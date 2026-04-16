import { useCallback, useState } from 'react'
import { SAMPLE_CONNECTION_NOTE } from '@core/demo-presets'

export function useNoteTemplates() {
  const [noteOptions, setNoteOptions] = useState<string[]>([''])
  const [mustIncludeInput, setMustIncludeInput] = useState('')

  const updateNoteOption = useCallback((index: number, value: string) => {
    setNoteOptions((prev) => prev.map((t, i) => (i === index ? value : t)))
  }, [])

  const appendPlaceholderToNote = useCallback((index: number, token: string) => {
    setNoteOptions((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t
        const gap = t.length > 0 && !/\s$/.test(t) ? ' ' : ''
        return t + gap + token
      })
    )
  }, [])

  const addNoteOption = useCallback(() => {
    setNoteOptions((prev) => [...prev, ''])
  }, [])

  const removeNoteOption = useCallback((index: number) => {
    setNoteOptions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }, [])

  const resetToSampleNote = useCallback(() => {
    setNoteOptions([SAMPLE_CONNECTION_NOTE])
  }, [])

  return {
    noteOptions,
    mustIncludeInput,
    setNoteOptions,
    setMustIncludeInput,
    updateNoteOption,
    appendPlaceholderToNote,
    addNoteOption,
    removeNoteOption,
    resetToSampleNote
  }
}
