import { app } from 'electron'
import { join } from 'node:path'

const DEV_APP_NAME = 'LinkinReachly Dev'

function userDataOverride(): string {
  return String(process.env['LOA_USER_DATA_DIR'] || '').trim()
}

function defaultDevUserDataDir(): string {
  return join(app.getPath('appData'), DEV_APP_NAME)
}

export function configureRuntimeIdentity(): void {
  const override = userDataOverride()
  if (!app.isPackaged) {
    app.setName(DEV_APP_NAME)
  }
  if (override) {
    app.setPath('userData', override)
    return
  }
  if (!app.isPackaged) {
    app.setPath('userData', defaultDevUserDataDir())
  }
}

export function userDataDir(): string {
  const override = userDataOverride()
  if (override) return override
  if (!app.isPackaged) return defaultDevUserDataDir()
  return app.getPath('userData')
}
