import { useCallback, useEffect, useRef, useState } from 'react'
import { getLoa, isElectronLoaAvailable } from '@/loa-client'

const MAX_LINES = 2500

export type DebugLogSide = 'left' | 'right'

type Props = {
  open: boolean
  side: DebugLogSide
  onSideChange: (side: DebugLogSide) => void
  onClose: () => void
}

const BROWSER_TAIL_POLL_MS = 2000

/** `readRuntimeLogTailLines` returns oldest-first; UI shows newest-first at the top. */
function tailLinesNewestFirst(raw: string[]): string[] {
  return raw.length <= 1 ? [...raw] : [...raw].reverse()
}

function formatRuntimeTailError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/unknown channel:\s*logs:runtime:tail/i.test(m)) {
    return `${m} Quit every LinkinReachly window and dev/Electron process, then start again so the desktop API matches this UI (or open main.log via Settings → Open logs folder).`
  }
  return m
}

const QUICK_FILTERS = [
  { label: 'Apply', value: '[apply-trace]' },
  { label: 'Queue', value: '[apply-queue]' },
  { label: 'Bridge', value: 'bridge' },
  { label: 'Error', value: 'ERROR' }
] as const

export function RuntimeDebugLogDock({ open, side, onSideChange, onClose }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [followTail, setFollowTail] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [streamingHint, setStreamingHint] = useState('')
  const [tailError, setTailError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const linesRef = useRef<string[]>([])
  const followTailRef = useRef(followTail)

  useEffect(() => {
    followTailRef.current = followTail
  }, [followTail])

  const appendLine = useCallback((text: string) => {
    setLines((prev) => {
      const base = prev.length >= MAX_LINES ? prev.slice(0, MAX_LINES - 1) : prev
      const next = [text, ...base]
      linesRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    linesRef.current = lines
  }, [lines])

  const pullTail = useCallback(async (maxLines: number) => {
    const loa = getLoa()
    const r = await loa.runtimeLogTail({ maxLines })
    if (!r?.ok || !Array.isArray(r.lines)) {
      throw new Error('Log tail response missing ok/lines — is the desktop backend running?')
    }
    return r.lines
  }, [])

  useEffect(() => {
    if (!open) return
    const electron = isElectronLoaAvailable()
    setStreamingHint(
      electron
        ? 'Live stream via IPC.'
        : 'Browser: polled tail. Use Electron for live lines.'
    )
    let cancelled = false
    setTailError(null)
    void (async () => {
      try {
        const next = tailLinesNewestFirst(await pullTail(500))
        if (cancelled) return
        setLines(next)
        linesRef.current = next
        setTailError(null)
      } catch (e) {
        if (!cancelled) {
          setTailError(formatRuntimeTailError(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, pullTail])

  /** Browser / Vite-in-Chrome: preload IPC is absent, so log lines never stream; poll the file tail instead. */
  useEffect(() => {
    if (!open || isElectronLoaAvailable()) return
    const id = window.setInterval(() => {
      if (!followTailRef.current) return
      void (async () => {
        try {
          const next = tailLinesNewestFirst(await pullTail(800))
          setLines(next)
          linesRef.current = next
          setTailError(null)
        } catch (e) {
          setTailError(formatRuntimeTailError(e))
        }
      })()
    }, BROWSER_TAIL_POLL_MS)
    return () => window.clearInterval(id)
  }, [open, pullTail])

  useEffect(() => {
    if (!open) return
    const unsub = getLoa().onRuntimeLogLine((line) => {
      appendLine(line.text)
    })
    return unsub
  }, [open, appendLine])

  useEffect(() => {
    if (!open || !followTail) return
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = 0
  }, [lines, open, followTail])

  const handleRefreshTail = useCallback(() => {
    void (async () => {
      try {
        const next = tailLinesNewestFirst(await pullTail(800))
        setLines(next)
        linesRef.current = next
        setTailError(null)
      } catch (e) {
        setTailError(formatRuntimeTailError(e))
      }
    })()
  }, [pullTail])

  const handleCopyAll = useCallback(async () => {
    const text = [...linesRef.current].reverse().join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('aria-hidden', 'true')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
  }, [])

  if (!open) return null

  return (
    <aside
      className={`runtime-debug-dock runtime-debug-dock--${side}`}
      aria-label="Runtime log"
    >
      <div className="runtime-debug-dock__header">
        <span className="runtime-debug-dock__title">Runtime log</span>
        <div className="runtime-debug-dock__header-actions">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => onSideChange(side === 'right' ? 'left' : 'right')}
            title={side === 'right' ? 'Dock log on the left' : 'Dock log on the right'}
            aria-label={side === 'right' ? 'Move log dock to left side' : 'Move log dock to right side'}
          >
            {side === 'right' ? 'Move left' : 'Move right'}
          </button>
          <label className="runtime-debug-dock__follow">
            <input
              type="checkbox"
              checked={followTail}
              onChange={(e) => setFollowTail(e.target.checked)}
            />
            Follow tail
          </label>
          <button type="button" className="btn btn-ghost btn-xs" onClick={handleRefreshTail} title="Reload last lines from main.log" aria-label="Refresh log">
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => void handleCopyAll()}
            disabled={lines.length === 0}
            title="Copy entire log to clipboard"
            aria-label="Copy all log lines to clipboard"
          >
            Copy all
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setLines([])}
          >
            Clear
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} aria-label="Close runtime log">
            Close
          </button>
        </div>
      </div>
      <div className="runtime-debug-dock__filter-bar">
        <input
          type="text"
          className="runtime-debug-dock__filter-input"
          placeholder="Filter log lines\u2026"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          aria-label="Filter log lines"
        />
        {filterText && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setFilterText('')}
            aria-label="Clear filter"
          >
            Clear
          </button>
        )}
        <span className="runtime-debug-dock__quick-filters">
          {QUICK_FILTERS.map((qf) => (
            <button
              key={qf.value}
              type="button"
              className={`btn btn-ghost btn-xs${filterText === qf.value ? ' btn--active' : ''}`}
              onClick={() => setFilterText(filterText === qf.value ? '' : qf.value)}
              title={`Filter: ${qf.value}`}
              aria-label={`Quick filter: ${qf.label}`}
            >
              {qf.label}
            </button>
          ))}
        </span>
      </div>
      <p className="runtime-debug-dock__hint muted caption">{streamingHint}</p>
      {tailError ? (
        <p className="runtime-debug-dock__error caption" role="alert">
          {tailError}
        </p>
      ) : null}
      <div
        ref={scrollerRef}
        className="runtime-debug-dock__scroll"
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {(() => {
          const filterLower = filterText.toLowerCase()
          const visible = filterText
            ? lines.filter((l) => l.toLowerCase().includes(filterLower))
            : lines
          if (visible.length === 0) {
            return (
              <p className="muted caption runtime-debug-dock__empty">
                {tailError
                  ? 'Could not load log lines. Fix the error above or use Refresh after the desktop app is running.'
                  : filterText
                    ? `No lines match "${filterText}" (${lines.length} total)`
                    : 'No log lines in tail yet. If the queue is active, wait a few seconds (browser mode polls), tap Refresh, or open main.log from Settings.'}
              </p>
            )
          }
          return (
            <>
              {filterText && (
                <p className="muted caption runtime-debug-dock__filter-count">
                  {visible.length} of {lines.length} lines
                </p>
              )}
              {visible.map((line, i) => (
                <div key={`${String(i)}-${line.slice(0, 24)}`} className="runtime-debug-dock__line">
                  {line}
                </div>
              ))}
            </>
          )
        })()}
      </div>
    </aside>
  )
}
