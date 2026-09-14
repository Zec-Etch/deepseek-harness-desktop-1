/**
 * Browser-side Desktop notification bridge for Task Board settlements.
 *
 * The core controller only emits a neutral settled-run event. Keeping this
 * mapping in the client prevents the Host scheduler from depending on
 * Electron while allowing both live and Host-owned executions to share the
 * same native-notification behavior.
 */

export interface SettledExecutionNotificationEvent {
  taskId: string
  title: string
  executionId: string
  outcome: 'succeeded' | 'failed' | 'cancelled'
  error?: string
}

export interface DesktopRunNotification {
  category: 'run'
  id: string
  title: string
  body: string
  deepLink: string
}

export interface DesktopNotificationBridge {
  showNotification?: (value: DesktopRunNotification) => unknown
}

/** Map a controller settlement into the pre-existing Desktop notification API. */
export function notifyDesktopExecutionSettled(
  desktop: DesktopNotificationBridge | undefined,
  event: Readonly<SettledExecutionNotificationEvent>,
): Promise<void> | undefined {
  if (event.outcome === 'cancelled' || typeof desktop?.showNotification !== 'function') return undefined
  const failed = event.outcome === 'failed'
  return Promise.resolve(desktop.showNotification({
    category: 'run',
    id: `run:${event.executionId}:${event.outcome}`,
    title: failed ? 'Task failed' : 'Task completed',
    body: failed
      ? `${event.title}: ${event.error ?? 'The agent turn failed.'}`
      : event.title,
    deepLink: `dsh-community://run/${event.executionId}`,
  })).then(() => undefined)
}
