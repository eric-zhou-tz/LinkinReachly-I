import { useCallback, useState } from 'react'
import { getLoa } from '@/loa-client'

export function useLogs() {
  const [logs, setLogs] = useState<unknown[]>([])
  const [logsBusy, setLogsBusy] = useState<false | 'exporting' | 'clearing'>(false)
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null)

  const refreshLogs = useCallback(async () => {
    setLogs(await getLoa().logsRecent())
  }, [])

  const exportLogs = useCallback(async () => {
    setLogsBusy('exporting')
    setHistoryFeedback(null)
    try {
      const res = await getLoa().logsExport()
      if (res.ok) {
        setHistoryFeedback(`Exported full log to ${res.path}`)
      } else if (res.canceled) {
        setHistoryFeedback(null)
      } else {
        setHistoryFeedback('Could not export logs. Try again.')
      }
    } catch (e) {
      setHistoryFeedback(e instanceof Error ? e.message : String(e))
    } finally {
      setLogsBusy(false)
    }
  }, [])

  const clearLogs = useCallback(async () => {
    setLogsBusy('clearing')
    setHistoryFeedback(null)
    try {
      const res = await getLoa().logsClear()
      setLogs([])
      if (res.cleared > 0) {
        setHistoryFeedback(`Cleared ${res.cleared} log ${res.cleared === 1 ? 'entry' : 'entries'}.`)
      } else {
        setHistoryFeedback('Log is already empty.')
      }
    } catch (e) {
      setHistoryFeedback(e instanceof Error ? e.message : String(e))
    } finally {
      setLogsBusy(false)
    }
  }, [])

  return {
    logs,
    logsBusy,
    historyFeedback,
    refreshLogs,
    exportLogs,
    clearLogs
  }
}
