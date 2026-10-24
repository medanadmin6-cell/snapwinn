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

/**
 * Per-deposit verification threshold. Driven by the same admin setting as the
 * deposit minimum: the two are kept equal everywhere in countries.ts, because
 * verification payments go through the normal deposit flow — a threshold
 * below the minimum would ask players for a deposit the gateway then rejects.
 */
export async function getVerificationThreshold(country: CountryCode): Promise<number> {
  const n = Number(await getSetting(minDepositKey(country)))
  if (Number.isFinite(n) && n > 0) return n
  return staticVerificationAmount(country)
}
