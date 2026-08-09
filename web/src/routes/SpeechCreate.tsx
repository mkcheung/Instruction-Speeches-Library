import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { UploadDashboard } from '@/components/speech/UploadDashboard'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { speechCreateSchema, type SpeechCreateFormValues } from '@/lib/validation'
import { useCreateSpeechMutation, useListSpeechesQuery } from '@/features/speech/speechApi'
import type { Speech } from '@/features/speech/types'

/**
 * STEP-03-upload-and-watch.md: the create form "including the 'this
 * replaces an earlier attempt' picker and the change_note field" (§6.11),
 * then the Uppy Dashboard for the actual file. Two phases in one route —
 * `speech_id` doesn't exist until the create mutation returns, and the
 * upload endpoints all key off it.
 */
export default function SpeechCreate() {
  const navigate = useNavigate()
  const [createSpeech, { isLoading: isCreating }] = useCreateSpeechMutation()
  const { data: existing } = useListSpeechesQuery()
  const [formError, setFormError] = useState<string | null>(null)
  const [createdSpeech, setCreatedSpeech] = useState<Speech | null>(null)
  const [uploadDone, setUploadDone] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<SpeechCreateFormValues>({
    resolver: zodResolver(speechCreateSchema),
    defaultValues: { title: '', supersedes_id: undefined, change_note: '' },
  })

  const supersedesId = watch('supersedes_id')

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const speech = await createSpeech({
        title: values.title,
        description: values.description || null,
        delivered_on: values.delivered_on || null,
        supersedes_id: values.supersedes_id ?? null,
        change_note: values.change_note || null,
      }).unwrap()
      setCreatedSpeech(speech)
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  if (createdSpeech) {
    return (
      <div className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-6 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Upload "{createdSpeech.title}"</CardTitle>
            <CardDescription>Turn off your wifi mid-upload and it will resume when you're back.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {uploadDone ? (
              <FormBanner variant="success" message="Uploaded. Processing now — check My speeches for status." />
            ) : (
              <UploadDashboard speechId={createdSpeech.id} onAssetReady={() => setUploadDone(true)} />
            )}
            <Button variant="outline" onClick={() => navigate('/speeches')}>
              Go to my speeches
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Upload a speech</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <FormBanner message={formError} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" aria-invalid={!!errors.title} {...register('title')} />
              <FieldMessage message={errors.title?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" rows={3} aria-invalid={!!errors.description} {...register('description')} />
              <FieldMessage message={errors.description?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delivered_on">Delivered on</Label>
              <Input id="delivered_on" type="date" {...register('delivered_on')} />
            </div>

            {existing && existing.speeches.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="supersedes_id">This replaces an earlier attempt</Label>
                <select
                  id="supersedes_id"
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none dark:bg-input/30"
                  {...register('supersedes_id', { setValueAs: (v) => (v ? Number(v) : undefined) })}
                >
                  <option value="">— None —</option>
                  {existing.speeches.map((speech) => (
                    <option key={speech.id} value={speech.id}>
                      {speech.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!!supersedesId && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="change_note">What did you change?</Label>
                <Textarea
                  id="change_note"
                  rows={2}
                  placeholder="Cut the third example, slowed down the opening…"
                  aria-invalid={!!errors.change_note}
                  {...register('change_note')}
                />
                <FieldMessage message={errors.change_note?.message} />
              </div>
            )}

            <Button type="submit" disabled={isCreating}>
              {isCreating ? 'Creating…' : 'Continue to upload'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
