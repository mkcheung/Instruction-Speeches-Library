import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { FormBanner } from '@/components/ui/form-message'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useGetMeQuery, useResendVerificationEmailMutation } from '@/features/auth/authApi'

/**
 * A holding page for "I registered, now what" — reached right after
 * `/register` succeeds. It is deliberately NOT the page the emailed link
 * itself resolves to: `GET /email/verify/{id}/{hash}` is a backend route
 * (`config/fortify.php`), and its non-JSON response
 * (`App\Http\Responses\Fortify\VerifyEmailResponse`) redirects a real
 * browser straight to `{frontend_url}/login?verified=1` — see
 * `Login.tsx`'s banner and `RequireGuest`'s query-forwarding for that path.
 *
 * What this page *does* need to handle is §12 S1's cross-device
 * requirement: opened fresh/unauthenticated (a verification link clicked
 * on a different device than the one that registered), it must not assume
 * a session exists. Per §5.9 trap #4, `email/verify/{id}/{hash}` carries
 * `auth` middleware — hitting it unauthenticated redirects to the `login`
 * named route (`routes/web.php`) rather than 500ing, landing the visitor
 * on `/login` with no session. This page's job is only the "waiting for
 * you to check your mail" state on an *authenticated* device.
 */
export default function VerifyEmail() {
  const { data, isLoading, refetch, isFetching } = useGetMeQuery()
  const [resend, { isLoading: isResending }] = useResendVerificationEmailMutation()
  const [notice, setNotice] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const user = data?.user
  const isVerified = !!user?.email_verified

  return (
    <div className="mx-auto flex min-h-svh max-w-sm items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Verify your email</CardTitle>
          <CardDescription>
            {isVerified
              ? 'Your email is confirmed.'
              : 'Click the link we sent you — it works from any device, not just the one you registered on.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormBanner message={notice} variant="success" />

          {isVerified ? (
            <Button render={<Link to="/onboarding" />}>Continue to onboarding</Button>
          ) : user ? (
            <>
              <p className="text-sm text-muted-foreground">
                Didn't get it, or clicked it on this device already?
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isResending}
                  onClick={async () => {
                    setNotice(null)
                    try {
                      await resend().unwrap()
                      setNotice('Verification email sent.')
                    } catch {
                      setNotice(null)
                    }
                  }}
                >
                  {isResending ? 'Sending…' : 'Resend verification email'}
                </Button>
                <Button
                  type="button"
                  disabled={isFetching}
                  onClick={() => {
                    void refetch()
                  }}
                >
                  {isFetching ? 'Checking…' : "I've verified — check again"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                You're not logged in on this device. Log in to resend the verification email, or
                just click the original link again from your mail app — it works cross-device.
              </p>
              <Button render={<Link to="/login" />}>Log in</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
