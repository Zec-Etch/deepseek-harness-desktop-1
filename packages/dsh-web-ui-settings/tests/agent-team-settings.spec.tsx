/** @vitest-environment jsdom */

import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AgentTeamSettingsCard } from '../src/client/AgentTeamSettingsCard.tsx'

afterEach(() => {
  cleanup()
  delete window.dshDockSettings
})

it('loads persisted Agent Team state and exposes restart progress', async () => {
  let progress: ((value: { phase: 'restarting' }) => void) | undefined
  window.dshDockSettings = {
    getAgentTeamStatus: vi.fn(async () => ({ available: true, enabled: false, version: '0.1.5-rc.2' })),
    setAgentTeamEnabled: vi.fn(async () => ({ available: true, enabled: true, version: '0.1.5-rc.2' })),
    onAgentTeamProgress: vi.fn(listener => { progress = listener as never; return () => {} }),
  }
  render(<AgentTeamSettingsCard />)
  const control = await screen.findByRole('switch', { name: 'Agent Team' })
  await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('false'))
  fireEvent.click(control)
  progress?.({ phase: 'restarting' })
  await waitFor(() => expect(window.dshDockSettings?.setAgentTeamEnabled).toHaveBeenCalledWith(true))
  await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'))
})

it('reloads the persisted state after a failed change and leaves retry available', async () => {
  const getAgentTeamStatus = vi.fn(async () => ({ available: true, enabled: false }))
  window.dshDockSettings = {
    getAgentTeamStatus,
    setAgentTeamEnabled: vi.fn(async () => { throw new Error('Runtime restart failed') }),
    onAgentTeamProgress: vi.fn(() => () => {}),
  }
  render(<AgentTeamSettingsCard />)
  const control = await screen.findByRole('switch', { name: 'Agent Team' })
  await waitFor(() => expect((control as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(control)
  expect((await screen.findByRole('alert')).textContent).toContain('Runtime restart failed')
  expect(getAgentTeamStatus).toHaveBeenCalledTimes(2)
  expect(control.getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
})
