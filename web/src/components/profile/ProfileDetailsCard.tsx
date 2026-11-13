import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { FormBanner } from '@/components/ui/form-message'
import { AvatarCropper } from '@/components/onboarding/AvatarCropper'
import { InlineField } from '@/components/profile/InlineField'
import {
  useUpdateOwnAvatarMutation,
  useUpdateOwnProfileMutation,
  useUpdateOwnUsernameMutation,
} from '@/features/profile/profileApi'
import type { PublicProfile } from '@/features/profile/types'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'
import { cleanProfileField, profileFieldError, PROFILE_FIELD_LABELS, PROFILE_FIELD_SCHEMAS, type ProfileField } from '@/lib/profileFieldRules'
import { profilePath } from '@/lib/profilePath'
import { cn } from '@/lib/utils'

/**
 * The Profile view of "Your profile": photo, display name, username, bio and
 * location, each saved on its own. Profile fields go to `PATCH /api/profile`
 * one at a time; the username has its own endpoint and the server's 30-day
 * rule; the photo keeps the cropper the old edit page used.
 */
export function ProfileDetailsCard({ profile, username }: { profile: PublicProfile; username: string }) {
  const headingId = useId()
  const [updateProfile] = useUpdateOwnProfileMutation()
  const [updateUsername] = useUpdateOwnUsernameMutation()
  const [updateAvatar, { isLoading: isUploadingAvatar }] = useUpdateOwnAvatarMutation()
  const [croppingFile, setCroppingFile] = useState<File | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [saved, setSaved] = useState('')

  /** One field's label, client rules and save: `send` is the only part that differs between fields. */
  function field(name: ProfileField, send: (value: string) => Promise<unknown>) {
    return {
      label: PROFILE_FIELD_LABELS[name],
      clean: (draft: string) => cleanProfileField(name, draft),
      error: (draft: string) => profileFieldError(name, draft),
      onSave: async (value: string) => {
        setSaved('')
        await send(value)
        setSaved(`${PROFILE_FIELD_LABELS[name]} saved.`)
      },
    }
  }

  function profileField(name: Exclude<ProfileField, 'username'>) {
    return field(name, (value) => updateProfile({ [name]: value, username }).unwrap())
  }

  async function handleCropped(blob: Blob) {
    setAvatarError(null)
    const formData = new FormData()
    formData.append('avatar', blob, 'avatar.jpg')
    try {
      await updateAvatar({ formData, username }).unwrap()
      setCroppingFile(null)
      setSaved('Photo saved.')
    } catch (error) {
      setAvatarError(extractServerErrorMessage(error))
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'workspace-notebook-surface workspace-notebook-panel flex flex-col items-center gap-4 px-4 py-8 text-center sm:px-6',
        // The cropper is exactly 288px, all a 320px screen leaves inside the
        // page padding, so while cropping this panel gives up its side
        // padding and border there (notebook.css does the same for cards).
        croppingFile && 'workspace-notebook-photo-panel--cropping max-[359px]:border-x-0 max-[359px]:px-0 max-[359px]:outline max-[359px]:outline-1 max-[359px]:outline-border',
      )}
    >
      <h2 id={headingId} className="sr-only">Profile</h2>
      {croppingFile ? (
        <div className="workspace-notebook-embedded w-full">
          <AvatarCropper
            file={croppingFile}
            submitting={isUploadingAvatar}
            onCancel={() => setCroppingFile(null)}
            onCropped={handleCropped}
          />
        </div>
      ) : (
        <div className="relative">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="Your photo" className="size-36 rounded-full border-4 border-card object-cover ring-1 ring-border" />
          ) : (
            <div className="size-36 rounded-full border-4 border-card bg-muted ring-1 ring-border" aria-hidden="true" />
          )}
          <label className="absolute right-0 bottom-1 inline-flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <Camera aria-hidden="true" className="size-5" />
            <input
              type="file"
              className="sr-only"
              aria-label="Change photo"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                setAvatarError(null)
                setCroppingFile(event.target.files?.[0] ?? null)
                event.target.value = ''
              }}
            />
          </label>
        </div>
      )}
      <FormBanner className="workspace-notebook-banner" message={avatarError} />

      <div className="flex w-full max-w-md flex-col items-center gap-1">
        <InlineField
          {...profileField('display_name')}
          value={profile.display_name ?? ''}
          emptyText="Add a display name"
          valueClassName="text-2xl font-bold"
        />
        <InlineField
          {...field('username', (value) => updateUsername({ username: value }).unwrap())}
          value={username}
          emptyText="Choose a username"
          display={(current) => `@${current}`}
          hint={(draft) => {
            const next = cleanProfileField('username', draft)
            return next && next !== username
              ? `Your page moves to /u/${next}. Links to /u/${username} will stop working.`
              : 'You can change your username once every 30 days.'
          }}
          valueClassName="font-medium text-muted-foreground"
        />
        <InlineField
          {...profileField('bio')}
          multiline
          value={profile.bio ?? ''}
          emptyText="Add a bio"
          hint={(draft) => `${cleanProfileField('bio', draft).length} / ${PROFILE_FIELD_SCHEMAS.bio.maxLength} characters`}
          valueClassName="text-[15px] leading-relaxed"
        />
        <InlineField
          {...profileField('location')}
          value={profile.location ?? ''}
          emptyText="Add your location"
          valueClassName="text-sm text-muted-foreground"
        />
      </div>
      <p role="status" className="min-h-5 text-sm font-medium text-muted-foreground">{saved}</p>

      <div className="w-full border-t border-dashed border-border pt-4">
        <Link to={profilePath(username)} className="font-semibold underline underline-offset-3">
          View your page as others see it
        </Link>
      </div>
    </section>
  )
}
