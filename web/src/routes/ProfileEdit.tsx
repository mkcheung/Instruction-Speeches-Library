import { useState } from 'react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AvatarCropper } from '@/components/onboarding/AvatarCropper'
import { NotebookPage } from '@/components/workspace/NotebookPage'
import { useWorkspaceCompanionScene } from '@/components/workspace/useWorkspaceCompanion'
import { applyServerErrors, extractServerErrorMessage } from '@/lib/applyServerErrors'
import { profileTextSchema, usernameSchema } from '@/lib/validation'
import { useGetMeQuery } from '@/features/auth/authApi'
import { isAcceptedViewer, useAuthSession } from '@/features/auth/authSession'
import {
  useGetPublicProfileQuery,
  useUpdateOwnAvatarMutation,
  useUpdateOwnProfileMutation,
  useUpdateOwnUsernameMutation,
} from '@/features/profile/profileApi'

const profileEditSchema = z.object({
  display_name: z.string().max(60, 'Display name must be at most 60 characters.'),
  ...profileTextSchema.shape,
})

type ProfileEditFormValues = z.infer<typeof profileEditSchema>

const usernameFormSchema = z.object({ username: usernameSchema })
type UsernameFormValues = z.infer<typeof usernameFormSchema>

/**
 * §6.5's "own-profile edit." There is no `GET /api/profile` — `UserResource`
 * (what `/api/me` returns) never carries bio/pronouns/location/avatar, only
 * `PublicProfileResource` does. So this page reads its own profile data
 * exactly the way a stranger would: `/api/me` for identity + username,
 * then `/api/u/{username}` for the display fields.
 */
export default function ProfileEdit() {
  const scene = useWorkspaceCompanionScene()
  const { data: me } = useGetMeQuery()
  const session = useAuthSession()
  // Identity is established only when cached /me names the proven viewer of
  // this document; anything else is treated as not-yet-known, never rendered.
  const identity = me && isAcceptedViewer(session, me.user) ? me.user : null
  const username = identity?.username ?? null

  // `currentData` (not `data`) so a previous username's profile is never shown
  // while the new username's read is pending or after it fails.
  const {
    currentData: profile,
    isError: profileFailed,
    error: profileError,
    refetch: refetchProfile,
  } = useGetPublicProfileQuery(username ?? '', { skip: !username })

  const [updateProfile, { isLoading: isSaving }] = useUpdateOwnProfileMutation()
  const [updateAvatar, { isLoading: isUploadingAvatar }] = useUpdateOwnAvatarMutation()
  const [updateUsername, { isLoading: isSavingUsername }] = useUpdateOwnUsernameMutation()

  const [formError, setFormError] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const [usernameSavedNotice, setUsernameSavedNotice] = useState(false)
  const [croppingFile, setCroppingFile] = useState<File | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ProfileEditFormValues>({
    resolver: zodResolver(profileEditSchema),
    values: profile
      ? {
          display_name: profile.display_name ?? '',
          bio: profile.bio ?? '',
          pronouns: profile.pronouns ?? '',
          location: profile.location ?? '',
        }
      : undefined,
  })

  const {
    register: registerUsername,
    handleSubmit: handleUsernameSubmit,
    setError: setUsernameFieldError,
    formState: { errors: usernameErrors },
  } = useForm<UsernameFormValues>({
    resolver: zodResolver(usernameFormSchema),
    values: username ? { username } : undefined,
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    setSavedNotice(false)
    if (!username) return
    try {
      await updateProfile({ ...values, username }).unwrap()
      setSavedNotice(true)
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  const onUsernameSubmit = handleUsernameSubmit(async (values) => {
    setUsernameError(null)
    setUsernameSavedNotice(false)
    try {
      await updateUsername(values).unwrap()
      setUsernameSavedNotice(true)
    } catch (error) {
      setUsernameError(applyServerErrors(error, setUsernameFieldError))
    }
  })

  async function handleCropped(blob: Blob) {
    setAvatarError(null)
    if (!username) return
    const formData = new FormData()
    formData.append('avatar', blob, 'avatar.jpg')
    try {
      await updateAvatar({ formData, username }).unwrap()
      setCroppingFile(null)
    } catch (error) {
      setAvatarError(extractServerErrorMessage(error))
    }
  }

  if (identity && !username) {
    return (
      <NotebookPage width="form" scene={scene} title="Edit profile">
        <p className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status" role="status">
          Choose a username to edit your profile. <Link to="/onboarding" className="underline">Finish setting up your account</Link>.
        </p>
      </NotebookPage>
    )
  }

  if (username && !profile && profileFailed) {
    const notFound = typeof profileError === 'object' && profileError !== null
      && 'status' in profileError && profileError.status === 404
    return (
      <NotebookPage width="form" scene={scene} title="Edit profile">
        <div role="alert" className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status flex flex-col items-start gap-3">
          <p>{notFound ? 'Your profile was not found.' : 'We could not load your profile.'}</p>
          <Button type="button" className="workspace-notebook-control workspace-notebook-control--primary" onClick={() => void refetchProfile()}>
            Retry
          </Button>
        </div>
      </NotebookPage>
    )
  }

  if (!identity || !profile || !username) {
    return (
      <NotebookPage width="form" scene={scene} title="Edit profile">
        <p className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-status">Loading…</p>
      </NotebookPage>
    )
  }

  return (
    <NotebookPage width="form" scene={scene} title="Edit profile">
      <Card className={`workspace-notebook-surface workspace-notebook-panel${croppingFile ? ' workspace-notebook-photo-panel--cropping' : ''}`}>
        <CardHeader>
          <CardTitle>Photo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <FormBanner className="workspace-notebook-banner" message={avatarError} />
          {croppingFile ? (
            <div className="workspace-notebook-embedded">
              <AvatarCropper
                file={croppingFile}
                submitting={isUploadingAvatar}
                onCancel={() => setCroppingFile(null)}
                onCropped={handleCropped}
              />
            </div>
          ) : (
            <>
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="size-24 rounded-full object-cover ring-1 ring-foreground/10"
                />
              ) : (
                <div className="size-24 rounded-full bg-muted" aria-hidden="true" />
              )}
              <Input
                type="file"
                aria-label="Profile photo"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setCroppingFile(event.target.files?.[0] ?? null)}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card className="workspace-notebook-surface workspace-notebook-panel">
        <CardHeader>
          <CardTitle>Username</CardTitle>
          <CardDescription>One change allowed every 30 days.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onUsernameSubmit} className="flex flex-col gap-3" noValidate>
            <FormBanner className="workspace-notebook-banner" message={usernameError} />
            {usernameSavedNotice && <FormBanner className="workspace-notebook-banner workspace-notebook-banner--success" variant="success" message="Username updated." />}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                aria-invalid={!!usernameErrors.username}
                {...registerUsername('username')}
              />
              <FieldMessage message={usernameErrors.username?.message} />
            </div>
            <Button type="submit" disabled={isSavingUsername} className="workspace-notebook-control workspace-notebook-control--primary self-start">
              {isSavingUsername ? 'Saving…' : 'Update username'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="workspace-notebook-surface workspace-notebook-panel">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>@{username}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <FormBanner className="workspace-notebook-banner" message={formError} />
            {savedNotice && <FormBanner className="workspace-notebook-banner workspace-notebook-banner--success" variant="success" message="Saved." />}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="display_name">Display name</Label>
              <Input id="display_name" aria-invalid={!!errors.display_name} {...register('display_name')} />
              <FieldMessage message={errors.display_name?.message} />
            </div>

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

            <div className="flex gap-2">
              <Button className="workspace-notebook-control workspace-notebook-control--primary" type="submit" disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button className="workspace-notebook-control workspace-notebook-control--secondary" type="button" variant="outline" onClick={() => reset()} disabled={isSaving}>
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </NotebookPage>
  )
}
