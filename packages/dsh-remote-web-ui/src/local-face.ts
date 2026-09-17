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
 * This face closes that gap inside the plugin: a loopback-only listener that
 * dispatches into the very same route table the runtime serves, so a tunnel
 * reaches the mobile routes with the public authority intact. The plugin's
 * existing fences still decide: `/api/pair/issue`, `/api/update/*` and the
 * device-control routes stay loopback-Host-only (they are unreachable through
 * a public origin), while the phone-facing routes authorize exactly as they
 * do on any other transport.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** One running local face. */
export interface LocalFace {
  /** The bound loopback port the tunnel should forward to. */
  readonly port: number
  /** Stop listening and release the port. */
  close(): Promise<void>
}

/** Injectable seams (the real ones bind loopback with node's http server). */
export interface LocalFaceOptions {
  /** Loopback host to bind (default 127.0.0.1; never a public interface). */
  host?: string
  /** Port to bind, 0 for an OS-assigned one (default 0). */
  port?: number
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
 * Start a loopback listener that dispatches into the plugin's own routes.
 * @param routes - the same route objects the plugin registers on the host.
 * @param options - the bind seams.
 * @returns the face once it is listening (its port is then usable).
 */
export async function startLocalFace(
  routes: readonly WebRoute[],
  options: LocalFaceOptions = {},
): Promise<LocalFace> {
  const host = options.host ?? '127.0.0.1'
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', `http://${host}`).pathname
    } catch {
      writePlain(res, 400, 'bad request')
      return
    }
    const route = matchRoute(routes, pathname)
    if (route === undefined) {
      writePlain(res, 404, 'not found')
      return
    }
    void Promise.resolve()
      .then(() => route.handler(req, res))
      .catch(() => {
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
