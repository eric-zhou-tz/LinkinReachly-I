import { getLoa } from '../loa-client'

let upgradeShownThisSession = false

export function hasShownUpgradeThisSession(): boolean {
  return upgradeShownThisSession
}

function markUpgradeShown(): void {
  upgradeShownThisSession = true
}

export function trackUpgradeClicked(source: string): void {
  markUpgradeShown()
  const loa = getLoa()
  void loa.settingsSave({}).catch(() => {})
}
