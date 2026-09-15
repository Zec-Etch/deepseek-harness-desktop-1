import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createRuntimePipeIdentity,
  createRuntimePipeServer,
  MAX_POSIX_PIPE_ADDRESS_BYTES,
  RuntimePipeClient,
  RUNTIME_PIPE_PROTOCOL_VERSION,
} from '../src/runtime-pipe.mjs'

test('macOS runtime pipe falls back to a bounded socket path when TMPDIR is long', () => {
  const identity = createRuntimePipeIdentity({
    platform: 'darwin',
    temporaryDirectory: `/var/folders/${'long-segment/'.repeat(12)}T`,
  })

  assert.match(identity.address, /^\/tmp\/dsh-desktop-[0-9a-f]{48}\.sock$/u)
  assert.ok(Buffer.byteLength(identity.address, 'utf8') <= MAX_POSIX_PIPE_ADDRESS_BYTES)

  const short = createRuntimePipeIdentity({ platform: 'darwin', temporaryDirectory: '/private/tmp' })
  assert.match(short.address, /^\/private\/tmp\/dsh-desktop-[0-9a-f]{48}\.sock$/u)
})

test('runtime pipe authenticates, chunks bodies, and preserves response metadata', async (t) => {
  const identity = createRuntimePipeIdentity()
  const server = await createRuntimePipeServer({
    identity,
    runtimeVersion: '0.1.5-rc.2',
    profile: 'desktop',
    fetch: async (request) => new Response(await request.arrayBuffer(), {
      status: 201,
      headers: { 'content-type': 'application/octet-stream', 'x-runtime-test': 'ok' },
    }),
    openStream: async function * () {},
  })
  t.after(() => server.close())

  const client = new RuntimePipeClient(identity)
  const body = new Uint8Array(700_000).map((_, index) => index % 251)
  const response = await client.fetch('http://dsh.internal/api/echo', { method: 'POST', body })

  assert.equal(response.status, 201)
  assert.equal(response.headers.get('x-runtime-test'), 'ok')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body)
  assert.deepEqual(await client.probe(), {
    type: 'hello',
    protocolVersion: RUNTIME_PIPE_PROTOCOL_VERSION,
    runtimeVersion: '0.1.5-rc.2',
    profile: 'desktop',
    generation: identity.generation,
  })
})

test('runtime pipe transports cancellation-aware logical streams', async (t) => {
  const identity = createRuntimePipeIdentity()
  let hostCancelled = false
  const server = await createRuntimePipeServer({
    identity,
    runtimeVersion: '0.1.5-rc.2',
    profile: 'desktop',
    fetch: async () => new Response('not found', { status: 404 }),
    openStream: async (endpoint, payload, signal) => (async function * () {
      assert.equal(endpoint, 'session/observe')
      assert.deepEqual(payload, { sessionId: 'session-1' })
      try {
        yield { sequence: 1 }
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      } finally {
        hostCancelled = signal.aborted
      }
    })(),
  })
  t.after(() => server.close())

  const controller = new AbortController()
  const client = new RuntimePipeClient(identity)
  const stream = client.openStream('session/observe', { sessionId: 'session-1' }, controller.signal)
  assert.deepEqual((await stream.next()).value, { sequence: 1 })
  controller.abort(new Error('test cancellation'))
  await assert.rejects(stream.next(), /test cancellation|cancelled|disconnected/u)
  const deadline = Date.now() + 1_000
  while (!hostCancelled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(hostCancelled, true)
})

test('runtime pipe rejects the wrong generation before dispatch', async (t) => {
  const identity = createRuntimePipeIdentity()
  let dispatched = false
  const server = await createRuntimePipeServer({
    identity,
    runtimeVersion: '0.1.5-rc.2',
    profile: 'desktop',
    fetch: async () => {
      dispatched = true
      return new Response('unexpected')
    },
    openStream: async function * () {},
  })
  t.after(() => server.close())
  const stale = new RuntimePipeClient({ ...identity, generation: createRuntimePipeIdentity().generation })

  await assert.rejects(stale.fetch('http://dsh.internal/api/test'), /handshake|authentication|closed/u)
  assert.equal(dispatched, false)
})

test('runtime pipe resolves response metadata before a streamed body ends', async (t) => {
  const identity = createRuntimePipeIdentity()
  let finish
  const gate = new Promise(resolve => { finish = resolve })
  const server = await createRuntimePipeServer({
    identity,
    runtimeVersion: '0.1.5-rc.2',
    profile: 'desktop',
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('first'))
        void gate.then(() => {
          controller.enqueue(Buffer.from('second'))
          controller.close()
        })
      },
    })),
    openStream: async function * () {},
  })
  t.after(() => server.close())
  const client = new RuntimePipeClient(identity)
  const response = await client.fetch('http://dsh.internal/stream')
  const reader = response.body.getReader()
  const first = await reader.read()
  assert.equal(Buffer.from(first.value).toString('utf8'), 'first')
  finish()
  const second = await reader.read()
  assert.equal(Buffer.from(second.value).toString('utf8'), 'second')
  assert.equal((await reader.read()).done, true)
})

test('runtime pipe carries bounded bidirectional values and half-close', async (t) => {
  const identity = createRuntimePipeIdentity()
  const server = await createRuntimePipeServer({
    identity,
    runtimeVersion: '0.1.5-rc.2',
    profile: 'desktop',
    fetch: async () => new Response('ok'),
    openStream: async function * () {},
    openDuplex: async function * (endpoint, payload, input) {
      assert.equal(endpoint, 'websocket')
      assert.deepEqual(payload, { path: '/terminal' })
      for await (const value of input) yield `echo:${value}`
    },
  })
  t.after(() => server.close())
  const client = new RuntimePipeClient(identity)
  const duplex = client.openDuplex('websocket', { path: '/terminal' })
  await duplex.write('one')
  await duplex.write('two')
  await duplex.close()
  const values = []
  for await (const value of duplex) values.push(value)
  assert.deepEqual(values, ['echo:one', 'echo:two'])
})
