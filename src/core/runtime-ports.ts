export const DEV_BRIDGE_PORT = 19511
export const PROD_BRIDGE_PORT = 19514

export const DEV_LOA_HTTP_PORT = 19512
export const PROD_LOA_HTTP_PORT = 19513

export const DEV_REMOTE_DEBUGGING_PORT = 9223
export const PROD_REMOTE_DEBUGGING_PORT = 9222

export function defaultBridgePortForPackaging(isPackaged: boolean): number {
  return isPackaged ? PROD_BRIDGE_PORT : DEV_BRIDGE_PORT
}

export function defaultLoaHttpPortForPackaging(isPackaged: boolean): number {
  return isPackaged ? PROD_LOA_HTTP_PORT : DEV_LOA_HTTP_PORT
}

export function defaultRemoteDebuggingPortForPackaging(isPackaged: boolean): number {
  return isPackaged ? PROD_REMOTE_DEBUGGING_PORT : DEV_REMOTE_DEBUGGING_PORT
}
