import { Fragment, createElement, lazy } from 'react'
import type * as Art from './art'

/**
 * The landing art is about 50KB of inline SVG, so it loads as ONE lazy
 * chunk instead of riding in the main bundle (`Home` is imported eagerly by
 * `App.tsx`). Signed-in visitors never download it: `Home` redirects them
 * before `Landing` renders. Every part below shares one `import('./art')`
 * promise, so the bundler emits a single chunk and it's requested once.
 *
 * Each part renders inside a frame `Landing` owns, and that frame is the
 * `<Suspense>` fallback, so nothing shifts when the art arrives.
 */
type ArtParts = Pick<
  typeof Art,
  'SceneDefs' | 'StageLip' | 'RehearsalScene' | 'FullHouseScene' | 'NoteAvatar'
>

function NoArt() {
  return createElement(Fragment)
}

/**
 * Nothing above `/` catches render errors (it sits outside `AppLayout`'s
 * `RouteErrorBoundary`), so a rejected chunk (a flaky connection, or a
 * deploy that replaced the hashed file) would swap the whole landing page
 * for the router's error screen. The art is decoration: on failure the
 * frames stay empty and the copy and buttons still work.
 */
const ART_UNAVAILABLE: ArtParts = {
  SceneDefs: NoArt,
  StageLip: NoArt,
  RehearsalScene: NoArt,
  FullHouseScene: NoArt,
  NoteAvatar: NoArt,
}

/**
 * Memoized, not just left to the module cache: React renders all five
 * parts in one pass, so five imports would start in the same tick. Browsers
 * collapse those into one module, but Vitest's mocker hands the mock only
 * to the first of several concurrent dynamic imports and the real module to
 * the rest, so `Landing.test.tsx` would silently test the real art.
 */
let artChunk: Promise<ArtParts> | undefined

const loadArt = (): Promise<ArtParts> =>
  (artChunk ??= import('./art').catch((error: unknown) => {
    console.error('Landing art failed to load; showing the page without it.', error)
    return ART_UNAVAILABLE
  }))

export const SceneDefs = lazy(() => loadArt().then((m) => ({ default: m.SceneDefs })))
export const StageLip = lazy(() => loadArt().then((m) => ({ default: m.StageLip })))
export const RehearsalScene = lazy(() => loadArt().then((m) => ({ default: m.RehearsalScene })))
export const FullHouseScene = lazy(() => loadArt().then((m) => ({ default: m.FullHouseScene })))
export const NoteAvatar = lazy(() => loadArt().then((m) => ({ default: m.NoteAvatar })))
