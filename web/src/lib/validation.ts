import { z } from 'zod'

/**
 * Client-side shape checks only (§6.5: "Zod validates shape and
 * immediacy... duplicate the field rules deliberately, and let the server
 * own every rule that requires the database" — i.e. whether a username is
 * actually taken is never decided here).
 */
export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters.')
  .max(30, 'Username must be at most 30 characters.')
  .regex(
    /^[a-z0-9](?:[a-z0-9_.-]{1,28}[a-z0-9])$/,
    'Lowercase letters, numbers, "_", "." or "-" only; must start and end with a letter or number.',
  )

export const emailSchema = z.email('Enter a valid email.').min(1, 'Email is required.')

export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters.')

/**
 * Registration collects only email + password (`CreateNewUser`) — names
 * and username are gathered at onboarding step 1, not here.
 */
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    password_confirmation: z.string(),
  })
  .refine((data) => data.password === data.password_confirmation, {
    message: 'Passwords do not match.',
    path: ['password_confirmation'],
  })

export type RegisterFormValues = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
  remember: z.boolean().optional(),
})

export type LoginFormValues = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    password_confirmation: z.string(),
  })
  .refine((data) => data.password === data.password_confirmation, {
    message: 'Passwords do not match.',
    path: ['password_confirmation'],
  })

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

export const onboardingStep1Schema = z.object({
  first_name: z.string().min(1, 'First name is required.').max(60),
  last_name: z.string().min(1, 'Last name is required.').max(60),
  username: usernameSchema,
})

export type OnboardingStep1FormValues = z.infer<typeof onboardingStep1Schema>

export const onboardingStep2Schema = z.object({
  bio: z.string().max(1000, 'Bio must be at most 1000 characters.'),
  pronouns: z.string().max(32, 'Pronouns must be at most 32 characters.'),
  location: z.string().max(80, 'Location must be at most 80 characters.'),
})

export type OnboardingStep2FormValues = z.infer<typeof onboardingStep2Schema>

/**
 * STEP-03-upload-and-watch.md / §6.11: `change_note` is required whenever
 * `supersedes_id` is set — same rule the server enforces
 * (`CreateSpeechRequest`'s `required_with:supersedes_id`), duplicated here
 * for immediate feedback only.
 */
export const speechCreateSchema = z
  .object({
    title: z.string().min(1, 'Title is required.').max(255),
    description: z.string().max(2000, 'Description must be at most 2000 characters.').optional(),
    delivered_on: z.string().optional(),
    supersedes_id: z.number().int().positive().optional(),
    change_note: z.string().max(1000, 'Change note must be at most 1000 characters.').optional(),
  })
  .refine((data) => !data.supersedes_id || !!data.change_note?.trim(), {
    message: 'Say what changed since the earlier attempt.',
    path: ['change_note'],
  })

export type SpeechCreateFormValues = z.infer<typeof speechCreateSchema>
