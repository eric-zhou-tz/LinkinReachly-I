import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { appLog } from './app-log'

type JsonStoreOptions = {
  /**
   * When true (default), write to `${dest}.tmp` then `renameSync` over the target
   * so readers never see a half-written file.
   */
  atomic?: boolean
}

/**
 * Generic JSON persistence: read/parse with safe fallbacks, optional atomic writes
 * (tmp + rename), and `mkdir -p` for the parent directory before save.
 *
 * Callers that need normalization, in-memory caching, or migration should wrap
 * `load`/`save` or compose this class — see existing `*-store.ts` modules.
 */
export class JsonStore<T> {
  constructor(
    private readonly filePath: string | (() => string),
    private readonly defaultValue: T,
    private readonly options?: JsonStoreOptions
  ) {}

  private resolvePath(): string {
    return typeof this.filePath === 'function' ? this.filePath() : this.filePath
  }

  private get useAtomic(): boolean {
    return this.options?.atomic !== false
  }

  /**
   * Read and parse JSON. Returns `defaultValue` when the file is missing,
   * unreadable, or contains invalid JSON.
   */
  load(): T {
    const path = this.resolvePath()
    if (!existsSync(path)) return this.defaultValue
    try {
      const raw = readFileSync(path, 'utf8')
      return JSON.parse(raw) as T
    } catch (e) {
      appLog.debug('[json-store] load read/parse failed, using default', e instanceof Error ? e.message : String(e))
      return this.defaultValue
    }
  }

  /**
   * Persist `data`. Ensures the parent directory exists. When atomic (default),
   * writes to `.tmp` then renames into place (with a rename retry matching
   * `applicant-profile-store` when the destination already exists).
   */
  save(data: T): void {
    const dest = this.resolvePath()
    const dir = dirname(dest)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const payload = JSON.stringify(data, null, 2)

    if (!this.useAtomic) {
      writeFileSync(dest, payload, 'utf8')
      return
    }

    const tmp = `${dest}.tmp`
    writeFileSync(tmp, payload, 'utf8')
    try {
      renameSync(tmp, dest)
    } catch (e) {
      appLog.debug('[json-store] atomic rename failed, retrying after unlink', e instanceof Error ? e.message : String(e))
      if (existsSync(dest)) {
        try {
          unlinkSync(dest)
        } catch (e2) {
          appLog.debug('[json-store] unlink before rename retry failed', e2 instanceof Error ? e2.message : String(e2))
          // best-effort; second rename may still fail
        }
      }
      renameSync(tmp, dest)
    }
  }

  /**
   * Load current state, apply `fn`, then save — one read/write pair (atomic write
   * per `save`); not a cross-process lock.
   */
  update(fn: (current: T) => T): void {
    this.save(fn(this.load()))
  }
}
