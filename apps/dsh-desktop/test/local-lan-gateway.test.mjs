import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_DESKTOP_LAN_GATEWAY_PORT,
  DesktopLanGatewayStore,
  DesktopLanGateway,
  createDesktopLanGatewayHandler,
  desktopLanAddresses,
  desktopLanGatewayBaseUrl,
  isDesktopLanGatewayRequestAllowed,
  isPrivateLanIpv4,
  normalizeDesktopLanGatewayConfig,
  validateDesktopLanGatewayBaseUrl,
} from '../src/local-lan-gateway.mjs'

test('LAN address discovery accepts only private and link-local IPv4 literals', () => {
  for (const value of ['10.0.0.2', '172.16.0.1', '172.31.255.254', '192.168.1.7', '169.254.4.2']) {
    assert.equal(isPrivateLanIpv4(value), true, value)
  }
  for (const value of ['127.0.0.1', '172.32.0.1', '8.8.8.8', '224.0.0.1', '01.2.3.4', '::1', '']) {
    assert.equal(isPrivateLanIpv4(value), false, value)
  }
  assert.deepEqual(desktopLanAddresses({
    Ethernet: [
      { family: 'IPv4', internal: false, address: '192.168.1.8' },
      { family: 'IPv6', internal: false, address: 'fe80::1' },
    ],
    WiFi: [
      { family: 'IPv4', internal: false, address: '192.168.1.8' },
      { family: 'IPv4', internal: false, address: '10.4.0.2' },
    ],
    Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  }), ['192.168.1.8', '10.4.0.2'])
})

test('LAN gateway config selects an active address and never permits all-interface binding', () => {
  const availableAddresses = ['192.168.1.8']
  assert.deepEqual(normalizeDesktopLanGatewayConfig({ enabled: true }, { availableAddresses, requireAvailable: true }), {
    schemaVersion: 1,
    enabled: true,
    address: '192.168.1.8',
    port: DEFAULT_DESKTOP_LAN_GATEWAY_PORT,
  })
  assert.equal(desktopLanGatewayBaseUrl({ enabled: true, address: '192.168.1.8', port: 45000 }, { availableAddresses }), 'http://192.168.1.8:45000')
  assert.equal(validateDesktopLanGatewayBaseUrl('http://192.168.1.8:45000', { availableAddresses }), 'http://192.168.1.8:45000')
  for (const value of [
    { enabled: true, address: '0.0.0.0' },
    { enabled: true, address: '127.0.0.1' },
    { enabled: true, address: '192.168.1.9' },
    { enabled: true, address: '192.168.1.8', port: 80 },
  ]) assert.throws(() => normalizeDesktopLanGatewayConfig(value, { availableAddresses, requireAvailable: true }))
  assert.throws(() => validateDesktopLanGatewayBaseUrl('https://192.168.1.8:45000', { availableAddresses }))
})

test('LAN gateway state is atomic and malformed state fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lan-gateway-state-'))
  const path = join(root, 'state.json')
  try {
    const store = new DesktopLanGatewayStore(path)
    assert.deepEqual(await store.load(), {
      schemaVersion: 1,
      enabled: false,
      port: DEFAULT_DESKTOP_LAN_GATEWAY_PORT,
    })
    await store.save({ enabled: true, address: '192.168.1.8', port: 45000 })
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      schemaVersion: 1,
      enabled: true,
      address: '192.168.1.8',
      port: 45000,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('LAN gateway route allowlist exposes only the mobile surface and pair accept/heartbeat', () => {
  for (const [method, path] of [
    ['GET', '/m'],
    ['HEAD', '/m/mobile.js'],
    ['POST', '/api/pair/accept'],
    ['POST', '/api/pair/heartbeat'],
    ['POST', '/m/api/session.list'],
    ['GET', '/m/api/events.mux'],
  ]) assert.equal(isDesktopLanGatewayRequestAllowed(method, path), true, `${method} ${path}`)
  for (const [method, path] of [
    ['GET', '/'],
    ['POST', '/api/pair/issue'],
    ['GET', '/api/pair/devices'],
    ['POST', '/api/session/create'],
    ['GET', '/m/api/session.list'],
    ['POST', '/m/api/events.mux'],
  ]) assert.equal(isDesktopLanGatewayRequestAllowed(method, path), false, `${method} ${path}`)
})

test('LAN gateway lifecycle binds one exact private interface and reports stable start failures', async () => {
  class FakeServer extends EventEmitter {
    listenOptions = undefined
    maxConnections = 0
    requestTimeout = 0
    headersTimeout = 0
    keepAliveTimeout = 0
    listen(options) {
      this.listenOptions = options
      queueMicrotask(() => this.emit('listening'))
    }
    close(callback) { callback() }
    closeAllConnections() {}
  }
  const saved = []
  const server = new FakeServer()
  const gateway = new DesktopLanGateway({
    store: { save: async value => { saved.push(value); return value } },
    initialConfig: { enabled: true, address: '192.168.1.8', port: 45126 },
    getProvider: () => ({ status: { state: 'ready' }, fetch }),
    createHttpServer: () => server,
    interfacesProvider: () => ({ Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.8' }] }),
  })
  assert.equal((await gateway.start()).state, 'running')
  assert.deepEqual(server.listenOptions, { host: '192.168.1.8', port: 45126, exclusive: true })
  assert.equal(gateway.status.url, 'http://192.168.1.8:45126')
  assert.equal((await gateway.configure({ enabled: false, port: 45126 })).state, 'stopped')
  assert.deepEqual(saved, [{ schemaVersion: 1, enabled: false, port: 45126 }])

  class FailedServer extends FakeServer {
    listen() { queueMicrotask(() => this.emit('error', Object.assign(new Error('busy'), { code: 'EADDRINUSE' }))) }
  }
  const failed = new DesktopLanGateway({
    store: { save: async value => value },
    initialConfig: { enabled: true, address: '192.168.1.8', port: 45127 },
    getProvider: () => ({ status: { state: 'ready' }, fetch }),
    createHttpServer: () => new FailedServer(),
    interfacesProvider: () => ({ Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.8' }] }),
  })
  assert.deepEqual(await failed.start(), {
    state: 'error',
    enabled: true,
    address: '192.168.1.8',
    port: 45127,
    availableAddresses: ['192.168.1.8'],
    errorCode: 'port-in-use',
  })
})

test('LAN gateway forwards allowlisted requests and rejects host, origin and full API access', async () => {
  const seen = []
  const provider = {
    status: { state: 'ready' },
    fetch: async request => {
      seen.push({
        url: request.url,
        method: request.method,
        host: request.headers.get('host'),
        origin: request.headers.get('origin'),
        cookie: request.headers.get('cookie'),
        authorization: request.headers.get('authorization'),
        body: request.method === 'POST' ? await request.text() : '',
      })
      return new Response('ok', {
        status: 201,
        headers: { 'content-type': 'text/plain', 'set-cookie': 'dsh_pair=device; Path=/; HttpOnly; SameSite=Lax' },
      })
    },
  }
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')
  const authority = `127.0.0.1:${String(address.port)}`
  server.on('request', createDesktopLanGatewayHandler({ getProvider: () => provider, authority }))
  try {
    const accepted = await fetch(`http://${authority}/api/pair/accept`, {
      method: 'POST',
      headers: {
        origin: `http://${authority}`,
        cookie: 'prior=value',
        authorization: 'must-not-forward',
        'content-type': 'application/json',
      },
      body: '{"token":"one"}',
    })
    assert.equal(accepted.status, 201)
    assert.equal(await accepted.text(), 'ok')
    assert.match(accepted.headers.get('set-cookie') ?? '', /dsh_pair=device/u)
    assert.deepEqual(seen, [{
      url: `http://${authority}/api/pair/accept`,
      method: 'POST',
      host: authority,
      origin: `http://${authority}`,
      cookie: 'prior=value',
      authorization: null,
      body: '{"token":"one"}',
    }])

    assert.equal((await fetch(`http://${authority}/api/session/create`, { method: 'POST' })).status, 404)
    assert.equal((await fetch(`http://${authority}/m`, { headers: { origin: 'http://evil.invalid' } })).status, 403)
    assert.equal(seen.length, 1)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
