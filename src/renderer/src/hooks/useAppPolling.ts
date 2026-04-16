import { useEffect, useState, useCallback, useRef } from 'react'
import { getLoa } from '@/loa-client'

interface DailyProgress {
  applied: number
  cap: number
  configuredCap?: number
}

interface WeeklyOutreachWarn {
  sent: number
  cap: number
}

interface LifecycleCounts {
  applied: number
  outreach: number
  connected: number
  followedUp: number
  responded: number
}

export function useAppPolling() {
  const [dailyProgress, setDailyProgress] = useState<DailyProgress | null>(null)
  const [dailyOutreach, setDailyOutreach] = useState<number>(0)
  const [weeklyOutreachWarn, setWeeklyOutreachWarn] = useState<WeeklyOutreachWarn | null>(null)
  const [answerBankCount, setAnswerBankCount] = useState<number | null>(null)
  const [followUpBadge, setFollowUpBadge] = useState(0)
  const [queuedCount, setQueuedCount] = useState(0)
  const [lifecycleCounts, setLifecycleCounts] = useState<LifecycleCounts>({
    applied: 0, outreach: 0, connected: 0, followedUp: 0, responded: 0
  })

  const fetchDaily = useCallback(() => {
    getLoa().applicationQueueState().then((res) => {
      if (!mountedRef.current) return
      const r = res as { ok?: boolean; items?: Array<{ status?: string }>; dailyUsage?: { sent: number; cap: number; configuredCap?: number }; dailyOutreach?: { sent: number }; weeklyOutreach?: { sent: number; cap: number; pendingWarning: boolean } }
      if (!r?.ok) return
      if (r.dailyUsage) setDailyProgress({ applied: r.dailyUsage.sent, cap: r.dailyUsage.cap, configuredCap: r.dailyUsage.configuredCap })
      if (r.dailyOutreach) setDailyOutreach(r.dailyOutreach.sent)
      if (r.weeklyOutreach?.pendingWarning) setWeeklyOutreachWarn({ sent: r.weeklyOutreach.sent, cap: r.weeklyOutreach.cap })
      else setWeeklyOutreachWarn(null)
      if (Array.isArray(r.items)) {
        setQueuedCount(r.items.filter(i => i.status === 'pending' || i.status === 'active').length)
      }
    }).catch((err: unknown) => { console.warn('[useAppPolling] fetchDaily failed:', err) })
  }, [])

  const [historyAppliedUrls, setHistoryAppliedUrls] = useState<Set<string>>(new Set())

  const fetchBadges = useCallback(() => {
    getLoa().applicationHistory().then((res) => {
      if (!mountedRef.current || !res.ok) return
      const records = res.records as Array<{ outcome?: string; outreachStatus?: string; pipelineStage?: string; createdAt: string; jobUrl?: string }>
      const appRecords = records.filter((r) => r.outcome === 'submitted' || r.outcome === 'autofilled')
      const outreachSent = records.filter((r) => r.outreachStatus === 'sent').length
      const connected = records.filter((r) => r.outreachStatus === 'connected').length
      setLifecycleCounts(prev => ({
        ...prev,
        applied: appRecords.length,
        outreach: outreachSent,
        connected
      }))
      const urls = new Set<string>()
      for (const r of records) {
        if ((r.outcome === 'submitted' || r.outcome === 'autofilled') && r.jobUrl) urls.add(r.jobUrl)
      }
      setHistoryAppliedUrls(urls)
    }).catch((err: unknown) => { console.warn('[useAppPolling] applicationHistory failed:', err) })
    getLoa().followUpState().then((res) => {
      if (!mountedRef.current || !res.ok) return
      const data = res as { ok: boolean; stats: { acceptsThisWeek: number; responded: number } }
      setFollowUpBadge(data.stats.acceptsThisWeek)
      setLifecycleCounts(prev => ({
        ...prev,
        followedUp: data.stats.acceptsThisWeek,
        responded: data.stats.responded
      }))
    }).catch((err: unknown) => { console.warn('[useAppPolling] followUpState failed:', err) })
  }, [])

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    fetchDaily()
    fetchBadges()
    getLoa().applicantGet().then((res) => {
      if (!mountedRef.current) return
      if (res.ok) setAnswerBankCount(Object.keys(res.profile.screeningAnswerCache || {}).length)
    }).catch((err: unknown) => { console.warn('[useAppPolling] applicantGet failed:', err) })
    const id = setInterval(fetchDaily, 15_000)
    const badgeId = setInterval(fetchBadges, 30_000)
    return () => { mountedRef.current = false; clearInterval(id); clearInterval(badgeId) }
  }, [fetchDaily, fetchBadges])

  return { dailyProgress, dailyOutreach, weeklyOutreachWarn, answerBankCount, followUpBadge, queuedCount, lifecycleCounts, historyAppliedUrls }
}
