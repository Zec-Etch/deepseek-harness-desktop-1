import {
  DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_HEADER,
  isDesktopWorkspaceFileOpenToken,
  isSafeDesktopWorkspaceFileOpenPath,
} from '@linxin666/dsh-desktop-compat/workspace-file-open-policy'
import { desktopRuntimeEndpoint } from './runtime-origin.mjs'

const MAX_ROOT_LENGTH = 32_767
const MAX_RELATIVE_PATH_LENGTH = 4_096

/** True only for a local, non-shell-dispatched file target accepted by the native opener. */
export function isSafeWorkspaceFileOpenTarget(value) {
  if (!isSafeDesktopWorkspaceFileOpenPath(value)) return false
  const normalized = value.replaceAll('\\', '/')
  // Do not accept file:, https:, or another URL scheme as a Shell target. A
  // local absolute path may be POSIX, a Windows drive path, or a UNC path.
  return normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized)
}

/** Validate the only file reference that can cross the renderer-to-host boundary. */
export function normalizeWorkspaceFileOpenRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('workspace file request must be an object')
  }
  const root = typeof value.root === 'string' ? value.root.trim() : ''
  const path = typeof value.path === 'string' ? value.path.trim().replaceAll('\\', '/') : ''
  if (root.length === 0 || root.length > MAX_ROOT_LENGTH) throw new TypeError('workspace root is invalid')
  if (
    path.length === 0
    || path.length > MAX_RELATIVE_PATH_LENGTH
    || path.startsWith('/')
    || /^[a-z]:/iu.test(path)
    || path.split('/').some(segment => segment.length === 0 || segment === '..' || segment.includes(':'))
  ) {
    throw new TypeError('workspace file path must be a relative path')
  }
  if (!isSafeDesktopWorkspaceFileOpenPath(path)) {
    throw new TypeError('workspace file type is not allowed for native opening')
  }
  return Object.freeze({ root, path })
}

function resultTarget(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const path = value.path
  return typeof path === 'string' && path.length <= MAX_ROOT_LENGTH && isSafeWorkspaceFileOpenTarget(path) ? path : undefined
}

/**
 * Ask the already-running, workspace-gated host plugin to canonicalize a
 * relative file before native Shell receives it. The renderer never supplies
 * a trusted absolute path and the resolved path is never returned to it. The
 * private capability getter belongs to Electron main, not preload or SDK.
 */
export async function resolveWorkspaceFileOpenTarget({
  request,
  getRuntimeOrigin,
  getWorkspaceFileOpenToken,
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  if (typeof getRuntimeOrigin !== 'function') throw new TypeError('runtime origin provider is required')
  if (typeof getWorkspaceFileOpenToken !== 'function') {
    throw new TypeError('workspace file capability provider is required')
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('workspace file fetch implementation is required')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new TypeError('workspace file timeout is invalid')
  const normalized = normalizeWorkspaceFileOpenRequest(request)
  const endpoint = desktopRuntimeEndpoint('/desktop/workspace-file-open-target', getRuntimeOrigin(), { loopbackOnly: true })
  const capabilityToken = getWorkspaceFileOpenToken()
  if (!isDesktopWorkspaceFileOpenToken(capabilityToken)) {
    throw new Error('workspace file capability is unavailable')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_HEADER]: capabilityToken,
      },
      body: JSON.stringify(normalized),
      signal: controller.signal,
    })
    if (!response?.ok) throw new Error('workspace file validation was rejected')
    const payload = await response.json()
    if (payload?.ok !== true) throw new Error('workspace file validation failed')
    const target = resultTarget(payload.value)
    if (target === undefined) throw new Error('workspace file validation returned an invalid target')
    return target
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve through the DSH workspace authority, then hand only that path to the OS. */
export async function openWorkspaceFile({ shell, request, ...options } = {}) {
  if (typeof shell?.openPath !== 'function') throw new TypeError('desktop Shell openPath is required')
  const target = await resolveWorkspaceFileOpenTarget({ request, ...options })
  const result = await shell.openPath(target)
  if (typeof result === 'string' && result.length > 0) return Object.freeze({ opened: false, reason: 'shell-failed' })
  return Object.freeze({ opened: true })
}
