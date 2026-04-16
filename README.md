# LinkinReachly

An Electron desktop app + Chrome extension that automates LinkedIn Easy Apply job applications. Users sign in, configure their profile and preferences, and the app fills out and submits applications automatically.

## Architecture

```
┌─────────────────────────┐     WebSocket      ┌──────────────────┐
│   Electron Main Process │◄───────────────────►│ Chrome Extension │
│   (src/main/)           │     (bridge)        │ (extension/)     │
│                         │                     │                  │
│ • CDP automation        │                     │ • Content scripts│
│ • Queue management      │                     │ • LinkedIn DOM   │
│ • Settings & auth       │                     │ • Form filling   │
│ • Telemetry             │                     │                  │
└────────┬────────────────┘                     └──────────────────┘
         │ IPC
┌────────▼────────────────┐
│   Electron Renderer     │
│   (src/renderer/)       │
│                         │
│ • React UI              │
│ • Wizard onboarding     │
│ • Job queue panel       │
│ • Settings              │
└─────────────────────────┘
```

**Key directories:**

| Path | What it does |
|------|-------------|
| `src/main/` | Electron main process — CDP browser automation, application queue, settings, IPC handlers |
| `src/main/easy-apply/` | Easy Apply flow — button clicking, form filling, navigation |
| `src/renderer/src/` | React frontend — components, auth, state management |
| `src/core/` | Shared types and utilities used by both main and renderer |
| `extension/` | Chrome extension — content scripts for LinkedIn page interaction |
| `tests/unit/` | Unit tests (Vitest) |

## Setup

### Prerequisites
- Node.js 18+
- npm
- Google Chrome

### Install & Run

```bash
# Install dependencies
npm install

# Start the Electron app in dev mode
npm run dev
```

### Load the Chrome Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the `extension/` folder from this repo
4. The LinkinReachly extension icon should appear in your Chrome toolbar

### Authentication

The app uses Google sign-in. Click "Sign in with Google" on the login screen — it will open your default browser for OAuth consent, then redirect back to the app.

### Run Tests

```bash
npm test              # Unit tests
npm run typecheck     # TypeScript type checking
```

## Contributing

Pull requests welcome. Please run `npm run typecheck && npm test` before submitting and include tests for any changes.

## Disclaimer

This project is shared for educational purposes. Automating interactions with third-party platforms may violate their terms of service. Use at your own risk and discretion.

## License

MIT
