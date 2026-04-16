import { shell, type BrowserWindow } from 'electron'
import { parseSafeExternalUrl, SAFE_EXTERNAL_URL_ERROR } from '@core/external-url'

export async function openExternalUrl(url: string): Promise<{ ok: true } | { ok: false; detail: string }> {
  const parsed = parseSafeExternalUrl(url)
  if (!parsed) {
    return { ok: false, detail: SAFE_EXTERNAL_URL_ERROR }
  }

  await shell.openExternal(parsed.toString())
  return { ok: true }
}

const FIREBASE_AUTH_PATTERNS = [
  /^https:\/\/accounts\.google\.com\//,
  /^https:\/\/[a-z0-9-]+\.firebaseapp\.com\/__\/auth\//,
  /^https:\/\/www\.googleapis\.com\/identitytoolkit\//,
]

function isFirebaseAuthPopup(url: string): boolean {
  return FIREBASE_AUTH_PATTERNS.some((re) => re.test(url))
}

export function secureBrowserWindowNavigation(window: BrowserWindow): void {
  const { webContents } = window

  webContents.setWindowOpenHandler(({ url }) => {
    if (isFirebaseAuthPopup(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      }
    }
    void openExternalUrl(url)
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, url) => {
    const currentUrl = webContents.getURL()
    if (!currentUrl || url === currentUrl) return
    event.preventDefault()
    void openExternalUrl(url)
  })
}
