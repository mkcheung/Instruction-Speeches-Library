import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useStore } from 'react-redux'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { WorkspaceLoginFrame } from '@/components/workspace/WorkspaceLoginFrame'
import { useLoginMutation } from '@/features/auth/authApi'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { getPostLoginDestination } from '@/lib/roles'
import { hardNavigation } from '@/lib/hardNavigation'
import { selectAuthSession, type AuthSessionState } from '@/features/auth/authSession'
import { consumeReturnPath } from '@/features/auth/returnPath'
import { loginSchema, type LoginFormValues } from '@/lib/validation'

export default function Login() {
  const store = useStore()
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
    defaultValues: { remember: false },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      // The login response already carries `onboarding_completed`
      // (`LoginResponse` returns the same `UserResource` as `/api/me`), so
      // the destination is decided here rather than by bouncing everyone
      // through `/onboarding` and letting that route redirect — which
      // would flash a "Loading…" screen on every single login.
      const attempt = login(values)
      const { user } = await attempt.unwrap()
      // A newer auth attempt (or another tab) has superseded this one: it must not navigate.
      const current = selectAuthSession(store.getState() as { authSession: AuthSessionState })
      if (current.latestAttemptId !== attempt.requestId) return
      // The expiry path stored a validated pathname in sessionStorage; it is consumed once.
      const stored = consumeReturnPath()
      const from = (location.state as { from?: { pathname?: string } } | null)?.from
      const destination = getPostLoginDestination(user, from?.pathname ?? stored ?? undefined)
      // PLAN-ADMIN-LOGIN-REDIRECT.md §7.3: the panel is on `API_URL`, a
      // different origin — `navigate()` can only express an in-SPA path
      // and would render the 404 route inside this app's own shell.
      // `replace()`, not `assign()`, so Back does not return to the
      // submitted login form. Every destination is a hard replace (R1): a
      // new account must get a fresh document, never the previous
      // account's Redux store and in-flight promises.
      hardNavigation.replace(destination.to)
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  return (
    <WorkspaceLoginFrame>
      <Card className="workspace-login-card">
        <CardHeader>
          <CardTitle><h1 className="workspace-login-title">Log in</h1></CardTitle>
          <CardDescription>Welcome back.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="workspace-login-form-fields flex flex-col gap-4" noValidate>
            {searchParams.has('verified') && (
              <FormBanner variant="success" message="Email verified — log in to continue." className="workspace-banner workspace-banner--success" />
            )}
            <FormBanner message={formError} className="workspace-banner workspace-banner--error" />

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
              <div className="workspace-login-password-label">
                <Label htmlFor="password">Password</Label>
                <Link to="/forgot-password" className="workspace-link text-xs">
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

            <div className="workspace-remember flex items-center gap-2">
              <input id="remember" type="checkbox" {...register('remember')} />
              <Label htmlFor="remember">Remember me</Label>
            </div>

            <Button type="submit" disabled={isLoading} className="workspace-button workspace-button--primary mt-2">
              {isLoading ? 'Logging in…' : 'Log in'}
            </Button>

            <p className="workspace-muted text-center text-sm">
              Need an account?{' '}
              <Link to="/register" className="workspace-link">
                Register
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </WorkspaceLoginFrame>
  )
}
