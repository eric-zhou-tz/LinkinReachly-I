# Architecture — LinkedIn Outreach Automation

Canonical behavior notes for main process and automation also live in `CLAUDE.md` at the repo root of `linkedin-outreach-automation/`.

## System overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│  Electron main (src/main/)                                          │
│  • WebSocket bridge server (default port from settings, e.g. 19511)    │
│  • HTTP API (localhost, see @core/loa-http-port) — renderer / tooling │
│  • Outreach queue, apply queue runner, settings, logger, LLM           │
└───────────────┬──────────────────────────────┬───────────────────────┘
                │ WS                            │ IPC
                ▼                               ▼
┌───────────────────────────┐    ┌──────────────────────────────────────┐
│  Chrome extension (MV3)      │    │  Electron renderer (React)          │
│  background.js + content.js │    │  preload → window.loa                │
└───────────────┬─────────────┘    └──────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  User Chrome tab — LinkedIn (Easy Apply, jobs search, outreach DOM)   │
└──────────────────────────────────────────────────────────────────────┘

```

**Apply:** LinkedIn Easy Apply uses the extension bridge + `application-assistant.ts` and the apply queue runner (`apply-queue-runner.ts`). One Electron main process owns the HTTP API, IPC, and bridge.

## Module layering

1. **`src/core/`** — Data and copy rules only. Importable from main, renderer (via bundler), and tests.
2. **`src/main/`** — Node/Electron capabilities: `ws`, `fs`, `safeStorage`, `BrowserWindow`, extension bridge.
3. **`src/renderer/`** — Presentation; calls `window.loa.*` or loopback HTTP in preview.
4. **`extension/`** — Browser execution environment; keep commands declarative (`action` + `payload`).

## Build outputs

| Output | Producer |
|--------|----------|
| `out/main/*` | electron-vite (main entry `src/main/index.ts`) |
| `out/preload/*` | electron-vite |
| `out/renderer/*` | Vite |
| `release/*` | electron-builder |

## Where to change what

| Change | Location |
|--------|----------|
| Template packs / CSV columns | `src/core/` |
| UI flow / tabs | `src/renderer/src/App.tsx` |
| Bridge protocol | `src/main/bridge.ts`, `extension/background.js` |
| LinkedIn selectors / modal logic | `extension/content.js` |
| IPC surface | `src/preload/index.ts`, `src/main/index.ts` |
| Native CDP snapshots / actions | `src/main/cdp-browser.ts` |
| External ATS fill loop | `src/main/native-apply-driver.ts` |
| Apply queue orchestration | `src/main/apply-queue-runner.ts` |
| Easy Apply + application IPC | `src/main/application-assistant.ts` |
