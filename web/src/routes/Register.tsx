import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from 'react-redux'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useRegisterMutation } from '@/features/auth/authApi'
import { hardNavigation } from '@/lib/hardNavigation'
import { selectAuthSession, type AuthSessionState } from '@/features/auth/authSession'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { registerSchema, type RegisterFormValues } from '@/lib/validation'

/**
 * Email + password only — `CreateNewUser` deliberately defers names and
 * username to onboarding step 1 (§6.5).
 */
export default function Register() {
  const store = useStore()
  const [registerUser, { isLoading }] = useRegisterMutation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const attempt = registerUser(values)
      await attempt.unwrap()
      // A newer auth attempt (or another tab) has superseded this one: it must not navigate.
      const current = selectAuthSession(store.getState() as { authSession: AuthSessionState })
      if (current.latestAttemptId !== attempt.requestId) return
      // §5.9: verified email gates writes others see; onboarding gates
      // findability. Registration succeeds unverified, so land on /verify
      // rather than assuming the mail arrived instantly.
      // Hard replace: the new account gets a fresh document (R1).
      hardNavigation.replace('/verify')
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  return (
    <div className="mx-auto flex min-h-svh max-w-sm items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Register with a real email — you'll need to verify it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <FormBanner message={formError} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
              <FieldMessage message={errors.email?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              <FieldMessage message={errors.password?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password_confirmation">Confirm password</Label>
              <Input
                id="password_confirmation"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.password_confirmation}
                {...register('password_confirmation')}
              />
              <FieldMessage message={errors.password_confirmation?.message} />
            </div>

            <Button type="submit" disabled={isLoading} className="mt-2">
              {isLoading ? 'Creating account…' : 'Create account'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                Log in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
