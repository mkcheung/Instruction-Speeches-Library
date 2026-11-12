import { describe, expect, it } from 'vitest'
import { parseReviewQueryParam, speechPath } from '@/lib/speechPath'

describe('speechPath', () => {
  it('names a review only when given one', () => {
    expect(speechPath(8)).toBe('/speeches/8')
    expect(speechPath(8, 3)).toBe('/speeches/8?review=3')
  })
})

describe('parseReviewQueryParam', () => {
  it('reads a positive integer id', () => {
    expect(parseReviewQueryParam('3')).toBe(3)
  })

  it.each([null, '', '0', '-1', 'abc', '1.5', '1e3', ' 3', '9007199254740993'])('rejects %j', (value) => {
    expect(parseReviewQueryParam(value)).toBeNull()
  })
})
