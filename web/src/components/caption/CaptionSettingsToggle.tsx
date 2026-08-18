import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useUpdateCaptionSettingsMutation } from '@/features/speech/speechApi'

/**
 * captions-settings gap fix: the owner-only control for
 * `speeches.captions_enabled` — STEP-09 shipped the column, the migration,
 * and every defensive read of it, but no way for a speaker to actually
 * flip it. Mounted only where the caller already knows the viewer is the
 * owner (see `SpeechWatch.tsx`'s `isOwner`-gated transcript tab) — this
 * component itself does not re-derive ownership, mirroring `CaptionEditor`'s
 * own "the parent already gated this" convention.
 *
 * PATCHes `/speeches/{speech}/caption-settings` via
 * `useUpdateCaptionSettingsMutation` (RTK Query). No local optimistic
 * cache write: the mutation already invalidates both this slice's own
 * `Speech` tag and `captionApi`'s `Captions` tag on success
 * (`speechApi.ts`'s `onQueryStarted`), so a refetch-on-success is enough —
 * the button just reflects `captionsEnabled` handed down from the parent's
 * own `getSpeech` subscription, which re-renders once that refetch lands.
 */
export function CaptionSettingsToggle({
  speechId,
  captionsEnabled,
}: {
  speechId: number
  captionsEnabled: boolean
}) {
  const [updateSettings, { isLoading }] = useUpdateCaptionSettingsMutation()
  const [error, setError] = useState(false)

  const toggle = () => {
    setError(false)
    updateSettings({ speechId, captions_enabled: !captionsEnabled })
      .unwrap()
      .catch(() => setError(true))
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={captionsEnabled ? 'default' : 'outline'}
        aria-pressed={captionsEnabled}
        disabled={isLoading}
        data-testid="caption-settings-toggle"
        onClick={toggle}
      >
        {isLoading ? 'Saving…' : captionsEnabled ? 'Automatic captions: on' : 'Automatic captions: off'}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-[var(--color-danger)]">
          Could not save. Try again.
        </span>
      )}
    </div>
  )
}
