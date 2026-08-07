import { describe, expect, it, vi } from 'vitest'
import { applyServerErrors, extractServerErrorMessage } from '@/lib/applyServerErrors'

describe('applyServerErrors', () => {
  it('routes each field error to setError and returns no banner message', () => {
    const setError = vi.fn()
    const error = {
      status: 422,
      data: {
        message: 'The given data was invalid.',
        errors: {
          email: ['The email has already been taken.'],
          username: ['The username is reserved.', 'ignored second message'],
        },
      },
    }

    const banner = applyServerErrors(error, setError)

    expect(setError).toHaveBeenCalledWith('email', {
      type: 'server',
      message: 'The email has already been taken.',
    })
    expect(setError).toHaveBeenCalledWith('username', {
      type: 'server',
      message: 'The username is reserved.',
    })
    expect(banner).toBeNull()
  })

  it('falls back to the top-level message when no field errors are present', () => {
    const setError = vi.fn()
    const error = { status: 429, data: { message: 'Too many attempts. Try again later.' } }

    const banner = applyServerErrors(error, setError)

    expect(setError).not.toHaveBeenCalled()
    expect(banner).toBe('Too many attempts. Try again later.')
  })

  it('returns a generic message for a shape it does not recognize', () => {
    const setError = vi.fn()

    expect(applyServerErrors(new Error('network down'), setError)).toBe(
      'Something went wrong. Please try again.',
    )
  })
})

describe('extractServerErrorMessage', () => {
  it('returns the first field error message when present', () => {
    const error = { status: 422, data: { errors: { avatar: ['File must be a JPEG or PNG.'] } } }
    expect(extractServerErrorMessage(error)).toBe('File must be a JPEG or PNG.')
  })

  it('falls back to the top-level message', () => {
    const error = { status: 413, data: { message: 'File too large.' } }
    expect(extractServerErrorMessage(error)).toBe('File too large.')
  })
})
