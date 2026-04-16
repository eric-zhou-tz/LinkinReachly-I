import { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApplicantAsset, ApplicantProfile, ApplicationCoverLetterMeta } from '@core/application-types'
import { appLog } from './app-log'
import { applyTrace } from './apply-trace'
import { callLlmDirect } from './llm'
import type { AppSettings } from './settings'
import { extractDocumentTextFromPath } from './resume'
import { userDataDir } from './user-data-path'

const COVER_LETTER_PROMPT_VERSION = 'easy_apply_cover_v1'

const MAX_COVER_PDF_BYTES = 512 * 1024

function sha256Short(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function coverTempDir(): string {
  const d = join(userDataDir(), 'tmp', 'cover-letters')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

async function resolveCoverLetterBaseText(
  profile: ApplicantProfile,
  coverAsset: ApplicantAsset | undefined
): Promise<{ text: string; source: 'profile' | 'asset_extract' } | null> {
  const fromProfile = String(profile.coverLetterTemplate || '').trim()
  if (fromProfile.length > 40) {
    return { text: fromProfile.slice(0, 20_000), source: 'profile' }
  }
  if (coverAsset?.storagePath && existsSync(coverAsset.storagePath)) {
    try {
      const text = (await extractDocumentTextFromPath(coverAsset.storagePath)).trim()
      if (text.length > 40) {
        return { text: text.slice(0, 20_000), source: 'asset_extract' }
      }
    } catch (e) {
      appLog.warn('[cover-letter] failed to extract text from cover asset', e instanceof Error ? e.message : String(e))
    }
  }
  return null
}

async function htmlToPdfFile(htmlDocument: string, outPath: string): Promise<number> {
  const win = new BrowserWindow({
    show: false,
    width: 720,
    height: 960,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      navigateOnDragDrop: false
    }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocument)}`)
    const pdf = await win.webContents.printToPDF({
      printBackground: false,
      pageSize: 'Letter',
      margins: { marginType: 'default' }
    })
    writeFileSync(outPath, pdf)
    return pdf.length
  } finally {
    win.destroy()
  }
}

function plainTextToParagraphHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const esc = block
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      const lines = esc.split(/\n/).join('<br/>')
      return `<p>${lines}</p>`
    })
    .join('')
}

type TailorCoverLetterParams = {
  profile: ApplicantProfile
  coverAsset: ApplicantAsset | undefined
  jobTitle: string
  company: string
  jdSnippet: string
  resumeSummary: string
  settings: AppSettings
  modelLabel: string
}

export async function tailorCoverLetterToPdf(
  params: TailorCoverLetterParams
): Promise<{ path: string; meta: ApplicationCoverLetterMeta } | null> {
  const base = await resolveCoverLetterBaseText(params.profile, params.coverAsset)
  const isFromScratch = !base

  if (isFromScratch && !params.resumeSummary.trim() && !params.jdSnippet.trim()) {
    applyTrace('easy_apply:cover_tailor_skipped_no_base', { reason: 'no_base_no_resume_no_jd' })
    return null
  }

  applyTrace('easy_apply:cover_tailor_start', {
    mode: isFromScratch ? 'generated' : 'tailored',
    templateSource: base?.source ?? 'scratch'
  })

  let enrich = ''
  if (params.settings.easyApplyEnrichCompanyContext) {
    try {
      const snippet = await callLlmDirect(
        'Return 3–5 short factual bullets about the employer or role context. No URLs. If unsure, say unknown. Output plain lines starting with "- ".',
        `Company: ${params.company}\nJob: ${params.jobTitle}\nJD excerpt:\n${params.jdSnippet.slice(0, 2000)}`,
        { timeoutMs: 8000, maxOutputTokens: 256, plainText: true }
      )
      enrich = snippet.slice(0, 1200)
      applyTrace('easy_apply:company_enrich_ok', { chars: enrich.length })
    } catch (e) {
      applyTrace('easy_apply:company_enrich_skip', { reason: e instanceof Error ? e.message : 'timeout_or_error' })
    }
  }

  const templateHash = base ? sha256Short(base.text) : sha256Short(`scratch:${params.company}:${params.jobTitle}`)
  let userBlock = `Company: ${params.company}\nRole: ${params.jobTitle}\n`
  if (params.jdSnippet.trim()) {
    userBlock += `Job description (excerpt):\n${params.jdSnippet.slice(0, 6000)}\n\n`
  }
  if (enrich.trim()) userBlock += `Context hints:\n${enrich}\n\n`
  if (params.resumeSummary.trim()) {
    userBlock += `Candidate summary (from resume, do not invent beyond this):\n${params.resumeSummary.slice(0, 4000)}\n\n`
  }
  if (base) {
    userBlock += `Base cover letter to adapt (keep facts truthful; do not add credentials not implied above):\n${base.text}`
  } else {
    const candidateName = params.profile.basics?.fullName || ''
    if (candidateName) userBlock += `Candidate name: ${candidateName}\n`
  }

  applyTrace('easy_apply:cover_tailor_llm', {
    promptVersion: COVER_LETTER_PROMPT_VERSION,
    inputChars: userBlock.length,
    model: params.modelLabel,
    fromScratch: isFromScratch
  })

  const systemPrompt = isFromScratch
    ? `You write concise, professional cover letters for job applications from scratch, using only the candidate's resume and the job description. Output only the final letter in plain text (greeting, body paragraphs, closing, candidate's name). No markdown fences. Do not invent employers, titles, degrees, or experience the candidate did not have. Keep under 350 words. Be specific — reference real details from the resume and job description.`
    : `You rewrite cover letters for job applications. Output only the final letter in plain text (greeting, body paragraphs, closing, name placeholder if no signer). No markdown fences. Do not invent employers, titles, degrees, or employers the candidate did not have. Keep under 450 words.`

  let letter: string
  try {
    letter = await callLlmDirect(
      systemPrompt,
      userBlock,
      { plainText: true, maxOutputTokens: 1200, timeoutMs: 60_000 }
    )
  } catch (e) {
    applyTrace('easy_apply:cover_tailor_error', {
      stage: 'llm',
      message: e instanceof Error ? e.message.slice(0, 200) : String(e)
    })
    return null
  }

  letter = letter.trim()
  if (!letter) {
    applyTrace('easy_apply:cover_tailor_error', { stage: 'empty_output' })
    return null
  }

  const outPath = join(coverTempDir(), `tailored-${Date.now()}.pdf`)
  let bytes = 0
  let attempt = letter
  for (let i = 0; i < 4; i++) {
    const bodyHtml = plainTextToParagraphHtml(attempt)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 11pt;
      line-height: 1.45; margin: 28px; color: #111; }
      p { margin: 0 0 0.85em 0; white-space: pre-wrap; }
      </style></head><body>${bodyHtml}</body></html>`
    try {
      bytes = await htmlToPdfFile(html, outPath)
    } catch (e) {
      applyTrace('easy_apply:cover_tailor_error', {
        stage: 'pdf',
        message: e instanceof Error ? e.message.slice(0, 200) : String(e)
      })
      try {
        unlinkSync(outPath)
      } catch (e) {
        appLog.debug('[cover-letter-tailor] unlink temp PDF after error failed', e instanceof Error ? e.message : String(e))
      }
      return null
    }
    if (bytes <= MAX_COVER_PDF_BYTES) break
    attempt = attempt.slice(0, Math.floor(attempt.length * 0.75))
  }

  applyTrace('easy_apply:cover_tailor_pdf', {
    sizeBytes: bytes,
    underCap: bytes <= MAX_COVER_PDF_BYTES,
    basename: outPath.split(/[/\\]/).pop()
  })

  if (bytes > MAX_COVER_PDF_BYTES) {
    try {
      unlinkSync(outPath)
    } catch (e) {
      appLog.debug('[cover-letter-tailor] unlink oversized temp PDF failed', e instanceof Error ? e.message : String(e))
    }
    applyTrace('easy_apply:cover_tailor_error', { stage: 'pdf_too_large', sizeBytes: bytes })
    return null
  }

  return {
    path: outPath,
    meta: {
      mode: isFromScratch ? 'generated' : 'tailored',
      fileBytes: bytes,
      model: params.modelLabel,
      promptVersion: COVER_LETTER_PROMPT_VERSION,
      templateSha256: templateHash
    }
  }
}
