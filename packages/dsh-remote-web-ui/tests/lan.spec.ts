import { describe, expect, it } from 'vitest'

import { desktopLanGatewayBase, resolveTunnelTarget } from '../src/lan.ts'

describe('Desktop local LAN gateway authority', () => {
  it('accepts one active private HTTP origin', () => {
    expect(desktopLanGatewayBase('http://192.168.1.8:43126', ['192.168.1.8'])).toEqual({
      address: '192.168.1.8',
      base: 'http://192.168.1.8:43126',
    })
  })

  it('fails closed for public, loopback, all-interface, stale and malformed origins', () => {
    for (const value of [
      'http://0.0.0.0:43126',
      'http://127.0.0.1:43126',
      'http://8.8.8.8:43126',
      'http://192.168.1.9:43126',
      'https://192.168.1.8:43126',
      'http://192.168.1.8:80',
      'http://user:pass@192.168.1.8:43126',
      'not a URL',
    ]) expect(desktopLanGatewayBase(value, ['192.168.1.8'])).toBeUndefined()
  })
})

describe('Tunnel target resolution', () => {
  it('prefers the Desktop LAN gateway, whose port is the only TCP face in pipe mode', () => {
    expect(resolveTunnelTarget({
      gatewayBase: { address: '192.168.1.8', base: 'http://192.168.1.8:43126' },
      host: '127.0.0.1',
      port: 0,
    })).toBe('http://192.168.1.8:43126')
  })

  it('falls back to the bound web server port', () => {
    expect(resolveTunnelTarget({ host: '127.0.0.1', port: 3080 })).toBe('http://127.0.0.1:3080')
  })

  it('reaches a wildcard bind over loopback and keeps an explicit host', () => {
    expect(resolveTunnelTarget({ host: '0.0.0.0', port: 3080 })).toBe('http://127.0.0.1:3080')
    expect(resolveTunnelTarget({ host: '10.0.0.5', port: 3080 })).toBe('http://10.0.0.5:3080')
  })

  it('reports no target while the port is still unknown', () => {
    expect(resolveTunnelTarget({ host: '127.0.0.1', port: 0 })).toBeUndefined()
    expect(resolveTunnelTarget({})).toBeUndefined()
  })
})
