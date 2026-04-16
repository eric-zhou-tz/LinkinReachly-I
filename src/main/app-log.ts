import { app } from 'electron'
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'
import log from 'electron-log/main.js'
import { userDataDir } from './user-data-path'

const RUNTIME_LOG_DIR_SEGMENTS = ['logs', 'runtime'] as const
const MAIN_LOG_FILENAME = 'main.log'
let loggingInitialized = false

function safeStderrWrite(line: string): void {
  try {
    if (process.stderr.writable) {
      process.stderr.write(line)
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'ECONNRESET') return
  }
}

export function runtimeLogsDir(): string {
  return join(userDataDir(), ...RUNTIME_LOG_DIR_SEGMENTS)
}

function ensureRuntimeLogsDir(): string {
  const dir = runtimeLogsDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function initializeAppLogging(): void {
  if (loggingInitialized) return
  log.transports.file.resolvePathFn = () => join(ensureRuntimeLogsDir(), MAIN_LOG_FILENAME)
  log.transports.console.level = app.isPackaged ? 'info' : 'debug'
  log.transports.file.level = 'info'
  ensureRuntimeLogsDir()
  log.initialize()
  Object.assign(console, log.functions)
  loggingInitialized = true
  const runtimePath = join(runtimeLogsDir(), MAIN_LOG_FILENAME)
  log.info(`[loa] Runtime log file: ${runtimePath}`)
}

export const appLog = log.scope('main')

const RUNTIME_TAIL_CHUNK = 524_288

/** Last non-empty lines from `main.log` (for debug panel bootstrap). */
export function readRuntimeLogTailLines(maxLines: number): string[] {
  const cap = Math.max(1, Math.min(maxLines, 2500))
  const p = join(runtimeLogsDir(), MAIN_LOG_FILENAME)
  if (!existsSync(p)) return []
  try {
    const st = statSync(p)
    if (st.size === 0) return []
    const start = Math.max(0, st.size - RUNTIME_TAIL_CHUNK)
    const len = st.size - start
    const fd = openSync(p, 'r')
    try {
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, start)
      const text = buf.toString('utf8').replace(/^\uFEFF/, '')
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
      return lines.slice(-cap)
    } finally {
      closeSync(fd)
    }
  } catch (e) {
    safeStderrWrite(
      `[app-log] readRuntimeLogTailLines failed: ${e instanceof Error ? e.message : String(e)}\n`
    )
    return []
  }
}

export function formatRuntimeLogMessage(message: {
  date: Date
  level: string
  scope?: string
  data: unknown[]
}): string {
  const ts = message.date.toISOString()
  const scope = message.scope ? `${message.scope} ` : ''
  const parts = message.data.map((d) =>
    typeof d === 'string'
      ? d
      : d instanceof Error
        ? d.stack || d.message
        : inspect(d, { depth: 4, maxArrayLength: 40, breakLength: 100, colors: false })
  )
  return `${ts} ${message.level.toUpperCase()} ${scope}${parts.join(' ')}`
}
