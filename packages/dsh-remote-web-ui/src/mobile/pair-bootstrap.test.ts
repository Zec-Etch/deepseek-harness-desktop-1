import { describe, expect, it, vi } from 'vitest'
import { acceptMobilePairFromLocation } from './pair-bootstrap.ts'

describe('mobile pair bootstrap', () => {
  it('accepts the QR token, removes it from the address and preserves the workspace', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const replaceState = vi.fn()
    await expect(acceptMobilePairFromLocation({
      location: {
        href: 'http://192.168.1.8:43126/m?pair=tok-1&workspace=ws-7',
        search: '?pair=tok-1&workspace=ws-7',
      },
      history: { replaceState },
      fetchImpl,
    })).resolves.toBe('accepted')
    expect(fetchImpl).toHaveBeenCalledWith('/api/pair/accept', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'tok-1' }),
    }))
    expect(replaceState).toHaveBeenCalledWith(null, '', '/m?workspace=ws-7')
  })

  it('does not issue a request without a token and fails closed on rejection', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":false}', { status: 404 }))
    const replaceState = vi.fn()
    await expect(acceptMobilePairFromLocation({
      location: { href: 'http://192.168.1.8:43126/m', search: '' },
      history: { replaceState },
      fetchImpl,
    })).resolves.toBe('not-required')
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(acceptMobilePairFromLocation({
      location: { href: 'http://192.168.1.8:43126/m?pair=used', search: '?pair=used' },
      history: { replaceState },
      fetchImpl,
    })).resolves.toBe('failed')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/m')
  })
})
