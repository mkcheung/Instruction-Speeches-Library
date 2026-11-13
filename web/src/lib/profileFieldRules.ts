import { displayNameSchema, profileTextSchema, usernameSchema } from '@/lib/validation'

export type ProfileField = 'display_name' | 'username' | 'bio' | 'location'

export const PROFILE_FIELD_LABELS: Record<ProfileField, string> = {
  display_name: 'Display name',
  username: 'Username',
  bio: 'Bio',
  location: 'Location',
}

/** The one client-side shape check per field, shared with onboarding's forms. */
export const PROFILE_FIELD_SCHEMAS = {
  display_name: displayNameSchema,
  username: usernameSchema,
  ...profileTextSchema.shape,
} satisfies Record<ProfileField, unknown>

/** What a draft is saved as: the server lowercases usernames and trims
 * every string (Laravel's TrimStrings), so the editor compares, measures and
 * sends the same value. Only the ends are trimmed; a bio keeps its line breaks. */
export function cleanProfileField(field: ProfileField, draft: string): string {
  const trimmed = draft.trim()
  return field === 'username' ? trimmed.toLowerCase() : trimmed
}

/** The first client-side rule a draft breaks, or null. The server still
 * decides anything that needs the database: a taken or reserved username,
 * and the 30-day wait between username changes. */
export function profileFieldError(field: ProfileField, draft: string): string | null {
  const value = cleanProfileField(field, draft)
  if (field === 'username') {
    // Clearer than the schema's own "at least 3" / character-set messages for these two cases.
    if (!value) return 'Username is required.'
    if (/\s/.test(value)) return 'Usernames cannot contain spaces.'
  }
  const result = PROFILE_FIELD_SCHEMAS[field].safeParse(value)
  return result.success ? null : (result.error.issues[0]?.message ?? `Enter a valid ${PROFILE_FIELD_LABELS[field].toLowerCase()}.`)
}
