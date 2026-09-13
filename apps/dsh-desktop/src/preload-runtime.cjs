const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Set()
const pending = []
ipcRenderer.on('desktop:runtime-stream-frame', (_event, frame) => {
  if (listeners.size === 0) {
    if (pending.length < 256) pending.push(frame)
    return
  }
  for (const listener of [...listeners]) {
    try { listener(frame) } catch {}
  }
})

contextBridge.exposeInMainWorld('dshDesktopTransport', Object.freeze({
  openRuntimeStream: (endpoint, payload) => ipcRenderer.invoke('desktop:runtime-stream-open', { endpoint, payload }),
  writeRuntimeStream: (id, value) => ipcRenderer.invoke('desktop:runtime-stream-write', id, value),
  cancelRuntimeStream: (id) => ipcRenderer.invoke('desktop:runtime-stream-cancel', id),
  onRuntimeStream: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('runtime stream listener must be a function')
    listeners.add(listener)
    if (listeners.size === 1 && pending.length > 0) {
      for (const frame of pending.splice(0)) {
        try { listener(frame) } catch {}
      }
    }
    return () => listeners.delete(listener)
  },
}))
