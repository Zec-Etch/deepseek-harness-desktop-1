/**
 * Dynamic trust of the configured public entry address: the pairing fence
 * derives the authority it accepts from the live `publicBaseUrl` on every
 * request, so changing that setting moves the trusted entry address with it —
 * no restart, and no window where the previous authority is still accepted.
 */
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { PairingService } from '../src/pairing.ts'
import { makeRoutes } from '../src/routes.ts'

/** One served route family with its pairing service. */
interface Harness {
  service: PairingService
  port: number
  close: () => Promise<void>
}

const open: Harness[] = []

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close()
})

async function serve(): Promise<Harness> {
  const service = new PairingService({
    tokenTtlMs: 600_000,
    offlineAfterMs: 25_000,
    maxDevices: 4,
    cookieName: 'dsh_pair',
  })
  const routes = makeRoutes({ service, lanAddresses: [] })
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const route = routes.find(item => item.kind === 'exact' && item.path === pathname)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const harness: Harness = {
    service,
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error)))),
  }
  open.push(harness)
  return harness
}

/** Ask the pairing status route as a client that presents `host`. */
async function statusThrough(port: number, host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/api/pair/status',
      method: 'GET',
      headers: { host },
    }, response => {
      response.resume()
      response.on('end', () => { resolve(response.statusCode ?? 0) })
    })
    request.on('error', reject)
    request.end()
  })
}

describe('configured public entry address', () => {
  it('is the authority the phone-facing routes accept', async () => {
    const h = await serve()
    h.service.setPublicBaseUrl('https://first.example.com')
    expect(await statusThrough(h.port, 'first.example.com')).toBe(200)
    expect(await statusThrough(h.port, 'second.example.com')).toBe(403)
  })

  it('moves the trusted authority as soon as it changes', async () => {
    const h = await serve()
    h.service.setPublicBaseUrl('https://first.example.com')
    expect(await statusThrough(h.port, 'first.example.com')).toBe(200)

    h.service.setPublicBaseUrl('https://second.example.com')
    // The new address is trusted immediately...
    expect(await statusThrough(h.port, 'second.example.com')).toBe(200)
    // ...and the previous one stops being accepted on the very next request.
    expect(await statusThrough(h.port, 'first.example.com')).toBe(403)
  })

  it('accepts nothing from a public authority while none is configured', async () => {
    const h = await serve()
    expect(await statusThrough(h.port, 'first.example.com')).toBe(403)
  })

  it('accepts a port-qualified authority verbatim and refuses a wrong port', async () => {
    const h = await serve()
    h.service.setPublicBaseUrl('https://third.example.com:8443')
    expect(await statusThrough(h.port, 'third.example.com:8443')).toBe(200)
    expect(await statusThrough(h.port, 'third.example.com:9443')).toBe(403)
  })
})
