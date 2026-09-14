import { describe, expect, it, vi } from 'vitest'
import { notifyDesktopExecutionSettled } from '../src/client/desktop-notifications.ts'

describe('Desktop run notifications', () => {
  it('maps a Host-delivered failed settlement to the existing native notification payload', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined)

    await expect(notifyDesktopExecutionSettled({ showNotification }, {
      taskId: 'task-host',
      title: 'Host scheduled task',
      executionId: 'schedule-host-1',
      outcome: 'failed',
      error: 'provider stopped',
    })).resolves.toBeUndefined()

    expect(showNotification).toHaveBeenCalledOnce()
    expect(showNotification).toHaveBeenCalledWith({
      category: 'run',
      id: 'run:schedule-host-1:failed',
      title: 'Task failed',
      body: 'Host scheduled task: provider stopped',
      deepLink: 'dsh-community://run/schedule-host-1',
    })
  })

  it('does not create a native notification for a cancelled run', () => {
    const showNotification = vi.fn()
    expect(notifyDesktopExecutionSettled({ showNotification }, {
      taskId: 'task-host',
      title: 'Host scheduled task',
      executionId: 'schedule-host-2',
      outcome: 'cancelled',
    })).toBeUndefined()
    expect(showNotification).not.toHaveBeenCalled()
  })
})
