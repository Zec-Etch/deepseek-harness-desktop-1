/**
 * SSH tunnel transport: argv construction, forward-spec parsing, and the
 * lifecycle (readiness, advertised origin, crash-restart backoff, stop
 * semantics) — all against an injected fake process and fake timers, so no
 * ssh client or network is involved.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildForwardSpec,
  buildSshArgs,
  resolveSshBinary,
  SshTunnelManager,
  type SshProcess,
} from '../src/ssh-tunnel.ts'
import type { TunnelPhase } from '../src/tunnel.ts'

/** A fake ssh process the test drives by hand. */
class FakeSsh implements SshProcess {
  readonly kill = vi.fn(() => true)
  private readonly exitListeners: ((code: number | null, signal: NodeJS.Signals | null) => void)[] = []
  private readonly errorListeners: ((error: Error) => void)[] = []

  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'exit' | 'error', listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): this {
    if (event === 'exit') this.exitListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void)
    else this.errorListeners.push(listener as (error: Error) => void)
    return this
  }

  /** Emit an unexpected exit the way a killed or refused ssh does. */
  emitExit(code = 255): void {
    for (const listener of this.exitListeners) listener(code, null)
  }

  /** Emit a spawn-level error the way node reports a missing executable. */
  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

/** Manually-driven timer queue (one pending timer per scheduled transition). */
function makeTimers() {
  const tasks: { fn: () => void; id: number }[] = []
  let nextId = 1
  const timer = {
    setTimeout: (fn: () => void): number => {
      tasks.push({ fn, id: nextId })
      return nextId++
    },
    clearTimeout: (t: unknown): void => {
      const index = tasks.findIndex(task => task.id === t)
      if (index >= 0) tasks.splice(index, 1)
    },
  }
  const fireOne = (): void => {
    const task = tasks.shift()
    if (task !== undefined) task.fn()
  }
  return { timer, tasks, fireOne }
}

interface Harness {
  manager: SshTunnelManager
  processes: FakeSsh[]
  phases: TunnelPhase[]
  urls: string[]
  spawnArgs: string[][]
  fireOne: () => void
}

function makeHarness(overrides: {
  publicUrl?: string | undefined
  server?: string | undefined
  readyDelayMs?: number
  restartBaseMs?: number
  spawnThrows?: boolean
} = {}): Harness {
  const processes: FakeSsh[] = []
  const spawnArgs: string[][] = []
  const { timer, fireOne } = makeTimers()
  const phases: TunnelPhase[] = []
  const urls: string[] = []
  const manager = new SshTunnelManager({
    server: 'server' in overrides ? overrides.server : 'root@dsh.example.com',
    sshPort: 22,
    remotePort: 7788,
    publicUrl: 'publicUrl' in overrides ? overrides.publicUrl : 'https://dsh.example.com',
    keyPath: '/home/user/.ssh/id_ed25519',
    sshBin: 'ssh',
    timer,
    readyDelayMs: overrides.readyDelayMs ?? 1_500,
    restartBaseMs: overrides.restartBaseMs ?? 10,
    restartMaxMs: 60_000,
    spawnProcess: (bin, args) => {
      spawnArgs.push([bin, ...args])
      if (overrides.spawnThrows === true) throw new Error('spawn ENOENT')
      const process = new FakeSsh()
      processes.push(process)
      return process
    },
  })
  manager.onPhase(info => { phases.push(info.phase) })
  manager.onUrl(url => { urls.push(url) })
  return { manager, processes, phases, urls, spawnArgs, fireOne }
}

describe('buildForwardSpec', () => {
  it('forwards the parsed local port out of the remote loopback port', () => {
    expect(buildForwardSpec('http://127.0.0.1:3080', { remotePort: 7788 })).toEqual({
      remoteHost: '127.0.0.1',
      remotePort: 7788,
      localHost: '127.0.0.1',
      localPort: 3080,
    })
  })

  it('defaults the exposed port and honors an explicit remote host', () => {
    const spec = buildForwardSpec('http://127.0.0.1:3080', { remoteHost: '0.0.0.0' })
    expect(spec.remotePort).toBe(7788)
    expect(spec.remoteHost).toBe('0.0.0.0')
  })

  it('refuses a target without a usable port instead of guessing one', () => {
    expect(() => buildForwardSpec('not a url', {})).toThrow()
    expect(() => buildForwardSpec('http://127.0.0.1:0', {})).toThrow(/unusable local target/u)
  })
})

describe('buildSshArgs', () => {
  it('pins the non-interactive, fail-fast and keepalive options', () => {
    const args = buildSshArgs(
      { remoteHost: '127.0.0.1', remotePort: 7788, localHost: '127.0.0.1', localPort: 3080 },
      { server: 'root@dsh.example.com', sshPort: 2222, keyPath: '/keys/id_ed25519' },
    )
    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('ExitOnForwardFailure=yes')
    expect(args).toContain('ServerAliveInterval=30')
    expect(args).toEqual([
      '-N', '-T',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'TCPKeepAlive=yes',
      '-i', '/keys/id_ed25519',
      '-p', '2222',
      '-R', '127.0.0.1:7788:127.0.0.1:3080',
      'root@dsh.example.com',
    ])
  })

  it('omits the identity flag when no key path is configured', () => {
    const args = buildSshArgs(
      { remoteHost: '127.0.0.1', remotePort: 7788, localHost: '127.0.0.1', localPort: 3080 },
      { server: 'dsh.example.com' },
    )
    expect(args).not.toContain('-i')
    expect(args.join(' ')).toContain('-p 22')
  })

  it('requires a destination', () => {
    expect(() => buildSshArgs({ remoteHost: '127.0.0.1', remotePort: 7788, localHost: '127.0.0.1', localPort: 3080 }, {})).toThrow(/server/u)
  })
})

describe('resolveSshBinary', () => {
  it('honors an explicit executable override', () => {
    expect(resolveSshBinary({ DSH_SSH_TUNNEL_BIN: '/opt/bin/ssh' })).toBe('/opt/bin/ssh')
  })

  it('falls back to a resolvable client name', () => {
    expect(resolveSshBinary({})).toContain('ssh')
  })
})

describe('SshTunnelManager', () => {
  it('carries the origin on the running phase frame itself', () => {
    // The host publishes the public base from this notification, so a running
    // frame without a URL reads as "no public address" and leaves the QR link
    // in its lan-required state even though the forward is up.
    const h = makeHarness()
    const frames: { phase: TunnelPhase; url?: string }[] = []
    h.manager.onPhase(info => { frames.push(info) })
    h.manager.start('http://127.0.0.1:3080')
    h.fireOne()
    expect(frames).toEqual([
      { phase: 'starting' },
      { phase: 'running', url: 'https://dsh.example.com' },
    ])
  })

  it('reaches running and advertises the configured public origin', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    expect(h.manager.info.phase).toBe('starting')
    expect(h.processes).toHaveLength(1)
    h.fireOne() // readiness delay elapses
    expect(h.manager.info).toEqual({ phase: 'running', url: 'https://dsh.example.com' })
    expect(h.urls).toEqual(['https://dsh.example.com'])
    expect(h.phases).toEqual(['starting', 'running'])
  })

  it('spawns the client with the configured destination and forward', () => {
    const h = makeHarness({ readyDelayMs: 1 })
    h.manager.start('http://127.0.0.1:62312')
    expect(h.spawnArgs[0]).toContain('-R')
    expect(h.spawnArgs[0]).toContain('127.0.0.1:7788:127.0.0.1:62312')
    expect(h.spawnArgs[0]).toContain('root@dsh.example.com')
  })

  it('waits for a target the host cannot name yet instead of failing on it', () => {
    // The web server reports port 0 while plugins are applied (an OS-assigned
    // launch): that is "not ready", not a configuration error.
    const h = makeHarness()
    let port = 0
    h.manager.start(() => (port === 0 ? undefined : `http://127.0.0.1:${String(port)}`))
    expect(h.manager.info.phase).toBe('starting')
    expect(h.manager.info.error).toBeUndefined()
    expect(h.processes).toHaveLength(0)

    port = 43126
    h.fireOne() // the target wait elapses and the real port is now readable
    expect(h.processes).toHaveLength(1)
    expect(h.spawnArgs[0]).toContain('127.0.0.1:7788:127.0.0.1:43126')

    h.fireOne() // the readiness delay elapses
    expect(h.manager.info).toEqual({ phase: 'running', url: 'https://dsh.example.com' })
  })

  it('re-arming the same live target only refreshes the resolver', () => {
    const h = makeHarness()
    const target = (): string => 'http://127.0.0.1:3080'
    h.manager.start(target)
    h.fireOne()
    expect(h.manager.info.phase).toBe('running')
    h.manager.start(target)
    expect(h.processes).toHaveLength(1)
    expect(h.manager.info.phase).toBe('running')
  })

  it('restarts when the resolved target moves under a live forward', () => {
    const h = makeHarness()
    let port = 3080
    const target = (): string => `http://127.0.0.1:${String(port)}`
    h.manager.start(target)
    h.fireOne()
    expect(h.manager.info.phase).toBe('running')

    port = 3081 // the web server rebound elsewhere
    h.manager.start(target)
    expect(h.processes).toHaveLength(2)
    expect(h.manager.info.phase).toBe('starting')
    expect(h.spawnArgs[1]).toContain('127.0.0.1:7788:127.0.0.1:3081')
  })

  it('stays running without a URL when no public origin is configured', () => {
    const h = makeHarness({ publicUrl: undefined })
    h.manager.start('http://127.0.0.1:3080')
    h.fireOne()
    expect(h.manager.info.phase).toBe('running')
    expect(h.manager.info.url).toBeUndefined()
    expect(h.urls).toEqual([])
  })

  it('is idempotent while starting against the same target', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    h.manager.start('http://127.0.0.1:3080')
    expect(h.processes).toHaveLength(1)
  })

  it('is idempotent while running against the same target', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    h.fireOne()
    h.manager.start('http://127.0.0.1:3080')
    expect(h.processes).toHaveLength(1)
  })

  it('restarts when the local target changes', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    h.fireOne()
    const first = h.processes[0]
    h.manager.start('http://127.0.0.1:3081')
    expect(h.processes).toHaveLength(2)
    expect(first.kill).toHaveBeenCalled()
    expect(h.manager.info.phase).toBe('starting')
    h.fireOne()
    expect(h.manager.info.url).toBe('https://dsh.example.com')
  })

  it('fails on an unexpected exit, then retries with backoff', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    const first = h.processes[0]
    first.emitExit(255)
    expect(h.manager.info.phase).toBe('failed')
    expect(h.manager.info.error).toContain('exited unexpectedly')
    h.fireOne() // backoff elapses → a fresh attempt
    expect(h.processes).toHaveLength(2)
    expect(h.processes[1]).not.toBe(first)
    expect(h.manager.info.phase).toBe('starting')
  })

  it('reports a spawn-level error', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    h.processes[0].emitError(new Error('spawn ssh ENOENT'))
    expect(h.manager.info.phase).toBe('failed')
    expect(h.manager.info.error).toContain('spawn ssh ENOENT')
  })

  it('reports a missing destination without spawning anything', () => {
    const h = makeHarness({ server: undefined })
    h.manager.start('http://127.0.0.1:3080')
    expect(h.processes).toHaveLength(0)
    expect(h.manager.info.phase).toBe('failed')
    expect(h.manager.info.error).toContain('server')
  })

  it('reports a throwing spawn', () => {
    const h = makeHarness({ spawnThrows: true })
    h.manager.start('http://127.0.0.1:3080')
    expect(h.manager.info.phase).toBe('failed')
    expect(h.manager.info.error).toContain('could not start the ssh client')
  })

  it('stop() kills the process, resets state and cancels restarts', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    h.processes[0].emitExit(255)
    h.manager.stop()
    expect(h.manager.info.phase).toBe('stopped')
    expect(h.manager.info.error).toBeUndefined()
    h.fireOne() // the pending backoff must be gone
    expect(h.processes).toHaveLength(1)
  })

  it('never restarts or republishes after stop()', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    const process = h.processes[0]
    h.fireOne()
    expect(h.manager.info.phase).toBe('running')
    h.manager.stop()
    process.emitExit(0) // a late exit after teardown must be ignored
    expect(h.manager.info.phase).toBe('stopped')
    expect(h.processes).toHaveLength(1)
    expect(h.manager.info.url).toBeUndefined()
  })

  it('exposes the configured origin for the host to compare against', () => {
    const h = makeHarness()
    expect(h.manager.publicUrl).toBe('https://dsh.example.com')
  })

  it('picks up a replaced options object on the next start', () => {
    const h = makeHarness()
    h.manager.start('http://127.0.0.1:3080')
    h.fireOne()
    h.manager.stop()
    h.manager.options = { ...h.manager.options, server: 'ubuntu@other.example.com', remotePort: 9000 }
    h.manager.start('http://127.0.0.1:3080')
    expect(h.spawnArgs[1]).toContain('ubuntu@other.example.com')
    expect(h.spawnArgs[1]).toContain('127.0.0.1:9000:127.0.0.1:3080')
  })
})
