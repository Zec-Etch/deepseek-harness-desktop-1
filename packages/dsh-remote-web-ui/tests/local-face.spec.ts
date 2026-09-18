/**
 * The plugin's own local tunnel face: route dispatch (exact wins over prefix,
 * longest prefix wins), the unknown-path answer, handler containment, and the
 * release of the port on close.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { makeFetchDispatch, matchRoute, resolveAssetPath, startLocalFace, type LocalFace } from '../src/local-face.ts'

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

/** A throwaway built-frontend directory for the full-scope tests. */
async function makeDist(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-face-'))
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log("app")')
  await writeFile(join(dir, 'secret.txt'), 'not-for-remote')
  return dir
}

describe('startLocalFace in full scope', () => {
  it('serves the built frontend statically and falls back to the SPA shell', async () => {
    const distDir = await makeDist()
    const face = await startLocalFace([], {
      full: { distDir, dispatch: (_req, res) => { res.writeHead(418); res.end('runtime') } },
    })
    faces.push(face)
    const base = `http://127.0.0.1:${String(face.port)}`

    const asset = await fetch(`${base}/assets/app.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('text/javascript')
    expect(await asset.text()).toContain('console.log')

    const root = await fetch(`${base}/`)
    expect(root.status).toBe(200)
    expect(await root.text()).toContain('id="root"')

    // An unknown route is client-side: the shell answers it.
    const deep = await fetch(`${base}/settings/models`)
    expect(deep.status).toBe(200)
    expect(await deep.text()).toContain('id="root"')
  })

  it('applies the host index injections to the shell', async () => {
    const distDir = await makeDist()
    const face = await startLocalFace([], {
      full: {
        distDir,
        dispatch: () => {},
        renderIndex: html => html.replace('</div>', '</div><script>window.__DSH_BOOT__={}</script>'),
      },
    })
    faces.push(face)
    const body = await (await fetch(`http://127.0.0.1:${String(face.port)}/`)).text()
    expect(body).toContain('__DSH_BOOT__')
  })

  it('hands runtime paths to the dispatcher instead of the shell', async () => {
    const distDir = await makeDist()
    const seen: string[] = []
    const face = await startLocalFace([], {
      full: {
        distDir,
        dispatch: (req, res) => {
          seen.push(req.url ?? '')
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        },
      },
    })
    faces.push(face)
    const base = `http://127.0.0.1:${String(face.port)}`

    for (const path of ['/api/pair/status', '/m', '/m/api/events.mux', '/plugins/x/client.js']) {
      const response = await fetch(`${base}${path}`)
      expect(response.status).toBe(200)
    }
    expect(seen).toEqual(['/api/pair/status', '/m', '/m/api/events.mux', '/plugins/x/client.js'])
  })

  it('never answers a missing asset with the shell', async () => {
    const distDir = await makeDist()
    const dispatched: string[] = []
    const face = await startLocalFace([], {
      full: {
        distDir,
        dispatch: (req, res) => {
          dispatched.push(req.url ?? '')
          res.writeHead(404)
          res.end('not found')
        },
      },
    })
    faces.push(face)

    // A broken bundle must fail loudly rather than render a blank SPA.
    const missing = await fetch(`http://127.0.0.1:${String(face.port)}/assets/missing.js`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('not found')
    expect(dispatched).toContain('/assets/missing.js')
  })

  it('refuses to resolve a path that escapes the dist directory', () => {
    const distDir = join('base', 'dist')
    expect(resolveAssetPath(distDir, '/assets/app.js')).toBe(join(distDir, 'assets', 'app.js'))
    for (const path of ['/../secret.txt', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '/..\\secret.txt', '/\0/app.js']) {
      expect(resolveAssetPath(distDir, path)).toBeUndefined()
    }
  })

  it('passes a request through the WHATWG dispatcher, headers and body included', async () => {
    const calls: { url: string; method: string; body: string }[] = []
    const face = await startLocalFace([], {
      full: {
        dispatch: makeFetchDispatch({
          fetch: async (request) => {
            calls.push({ url: request.url, method: request.method, body: await request.text() })
            return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } })
          },
        }),
      },
    })
    faces.push(face)
    const response = await fetch(`http://127.0.0.1:${String(face.port)}/api/pair/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"token":"t"}',
    })
    expect(response.status).toBe(201)
    expect(await response.text()).toBe('{"ok":true}')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toBe('{"token":"t"}')
    expect(calls[0].url).toContain('/api/pair/accept')
  })

  it('streams a long-lived response so the live event channel survives', async () => {
    const face = await startLocalFace([], {
      full: {
        dispatch: makeFetchDispatch({
          fetch: async () => new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('data: one\n\n'))
                // Deliberately left open: the client must receive the first
                // chunk without waiting for the stream to end.
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        }),
      },
    })
    faces.push(face)
    const response = await fetch(`http://127.0.0.1:${String(face.port)}/m/api/events.mux`)
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    const first = await reader?.read()
    expect(new TextDecoder().decode(first?.value)).toContain('data: one')
    await reader?.cancel()
  })
})
