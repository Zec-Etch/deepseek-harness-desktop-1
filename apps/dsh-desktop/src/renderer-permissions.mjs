const WRITABLE_CLIPBOARD_PERMISSION = 'clipboard-sanitized-write'
import { desktopRuntimeOrigin } from './runtime-origin.mjs'

export function isAllowedRendererPermission({ permission, requestingUrl, activeOrigin }) {
  if (permission !== WRITABLE_CLIPBOARD_PERMISSION) return false
  const expected = desktopRuntimeOrigin(activeOrigin, { loopbackOnly: true })
  const requested = desktopRuntimeOrigin(requestingUrl, { loopbackOnly: true })
  return expected !== undefined && requested === expected
}

export function installRendererPermissions({ session, getActiveOrigin }) {
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => (
    isAllowedRendererPermission({
      permission,
      requestingUrl: requestingOrigin,
      activeOrigin: getActiveOrigin(),
    })
  ))
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isAllowedRendererPermission({
      permission,
      requestingUrl: details?.requestingUrl || webContents?.getURL?.(),
      activeOrigin: getActiveOrigin(),
    }))
  })
}
