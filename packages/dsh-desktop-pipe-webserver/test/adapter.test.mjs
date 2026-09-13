import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { apply, DesktopPipeWebServer } from '../src/index.mjs'

function server() {
  return new DesktopPipeWebServer(new Context())
}

test('adapter dispatches exact and longest-prefix routes without listening', async () => {
  const web = server()
  web.register({ kind: 'prefix', path: '/items', handler: (_req, res) => res.end('short') })
  web.register({ kind: 'prefix', path: '/items/deep', handler: (req, res) => {
    assert.equal(req.socket.remoteAddress, '127.0.0.1')
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(req.url)
  } })
  web.register({ kind: 'exact', path: '/items/deep/one', handler: (_req, res) => res.end('exact') })

  assert.equal(await (await web.fetch(new Request('http://dsh.internal/items/value'))).text(), 'short')
  assert.equal(await (await web.fetch(new Request('http://dsh.internal/items/deep/value?q=1'))).text(), '/items/deep/value?q=1')
  assert.equal(await (await web.fetch(new Request('http://dsh.internal/items/deep/one'))).text(), 'exact')
  assert.equal((await web.fetch(new Request('http://dsh.internal/missing'))).status, 404)
})

test('Cordis service proxy retains route registry method ownership', async () => {
  const ctx = new Context()
  apply(ctx)
  const web = ctx.get('webServer')
  assert.ok(web)
  web.register({ kind: 'exact', path: '/', handler: (_req, res) => res.end('root') })
  assert.equal(await (await web.fetch(new Request('http://dsh.internal/'))).text(), 'root')
  assert.deepEqual(ctx.get('webRuntime').trustedHosts, [])
})

test('adapter preserves streamed responses and request bodies', async () => {
  const web = server()
  web.register({ kind: 'exact', path: '/stream', handler: async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    res.writeHead(201, { 'x-body': Buffer.concat(chunks).toString('utf8') })
    res.write('first')
    queueMicrotask(() => res.end('second'))
  } })

  const response = await web.fetch(new Request('http://dsh.internal/stream', { method: 'POST', body: 'payload' }))
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('x-body'), 'payload')
  assert.equal(await response.text(), 'firstsecond')
})

test('adapter normalizes custom-scheme authority and bridges index authorization', async () => {
  const ctx = new Context()
  let observed
  ctx.provide('connection', {
    authorizeIndex(req, res) {
      observed = req.headers
      res.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth-test=signed; Path=/; HttpOnly; SameSite=Strict' })
      res.end()
      return false
    },
  })
  const web = new DesktopPipeWebServer(ctx)
  const response = await web.authorizeIndex(new Request('http://dsh.internal/?token=private', {
    headers: {
      host: 'attacker.invalid',
      origin: 'dsh-runtime://app',
      'sec-fetch-site': 'cross-site',
      cookie: 'existing=value',
    },
  }))

  assert.equal(observed.host, '127.0.0.1')
  assert.equal(observed.origin, 'http://127.0.0.1')
  assert.equal(observed['sec-fetch-site'], 'same-origin')
  assert.equal(observed.cookie, 'existing=value')
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), '/')
  assert.match(response.headers.get('set-cookie'), /^dsh-auth-test=signed;/u)
})

test('adapter request cancellation cannot emit an unhandled Readable error', async () => {
  const web = server()
  let observedAbort = false
  web.register({ kind: 'exact', path: '/cancel', handler: req => new Promise(resolve => {
    req.once('aborted', () => { observedAbort = true; resolve() })
  }) })
  const controller = new AbortController()
  const response = web.fetch(new Request('http://dsh.internal/cancel', { signal: controller.signal }))
  await new Promise(resolve => setImmediate(resolve))
  controller.abort(new Error('expected cancellation'))
  assert.equal((await response).status, 500)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(observedAbort, true)
})

test('adapter renders structured injections and raw index taps', () => {
  const ctx = new Context()
  const web = new DesktopPipeWebServer(ctx)
  ctx.on('webserver/index-inject', table => table.push({ kind: 'global', name: '__TEST__', value: { ok: true } }))
  web.tapIndex(html => html.replace('</body>', '<p>tap</p></body>'))
  const html = web.renderIndex('<html><head></head><body></body></html>')
  assert.match(html, /__TEST__/u)
  assert.match(html, /<p>tap<\/p>/u)
})

test('adapter carries registered upgrade sockets as bounded duplex bytes', async () => {
  const web = server()
  web.registerUpgrade({ path: '/socket', handler: (req, socket) => {
    assert.equal(req.headers.upgrade, 'websocket')
    socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n')
    socket.on('data', chunk => socket.write(chunk))
    socket.on('end', () => socket.end())
  } })
  const input = (async function * () { yield Buffer.from('client-frame').toString('base64') })()
  const controller = new AbortController()
  const chunks = []
  for await (const chunk of web.openDuplex('websocket', { url: '/socket' }, input, controller.signal)) {
    chunks.push(Buffer.from(chunk, 'base64'))
  }
  assert.match(Buffer.concat(chunks).toString('utf8'), /101 Switching Protocols[\s\S]*client-frame/u)
})
