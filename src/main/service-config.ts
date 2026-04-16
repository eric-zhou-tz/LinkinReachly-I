// ---------------------------------------------------------------------------
// service-config.ts — External service credentials and endpoints.
// Values come from environment variables; defaults are placeholder empty strings
// that disable the feature when unconfigured.
// ---------------------------------------------------------------------------

interface ServiceConfig {
  firebase: {
    apiKey: string
    authDomain: string
    projectId: string
    appId: string
  }
  cloudFunctions: {
    url: string
  }
  llmProxy: {
    url: string
  }
}

// Vite's `define` only replaces static `process.env.X` references —
// dynamic `process.env[name]` is NOT replaced at compile time.
// Use static references so the values are inlined by the build.
function s(val: string | undefined, fallback = ''): string {
  return val?.trim() || fallback
}

let _config: ServiceConfig | null = null

export function getServiceConfig(): ServiceConfig {
  if (_config) return _config
  const projectId = s(process.env.LR_FIREBASE_PROJECT_ID)
  const region = s(process.env.LR_FIREBASE_FUNCTIONS_REGION, 'us-central1')
  _config = {
    firebase: {
      apiKey: s(process.env.LR_FIREBASE_API_KEY),
      authDomain: s(process.env.LR_FIREBASE_AUTH_DOMAIN),
      projectId,
      appId: s(process.env.LR_FIREBASE_APP_ID),
    },
    cloudFunctions: {
      url: s(process.env.LR_CLOUD_FUNCTIONS_URL, projectId ? `https://${region}-${projectId}.cloudfunctions.net` : ''),
    },
    llmProxy: {
      url: s(process.env.LR_LLM_PROXY_URL),
    },
  }
  return _config
}

export function isBackendConfigured(): boolean {
  const c = getServiceConfig()
  return !!(c.firebase.apiKey && c.firebase.projectId)
}
