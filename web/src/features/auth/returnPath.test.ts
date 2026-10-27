import { beforeEach, describe, expect, it } from 'vitest'
import { getPostLoginDestination } from '@/lib/roles'
import { RETURN_PATH_KEY, classifyRoute, consumeReturnPath, sanitizeReturnPath, storeReturnPath } from './returnPath'

describe('sanitizeReturnPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/speeches/12?x=1#y', '/speeches/12'],
    ['/u/alex/friends', '/u/alex/friends'],
  ])('keeps the internal pathname of %s', (raw, expected) => expect(sanitizeReturnPath(raw)).toBe(expected))

  it.each([
    '//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'dashboard', '', '/a\nb', '/a\u0000b',
    '/login', '/LOGIN/x', '/register', '/forgot-password', '/reset-password', '/api/me', '/sanctum/csrf-cookie', '/logout', '/control-panel',
    '/%5Cevil', '/%0Aoops', '/%2f%2f', 42, null, undefined,
  ])('rejects %j', (raw) => expect(sanitizeReturnPath(raw)).toBeNull())

  it('is what getPostLoginDestination uses, so a hostile `from` falls back to the landing', () => {
    const user = { roles: [], onboarding_completed: true }
    expect(getPostLoginDestination(user, '/speeches/3')).toEqual({ to: '/speeches/3', external: false })
    expect(getPostLoginDestination(user, '//evil.example')).toEqual({ to: '/dashboard', external: false })
    expect(getPostLoginDestination({ roles: ['admin'], onboarding_completed: true }, '/login').external).toBe(true)
  })
})

describe('stored return path', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('persists only a validated pathname in one key and consumes it once', () => {
    storeReturnPath('/speeches/4?secret=1#x')
    expect(window.sessionStorage.length).toBe(1)
    expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBe('/speeches/4')
    expect(consumeReturnPath()).toBe('/speeches/4')
    expect(consumeReturnPath()).toBeNull()
  })

  it('never stores or returns an unsafe value', () => {
    storeReturnPath('//evil.example')
    expect(window.sessionStorage.length).toBe(0)
    window.sessionStorage.setItem(RETURN_PATH_KEY, 'https://evil.example')
    expect(consumeReturnPath()).toBeNull()
    expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull()
  })
})

describe('classifyRoute', () => {
  it.each([
    ['/login', 'guest'], ['/register', 'guest'], ['/forgot-password', 'guest'], ['/reset-password', 'guest'], ['/reset-password/tok', 'guest'],
    ['/', 'public'], ['/verify', 'public'], ['/u/alex', 'public'], ['/u/alex/friendsomething', 'public'],
    ['/u/alex/friends', 'private'], ['/U/alex/FRIENDS/all', 'private'],
    ['/dashboard', 'private'], ['/weird', 'private'],
    // The router is case-insensitive and tolerates a trailing slash: classification must follow it.
    ['/Login', 'guest'], ['/U/alex', 'public'], ['/VERIFY', 'public'], ['/verify/', 'public'], ['/u/alex/', 'public'],
  ])('%s is %s', (path, expected) => expect(classifyRoute(path)).toBe(expected))
})
