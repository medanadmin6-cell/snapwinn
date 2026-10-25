import { getSetting } from '@/lib/settings-store'
import {
  getMinFirstDeposit as staticMinFirstDeposit,
  getVerificationAmount as staticVerificationAmount,
  type CountryCode,
} from '@/lib/countries'

// Admin-editable minimum deposit, stored per country in app_settings so the
// operator changes it from /admin/settings without a redeploy. The DB value
// wins; absent (or cleared) it falls back to the env override, then the
// compiled default in lib/countries.ts.

export function minDepositKey(country: CountryCode): string {
  return `min_first_deposit_${country}`
}

export async function getMinDeposit(country: CountryCode): Promise<number> {
  const n = Number(await getSetting(minDepositKey(country)))
  if (Number.isFinite(n) && n > 0) return n
  return staticMinFirstDeposit(country)
}

export function verificationAmountKey(country: CountryCode): string {
  return `verification_amount_${country}`
}

/**
 * Per-deposit verification threshold — its own setting, independent of the
 * deposit minimum (GH verifies on 300+ deposits while accepting 200 ones).
 * Keep it at or above the minimum: verification payments go through the
 * normal deposit flow, so a threshold below the minimum is harmless, but a
 * minimum above the threshold would let sub-threshold deposits through that
 * then don't count.
 */
export async function getVerificationThreshold(country: CountryCode): Promise<number> {
  const n = Number(await getSetting(verificationAmountKey(country)))
  if (Number.isFinite(n) && n > 0) return n
  return staticVerificationAmount(country)
}
