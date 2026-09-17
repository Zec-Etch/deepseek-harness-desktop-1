/**
 * The plugin's own local tunnel face: route dispatch (exact wins over prefix,
 * longest prefix wins), the unknown-path answer, handler containment, and the
 * release of the port on close.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { matchRoute, startLocalFace, type LocalFace } from '../src/local-face.ts'

const faces: LocalFace[] = []

afterEach(async () => {
  for (const face of faces.splice(0)) await face.close()
})

function textRoute(kind: 'exact' | 'prefix', path: string, body: string): WebRoute {
  return {
    kind,
    path,
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(body)
    },
  }
}

async function start(routes: WebRoute[]): Promise<LocalFace> {
  const face = await startLocalFace(routes)
  faces.push(face)
  return face
}

describe('matchRoute', () => {
  it('lets an exact route win over a prefix route', () => {
    const exact = textRoute('exact', '/m/api/events.mux', 'exact')
    const prefix = textRoute('prefix', '/m/api', 'prefix')
    expect(matchRoute([prefix, exact], '/m/api/events.mux')).toBe(exact)
  })

  it('picks the longest matching prefix', () => {
    const short = textRoute('prefix', '/m', 'short')
    const long = textRoute('prefix', '/m/api', 'long')
    expect(matchRoute([short, long], '/m/api/session.list')).toBe(long)
  })

  it('reports no match for an unrelated path', () => {
    expect(matchRoute([textRoute('exact', '/m', 'm')], '/api/pair/issue')).toBeUndefined()
  })
})

describe('startLocalFace', () => {
  it('serves a matching route over loopback', async () => {
    const face = await start([textRoute('exact', '/m', 'mobile-page')])
    const response = await fetch(`http://127.0.0.1:${String(face.port)}/m`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('mobile-page')
  })

  it('binds loopback only', async () => {
    const face = await start([textRoute('exact', '/m', 'mobile-page')])
    expect(face.port).toBeGreaterThan(0)
    expect(face.port).toBeLessThan(65_536)
  })

  it('answers an unknown path without exposing internals', async () => {
    const face = await start([textRoute('exact', '/m', 'mobile-page')])
    const response = await fetch(`http://127.0.0.1:${String(face.port)}/api/pair/issue`)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('not found')
  })

  it('contains a throwing handler', async () => {
    const exploding: WebRoute = {
      kind: 'exact',
      path: '/m',
      handler: async () => { throw new Error('handler blew up with internals') },
    }
    const face = await start([exploding])
    const response = await fetch(`http://127.0.0.1:${String(face.port)}/m`)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('internal error')
  })

  it('releases the port on close', async () => {
    const face = await startLocalFace([textRoute('exact', '/m', 'mobile-page')])
    const port = face.port
    await face.close()
    await expect(fetch(`http://127.0.0.1:${String(port)}/m`)).rejects.toThrow()
  })
})
