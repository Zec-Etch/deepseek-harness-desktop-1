/**
 * SSH reverse-tunnel transport: an alternative to the Cloudflare quick
 * tunnel for deployments that already run their own public entry point (a
 * reverse proxy in front of an SSH server they control).
 *
 * The manager opens `ssh -N -T ... -R <remoteHost>:<remotePort>:<localHost>:<localPort>`
 * so the remote host's loopback port forwards back to this machine's dsh web
 * server. Unlike a quick tunnel there is no minted hostname to parse: the
 * public origin is configured (`publicUrl`), and it is advertised once the
 * forward is up so the pairing service can build QR links from it.
 *
 * Readiness: the connection carries `-o ExitOnForwardFailure=yes`, so ssh
 * exits within a moment when the remote port cannot be bound (taken, or
 * forwarding refused). A process that is still alive after
 * {@link SshTunnelOptions.readyDelayMs} therefore means the forward is
 * established; that is when the phase flips to `running`.
 *
 * All seams — the process factory, the clock and the timers — are injectable,
 * so the whole lifecycle is unit-testable without an SSH server.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TunnelInfo, TunnelPhase } from './tunnel.ts'

/** The SSH invocation shape this manager builds (pure, so tests can assert it). */
export interface SshForwardSpec {
  /** Forward target host on the remote side (the reverse proxy's upstream). */
  remoteHost: string
  /** Forwarded port on the remote side. */
  remotePort: number
  /** Local host the dsh web server listens on. */
  localHost: string
  /** Local dsh web port. */
  localPort: number
}

/** The child-process subset the manager drives (a node ChildProcess fits). */
export interface SshProcess {
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

/** Injectable seams (defaults spawn the real ssh client with node timers). */
export interface SshTunnelOptions {
  /** SSH destination: `host` or `user@host`. Required. */
  server?: string
  /** SSH server port (default 22). */
  sshPort?: number
  /** Port exposed on the remote loopback (default 7788). */
  remotePort?: number
  /** Remote host the forward binds to (default 127.0.0.1). */
  remoteHost?: string
  /** Public origin the QR link is built from, e.g. `https://dsh.example.com`. */
  publicUrl?: string
  /** Private key file passed as `-i` (default: the ssh client's own identity). */
  keyPath?: string
  /** ssh executable (default: the platform client). */
  sshBin?: string
  /** Spawn one ssh process (injected in tests). */
  spawnProcess?: (bin: string, args: string[]) => SshProcess
  /** Timer source (injected in tests). */
  timer?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }
  /** How long the process must stay alive before the forward counts as up. */
  readyDelayMs?: number
  /** How long to wait before re-resolving an unknown local target (default 1000). */
  targetWaitMs?: number
  /** First restart delay after an unexpected failure (exponential base). */
  restartBaseMs?: number
  /** Cap on the exponential restart delay. */
  restartMaxMs?: number
}

/** Node timers. */
const nodeTimer = { setTimeout, clearTimeout }

const DEFAULT_READY_DELAY_MS = 1_500
const DEFAULT_TARGET_WAIT_MS = 1_000
const DEFAULT_RESTART_BASE_MS = 5_000
const DEFAULT_RESTART_MAX_MS = 60_000
const DEFAULT_REMOTE_PORT = 7788
const DEFAULT_SSH_PORT = 22
const DEFAULT_REMOTE_HOST = '127.0.0.1'

/**
 * The platform ssh client. Windows ships one under System32 and normally has
 * it on PATH; resolving the absolute path first keeps the tunnel working in
 * packaged processes whose PATH was rebuilt without the OpenSSH directory.
 * @param env - environment to resolve SystemRoot from (default process.env).
 * @returns the executable to spawn.
 */
export function resolveSshBinary(env: Record<string, string | undefined> = process.env): string {
  const override = env.DSH_SSH_TUNNEL_BIN?.trim()
  if (override !== undefined && override.length > 0) return override
  if (process.platform === 'win32') {
    const systemRoot = env.SystemRoot ?? env.SYSTEMROOT
    if (systemRoot !== undefined && systemRoot.length > 0) {
      const candidate = join(systemRoot, 'System32', 'OpenSSH', 'ssh.exe')
      if (existsSync(candidate)) return candidate
    }
  }
  return 'ssh'
}

/**
 * Parse the local URL the plugin starts the transport with into a forward
 * spec. The plugin passes `http://127.0.0.1:<port>`; a malformed value is
 * refused so the tunnel never forwards to a guessed port.
 * @param targetUrl - the local dsh web URL.
 * @param options - the configured remote side.
 * @returns the forward spec.
 * @throws {TypeError} when the URL carries no usable port.
 */
export function buildForwardSpec(targetUrl: string, options: SshTunnelOptions): SshForwardSpec {
  const url = new URL(targetUrl)
  const localPort = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
    throw new TypeError(`ssh tunnel: unusable local target ${JSON.stringify(targetUrl)}`)
  }
  return {
    remoteHost: options.remoteHost ?? DEFAULT_REMOTE_HOST,
    remotePort: options.remotePort ?? DEFAULT_REMOTE_PORT,
    localHost: url.hostname === '' ? DEFAULT_REMOTE_HOST : url.hostname,
    localPort,
  }
}

/**
 * Build the ssh argv for one forward. Pure, so the exact invocation is
 * testable and reviewable: BatchMode keeps a headless host process from ever
 * blocking on a prompt, ExitOnForwardFailure makes a failed bind a fast,
 * observable exit instead of a silent no-op, and the keepalives cover the
 * idle NAT timeouts that kill long-lived forwards.
 * @param spec - the forward to establish.
 * @param options - the configured remote side.
 * @returns the argument vector (without the executable).
 */
export function buildSshArgs(spec: SshForwardSpec, options: SshTunnelOptions): string[] {
  const server = options.server
  if (server === undefined || server.trim() === '') {
    throw new TypeError('ssh tunnel: a server ([user@]host) is required')
  }
  const args = [
    '-N',
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'TCPKeepAlive=yes',
  ]
  if (options.keyPath !== undefined && options.keyPath.trim() !== '') {
    args.push('-i', options.keyPath)
  }
  args.push('-p', String(options.sshPort ?? DEFAULT_SSH_PORT))
  args.push('-R', `${spec.remoteHost}:${spec.remotePort}:${spec.localHost}:${spec.localPort}`)
  args.push(server)
  return args
}

/** Default process factory: the platform ssh client, no shell, hidden window. */
function defaultSpawnProcess(bin: string, args: string[]): SshProcess {
  const child: ChildProcess = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  return child as unknown as SshProcess
}

/**
 * Own the lifecycle of one SSH reverse tunnel: start/stop, readiness, the
 * advertised public origin, and crash-restart backoff. The phase model
 * matches the Cloudflare transport so the desktop panel renders either one
 * without changes.
 */
export class SshTunnelManager {
  /**
   * Live tunables. The settings surface replaces the object (a fresh literal)
   * when a committed section changes, so an edit takes effect on the next
   * (re)connect without a process restart — the same contract the pairing
   * service uses for its own config.
   */
  public options: SshTunnelOptions

  private readonly spawnProcess: (bin: string, args: string[]) => SshProcess
  private readonly timer: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void }

  private phase: TunnelPhase = 'stopped'
  private url: string | undefined
  private error: string | undefined
  /** Resolver for the local target (re-read on every attempt). */
  private targetProvider: (() => string | undefined) | undefined
  /** Last resolved target (the fixed form when `start` was given a string). */
  private targetUrl: string | undefined
  private handle: SshProcess | undefined
  private readyTimer: unknown | undefined
  private restartTimer: unknown | undefined
  private attempts = 0
  private stopping = false
  private readonly urlListeners = new Set<(url: string) => void>()
  private readonly phaseListeners = new Set<(info: TunnelInfo) => void>()

  /**
   * @param options - the SSH destination, the exposed port, the public origin
   * and the injectable seams.
   */
  constructor(options: SshTunnelOptions = {}) {
    this.options = options
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess
    this.timer = options.timer ?? nodeTimer
  }

  /** The configured public origin (the URL the QR link is built from). */
  get publicUrl(): string | undefined {
    return this.options.publicUrl
  }

  /** The current status frame (the panel's tunnel badge). */
  get info(): TunnelInfo {
    return {
      phase: this.phase,
      ...(this.url !== undefined ? { url: this.url } : {}),
      ...(this.error !== undefined ? { error: this.error } : {}),
    }
  }

  /**
   * Start (or keep) the forward toward a local target. The target may be a
   * fixed URL or a provider re-resolved on every attempt: the local dsh web
   * port is only known AFTER the server binds (an OS-assigned `--port 0`
   * reads as 0 while plugins are being applied), so a provider lets the
   * transport converge on the real port instead of failing on the configured
   * placeholder. Restarting with a different target tears the old process
   * down first; re-arming the same target while already live is a no-op.
   * @param target - the local dsh web URL, or a provider of it (undefined
   * while the port is still unknown).
   */
  start(target: string | (() => string | undefined)): void {
    const provider = typeof target === 'function' ? target : () => target
    const live = this.phase === 'starting' || this.phase === 'running'
    if (live && this.targetProvider !== undefined) {
      const next = typeof target === 'string' ? target : this.resolveTarget()
      if (next === undefined || next === this.targetUrl) {
        // Same destination (or not resolvable yet): refresh the resolver so a
        // settings edit cannot bounce a healthy forward. A moved destination
        // (the web server rebound on another port) falls through and restarts.
        this.targetProvider = provider
        return
      }
    }
    this.teardown()
    this.stopping = false
    this.targetProvider = provider
    this.targetUrl = undefined
    this.attempts = 0
    this.attempt()
  }

  /** Stop the tunnel for good: no restarts, no state. */
  stop(): void {
    this.teardown()
    this.stopping = false
    this.targetProvider = undefined
    this.targetUrl = undefined
    this.url = undefined
    this.error = undefined
    this.setPhase('stopped')
  }

  /** Alias of {@link stop} for plugin-effect disposal. */
  dispose(): void {
    this.stop()
  }

  /** Subscribe to the advertised public origin. */
  onUrl(listener: (url: string) => void): () => void {
    this.urlListeners.add(listener)
    return () => { this.urlListeners.delete(listener) }
  }

  /** Subscribe to every phase change. */
  onPhase(listener: (info: TunnelInfo) => void): () => void {
    this.phaseListeners.add(listener)
    return () => { this.phaseListeners.delete(listener) }
  }

  private attempt(): void {
    if (this.stopping || this.targetProvider === undefined) return
    this.setPhase('starting')
    this.handle = undefined
    this.url = undefined
    this.error = undefined

    // The local port is only known after the web server binds, so an
    // unresolved target means "not ready yet": keep waiting on a short timer
    // instead of reporting a failure the user cannot act on.
    const targetUrl = this.resolveTarget()
    if (targetUrl === undefined) {
      this.restartTimer = this.timer.setTimeout(() => {
        this.restartTimer = undefined
        this.attempt()
      }, this.options.targetWaitMs ?? DEFAULT_TARGET_WAIT_MS)
      return
    }
    this.targetUrl = targetUrl

    let spec: SshForwardSpec
    let args: string[]
    try {
      spec = buildForwardSpec(this.targetUrl, this.options)
      args = buildSshArgs(spec, this.options)
    } catch (error) {
      // A configuration mistake is not retryable on its own: report it and
      // keep the backoff running so a settings edit recovers the tunnel.
      this.fail(error instanceof Error ? error.message : String(error))
      return
    }

    let handle: SshProcess
    try {
      handle = this.spawnProcess(this.options.sshBin ?? resolveSshBinary(), args)
    } catch (error) {
      this.fail(`could not start the ssh client: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.handle = handle

    handle.on('error', (error: Error) => {
      if (this.handle !== handle) return
      this.fail(`ssh client error: ${error.message}`)
    })
    handle.on('exit', (code: number | null) => {
      // The exit handler is detached during teardown, so reaching this point
      // means an unexpected death: fail the phase and schedule a retry.
      if (this.handle !== handle) return
      this.fail(`the ssh tunnel exited unexpectedly (code ${String(code)})`)
    })

    // A live process after the readiness delay means the remote bind succeeded
    // (ExitOnForwardFailure turns a refused bind into an immediate exit).
    this.readyTimer = this.timer.setTimeout(() => {
      this.readyTimer = undefined
      if (this.handle !== handle || this.stopping) return
      // The advertised origin must ride the running frame itself: the host
      // publishes the public base from that notification, and a running frame
      // without a URL is indistinguishable from "no public address", which
      // would leave the QR link in its lan-required state even though the
      // forward is up. The Cloudflare transport assigns its minted URL before
      // the same transition, for the same reason.
      const publicUrl = this.options.publicUrl
      if (publicUrl !== undefined && publicUrl !== '') this.url = publicUrl
      this.attempts = 0
      this.error = undefined
      this.setPhase('running')
      const announced = this.url
      if (announced === undefined) return
      for (const listener of this.urlListeners) {
        try {
          listener(announced)
        } catch {
          // A throwing subscriber must not break the emit loop.
        }
      }
    }, this.options.readyDelayMs ?? DEFAULT_READY_DELAY_MS)
  }

  /** Resolve the current local target, or undefined while it is unknown. */
  private resolveTarget(): string | undefined {
    try {
      const value = this.targetProvider?.()
      return value === undefined || value === '' ? undefined : value
    } catch {
      // A throwing resolver is a host-side bug; keep waiting rather than
      // taking the tunnel down over it.
      return undefined
    }
  }

  private fail(message: string): void {
    if (this.stopping) return
    this.url = undefined
    this.error = message
    if (this.handle !== undefined) {
      try { this.handle.kill() } catch { /* the process may already be gone */ }
      this.handle = undefined
    }
    this.clearReadyTimer()
    this.setPhase('failed')
    this.attempts += 1
    const base = this.options.restartBaseMs ?? DEFAULT_RESTART_BASE_MS
    const cap = this.options.restartMaxMs ?? DEFAULT_RESTART_MAX_MS
    const delay = Math.min(base * 2 ** (this.attempts - 1), cap)
    this.restartTimer = this.timer.setTimeout(() => {
      this.restartTimer = undefined
      this.attempt()
    }, delay)
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== undefined) {
      this.timer.clearTimeout(this.readyTimer)
      this.readyTimer = undefined
    }
  }

  /** Stop the current process and cancel every pending timer (no phase change). */
  private teardown(): void {
    this.stopping = true
    this.clearReadyTimer()
    if (this.restartTimer !== undefined) {
      this.timer.clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    if (this.handle !== undefined) {
      const handle = this.handle
      this.handle = undefined
      try { handle.kill() } catch { /* already exited */ }
    }
  }

  private setPhase(phase: TunnelPhase): void {
    this.phase = phase
    const info = this.info
    for (const listener of this.phaseListeners) {
      try {
        listener(info)
      } catch {
        // A throwing subscriber must not break the emit loop.
      }
    }
  }
}
