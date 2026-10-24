import { NextResponse } from 'next/server'
import { findUserById } from '@/lib/users-store'
import { recordPayment } from '@/lib/payments-store'
import { chargeMoolreDirect } from '@/lib/moolre'
import { normalizePhone } from '@/lib/countries'
import { getMinDeposit } from '@/lib/deposit-settings'

export const dynamic = 'force-dynamic'

interface Body {
  userId?: string
  amount?: number
  phone?: string
  network?: string // 'mtn' | 'telecel' | 'airteltigo' — channel 13 handles all
  purpose?: 'deposit' | 'verification'
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const userId = (body.userId ?? '').trim()
  const amount = Number(body.amount)
  const phoneRaw = (body.phone ?? '').trim()
  const network = (body.network ?? 'mtn').trim()

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }

  const user = await findUserById(userId)
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

  // Moolre's mobile-money channel is Ghana / GHS.
  if (user.country !== 'GH') {
    return NextResponse.json(
      { error: 'Mobile-money deposits are available for Ghana accounts only.' },
      { status: 400 },
    )
  }

  // Moolre wants the local form: starts with 0, no country code. Channel 13
  // auto-detects MTN / Telecel / AirtelTigo from the number.
  const phone = normalizePhone('GH', phoneRaw)
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid mobile-money number, e.g. 0244XXXXXXX' },
      { status: 400 },
    )
  }

  const minDeposit = await getMinDeposit(user.country)
  if (amount < minDeposit) {
    return NextResponse.json(
      { error: `minimum deposit is ${user.currency} ${minDeposit.toFixed(2)}` },
      { status: 400 },
    )
  }

  // Neutral, non-branded ids. externalref is our tracking key (also the
  // payment row's reference); the customer-facing narration is generic.
  const externalref = `DEP${Date.now()}${userId.slice(0, 4)}`
  const narration = 'Wallet topup'

  try {
    await recordPayment({
      userId,
      reference: externalref,
      amount,
      type: 'deposit',
      status: 'pending',
      provider: 'moolre',
      currency: user.currency,
      metadata: {
        purpose: 'deposit',
        channel: 'mobile_money',
        flow: 'direct',
        network,
        momoPhone: phone,
        userName: user.name,
        country: 'GH',
      },
    })
  } catch (e) {
    console.error('[moolre/direct/start] pending ledger write failed:', e)
  }

  const charge = await chargeMoolreDirect({
    payer: phone,
    amount,
    reference: narration,
    externalref,
    currency: user.currency,
  })

  // Moolre sent an SMS OTP to the payer — the UI collects it and posts to
  // /api/payments/moolre/direct/otp to finish.
  if (charge.otpRequired) {
    return NextResponse.json(
      {
        reference: externalref,
        status: 'otp',
        displayText: 'Enter the verification code sent to your phone.',
      },
      { status: 201 },
    )
  }

  if (!charge.ok) {
    return NextResponse.json(
      { error: charge.message ?? 'Could not start the payment. Please try again.' },
      { status: 502 },
    )
  }

  return NextResponse.json(
    {
      reference: externalref,
      status: 'pending',
      displayText: 'Approve the Mobile Money prompt on your phone to complete the deposit.',
    },
    { status: 201 },
  )
}
