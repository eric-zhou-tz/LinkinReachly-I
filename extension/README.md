# LinkedIn Outreach Automation — Chrome extension

This is the **official branded bridge** for the **LinkedIn Outreach Automation** desktop app.

## Location

- **Repository path:** `linkedin-outreach-automation/extension/`
- **After `npm run dist`:** the installer copies this folder to **`resources/extension`** next to the app; use **Setup → Open extension folder** in the desktop app to find it.

## Install (developer / unpacked)

1. Build icons if needed: parent app `npm run assets` (generates `../build/icon.png`), then regenerate icons:
   ```bash
   python3 -c "from PIL import Image; from pathlib import Path; r=Path('..'); im=Image.open(r/'build'/'icon.png').convert('RGBA'); [(im.resize((s,s), Image.Resampling.LANCZOS).save(f'icons/icon{s}.png')) for s in (16,32,48,128)]"
   ```
   (Run from this `extension/` directory.)
2. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → select **this folder** (`extension`).

## What it does

- Connects through `ws://127.0.0.1:19511` and follows the Electron app’s configured bridge port automatically when the **LinkedIn Outreach Automation** app is running.
- Runs automation steps in **linkedin.com** tabs only (content script).
- **Toolbar state:** **ON** / **WAIT** / **STOP** badges appear **only on linkedin.com** tabs (per-tab badge API). On other sites the icon has no badge so it is not confused with “globally on.” **Click the icon** to toggle **ON** ↔ **STOP** (while stopped there is no WebSocket and no auto-reconnect). Colors: **ON** (green) = linked to the desktop app; **WAIT** (amber) = bridge armed — open the Electron app; **STOP** (red) = you halted the bridge.
- **Brand:** navy rounded square with **two linked orange nodes** (connection metaphor); regenerate via `npm run assets` in the parent app.

After changing `background.js` or icons, open `chrome://extensions` and click **Reload** on this extension.

## Privacy

This extension only talks to **localhost** and **linkedin.com**. It does not include analytics or third-party SDKs. Message text and targets are handled by the **desktop app** (your saved templates).
