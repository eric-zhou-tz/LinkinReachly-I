/**
 * SemperSignum-style execution profiles: one selectable “signal” bundles queue behavior,
 * template pack, and log channel for downstream follow-up filtering.
 */

import {
  DEMO_SEED_CSV,
  DEMO_STARTER_TEMPLATES,
  INFLUENCER_DEMO_SEED_CSV,
  JOB_DEMO_SEED_CSV,
  RIA_DEMO_SEED_CSV
} from './demo-presets'

type QueueKind = 'connection_invite_note' | 'post_accept_dm'

export interface ExecutionDefinition {
  id: string
  /** Short UI label */
  label: string
  /** One-line description for Run / Setup */
  description: string
  queueKind: QueueKind
  templatePackId: string
  logChannel: string
  /** CSV column names that should be present for best results (soft validation). */
  requiredCsvHeaders: string[]
  /**
   * When non-empty, compose uses these templates (with placeholders) for this execution.
   * When empty, the app uses templates from Settings (Setup tab).
   */
  packTemplates: string[]
  /** Follow-up DM templates (post_accept_dm); same placeholder rules as connection notes. */
  followUpPackTemplates: string[]
  /**
   * Selecting this execution pre-fills the Run CSV so Start works without pasting.
   * Omit for follow-up-only (log-driven; list optional).
   */
  starterCsv?: string
}

const GENERIC_FALLBACK_TEMPLATES: string[] = []

export const EXECUTION_REGISTRY: ExecutionDefinition[] = [
  {
    id: 'generic_connection',
    label: 'Standard invite',
    description:
      'Simple peer outreach with a short default note. Use your own list or the starter example to begin quickly.',
    queueKind: 'connection_invite_note',
    templatePackId: 'none',
    logChannel: 'generic',
    requiredCsvHeaders: ['profileUrl'],
    starterCsv: DEMO_SEED_CSV.trimEnd() + '\n',
    packTemplates: GENERIC_FALLBACK_TEMPLATES,
    followUpPackTemplates: []
  },
  {
    id: 'sample_signal',
    label: 'Test run (safe demo)',
    description: 'Built-in example row and friendly peer note for onboarding, walkthroughs, and safe first runs.',
    queueKind: 'connection_invite_note',
    templatePackId: 'sample_signal',
    logChannel: 'sample',
    requiredCsvHeaders: ['profileUrl'],
    starterCsv: DEMO_SEED_CSV.trimEnd() + '\n',
    packTemplates: [
      'Hi {firstName} — I noticed your work at {company} and would like to connect. Hope you are having a good week.'
    ],
    followUpPackTemplates: [
      'Hi {firstName} — thanks for connecting. No rush — if peers at {company} ever compare notes on RIA outreach, happy to swap learnings.'
    ]
  },
  {
    id: 'ria_connection',
    label: 'Financial advisor network',
    description: 'RIA list-building angle: firm + principal placeholders. Optional: {ticker}, {message_variant} from CSV for holdings-aware copy.',
    queueKind: 'connection_invite_note',
    templatePackId: 'ria_connection',
    logChannel: 'ria',
    requiredCsvHeaders: ['profileUrl', 'firm_name', 'principal_name'],
    starterCsv: RIA_DEMO_SEED_CSV.trimEnd() + '\n',
    packTemplates: [
      'Hi {firstName} — I am reaching out to principals at {firm_name} doing thoughtful allocator work. Would be glad to connect.',
      '{firstName}, your leadership at {firm_name} stood out. I work with a small network of RIAs and would like to connect as a peer.',
      'Hi {firstName} — mutual respect for how {firm_name} approaches risk. A connection here would be welcome when you have a moment.',
      'Hi {firstName}, I noticed {firm_name} in allocator circles and thought a light peer connection made sense — no pitch, just network.',
      'Hi {firstName} — if {ticker} names ever come up in your research stack: happy to compare notes. Would love to connect.',
      'Hi {firstName}, {message_variant}'
    ],
    followUpPackTemplates: [
      'Hi {firstName} — thanks for connecting. When you have a cycle, curious how {firm_name} thinks about manager diligence lately — happy to share what we see across peers.',
      'Hi {firstName} — appreciate the connection. No agenda — if allocator ops at {firm_name} ever want a second pair of eyes on a manager shortlist, I am around.'
    ]
  },
  {
    id: 'influencer_connection',
    label: 'Shared interest',
    description: 'Warmer intro referencing shared ecosystem or content — still short and peer-like.',
    queueKind: 'connection_invite_note',
    templatePackId: 'influencer_connection',
    logChannel: 'influencer',
    requiredCsvHeaders: ['profileUrl', 'firstName'],
    starterCsv: INFLUENCER_DEMO_SEED_CSV.trimEnd() + '\n',
    packTemplates: [
      'Hi {firstName} — we overlap in the same corner of the market. I enjoy your public takes; would be glad to connect here.',
      '{firstName}, I have been following your commentary alongside {company}. Would love a simple connection if you are open.',
      'Hi {firstName} — mutual folks in {company}’s orbit suggested we might get value from connecting. No ask beyond that.'
    ],
    followUpPackTemplates: [
      'Hi {firstName} — thanks for connecting. If you ever want raw notes from the allocator weeds (contrarian to the feed), I can share.',
      'Hi {firstName} — appreciate the link. Happy to compare notes on what is actually working in outreach vs what people post about.'
    ]
  },
  {
    id: 'job_signal_connection',
    label: 'Hiring opportunity',
    description: 'For orgs or contacts where a hiring or growth signal is the honest reason.',
    queueKind: 'connection_invite_note',
    templatePackId: 'job_signal_connection',
    logChannel: 'job',
    requiredCsvHeaders: ['profileUrl', 'company'],
    starterCsv: JOB_DEMO_SEED_CSV.trimEnd() + '\n',
    packTemplates: [
      'Hi {firstName} — saw {company} growing the team and thought a connection might be useful down the line.',
      '{firstName}, congrats on the momentum at {company}. I recruit in adjacent spaces — would be glad to connect.',
      'Hi {firstName} — {company}’s hiring motion caught my eye. A light connection here could be helpful later.'
    ],
    followUpPackTemplates: [
      'Hi {firstName} — thanks for connecting. If {company} ever wants a tight intro loop for a hard-to-fill seat, I can point you to a few folks.',
      'Hi {firstName} — appreciate the connection. When hiring picks up again at {company}, happy to share what candidates actually ask behind closed doors.'
    ]
  },
  {
    id: 'post_accept_followup',
    label: 'Follow-up message',
    description:
      'Step 4 style: opens Connections, matches recent accepts to your sent log by channel, sends a short DM. Optional CSV — leave blank to use log only.',
    queueKind: 'post_accept_dm',
    templatePackId: 'post_accept_followup',
    logChannel: 'followup',
    requiredCsvHeaders: ['profileUrl'],
    packTemplates: [],
    followUpPackTemplates: [
      'Hi {firstName} — thanks for connecting. Hope your week is going well at {company}.',
      'Hi {firstName} — appreciate the connection. If peers at {company} ever want a quick swap on allocator tooling, I am around.',
      '{firstName} — grateful for the connect. No pitch; if our paths cross on a deal or manager screen, say hello.'
    ]
  },
  {
    id: 'post_apply_connection',
    label: 'Post-apply outreach',
    description:
      'Reach out to hiring managers after applying. References the specific role you applied for — the "apply + network" move that gets responses.',
    queueKind: 'connection_invite_note',
    templatePackId: 'post_apply_connection',
    logChannel: 'post_apply',
    requiredCsvHeaders: ['profileUrl', 'company'],
    packTemplates: [
      'Hi {firstName} — I recently applied for the {jobTitle} role at {company} and wanted to connect directly. I am excited about the team and think my background is a strong fit.',
      '{firstName}, I submitted an application for {jobTitle} at {company} and noticed your work there. Would love to connect and learn more about the team.',
      'Hi {firstName} — I applied for the {jobTitle} position at {company} and thought a direct connection would be valuable. Looking forward to the opportunity.'
    ],
    followUpPackTemplates: [
      'Hi {firstName} — thanks for connecting. I applied for the {jobTitle} role at {company} recently — if there is anything helpful I can share about my background, happy to do so.',
      '{firstName} — appreciate the connection. Excited about the {jobTitle} opportunity at {company}. Let me know if you would like to chat.'
    ]
  }
]

const BY_ID = new Map(EXECUTION_REGISTRY.map((e) => [e.id, e]))

/** Default profile for new installs and invalid ids — opens ready-to-run with starter list + pack. */
export const DEFAULT_EXECUTION_ID = 'generic_connection'

/**
 * Templates persisted when the user picks an execution so a run works without opening Setup.
 * Follow-up executions do not overwrite note templates (DM copy comes from the registry).
 */
export function persistedTemplatesForExecutionSelect(id: string): string[] | undefined {
  const ex = getExecutionById(id)
  if (!ex || ex.queueKind === 'post_accept_dm') return undefined
  if (ex.packTemplates.length > 0) return [...ex.packTemplates]
  return [...DEMO_STARTER_TEMPLATES]
}

export function getExecutionById(id: string | undefined): ExecutionDefinition | undefined {
  if (!id) return undefined
  return BY_ID.get(id)
}

/** Normalize CSV / UI values to a registry id. */
export function normalizeExecutionSlug(raw: string | undefined): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
  if (!s) return undefined
  if (BY_ID.has(s)) return s
  const aliases: Record<string, string> = {
    ria: 'ria_connection',
    peer: 'ria_connection',
    sample: 'sample_signal',
    demo: 'sample_signal',
    influencer: 'influencer_connection',
    job: 'job_signal_connection',
    hiring: 'job_signal_connection',
    followup: 'post_accept_followup',
    follow_up: 'post_accept_followup',
    dm: 'post_accept_followup',
    post_apply: 'post_apply_connection',
    reach_out: 'post_apply_connection',
    reachout: 'post_apply_connection'
  }
  const mapped = aliases[s]
  return mapped && BY_ID.has(mapped) ? mapped : undefined
}

export function resolveExecutionIdForRow(
  row: { executionId?: string; execution?: string; signal?: string },
  lastExecutionId: string
): string {
  const fromRow =
    normalizeExecutionSlug(row.executionId) ||
    normalizeExecutionSlug(row.execution) ||
    normalizeExecutionSlug(row.signal)
  if (fromRow) return fromRow
  const last = normalizeExecutionSlug(lastExecutionId) || lastExecutionId
  return getExecutionById(last) ? last : DEFAULT_EXECUTION_ID
}

/** Templates for connection note step: pack if defined, else user settings. */
export function templatesForConnectionCompose(
  executionId: string,
  settingsTemplates: string[]
): string[] {
  const ex = getExecutionById(executionId) ?? getExecutionById(DEFAULT_EXECUTION_ID)!
  if (ex.packTemplates.length > 0) return ex.packTemplates
  return settingsTemplates.length
    ? settingsTemplates
    : ['Hi {firstName}, would love to connect.']
}

/** Templates for post-accept DM: follow-up pack, or settings templates as fallback. */
export function templatesForFollowUpCompose(
  executionId: string,
  settingsTemplates: string[]
): string[] {
  const ex = getExecutionById(executionId) ?? getExecutionById(DEFAULT_EXECUTION_ID)!
  if (ex.followUpPackTemplates.length > 0) return ex.followUpPackTemplates
  return settingsTemplates.length
    ? settingsTemplates
    : ['Hi {firstName} — thanks for connecting.']
}

export function sourceConnectionExecutionForLogEntry(entry: {
  executionId?: string
  logChannel?: string
}): ExecutionDefinition | undefined {
  const byExecutionId = getExecutionById(entry.executionId)
  if (byExecutionId?.queueKind === 'connection_invite_note') return byExecutionId

  if (!entry.logChannel) return undefined
  return EXECUTION_REGISTRY.find(
    (ex) => ex.queueKind === 'connection_invite_note' && ex.logChannel === entry.logChannel
  )
}

export function assertHomogeneousQueueKinds(executionIds: string[]): QueueKind | null {
  if (executionIds.length === 0) return null
  const kinds = new Set(
    executionIds.map((id) => getExecutionById(id)?.queueKind || 'connection_invite_note')
  )
  if (kinds.size > 1) return null
  return [...kinds][0] as QueueKind
}
