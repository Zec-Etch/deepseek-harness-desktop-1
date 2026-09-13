const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export const DESKTOP_PIPE_RUNTIME_ORIGIN = 'dsh-runtime://app'

/** Normalize the two Desktop-owned Runtime authorities without trusting arbitrary URLs. */
export function desktopRuntimeOrigin(value, { loopbackOnly = false } = {}) {
  if (value && typeof value === 'object' && typeof value.url === 'string') value = value.url
  if (typeof value !== 'string' || value.length === 0) return undefined
  let url
  try { url = new URL(value) } catch { return undefined }
  if (url.username || url.password) return undefined
  if (url.protocol === 'dsh-runtime:' && url.hostname === 'app') return DESKTOP_PIPE_RUNTIME_ORIGIN
  if (url.protocol !== 'http:' || (loopbackOnly && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()))) return undefined
  return url.origin
}

export function desktopRuntimeEndpoint(path, runtimeUrl, options) {
  const origin = desktopRuntimeOrigin(runtimeUrl, options)
  if (origin === undefined) throw new Error('desktop runtime is not ready')
  return new URL(path, `${origin}/`)
}
