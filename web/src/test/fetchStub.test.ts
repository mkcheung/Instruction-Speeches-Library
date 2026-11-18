import { describe, expect, it } from 'vitest'
import { bodyOf, jsonResponse, methodOf, urlOf } from '@/test/fetchStub'

describe('fetch stub helpers', () => {
  it('defaults JSON responses to 200 with a JSON content type', async () => {
    const response = jsonResponse({ ready: true })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(await response.json()).toEqual({ ready: true })
  })

  it('preserves an explicitly supplied response status and body', async () => {
    const response = jsonResponse({ message: 'Invalid input.' }, 422)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ message: 'Invalid input.' })
  })

  it('reads URLs from strings, URL objects and Requests', () => {
    const url = 'https://example.test/api/speeches?cursor=next'

    expect(urlOf(url)).toBe(url)
    expect(urlOf(new URL(url))).toBe(url)
    expect(urlOf(new Request(url))).toBe(url)
  })

  it('uses the Request method even when init supplies a different method', () => {
    const request = new Request('https://example.test/api/speeches', { method: 'PATCH' })

    expect(methodOf(request)).toBe('PATCH')
    expect(methodOf(request, { method: 'DELETE' })).toBe('PATCH')
  })

  it('uppercases init methods for string and URL inputs', () => {
    const url = 'https://example.test/api/speeches'

    expect(methodOf(url, { method: 'post' })).toBe('POST')
    expect(methodOf(new URL(url), { method: 'put' })).toBe('PUT')
  })

  it('defaults to GET when string or URL inputs have no method', () => {
    const url = 'https://example.test/api/speeches'

    expect(methodOf(url)).toBe('GET')
    expect(methodOf(new URL(url))).toBe('GET')
  })

  it('reads a cloned JSON body without consuming the original Request', async () => {
    const body = { title: 'A clear opening', tags: ['practice'], published: false }
    const request = new Request('https://example.test/api/speeches', {
      method: 'POST', body: JSON.stringify(body),
    })

    expect(await bodyOf(request)).toEqual(body)
    expect(request.bodyUsed).toBe(false)
    expect(await request.json()).toEqual(body)
  })

  it('returns an empty object for empty or invalid JSON Request bodies', async () => {
    const url = 'https://example.test/api/speeches'

    expect(await bodyOf(new Request(url))).toEqual({})
    expect(await bodyOf(new Request(url, { method: 'POST', body: 'not JSON' }))).toEqual({})
  })

  it('returns an empty object for string and URL inputs', async () => {
    const url = 'https://example.test/api/speeches'

    expect(await bodyOf(url)).toEqual({})
    expect(await bodyOf(new URL(url))).toEqual({})
  })
})
