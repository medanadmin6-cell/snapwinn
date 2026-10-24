import { NextResponse } from 'next/server'
import { findUserById } from '@/lib/users-store'
import { recordPayment } from '@/lib/payments-store'
import { sendApprovalRequest } from '@/lib/telegram'
import { getMinDeposit } from '@/lib/deposit-settings'

export const dynamic = 'force-dynamic'

interface StartBody {
  userId?: string
  amount?: number
  purpose?: 'deposit' | 'verification'
}

// Creates a pending payment row tagged provider="telegram" and notifies
// the admin chat. The operator either approves (the bot calls
// /api/telegram/webhook → applyDepositCredit) or rejects. Until then the
// row stays in 'pending', and the user UI shows "Awaiting operator".
export async function POST(request: Request) {
  let body: StartBody
  try {
    body = (await request.json()) as StartBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const userId = (body.userId ?? '').trim()
  const amount = Number(body.amount)
  const purpose: 'deposit' | 'verification' =
    body.purpose === 'verification' ? 'verification' : 'deposit'

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }

  const user = await findUserById(userId)
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

  // Telegram pay flow is Nigeria-only for now. Other countries already
  // have automated gateways and don't need the manual operator path.
  if (user.country !== 'NG') {
    return NextResponse.json(
      { error: 'Telegram pay is available for Nigeria wallets only.' },
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

  const reference = `PB-TG-${userId.slice(0, 8)}-${Date.now()}`

  const payment = await recordPayment({
    userId,
    reference,
    amount,
    type: 'deposit',
    status: 'pending',
    provider: 'telegram',
    currency: user.currency,
    metadata: {
      purpose,
      userName: user.name,
      userPhone: user.phone ?? null,
      country: user.country,
      flow: 'telegram-operator-approval',
    },
  })
  if (!payment) {
    return NextResponse.json({ error: 'failed to record pending payment' }, { status: 500 })
  }

  try {
    await sendApprovalRequest({
      paymentId: payment.id,
      reference,
      amount,
      currency: user.currency,
      userName: user.name,
      userEmail: user.email,
      userPhone: user.phone ?? null,
      country: user.country,
    })
  } catch (e) {
    console.error('[telegram/start] failed to post approval message:', e)
    // Don't roll back the pending row — the operator can still see it on
    // the admin deposits page and credit manually. Let the user know
    // we couldn't auto-notify so they can reach out.
    return NextResponse.json(
      {
        ok: true,
        reference,
        paymentId: payment.id,
        warning: 'Payment recorded but the operator notification failed. Contact support.',
      },
      { status: 201 },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      reference,
      paymentId: payment.id,
    },
    { status: 201 },
  )
}
