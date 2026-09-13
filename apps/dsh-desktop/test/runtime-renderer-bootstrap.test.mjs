import assert from 'node:assert/strict'
import test from 'node:test'

import { installDesktopTransportBridge, transportBootstrapScript } from '../src/runtime-renderer-bootstrap.mjs'

function serverFrame(opcode, payload) {
  const body = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
  assert.ok(body.length < 126)
  return Uint8Array.of(0x80 | opcode, body.length, ...body)
}

function decodeClientFrame(encoded) {
  const bytes = Buffer.from(encoded, 'base64')
  assert.equal((bytes[1] & 0x80) !== 0, true)
  const length = bytes[1] & 0x7f
  assert.ok(length < 126)
  const mask = bytes.subarray(2, 6)
  const payload = bytes.subarray(6, 6 + length)
  for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]
  return { opcode: bytes[0] & 0x0f, payload }
}

function testTarget() {
  const frames = []
  const writes = []
  const cancelled = []
  class NativeWebSocket {
    constructor(url) { this.nativeUrl = url }
  }
  const target = {
    AbortController,
    ArrayBuffer,
    Blob,
    DOMException,
    Event,
    EventTarget,
    NativeWebSocket,
    Request,
    TextDecoder,
    TextEncoder,
    URL,
    WebSocket: NativeWebSocket,
    atob,
    btoa,
    crypto,
    fetch,
    location: new URL('dsh-runtime://app/'),
    dshDesktop: {
      openRuntimeStream: async () => 'stream-1',
      writeRuntimeStream: async (_id, value) => { writes.push(value); return true },
      cancelRuntimeStream: id => { cancelled.push(id); return true },
      onRuntimeStream: callback => { frames.push(callback); return () => {} },
    },
  }
  return { target, emit: frame => frames[0](frame), writes, cancelled, NativeWebSocket }
}

test('bootstrap source is self-contained and installs the owned transport', () => {
  const source = transportBootstrapScript()
  assert.match(source, /^\(function installDesktopTransportBridge/u)
  assert.match(source, /openRuntimeStream/u)
})

test('owned WebSocket crosses the duplex bridge with RFC 6455 framing', async () => {
  const fixture = testTarget()
  installDesktopTransportBridge(fixture.target)
  const socket = new fixture.target.WebSocket('ws://app/ssh/terminal?alias=local')
  const events = []
  socket.onopen = () => events.push('open')
  socket.onmessage = event => events.push(`message:${event.data}`)
  socket.onclose = event => events.push(`close:${event.code}:${event.reason}`)
  await new Promise(resolve => setImmediate(resolve))

  const handshake = Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  const greeting = serverFrame(1, 'ready')
  fixture.emit({ id: 'stream-1', type: 'item', value: Buffer.concat([handshake, greeting]).toString('base64') })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(socket.readyState, fixture.target.WebSocket.OPEN)
  assert.deepEqual(events, ['open', 'message:ready'])

  socket.send('input')
  await new Promise(resolve => setImmediate(resolve))
  const sent = decodeClientFrame(fixture.writes[0])
  assert.equal(sent.opcode, 1)
  assert.equal(sent.payload.toString(), 'input')

  const closePayload = Buffer.alloc(5)
  closePayload.writeUInt16BE(1000)
  closePayload.write('bye', 2)
  fixture.emit({ id: 'stream-1', type: 'item', value: Buffer.from(serverFrame(8, closePayload)).toString('base64') })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(socket.readyState, fixture.target.WebSocket.CLOSED)
  assert.deepEqual(events, ['open', 'message:ready', 'close:1000:bye'])
})

test('worker stream preserves frames delivered before the open acknowledgement', async () => {
  const fixture = testTarget()
  installDesktopTransportBridge(fixture.target)
  const stream = fixture.target.__DSH_TRANSPORT__.openStream('events.mux', {})
  fixture.emit({ id: 'stream-1', type: 'item', value: 'first-frame' })
  const iterator = stream[Symbol.asyncIterator]()
  assert.deepEqual(await iterator.next(), { done: false, value: 'first-frame' })
  fixture.emit({ id: 'stream-1', type: 'end' })
  assert.deepEqual(await iterator.next(), { done: true, value: undefined })
})

test('external WebSocket URLs retain the native implementation', () => {
  const fixture = testTarget()
  installDesktopTransportBridge(fixture.target)
  const socket = new fixture.target.WebSocket('wss://example.com/socket')
  assert.equal(socket instanceof fixture.NativeWebSocket, true)
  assert.equal(socket.nativeUrl, 'wss://example.com/socket')
})
