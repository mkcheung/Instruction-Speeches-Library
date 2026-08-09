import { describe, expect, it } from 'vitest'
import { speechCreateSchema } from '@/lib/validation'

/**
 * §6.11: the client-side mirror of `CreateSpeechRequest`'s
 * `required_with:supersedes_id` — shape/immediacy only, the server owns
 * the real rule.
 */
describe('speechCreateSchema', () => {
  it('accepts a title-only speech with no supersedes_id', () => {
    const result = speechCreateSchema.safeParse({ title: 'My speech' })
    expect(result.success).toBe(true)
  })

  it('requires change_note when supersedes_id is set', () => {
    const result = speechCreateSchema.safeParse({ title: 'v2', supersedes_id: 5 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('change_note'))).toBe(true)
    }
  })

  it('accepts supersedes_id with a non-empty change_note', () => {
    const result = speechCreateSchema.safeParse({
      title: 'v2',
      supersedes_id: 5,
      change_note: 'Cut the third example.',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a blank/whitespace-only change_note even if the field is technically present', () => {
    const result = speechCreateSchema.safeParse({ title: 'v2', supersedes_id: 5, change_note: '   ' })
    expect(result.success).toBe(false)
  })
})
