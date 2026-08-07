import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AvatarCropper } from '@/components/onboarding/AvatarCropper'
import { applyServerErrors, extractServerErrorMessage } from '@/lib/applyServerErrors'
import {
  onboardingStep1Schema,
  onboardingStep2Schema,
  type OnboardingStep1FormValues,
  type OnboardingStep2FormValues,
} from '@/lib/validation'
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability'
import {
  useGetOnboardingStatusQuery,
  useSubmitOnboardingStep1Mutation,
  useSubmitOnboardingStep2Mutation,
  useSubmitOnboardingStep3Mutation,
} from '@/features/profile/profileApi'

const STEP_LABELS = ['Your name', 'About you', 'Photo']

/**
 * Each step submits to the backend immediately — §6.5's "resumability is a
 * real requirement" — so `GET /api/onboarding` on mount decides which step
 * to render, rather than always starting at step 1. `Support\Onboarding
 * ::currentStep` derives the step from which columns are already
 * populated: each step is atomic (all its fields required together), so
 * there is no partially-filled step to prefill — a user who quits after
 * step 2 and returns tomorrow simply lands back on step 3's blank form
 * with steps 1–2 already recorded server-side.
 */
export default function Onboarding() {
  const { data: status, isLoading } = useGetOnboardingStatusQuery()
  const [searchParams] = useSearchParams()

  if (isLoading || !status) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  const stepIndex = status.step - 1 // 0-based; step 4 ("done") is >= STEP_LABELS.length

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-10">
      {searchParams.has('verified') && (
        <FormBanner variant="success" message="Email verified." />
      )}

      <ol className="flex justify-center gap-2 text-xs text-muted-foreground">
        {STEP_LABELS.map((label, index) => (
          <li
            key={label}
            className={
              index === stepIndex
                ? 'font-medium text-foreground'
                : index < stepIndex
                  ? 'text-foreground/70'
                  : ''
            }
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {status.step === 1 && <StepOne />}
      {status.step === 2 && <StepTwo />}
      {status.step === 3 && <StepThree />}
      {status.step === 4 && <OnboardingComplete username={status.user.username} />}
    </div>
  )
}

function StepOne() {
  const [submitStep1, { isLoading }] = useSubmitOnboardingStep1Mutation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<OnboardingStep1FormValues>({
    resolver: zodResolver(onboardingStep1Schema),
    defaultValues: { first_name: '', last_name: '', username: '' },
  })

  const username = useWatch({ control, name: 'username' })
  const availability = useUsernameAvailability(username ?? '')

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await submitStep1(values).unwrap()
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your name</CardTitle>
        <CardDescription>This is how you'll appear to other members.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormBanner message={formError} />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="first_name">First name</Label>
              <Input id="first_name" aria-invalid={!!errors.first_name} {...register('first_name')} />
              <FieldMessage message={errors.first_name?.message} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="last_name">Last name</Label>
              <Input id="last_name" aria-invalid={!!errors.last_name} {...register('last_name')} />
              <FieldMessage message={errors.last_name?.message} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" aria-invalid={!!errors.username} {...register('username')} />
            <FieldMessage message={errors.username?.message} />
            {!errors.username && availability.status === 'checking' && (
              <p className="text-xs text-muted-foreground">Checking availability…</p>
            )}
            {!errors.username && availability.status === 'available' && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">Username is available.</p>
            )}
            {!errors.username && availability.status === 'taken' && (
              <p className="text-xs text-destructive">That username is taken.</p>
            )}
          </div>

          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Saving…' : 'Continue'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function StepTwo() {
  const [submitStep2, { isLoading }] = useSubmitOnboardingStep2Mutation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<OnboardingStep2FormValues>({
    resolver: zodResolver(onboardingStep2Schema),
    defaultValues: { bio: '', pronouns: '', location: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await submitStep2(values).unwrap()
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>About you</CardTitle>
        <CardDescription>Optional — you can skip this and fill it in later.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormBanner message={formError} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" rows={4} aria-invalid={!!errors.bio} {...register('bio')} />
            <FieldMessage message={errors.bio?.message} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pronouns">Pronouns</Label>
              <Input id="pronouns" aria-invalid={!!errors.pronouns} {...register('pronouns')} />
              <FieldMessage message={errors.pronouns?.message} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="location">Location</Label>
              <Input id="location" aria-invalid={!!errors.location} {...register('location')} />
              <FieldMessage message={errors.location?.message} />
            </div>
          </div>

          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Saving…' : 'Continue'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function StepThree() {
  const [submitStep3, { isLoading }] = useSubmitOnboardingStep3Mutation()
  const [file, setFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleCropped(blob: Blob) {
    setFormError(null)
    const formData = new FormData()
    formData.append('avatar', blob, 'avatar.jpg')
    try {
      await submitStep3(formData).unwrap()
    } catch (error) {
      // No react-hook-form instance on this step (no text fields to
      // attach errors to) — every server error collapses into the banner.
      setFormError(extractServerErrorMessage(error))
    }
  }

  async function handleSkip() {
    // The backend's step-3 endpoint completes onboarding on submission
    // whether or not a file is attached (`avatar` is `sometimes`+
    // `nullable`) — an empty FormData is a real "no avatar" submission,
    // not a special case.
    setFormError(null)
    try {
      await submitStep3(new FormData()).unwrap()
    } catch (error) {
      setFormError(extractServerErrorMessage(error))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a photo</CardTitle>
        <CardDescription>Optional — crop it to a square before uploading.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormBanner message={formError} />

        {file ? (
          <AvatarCropper
            file={file}
            submitting={isLoading}
            onCancel={() => setFile(null)}
            onCropped={handleCropped}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="outline" disabled={isLoading} onClick={handleSkip}>
              {isLoading ? 'Saving…' : 'Skip for now'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function OnboardingComplete({ username }: { username: string | null }) {
  const navigate = useNavigate()
  return (
    <Card>
      <CardHeader>
        <CardTitle>You're all set</CardTitle>
        <CardDescription>Your profile is ready.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button onClick={() => navigate(username ? `/u/${username}` : '/')}>
          View your profile
        </Button>
      </CardContent>
    </Card>
  )
}
