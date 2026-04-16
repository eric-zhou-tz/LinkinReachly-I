/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StuckFieldsPrompt } from '../../../src/renderer/src/components/StuckFieldsPrompt'

afterEach(cleanup)

describe('StuckFieldsPrompt — compact (inline per-item save)', () => {
  it('renders one save button per label', () => {
    render(
      <StuckFieldsPrompt labels={['Phone', 'Work Auth']} compact onSave={vi.fn()} />
    )
    const buttons = screen.getAllByRole('button', { name: /^Save$/i })
    expect(buttons).toHaveLength(2)
  })

  it('save button is disabled when its input is empty', () => {
    render(
      <StuckFieldsPrompt labels={['Phone', 'Work Auth']} compact onSave={vi.fn()} />
    )
    const buttons = screen.getAllByRole('button', { name: /^Save$/i })
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true)
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
  })

  it('save button enables only when its own input has a value', () => {
    render(
      <StuckFieldsPrompt labels={['Phone', 'Work Auth']} compact onSave={vi.fn()} />
    )
    const phoneInput = screen.getByLabelText('Answer for: Phone')
    fireEvent.change(phoneInput, { target: { value: '555-1234' } })

    const buttons = screen.getAllByRole('button', { name: /^Save$/i })
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false)
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
  })

  it('clicking save calls onSave with ONLY that label, not all labels', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <StuckFieldsPrompt labels={['Phone', 'Work Auth']} compact onSave={onSave} />
    )

    fireEvent.change(screen.getByLabelText('Answer for: Phone'), { target: { value: '555-1234' } })
    fireEvent.change(screen.getByLabelText('Answer for: Work Auth'), { target: { value: 'Yes' } })

    const buttons = screen.getAllByRole('button', { name: /^Save$/i })
    fireEvent.click(buttons[0])

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    expect(onSave).toHaveBeenCalledWith({ phone: '555-1234' })
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({ 'work authorization': 'Yes' }))
  })

  it('calls onAfterSave after successful single save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onAfterSave = vi.fn().mockResolvedValue(undefined)
    render(
      <StuckFieldsPrompt labels={['Phone']} compact onSave={onSave} onAfterSave={onAfterSave} />
    )

    fireEvent.change(screen.getByLabelText('Answer for: Phone'), { target: { value: '555-1234' } })
    fireEvent.click(screen.getByRole('button', { name: /Save & retry/i }))

    await waitFor(() => {
      expect(onAfterSave).toHaveBeenCalledTimes(1)
    })
  })

  it('Enter key in input saves only that input', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <StuckFieldsPrompt labels={['Phone', 'Work Auth']} compact onSave={onSave} />
    )

    const phoneInput = screen.getByLabelText('Answer for: Phone')
    fireEvent.change(phoneInput, { target: { value: '555-1234' } })
    fireEvent.keyDown(phoneInput, { key: 'Enter' })

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    expect(onSave).toHaveBeenCalledWith({ phone: '555-1234' })
  })

  it('shows error message when save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Network error'))
    render(
      <StuckFieldsPrompt labels={['Phone']} compact onSave={onSave} />
    )

    fireEvent.change(screen.getByLabelText('Answer for: Phone'), { target: { value: '555' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })

  it('skip button dismisses the prompt', () => {
    render(
      <StuckFieldsPrompt labels={['Phone']} compact onSave={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('button', { name: /Skip/i }))
    expect(screen.queryByLabelText('Answer for: Phone')).toBeNull()
  })

  it('resets saved-state UI when labels change', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <StuckFieldsPrompt labels={['Phone']} compact onSave={onSave} />
    )

    fireEvent.change(screen.getByLabelText('Answer for: Phone'), { target: { value: '555-1234' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    await waitFor(() => {
      expect(screen.getByText(/Answer saved/i)).toBeTruthy()
    })

    rerender(<StuckFieldsPrompt labels={['Work Auth']} compact onSave={onSave} />)

    expect(screen.queryByText(/Answer saved/i)).toBeNull()
    expect(screen.getByLabelText('Answer for: Work Auth')).toBeTruthy()
  })
})

describe('StuckFieldsPrompt — full (batch save)', () => {
  it('batch save button is disabled when no inputs are filled', () => {
    render(
      <StuckFieldsPrompt labels={['Phone', 'Work Auth']} onSave={vi.fn()} />
    )
    const saveBtn = screen.getByRole('button', { name: /Save 0\/2/i })
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('batch save sends all filled answers', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <StuckFieldsPrompt labels={['Phone', 'Work Auth']} onSave={onSave} />
    )

    fireEvent.change(screen.getByLabelText('Answer for: Phone'), { target: { value: '555-1234' } })
    fireEvent.change(screen.getByLabelText('Answer for: Work Auth'), { target: { value: 'Yes' } })
    fireEvent.click(screen.getByRole('button', { name: /Save 2\/2/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    expect(onSave).toHaveBeenCalledWith({ phone: '555-1234', 'work authorization': 'Yes' })
  })

  it('batch save skips empty inputs', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <StuckFieldsPrompt labels={['Phone', 'Work Auth']} onSave={onSave} />
    )

    fireEvent.change(screen.getByLabelText('Answer for: Phone'), { target: { value: '555-1234' } })
    fireEvent.click(screen.getByRole('button', { name: /Save 1\/2/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    expect(onSave).toHaveBeenCalledWith({ phone: '555-1234' })
  })
})
