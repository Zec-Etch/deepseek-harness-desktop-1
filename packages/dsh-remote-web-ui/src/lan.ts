/**
 * LAN address derivation for the pairing URLs. Mirrors the dsh CLI's
 * boot-time sampling (apps/cli/src/app-cli-entry.ts `resolveLanTrust`): the
 * pairing links may only name addresses the /api trust fence was configured
 * with, so the same non-internal IPv4 derivation applies here — an external
 * plugin cannot read the CLI's sampled snapshot, but the fence accepts
 * exactly these literals, which is the property that matters.
 */

import { networkInterfaces } from 'node:os'

/** Desktop-owned local gateway origin passed only to the managed Runtime child. */
export const DESKTOP_LAN_GATEWAY_BASE_ENV = 'DSH_DESKTOP_LAN_GATEWAY_BASE'

function privateIpv4(value: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return false
  const parts = value.split('.').map(Number)
  if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255) || parts.join('.') !== value) return false
  const [a, b] = parts
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
}

/**
 * Non-internal IPv4 interface addresses of this machine — the IP-literal
 * authorities an all-interfaces bind is reachable by on the LAN.
 * @returns the addresses in interface order (possibly empty).
 */
export function lanIPv4Addresses(): string[] {
  return Object.values(networkInterfaces()).flat()
    .filter((iface): iface is NonNullable<typeof iface> => { return iface !== undefined && iface.family === 'IPv4' && !iface.internal })
    .map(iface => iface.address)
}

/**
 * Resolve the exact private origin owned by Electron's optional LAN gateway.
 * The address must still be active locally; an ambient or stale environment
 * value can therefore never make a QR advertise a foreign/dead authority.
 */
export function desktopLanGatewayBase(
  value: string | undefined = process.env[DESKTOP_LAN_GATEWAY_BASE_ENV],
  addresses: readonly string[] = lanIPv4Addresses(),
): { address: string; base: string } | undefined {
  if (value === undefined || value === '') return undefined
  let url: URL
  try { url = new URL(value) } catch { return undefined }
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '') return undefined
  if (!privateIpv4(url.hostname) || !addresses.includes(url.hostname)) return undefined
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) return undefined
  return { address: url.hostname, base: `http://${url.hostname}:${String(port)}` }
}

/**
 * The local origin a tunnel should forward to.
 *
 * A Desktop-managed runtime runs over Electron's private OS pipe: the TCP
 * webserver row is disabled, so `webServer.port` never becomes usable and the
 * only reachable TCP face is the Desktop LAN gateway — the narrow surface that
 * already serves the mobile routes and rewrites its own authority upstream.
 * Everywhere else (the `dsh web` CLI and plain desktop runs) the bound web
 * server is the right target, and a wildcard bind is reached over loopback.
 * @param input - the gateway base (when the app owns one), the bound host and
 * the bound port (which reads as 0 until the server has listened).
 * @returns the origin to forward to, or undefined while it cannot be named yet.
 */
export function resolveTunnelTarget(input: {
  gatewayBase?: { base: string } | undefined
  host?: string | undefined
  port?: number | undefined
}): string | undefined {
  const gateway = input.gatewayBase
  if (gateway !== undefined) return gateway.base
  const port = input.port
  if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  const host = input.host === undefined || input.host === '0.0.0.0' ? '127.0.0.1' : input.host
  return `http://${host}:${String(port)}`
}
