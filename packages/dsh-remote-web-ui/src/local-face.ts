/**
 * The plugin's own local HTTP face.
 *
 * A Desktop-managed runtime serves over Electron's private OS pipe and
 * disables the TCP webserver row, so there is no bound port a tunnel can
 * forward to. The Desktop LAN gateway is a TCP face, but it is owned by the
 * packaged application (inside `app.asar`, so it cannot be updated with the
 * plugin) and it only accepts requests whose Host is its own LAN authority —
 * a request arriving through a public reverse proxy is refused with 421, and
 * forcing the proxy to masquerade as the LAN authority would also strip the
 * device cookie's Secure flag.
 *
 * This face closes that gap inside the plugin, in one of two scopes:
 *
 * - **mobile** (default): a loopback listener that dispatches into the very
 *   same route table the runtime serves, restricted to the paths a remote
 *   client may reach. The loopback-only control routes stay off every TCP
 *   surface.
 * - **full**: the whole surface a browser needs — the built frontend (which
 *   the runtime does not serve in pipe mode; Electron does) plus every other
 *   path handed to the runtime's own dispatcher, so a paired device gets the
 *   complete interface, including `/api`.
 *
 * In both scopes the runtime's own fences still decide: the pairing service
 * and the `api/gate` policy are unchanged, and the request keeps the public
 * authority so the configured entry address is what gets trusted.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** One running local face. */
export interface LocalFace {
  /** The bound loopback port the tunnel should forward to. */
  readonly port: number
  /** Stop listening and release the port. */
  close(): Promise<void>
}

/**
 * Full-surface wiring: serve the built frontend and hand every other path to
 * the runtime's own dispatcher (the caller decides how to reach it).
 */
export interface FullSurface {
  /**
   * Directory holding the built frontend. Omit when the runtime's own
   * dispatcher already serves the frontend (a TCP webserver does).
   */
  distDir?: string
  /** Serve one request the face does not answer from disk. */
  dispatch(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  /**
   * Decide whether this request may receive the application shell. The caller
   * owns the answer: returning false means it already wrote the response (an
   * exchange redirect, a challenge, or a refusal), which is how the runtime's
   * browser-session handshake is honoured instead of bypassed.
   */
  authorizeIndex?(req: IncomingMessage, res: ServerResponse): boolean
  /** Apply the host's index injections to the raw index.html. */
  renderIndex?(html: string): string
}

/** Injectable seams (the real ones bind loopback with node's http server). */
export interface LocalFaceOptions {
  /** Loopback host to bind (default 127.0.0.1; never a public interface). */
  host?: string
  /** Port to bind, 0 for an OS-assigned one (default 0). */
  port?: number
  /** Full-surface scope; omitted means the mobile-only scope. */
  full?: FullSurface
}

/** Content types for the built frontend's file kinds. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

/** Paths the runtime owns even in the full scope (never answered from disk). */
function isRuntimePath(pathname: string): boolean {
  return pathname === '/m'
    || pathname.startsWith('/m/')
    || pathname === '/api'
    || pathname.startsWith('/api/')
    || pathname.startsWith('/plugins/')
}

/** Write one plain-text response without leaking internals. */
function writePlain(res: ServerResponse, status: number, body: string): void {
  if (res.headersSent || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/**
 * Match one request path against the registered routes the way the host
 * webserver does: an exact route wins over a prefix route, and the longest
 * matching prefix wins among prefixes.
 * @param routes - the registered routes.
 * @param pathname - the request path.
 * @returns the matching route, or undefined.
 */
export function matchRoute(routes: readonly WebRoute[], pathname: string): WebRoute | undefined {
  const exact = routes.find(route => route.kind === 'exact' && route.path === pathname)
  if (exact !== undefined) return exact
  let best: WebRoute | undefined
  for (const route of routes) {
    if (route.kind !== 'prefix' || !pathname.startsWith(route.path)) continue
    if (best === undefined || route.path.length > best.path.length) best = route
  }
  return best
}

/**
 * Resolve a request path to a file inside the dist directory, or undefined
 * when it escapes the directory or names no file.
 * @param distDir - the built frontend's directory.
 * @param pathname - the request path.
 * @returns the absolute file path, or undefined.
 */
export function resolveAssetPath(distDir: string, pathname: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.includes('..')) return undefined
  const relative = normalize(decoded).replace(/^([/\\])+/, '')
  if (relative === '' || relative.startsWith('..')) return undefined
  return join(distDir, relative)
}

/** Serve one file, or report that it is not there. */
async function serveFile(res: ServerResponse, filename: string): Promise<boolean> {
  try {
    const info = await stat(filename)
    if (!info.isFile()) return false
    const body = await readFile(filename)
    if (res.headersSent || res.writableEnded) return true
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(filename).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.byteLength,
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
    return true
  } catch {
    return false
  }
}

/** Serve the SPA index (with the host's injections when it can provide them). */
async function serveIndex(
  req: IncomingMessage,
  res: ServerResponse,
  full: FullSurface,
): Promise<void> {
  // The runtime's browser-session handshake runs first: the shell is only
  // meaningful to a session the runtime will also authorize on /api.
  if (full.authorizeIndex !== undefined && !full.authorizeIndex(req, res)) return
  if (full.distDir === undefined) {
    writePlain(res, 404, 'not found')
    return
  }
  let html: string
  try {
    html = await readFile(join(full.distDir, 'index.html'), 'utf8')
  } catch {
    writePlain(res, 500, 'frontend is not available')
    return
  }
  const body = full.renderIndex === undefined ? html : full.renderIndex(html)
  if (res.headersSent || res.writableEnded) return
  res.writeHead(200, {
    'content-type': CONTENT_TYPES['.html'],
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/** Route one request in the full scope. */
async function handleFull(
  req: IncomingMessage,
  res: ServerResponse,
  full: FullSurface,
  pathname: string,
): Promise<void> {
  // The runtime owns its own paths, including the mobile surface.
  if (isRuntimePath(pathname)) {
    await full.dispatch(req, res)
    return
  }
  if (full.distDir !== undefined) {
    const filename = resolveAssetPath(full.distDir, pathname)
    if (filename !== undefined && await serveFile(res, filename)) return
    // A missing asset is a miss, not a route: answering it with the SPA shell
    // would turn a broken bundle into a confusing blank page.
    if (extname(pathname) !== '' && pathname !== '/index.html') {
      await full.dispatch(req, res)
      return
    }
    await serveIndex(req, res, full)
    return
  }
  await full.dispatch(req, res)
}

/**
 * Start a loopback listener that serves the plugin's routes (mobile scope) or
 * the whole browser surface (full scope).
 * @param routes - the same route objects the plugin registers on the host.
 * @param options - the bind seams and the optional full-surface wiring.
 * @returns the face once it is listening (its port is then usable).
 */
export async function startLocalFace(
  routes: readonly WebRoute[],
  options: LocalFaceOptions = {},
): Promise<LocalFace> {
  const host = options.host ?? '127.0.0.1'
  const full = options.full
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', `http://${host}`).pathname
    } catch {
      writePlain(res, 400, 'bad request')
      return
    }
    const dispatch = async (): Promise<void> => {
      if (full !== undefined) {
        await handleFull(req, res, full, pathname)
        return
      }
      const route = matchRoute(routes, pathname)
      if (route === undefined) {
        writePlain(res, 404, 'not found')
        return
      }
      await route.handler(req, res)
    }
    void dispatch().catch(() => {
      // A handler failure is a local bug; the caller gets no internals.
      writePlain(res, 500, 'internal error')
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host, port: options.port ?? 0, exclusive: true }, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo | null
  if (address === null || typeof address === 'string') {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    throw new Error('local face: the listener reported no port')
  }

  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => {
      server.close(() => { resolve() })
      // A keep-alive client must not hold the face open forever.
      server.closeAllConnections?.()
    }),
  }
}

/** The WHATWG subset a runtime dispatcher exposes (the pipe webserver's `fetch`). */
export interface RuntimeFetchDispatcher {
  fetch(request: Request): Promise<Response>
}

/**
 * Bridge a node request into a runtime dispatcher that speaks WHATWG fetch —
 * the Desktop pipe webserver's carrier — so an HTTP tunnel reaches the same
 * route table the application's IPC does. Bodies are piped through, which is
 * what keeps the live event channel (`text/event-stream`) working.
 * @param dispatcher - the runtime dispatcher.
 * @returns a dispatch function for {@link FullSurface}.
 */
export function makeFetchDispatch(
  dispatcher: RuntimeFetchDispatcher,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      if (Array.isArray(value)) for (const item of value) headers.append(name, item)
      else headers.set(name, value)
    }
    const method = req.method ?? 'GET'
    const hasBody = method !== 'GET' && method !== 'HEAD' && chunks.length > 0
    const request = new Request(url, {
      method,
      headers,
      ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
    })
    let response: Response
    try {
      response = await dispatcher.fetch(request)
    } catch {
      writePlain(res, 500, 'internal error')
      return
    }
    if (res.headersSent || res.writableEnded) return
    const outHeaders: Record<string, string | string[]> = {}
    response.headers.forEach((value, name) => {
      // Body framing belongs to this listener.
      if (name === 'content-encoding' || name === 'transfer-encoding' || name === 'content-length') return
      outHeaders[name] = value
    })
    res.writeHead(response.status, outHeaders)
    if (response.body === null) {
      res.end()
      return
    }
    await new Promise<void>((resolve, reject) => {
      const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
      body.on('error', reject)
      res.on('close', () => { body.destroy() })
      res.on('finish', () => { resolve() })
      body.pipe(res)
    }).catch(() => { if (!res.writableEnded) res.destroy() })
  }
}
