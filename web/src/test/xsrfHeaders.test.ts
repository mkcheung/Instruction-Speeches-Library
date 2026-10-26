import type { BrowserContext } from '@playwright/test'
import { describe, expect, it, vi } from 'vitest'
import { xsrfHeaders } from '../../tests/xsrf-headers'

describe('direct API XSRF headers', () => {
  it('requests cookies for the API origin and URL-decodes the token', async () => {
    const cookies = vi.fn<BrowserContext['cookies']>().mockResolvedValue([
      { name: 'XSRF-TOKEN', value: 'token%3D%2B', domain: 'api.example.test', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' },
    ])
    expect(await xsrfHeaders({ cookies }, 'https://api.example.test')).toEqual({ 'X-XSRF-TOKEN': 'token=+' })
    expect(cookies).toHaveBeenCalledWith('https://api.example.test')
  })

  it('keeps a missing cookie optional only for callers that opt out', async () => {
    const context = { cookies: vi.fn<BrowserContext['cookies']>().mockResolvedValue([]) }
    await expect(xsrfHeaders(context, 'https://api.example.test')).rejects.toThrow('no XSRF-TOKEN cookie — has the session gone stale?')
    await expect(xsrfHeaders(context, 'https://api.example.test', { message: 'no XSRF-TOKEN cookie — has the seeded session gone stale?' })).rejects.toThrow('no XSRF-TOKEN cookie — has the seeded session gone stale?')
    await expect(xsrfHeaders(context, 'http://127.0.0.1:18080', { required: false })).resolves.toEqual({})
  })
})
