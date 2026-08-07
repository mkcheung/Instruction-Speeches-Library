import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useResetPasswordMutation } from '@/features/auth/authApi'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { resetPasswordSchema, type ResetPasswordFormValues } from '@/lib/validation'

/**
 * Assumes Fortify's conventional reset-link shape: `/reset-password/{token}
 * ?email=...` (the plan didn't pin an exact frontend route for this since
 * the backend wasn't built yet — this is the "adapt once routes exist"
 * fallback STEP-01-identity.md calls out).
 */
export default function ResetPassword() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [resetPassword, { isLoading }] = useResetPasswordMutation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: searchParams.get('email') ?? '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    if (!token) {
      setFormError('This reset link is missing its token. Request a new one.')
      return
    }
    try {
      await resetPassword({ ...values, token }).unwrap()
      navigate('/login', { replace: true })
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  return (
    <div className="mx-auto flex min-h-svh max-w-sm items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>Enter your email and a new password.</CardDescription>
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
              <Label htmlFor="password">New password</Label>
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
              <Label htmlFor="password_confirmation">Confirm new password</Label>
              <Input
                id="password_confirmation"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.password_confirmation}
                {...register('password_confirmation')}
              />
              <FieldMessage message={errors.password_confirmation?.message} />
            </div>

            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Reset password'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                Back to login
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
