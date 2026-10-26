import { describe, expect, it } from 'vitest'
import { getErrorStatus, isTerminalAccessError } from './errorStatus'

describe('speech/commentary access failure classification', () => {
  it.each([401, 403, 404, 410])('recognizes numeric HTTP %s without interpreting its payload', (status) => {
    const error = { status, data: { message: 'Access unavailable' } }
    expect(getErrorStatus(error)).toBe(status)
    expect(isTerminalAccessError(error)).toBe(true)
    expect(isTerminalAccessError({ ...error, status: String(status) })).toBe(false)
  })

  it.each([undefined, null, new Error('network down'), { status: 'FETCH_ERROR' }, { status: 500 }, { status: 503 }, { status: 422 }])(
    'does not confuse transient, validation or malformed errors with terminal denial: %j', (error) => {
      expect(isTerminalAccessError(error)).toBe(false)
    },
  )
})
