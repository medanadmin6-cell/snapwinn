import { NextResponse } from 'next/server'
import { findUserById } from '@/lib/users-store'
import { recordPayment } from '@/lib/payments-store'
import { getCountry } from '@/lib/countries'
import { getMinDeposit } from '@/lib/deposit-settings'
import { supabaseServer } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const BUCKET = 'deposit-screenshots'
const MAX_BYTES = 5_000_000
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

function sanitizeReturnPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/me'
  return raw
}

function pickExtension(file: File): string {
  const fromName = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
    : ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(fromName)) return fromName
  if (file.type === 'image/jpeg') return 'jpg'
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'image/gif') return 'gif'
  return 'bin'
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }

  const userId = (form.get('userId')?.toString() ?? '').trim()
  const amount = Number(form.get('amount'))
  const purposeRaw = form.get('purpose')?.toString() ?? 'deposit'
  const purpose: 'deposit' | 'verification' =
    purposeRaw === 'verification' ? 'verification' : 'deposit'
  const returnPath = sanitizeReturnPath(form.get('returnPath')?.toString() ?? null)
  const file = form.get('file')

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'screenshot file required' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'screenshot is empty' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `screenshot too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 5 MB)` },
      { status: 400 },
    )
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported file type: ${file.type}` },
      { status: 400 },
    )
  }

  const user = await findUserById(userId)
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

  const countryCfg = getCountry(user.country)
  if (countryCfg.gateway !== 'manual') {
    return NextResponse.json(
      { error: 'manual deposits are not enabled for this country' },
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

  // Upload screenshot first — if storage fails we don't want a payment row
  // pointing at nothing.
  const supabase = supabaseServer()
  const ext = pickExtension(file)
  const key = `${userId.slice(0, 8)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(key, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (uploadErr) {
    return NextResponse.json(
      { error: `upload failed: ${uploadErr.message}` },
      { status: 500 },
    )
  }
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key)
  const screenshotUrl = pub.publicUrl

  const refPrefix = purpose === 'verification' ? 'PB-VRF' : 'PB-DEP'
  const reference = `${refPrefix}-MAN-${userId.slice(0, 8)}-${Date.now()}`

  try {
    const payment = await recordPayment({
      userId,
      reference,
      amount,
      type: 'deposit',
      status: 'pending',
      provider: 'manual',
      currency: user.currency,
      metadata: {
        purpose,
        returnPath,
        userName: user.name,
        userPhone: user.phone ?? null,
        country: user.country,
        source: 'manual_upload',
        screenshotUrl,
        screenshotKey: key,
      },
    })
    return NextResponse.json(
      {
        ok: true,
        reference,
        screenshotUrl,
        payment: payment
          ? { id: payment.id, status: payment.status, amount: payment.amount }
          : null,
      },
      { status: 201 },
    )
  } catch (e) {
    // Roll back the upload so we don't leave an orphan file
    await supabase.storage.from(BUCKET).remove([key]).catch(() => {})
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to record payment' },
      { status: 500 },
    )
  }
}
