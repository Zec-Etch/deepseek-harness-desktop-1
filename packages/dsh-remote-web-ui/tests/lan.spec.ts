import { describe, expect, it } from 'vitest'

import { desktopLanGatewayBase } from '../src/lan.ts'

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
