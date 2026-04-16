import { BrowserWindow, dialog } from 'electron'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, unlinkSync, readdirSync, writeFileSync } from 'node:fs'
import { join, basename, extname, resolve } from 'node:path'
import * as os from 'node:os'
import { userDataDir } from './user-data-path'
import { loadSettings, saveSettings } from './settings'
import { appLog } from './app-log'

function resumeDir(): string {
  const d = join(userDataDir(), 'resume')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** Extract plain text from PDF, DOCX, TXT, or MD on disk (shared with cover letter base extraction). */
export async function extractDocumentTextFromPath(filePath: string): Promise<string> {
  return extractText(filePath)
}

async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()

  if (ext === '.txt' || ext === '.md') {
    return readFileSync(filePath, 'utf8')
  }

  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const buf = readFileSync(filePath)
    const parser = new PDFParse({ data: new Uint8Array(buf) })
    const result = await parser.getText()
    await parser.destroy()
    return result.text
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filePath })
    return result.value
  }

  throw new Error(`Unsupported file type: ${ext}. Use .pdf, .docx, .txt, or .md.`)
}

async function extractTextFromBuffer(fileName: string, buffer: Buffer): Promise<string> {
  const ext = extname(fileName).toLowerCase()

  if (ext === '.txt' || ext === '.md') {
    return buffer.toString('utf8')
  }

  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const result = await parser.getText()
    await parser.destroy()
    return result.text
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  throw new Error(`Unsupported file type: ${ext}. Use .pdf, .docx, .txt, or .md.`)
}

async function normalizeAndSaveResume(fileName: string, buffer: Buffer): Promise<{ ok: true; fileName: string; charCount: number } | { ok: false; detail: string }> {
  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
  try {
    const fileSize = buffer.byteLength
    if (fileSize > MAX_FILE_SIZE) {
      return { ok: false, detail: `File is too large (${Math.round(fileSize / 1024 / 1024)}MB). Maximum is 10MB.` }
    }
    const rawText = await extractTextFromBuffer(fileName, buffer)
    const trimmed = rawText.trim()
    if (!trimmed) {
      const ext = extname(fileName).toLowerCase()
      const hint = ext === '.pdf'
        ? ' This PDF may be a scanned image. Try a text-based PDF, or paste your resume text manually.'
        : ''
      return { ok: false, detail: `The file appears to be empty or could not be read.${hint}` }
    }

    const MAX_RESUME_CHARS = 8000
    const text = trimmed.length > MAX_RESUME_CHARS
      ? trimmed.slice(0, MAX_RESUME_CHARS)
      : trimmed

    const dir = resumeDir()
    for (const f of readdirSync(dir)) {
      try { unlinkSync(join(dir, f)) } catch (e) { appLog.debug('[resume] cleanup failed', e instanceof Error ? e.message : String(e)) }
    }
    writeFileSync(join(dir, fileName), buffer)

    const settings = loadSettings()
    settings.resumeText = text
    settings.resumeFileName = fileName
    saveSettings(settings)

    return { ok: true, fileName, charCount: text.length }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, detail: `Couldn\u2019t read the resume: ${msg}` }
  }
}

export async function uploadResume(): Promise<{ ok: true; fileName: string; charCount: number } | { ok: false; detail: string }> {
  const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const result = await dialog.showOpenDialog(
    ...(parentWindow ? [parentWindow] : []) as [BrowserWindow],
    {
      title: 'Select your resume',
      filters: [
        { name: 'Resume files', extensions: ['pdf', 'docx', 'txt', 'md'] }
      ],
      properties: ['openFile']
    }
  )

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, detail: 'cancelled' }
  }

  return await importResumeFromPath(result.filePaths[0])
}

export async function importResumeFromPath(filePath: string): Promise<{ ok: true; fileName: string; charCount: number } | { ok: false; detail: string }> {
  const normalizedPath = String(filePath || '').trim()
  if (!normalizedPath) {
    return { ok: false, detail: 'No file path provided.' }
  }
  const resolvedPath = resolve(normalizedPath)
  if (process.platform === 'win32') {
    if (resolvedPath.startsWith('\\\\')) {
      throw new Error('Cannot read files from network locations')
    }
  }
  const fileName = basename(resolvedPath)
  const buffer = readFileSync(resolvedPath)
  return await normalizeAndSaveResume(fileName, buffer)
}

export async function importResumeFromData(
  fileName: string,
  dataBase64: string
): Promise<{ ok: true; fileName: string; charCount: number } | { ok: false; detail: string }> {
  const normalizedName = basename(String(fileName || '').trim())
  const normalizedData = String(dataBase64 || '').trim()
  if (!normalizedName) {
    return { ok: false, detail: 'No file name provided.' }
  }
  if (!normalizedData) {
    return { ok: false, detail: 'No file data provided.' }
  }
  const buffer = Buffer.from(normalizedData, 'base64')
  return await normalizeAndSaveResume(normalizedName, buffer)
}

export function clearResume(): { ok: true } {
  const settings = loadSettings()
  settings.resumeText = ''
  settings.resumeFileName = ''
  saveSettings(settings)

  const dir = resumeDir()
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      try { unlinkSync(join(dir, f)) } catch (e) { appLog.debug('[resume] cleanup failed', e instanceof Error ? e.message : String(e)) }
    }
  }

  return { ok: true }
}
