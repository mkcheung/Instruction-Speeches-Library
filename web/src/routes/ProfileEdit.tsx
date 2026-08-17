import { useState } from 'react'
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
import { applyServerErrors, extractServerErrorMessage } from '@/lib/applyServerErrors'
import { usernameSchema } from '@/lib/validation'
import { useGetMeQuery } from '@/features/auth/authApi'
import {
  useGetPublicProfileQuery,
  useUpdateOwnAvatarMutation,
  useUpdateOwnProfileMutation,
  useUpdateOwnUsernameMutation,
} from '@/features/profile/profileApi'

const profileEditSchema = z.object({
  display_name: z.string().max(60, 'Display name must be at most 60 characters.'),
  bio: z.string().max(1000, 'Bio must be at most 1000 characters.'),
  pronouns: z.string().max(32, 'Pronouns must be at most 32 characters.'),
  location: z.string().max(80, 'Location must be at most 80 characters.'),
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
  const { data: me, isLoading: isLoadingMe } = useGetMeQuery()
  const username = me?.user.username ?? null

  const { data: profile, isLoading: isLoadingProfile } = useGetPublicProfileQuery(username ?? '', {
    skip: !username,
  })

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

  if (isLoadingMe || isLoadingProfile || !profile || !username) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto flex flex-1 max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Photo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <FormBanner message={avatarError} />
          {croppingFile ? (
            <AvatarCropper
              file={croppingFile}
              submitting={isUploadingAvatar}
              onCancel={() => setCroppingFile(null)}
              onCropped={handleCropped}
            />
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
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setCroppingFile(event.target.files?.[0] ?? null)}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Username</CardTitle>
          <CardDescription>One change allowed every 30 days.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onUsernameSubmit} className="flex flex-col gap-3" noValidate>
            <FormBanner message={usernameError} />
            {usernameSavedNotice && <FormBanner variant="success" message="Username updated." />}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                aria-invalid={!!usernameErrors.username}
                {...registerUsername('username')}
              />
              <FieldMessage message={usernameErrors.username?.message} />
            </div>
            <Button type="submit" disabled={isSavingUsername} className="self-start">
              {isSavingUsername ? 'Saving…' : 'Update username'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>@{username}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <FormBanner message={formError} />
            {savedNotice && <FormBanner variant="success" message="Saved." />}

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
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="outline" onClick={() => reset()} disabled={isSaving}>
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
