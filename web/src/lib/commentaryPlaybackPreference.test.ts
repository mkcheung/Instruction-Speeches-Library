import { describe, expect, it, vi } from 'vitest'
import type { CommentaryPlaybackMode, CommentaryPlaybackPreference } from '@/features/annotation/types'
import { PlaybackPreferenceCoordinator, PlaybackPreferenceRegistry } from './commentaryPlaybackPreference'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function preference(mode: CommentaryPlaybackMode, source: CommentaryPlaybackPreference['source'] = 'saved', speechId = 8): CommentaryPlaybackPreference {
  return { speech_id: speechId, mode, source }
}

function fixture(speechId = 8) {
  const reads: ReturnType<typeof deferred<CommentaryPlaybackPreference>>[] = []
  const writes: { mode: CommentaryPlaybackMode; result: ReturnType<typeof deferred<CommentaryPlaybackPreference>> }[] = []
  const transport = {
    read: vi.fn(() => { const result = deferred<CommentaryPlaybackPreference>(); reads.push(result); return result.promise }),
    write: vi.fn((mode: CommentaryPlaybackMode) => {
      const result = deferred<CommentaryPlaybackPreference>()
      writes.push({ mode, result })
      return result.promise
    }),
    cancel: vi.fn(), confirmed: vi.fn(),
  }
  const coordinator = new PlaybackPreferenceCoordinator(speechId, transport)
  const hydrate = async (mode: CommentaryPlaybackMode = 'all') => {
    const pending = coordinator.hydrate()
    reads.at(-1)!.resolve(preference(mode, 'saved', speechId))
    await pending
  }
  return { coordinator, reads, writes, transport, hydrate }
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('commentary preference ordering', () => {
  it('suppresses feedback and selection until a successful authoritative GET', async () => {
    const { coordinator, reads, transport } = fixture()
    const pending = coordinator.hydrate()
    coordinator.select('voice')
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', ready: false, loading: true })
    expect(transport.write).not.toHaveBeenCalled()
    reads[0].resolve(preference('all', 'default'))
    await pending
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'all', ready: true, loading: false })
    expect(transport.confirmed).toHaveBeenCalledWith(preference('all', 'default'))
  })

  it('exposes a retryable initial failure and never enables cached feedback', async () => {
    const { coordinator, reads } = fixture()
    const pending = coordinator.hydrate()
    reads[0].reject({ status: 500 })
    await pending
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', ready: false, loading: false, loadError: true })
    coordinator.retry()
    reads[1].resolve(preference('written'))
    await settle()
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'written', ready: true, loadError: false })
  })

  it('sends one PATCH at a time and coalesces queued choices to the latest', async () => {
    const { coordinator, writes, hydrate, transport } = fixture()
    await hydrate()
    coordinator.select('voice')
    coordinator.select('written')
    coordinator.select('off')
    expect(writes.map((write) => write.mode)).toEqual(['voice'])
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', saving: true })
    writes[0].result.resolve(preference('voice'))
    await settle()
    expect(writes.map((write) => write.mode)).toEqual(['voice', 'off'])
    expect(coordinator.getSnapshot().mode).toBe('off')
    writes[1].result.resolve(preference('off'))
    await settle()
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', saving: false, saveError: false })
    expect(transport.confirmed).toHaveBeenLastCalledWith(preference('off'))
  })

  it('permanently rejects a GET begun before an explicit choice, even after the PATCH settles', async () => {
    const { coordinator, reads, writes, hydrate, transport } = fixture()
    await hydrate()
    const oldRead = coordinator.hydrate()
    coordinator.select('off')
    writes[0].result.resolve(preference('off'))
    await settle()
    reads[1].resolve(preference('all'))
    await oldRead
    expect(coordinator.getSnapshot().mode).toBe('off')
    expect(transport.confirmed).toHaveBeenLastCalledWith(preference('off'))
    // A newly initiated clean read converges with another tab's saved change.
    const newRead = coordinator.hydrate()
    reads[2].resolve(preference('written'))
    await newRead
    expect(coordinator.getSnapshot().mode).toBe('written')
  })

  it('never exposes the old confirmed mode between an acknowledgement and clearing an override', async () => {
    const { coordinator, writes, hydrate } = fixture()
    await hydrate()
    const seen: CommentaryPlaybackMode[] = []
    coordinator.subscribe(() => seen.push(coordinator.getSnapshot().mode))
    coordinator.select('off')
    writes[0].result.resolve(preference('off'))
    await settle()
    expect(seen).toEqual(['off', 'off'])
  })

  it('continues the latest queued intent after a superseded transient failure', async () => {
    const { coordinator, writes, hydrate } = fixture()
    await hydrate()
    coordinator.select('voice')
    coordinator.select('written')
    writes[0].result.reject({ status: 503 })
    await settle()
    expect(writes.map((write) => write.mode)).toEqual(['voice', 'written'])
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'written', saving: true, saveError: false })
    writes[1].result.resolve(preference('written'))
    await settle()
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'written', saving: false })
  })

  it('keeps a failed latest choice session-only and retries it instead of an older acknowledged mode', async () => {
    const { coordinator, reads, writes, hydrate, transport } = fixture()
    await hydrate()
    coordinator.select('off')
    writes[0].result.reject({ status: 503 })
    await settle()
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', saving: false, saveError: true, ready: true })
    expect(transport.confirmed).toHaveBeenCalledTimes(1)
    await coordinator.hydrate()
    expect(reads).toHaveLength(1) // Focus/remount cannot overwrite unsaved intent.
    coordinator.retry()
    expect(writes.map((write) => write.mode)).toEqual(['off', 'off'])
    writes[1].result.resolve(preference('off'))
    await settle()
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', saving: false, saveError: false })
  })

  it.each([401, 403, 404, 410])('suppresses playback and cancels queued choices after access error %i', async (status) => {
    const { coordinator, writes, hydrate } = fixture()
    await hydrate()
    coordinator.select('voice')
    coordinator.select('off')
    writes[0].result.reject({ status })
    await settle()
    expect(writes).toHaveLength(1)
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', ready: false, saving: false, accessDenied: true })
    coordinator.select('all')
    expect(writes).toHaveLength(1)
  })

  it('rejects a response for the wrong speech', async () => {
    const { coordinator, reads, transport } = fixture()
    const pending = coordinator.hydrate()
    reads[0].resolve(preference('all', 'saved', 99))
    await pending
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', ready: false, loadError: true })
    expect(transport.confirmed).not.toHaveBeenCalled()
  })

  it('does not accept a PATCH acknowledgement with a different mode', async () => {
    const { coordinator, writes, hydrate, transport } = fixture()
    await hydrate()
    coordinator.select('off')
    writes[0].result.resolve(preference('all'))
    await settle()
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'off', saveError: true, saving: false })
    expect(transport.confirmed).toHaveBeenCalledTimes(1)
  })

  it('keeps successful hydration during a transient focus-refresh failure', async () => {
    const { coordinator, reads, hydrate } = fixture()
    await hydrate('written')
    const pending = coordinator.hydrate()
    reads[1].reject({ status: 'FETCH_ERROR' })
    await pending
    expect(coordinator.getSnapshot()).toMatchObject({ mode: 'written', ready: true, loadError: true })
  })
})

describe('preference identity and route lifetime', () => {
  it('reuses the same coordinator after remount, without a second concurrent PATCH', async () => {
    const registry = new PlaybackPreferenceRegistry()
    const f = fixture()
    const entry = registry.get('owner', 8, () => f.transport)
    const hydration = entry.hydrate()
    f.reads[0].resolve(preference('all'))
    await hydration
    entry.select('voice')
    const remounted = registry.get('owner', 8, () => { throw new Error('must reuse existing entry') })
    await remounted.hydrate()
    remounted.select('off')
    expect(f.writes).toHaveLength(1)
    f.writes[0].result.resolve(preference('voice'))
    await settle()
    expect(f.writes.map((write) => write.mode)).toEqual(['voice', 'off'])
  })

  it('cancels old-account queues and ignores late acknowledgements while the route is unmounted', async () => {
    const registry = new PlaybackPreferenceRegistry()
    const a = fixture()
    const first = registry.get('a', 8, () => a.transport)
    const hydration = first.hydrate()
    a.reads[0].resolve(preference('all'))
    await hydration
    first.select('voice')
    first.select('off')
    registry.setIdentity(null)
    const b = fixture()
    const second = registry.get('b', 8, () => b.transport)
    a.writes[0].result.resolve(preference('voice'))
    await settle()
    expect(a.transport.cancel).toHaveBeenCalledOnce()
    expect(a.writes).toHaveLength(1)
    expect(a.transport.confirmed).toHaveBeenCalledTimes(1)
    expect(first.getSnapshot().ready).toBe(false)
    expect(second.getSnapshot()).toMatchObject({ mode: 'off', ready: false })
  })

  it('ignores a late initial GET after an account change', async () => {
    const registry = new PlaybackPreferenceRegistry()
    const a = fixture()
    const first = registry.get('a', 8, () => a.transport)
    const hydration = first.hydrate()
    registry.setIdentity('b')
    a.reads[0].resolve(preference('voice'))
    await hydration
    expect(a.transport.confirmed).not.toHaveBeenCalled()
    expect(first.getSnapshot().ready).toBe(false)
  })

  it('keeps concurrent saves to different speeches independent', async () => {
    const registry = new PlaybackPreferenceRegistry()
    const a = fixture(8)
    const b = fixture(9)
    const first = registry.get('a', 8, () => a.transport)
    const second = registry.get('a', 9, () => b.transport)
    const readA = first.hydrate()
    const readB = second.hydrate()
    a.reads[0].resolve(preference('all'))
    b.reads[0].resolve(preference('all', 'saved', 9))
    await Promise.all([readA, readB])
    first.select('off')
    second.select('written')
    b.writes[0].result.resolve(preference('written', 'saved', 9))
    a.writes[0].result.resolve(preference('off'))
    await settle()
    expect(first.getSnapshot().mode).toBe('off')
    expect(second.getSnapshot().mode).toBe('written')
  })
})
