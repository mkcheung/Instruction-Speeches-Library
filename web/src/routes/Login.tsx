import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useLoginMutation } from '@/features/auth/authApi'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { getPostLoginDestination } from '@/lib/roles'
import { loginSchema, type LoginFormValues } from '@/lib/validation'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [login, { isLoading }] = useLoginMutation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      // The login response already carries `onboarding_completed`
      // (`LoginResponse` returns the same `UserResource` as `/api/me`), so
      // the destination is decided here rather than by bouncing everyone
      // through `/onboarding` and letting that route redirect — which
      // would flash a "Loading…" screen on every single login.
      const { user } = await login(values).unwrap()
      const from = (location.state as { from?: { pathname?: string } } | null)?.from
      const destination = getPostLoginDestination(user, from?.pathname)
      // PLAN-ADMIN-LOGIN-REDIRECT.md §7.3: the panel is on `API_URL`, a
      // different origin — `navigate()` can only express an in-SPA path
      // and would render the 404 route inside this app's own shell.
      // `replace()`, not `assign()`, so Back does not return to the
      // submitted login form.
      if (destination.external) {
        window.location.replace(destination.to)
      } else {
        navigate(destination.to, { replace: true })
      }
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  return (
    <div className="mx-auto flex min-h-svh max-w-sm items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>Welcome back.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            {searchParams.has('verified') && (
              <FormBanner variant="success" message="Email verified — log in to continue." />
            )}
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              <FieldMessage message={errors.password?.message} />
            </div>

            <Button type="submit" disabled={isLoading} className="mt-2">
              {isLoading ? 'Logging in…' : 'Log in'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Need an account?{' '}
              <Link to="/register" className="text-primary underline-offset-4 hover:underline">
                Register
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
