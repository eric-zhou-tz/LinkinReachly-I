# `src/core`

Portable **domain logic** for LinkedIn Outreach Automation:

- **`types.ts`** — `TargetRow`, `ProfileFacts`, `QueueState`
- **`csv-targets.ts`** — `parseTargetsCsv()`, `parseTargetsCsvWithDiagnostics()`
- **`message-compose.ts`** — `fillTemplate`, `pickVariant`, `validateMessageBody`
- **`template-presets.ts`** — `BUILTIN_DEFAULT_TEMPLATES`
- **`executions.ts`** — `EXECUTION_REGISTRY`, execution definitions, template/pack resolvers
- **`demo-presets.ts`** — starter templates, seed CSVs for onboarding
- **`linkedin-url.ts`** — `isLinkedInUrl`, `canonicalProfileUrlKey`
- **`loa-http-port.ts`** — `LOA_HTTP_PORT` constant
- **`index.ts`** — barrel re-exports

Imported from Electron **main**, Vite **renderer** (`@core/*`), and **Vitest** (`tests/unit/core/`). Do not import Electron, React, or `chrome` APIs here.
