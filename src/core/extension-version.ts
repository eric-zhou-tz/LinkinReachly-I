/**
 * Minimum extension versions the Electron app expects. Bump when bridge or
 * content-script contracts change; users must reload the packed extension in
 * chrome://extensions after updates.
 */
/** Minimum content-script version the app requires (alias for docs / single bump point). */
const EXPECTED_EXTENSION_VERSION = 16

export const EXPECTED_CONTENT_SCRIPT_VERSION = EXPECTED_EXTENSION_VERSION
export const EXPECTED_BACKGROUND_BRIDGE_VERSION = 2

export const STALE_EXTENSION_USER_MESSAGE =
  'Extension outdated. Reload LinkinReachly in Chrome\u2019s Extensions page, then retry.'

export const EXTENSION_RELOAD_QUEUE_HINT =
  'Extension needs a reload. Open Chrome\u2019s Extensions page, reload LinkinReachly, then retry the queue.'
