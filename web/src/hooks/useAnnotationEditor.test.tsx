import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { useAnnotationEditor, type UseAnnotationEditorOptions } from '@/hooks/useAnnotationEditor'
import { discoverAnnotationRecovery } from '@/lib/annotationRecovery'
import type { Annotation } from '@/features/annotation/types'

function row(overrides: Partial<Annotation> = {}): Annotation {
  return { id: '9', timing_type: 'range', start_seconds: 12, duration_seconds: 6, kind: 'praise', topic: 'old-topic',
    body: 'existing body', lock_version: 1, client_uuid: 'existing-uuid', voice: null, ...overrides }
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
const scope = { userId: '3', speechId: 1, reviewId: 1, rowId: null }
function setup(overrides: Partial<UseAnnotationEditorOptions> = {}) {
  const store = createTestStore()
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  const video = document.createElement('video')
  vi.spyOn(video, 'pause').mockImplementation(() => {})
  const options: UseAnnotationEditorOptions = { userId: '3', speechId: 1, reviewId: 1, initial: null, videoEl: video,
    durationMs: 100_000, annotations: [], ...overrides }
  return { ...renderHook((props: UseAnnotationEditorOptions) => useAnnotationEditor(props), { wrapper, initialProps: options }), video, options }
}
function input(editor: ReturnType<typeof setup>['result'], body = 'New feedback') {
  act(() => { editor.current.setStart('12.500'); editor.current.setEnd('0:18.000'); editor.current.setBody(body) })
}
function network(handler: (request: Request) => Promise<Response> | Response) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
    const request = input as Request
    return handler(request)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('explicit annotation authoring', () => {
  beforeEach(() => { localStorage.clear(); clearCookies() })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('typing and captures remain local, including pagehide and elapsed debounce intervals', async () => {
    vi.useFakeTimers()
    const fetch = network(() => response({}))
    const { result, video } = setup()
    act(() => result.current.setBody('Typing does not stamp'))
    expect(result.current.fields.start).toBe('')
    expect(result.current.fields.end).toBe('')
    video.currentTime = 12.5004
    act(() => result.current.captureStart())
    expect(result.current.fields.start).toBe('0:12.500')
    expect(result.current.fields.end).toBe('')
    expect(video.pause).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('pagehide'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetch).not.toHaveBeenCalled()
    expect(discoverAnnotationRecovery(scope)[0].fields.body).toBe('Typing does not stamp')
  })

  it('Add sends one canonical range, omits Kind/Topic and clears only its acknowledged recovery', async () => {
    const calls: Record<string, unknown>[] = []
    network(async (request) => {
      const body = await request.json() as Record<string, unknown>; calls.push(body)
      return response({ annotation: row({ client_uuid: body.client_uuid as string, body: body.body as string, start_seconds: 12.5, duration_seconds: 5.5 }) }, 201)
    })
    const created = vi.fn()
    const { result } = setup({ onCreated: created })
    input(result)
    await act(async () => { await Promise.all([result.current.submit(), result.current.submit()]) })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ start_seconds: 12.5, duration_seconds: 5.5, body: 'New feedback' })
    expect(calls[0]).not.toHaveProperty('kind'); expect(calls[0]).not.toHaveProperty('topic')
    expect(created).toHaveBeenCalledOnce()
    expect(discoverAnnotationRecovery(scope)).toHaveLength(0)
  })

  it('freezes fields until an in-flight submission is acknowledged', async () => {
    let resolve!: (response: Response) => void
    let sent: Record<string, unknown> = {}
    network(async (request) => { sent = await request.json(); return new Promise<Response>((done) => { resolve = done }) })
    const { result } = setup()
    input(result)
    let pending!: Promise<void>
    act(() => { pending = result.current.submit() })
    await waitFor(() => expect(resolve).toBeDefined())
    act(() => result.current.setBody('Should not replace the frozen submission'))
    expect(result.current.fields.body).toBe('New feedback')
    await act(async () => { resolve(response({ annotation: row({ client_uuid: sent.client_uuid as string, body: 'New feedback', start_seconds: 12.5, duration_seconds: 5.5 }) })); await pending })
    expect(result.current.saveState).toBe('saved')
  })

  it('accepts the server body trim without falsely freezing a successful save', async () => {
    network(async (request) => {
      const body = await request.json()
      return response({ annotation: row({ client_uuid: body.client_uuid, body: body.body.trim(), start_seconds: 12.5, duration_seconds: 5.5 }) })
    })
    const { result } = setup(); input(result, '  Feedback with surrounding whitespace\n')
    await act(async () => { await result.current.submit() })
    expect(result.current.saveState).toBe('saved')
    expect(result.current.fields.body).toBe('Feedback with surrounding whitespace')
    expect(result.current.pending).toBe(false)
  })

  it('a validation rejection preserves text, allows timing correction, and stays separate from version conflict', async () => {
    network(() => response({ code: 'annotation_overlap', message: 'overlap', conflicts: [] }, 422))
    const { result } = setup(); input(result)
    const uuid = result.current.clientUuid
    await act(async () => { await result.current.submit() })
    expect(result.current.message).toContain('overlaps')
    expect(result.current.conflict).toBeNull()
    expect(result.current.frozen).toBe(false)
    act(() => result.current.setStart('20'))
    expect(result.current.fields.start).toBe('20')
    expect(result.current.clientUuid).toBe(uuid)
    expect(discoverAnnotationRecovery(scope)[0].fields.body).toBe('New feedback')
  })

  it('unknown network outcomes freeze the original snapshot and retry the same UUID/body/timing', async () => {
    const requests: Record<string, unknown>[] = []
    network(async (request) => {
      const body = await request.json(); requests.push(body)
      if (requests.length === 1) return response({ message: 'uncertain' }, 500)
      return response({ annotation: row({ client_uuid: body.client_uuid, body: body.body, start_seconds: 12.5, duration_seconds: 5.5 }) })
    })
    const { result } = setup(); input(result)
    await act(async () => { await result.current.submit() })
    expect(result.current.saveState).toBe('uncertain')
    act(() => { result.current.setStart('40'); result.current.discard() })
    expect(result.current.fields.start).toBe('12.500')
    expect(discoverAnnotationRecovery(scope)[0].uncertain).not.toBeNull()
    await act(async () => { await result.current.submit() })
    expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0])
    expect(result.current.saveState).toBe('saved')
  })

  it('a known rolled-back busy response permits correction while preserving the UUID', async () => {
    network(() => response({ code: 'annotation_busy' }, 503))
    const { result } = setup(); input(result)
    await act(async () => { await result.current.submit() })
    expect(result.current.frozen).toBe(false)
    expect(result.current.message).toContain('retry')
  })

  it.each([403, 429, 503])('a later %s cannot establish the outcome of an earlier uncertain create', async (status) => {
    let attempts = 0
    network(() => ++attempts === 1 ? response({}, 500) : response({ code: status === 503 ? 'annotation_busy' : undefined }, status))
    const { result } = setup(); input(result)
    await act(async () => { await result.current.submit() })
    await act(async () => { await result.current.submit() })
    expect(result.current.saveState).toBe('uncertain')
    expect(result.current.frozen).toBe(true)
    act(() => result.current.setStart('30'))
    expect(result.current.fields.start).toBe('12.500')
  })

  it('a later explicit overlap releases the frozen submission without losing its draft identity', async () => {
    const requests: Record<string, unknown>[] = []
    network(async (request) => {
      requests.push(await request.json())
      return requests.length === 1 ? response({}, 500) : response({ code: 'annotation_overlap' }, 422)
    })
    const { result } = setup(); input(result)
    const uuid = result.current.clientUuid
    await act(async () => { await result.current.submit() })
    expect(result.current.frozen).toBe(true)
    await act(async () => { await result.current.submit() })
    expect(requests[1]).toEqual(requests[0])
    expect(result.current.frozen).toBe(false)
    expect(result.current.clientUuid).toBe(uuid)
    expect(discoverAnnotationRecovery(scope)[0].uncertain).toBeNull()
    act(() => result.current.setStart('30'))
    expect(result.current.fields.start).toBe('30')
  })

  it('a mismatched idempotent acknowledgement cannot clear the draft', async () => {
    network(() => response({ annotation: row({ body: 'Earlier body' }) }))
    const { result } = setup(); input(result)
    await act(async () => { await result.current.submit() })
    expect(result.current.saveState).toBe('uncertain')
    expect(result.current.fields.body).toBe('New feedback')
    expect(discoverAnnotationRecovery(scope)).toHaveLength(1)
  })

  it('Keep mine prepares a current-version retry without making an implicit request', async () => {
    const remote = row({ body: 'Other tab', lock_version: 2 })
    const calls: Record<string, unknown>[] = []
    network(async (request) => {
      const body = await request.json(); calls.push(body)
      return calls.length === 1 ? response({ conflictSource: 'self', current: remote }, 409)
        : response({ annotation: row({ body: 'My edit', lock_version: 3 }) })
    })
    const existing = row()
    const { result } = setup({ initial: existing, annotations: [existing] })
    act(() => result.current.setBody('My edit'))
    await act(async () => { await result.current.submit() })
    expect(result.current.conflict?.lock_version).toBe(2)
    act(() => result.current.keepMine())
    expect(calls).toHaveLength(1)
    await act(async () => { await result.current.submit() })
    expect(calls[1]).toEqual({ body: 'My edit', lock_version: 2 })
    expect(result.current.saveState).toBe('saved')
  })

  it('body-only editing preserves grandfathered timing and hidden metadata', async () => {
    const existing = row({ duration_seconds: 0.1, start_seconds: 200 })
    let payload: unknown
    network(async (request) => { payload = await request.json(); return response({ annotation: { ...existing, body: 'Amended', lock_version: 2 } }) })
    const { result } = setup({ initial: existing, annotations: [existing] })
    act(() => result.current.setBody('Amended'))
    expect(result.current.canSubmit).toBe(true)
    await act(async () => { await result.current.submit() })
    expect(payload).toEqual({ body: 'Amended', lock_version: 1 })
    expect(result.current.saveState).toBe('saved')
  })

  it('an erased point offers only body editing and retains its point identity', async () => {
    const existing = row({ timing_type: 'point' })
    const { result } = setup({ initial: existing, annotations: [existing] })
    expect(result.current.point).toBe(true)
    act(() => result.current.setBody('Preserved transcript'))
    expect(result.current.canSubmit).toBe(true)
  })

  it('Cancel restores saved fields and removes only this editor recovery', () => {
    const existing = row(); const cancel = vi.fn()
    const { result } = setup({ initial: existing, annotations: [existing], onCancel: cancel })
    act(() => result.current.setBody('Discard this edit'))
    act(() => result.current.discard())
    expect(result.current.fields.body).toBe(existing.body)
    expect(result.current.pending).toBe(false); expect(cancel).toHaveBeenCalledOnce()
    expect(discoverAnnotationRecovery({ ...scope, rowId: existing.id })).toHaveLength(0)
  })

  it('requires loaded timing, annotations and account before a new save', () => {
    const { result, rerender, options } = setup({ annotations: undefined }); input(result)
    expect(result.current.canSubmit).toBe(false)
    rerender({ ...options, annotations: [], durationMs: null }); expect(result.current.canSubmit).toBe(false)
    rerender({ ...options, annotations: [], userId: undefined }); expect(result.current.canSubmit).toBe(false)
  })

  it('recovery after remount is explicit and preserves the original create identity', () => {
    const first = setup(); input(first.result)
    const uuid = first.result.current.clientUuid
    first.unmount()
    const next = setup()
    expect(next.result.current.fields.body).toBe('')
    expect(next.result.current.recoveries).toHaveLength(1)
    act(() => next.result.current.restore(next.result.current.recoveries[0]))
    expect(next.result.current.fields.body).toBe('New feedback')
    expect(next.result.current.clientUuid).toBe(uuid)
    expect(discoverAnnotationRecovery(scope)).toHaveLength(2)
  })

  it('clean external updates adopt; dirty external updates show a conflict without overwriting text', () => {
    const existing = row()
    const { result, rerender, options } = setup({ initial: existing, annotations: [existing] })
    rerender({ ...options, initial: row({ lock_version: 2, body: 'Updated elsewhere' }) })
    expect(result.current.fields.body).toBe('Updated elsewhere')
    act(() => result.current.setBody('Local unsaved edit'))
    rerender({ ...options, initial: row({ lock_version: 3, body: 'Newer remote body' }) })
    expect(result.current.fields.body).toBe('Local unsaved edit')
    expect(result.current.conflict?.body).toBe('Newer remote body')
  })

  it('late acknowledgements cannot clear another account context', async () => {
    let resolve!: (response: Response) => void
    let payload: Record<string, unknown> = {}
    network(async (request) => { payload = await request.json(); return new Promise<Response>((done) => { resolve = done }) })
    const created = vi.fn()
    const { result, rerender, options } = setup({ onCreated: created }); input(result)
    let saving!: Promise<void>
    act(() => { saving = result.current.submit() })
    await waitFor(() => expect(resolve).toBeDefined())
    rerender({ ...options, userId: 'another-account' })
    await act(async () => { resolve(response({ annotation: row({ client_uuid: payload.client_uuid as string, body: 'New feedback', start_seconds: 12.5, duration_seconds: 5.5 }) })); await saving })
    expect(created).not.toHaveBeenCalled()
    expect(discoverAnnotationRecovery(scope)).toHaveLength(1)
  })
})
