import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/settings-store'
import { getMinDeposit } from '@/lib/deposit-settings'
import { isCountryCode } from '@/lib/countries'

export const dynamic = 'force-dynamic'

// Public: the manual-deposit MoMo number + account name shown on the deposit
// screen, plus the minimum deposit for the caller's country (?country=GH).
// DB setting wins; falls back to env, then a built-in default.
export async function GET(request: Request) {
  // DB setting wins when present; otherwise the built-in default. (We do NOT
  // fall back to env vars — a stale NEXT_PUBLIC_DEPOSIT_* on the host was
  // overriding this, showing an old name.)
  const s = await getSettings(['deposit_number', 'deposit_name'])
  const countryParam = new URL(request.url).searchParams.get('country') ?? ''
  const country = isCountryCode(countryParam) ? countryParam : 'GH'
  return NextResponse.json({
    number: s.deposit_number || '0534922921',
    name: s.deposit_name || 'KOJO MABIGMAN',
    minDeposit: await getMinDeposit(country),
  })
}
