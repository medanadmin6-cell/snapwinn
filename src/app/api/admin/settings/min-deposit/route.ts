import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_COOKIE, isValidSessionCookie } from '@/lib/admin-auth'
import { setSetting } from '@/lib/settings-store'
import { getMinDeposit, minDepositKey } from '@/lib/deposit-settings'
import { isCountryCode, type CountryCode } from '@/lib/countries'

export const dynamic = 'force-dynamic'

// The countries the settings card edits. Others keep their compiled defaults.
const EDITABLE: CountryCode[] = ['GH', 'NG']

async function isAdmin(): Promise<boolean> {
  const store = await cookies()
  return isValidSessionCookie(store.get(ADMIN_COOKIE)?.value)
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const out: Record<string, number> = {}
  for (const c of EDITABLE) out[c] = await getMinDeposit(c)
  return NextResponse.json(out)
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const updates: Array<[CountryCode, number]> = []
  for (const [key, raw] of Object.entries(body)) {
    if (!isCountryCode(key)) continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: `${key}: minimum deposit must be a number above 0` },
        { status: 400 },
      )
    }
    updates.push([key, n])
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: 'nothing to save' }, { status: 400 })
  }

  try {
    for (const [country, amount] of updates) {
      await setSetting(minDepositKey(country), String(amount))
    }
  } catch (e) {
    return NextResponse.json(
      {
        error:
          (e instanceof Error ? e.message : 'failed to save') +
          ' — run migration 0018_app_settings.sql in Supabase.',
      },
      { status: 500 },
    )
  }

  const out: Record<string, number> = {}
  for (const c of EDITABLE) out[c] = await getMinDeposit(c)
  return NextResponse.json({ ok: true, ...out })
}
