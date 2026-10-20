import { Suspense } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Act } from './Act'
import { ClosedRehearsalSign } from './ClosedRehearsalSign'
import { CurtainFrame } from './CurtainFrame'
import { LandingFooter } from './LandingFooter'
import { PlaybackTimeline } from './PlaybackTimeline'
import { TitleRibbon } from './TitleRibbon'
import { FullHouseScene, RehearsalScene, SceneDefs, StageLip } from './lazyArt'
import './landing.css'

/**
 * The two CTAs' shared shape: a 56px pill in Patrick Hand (inherited from
 * the page root). These go through `className`, so twMerge swaps out the
 * Button's own height, radius, border, font size and weight. `.land-cta`
 * adds the offset shadow, the hover lift and the 3px focus outline.
 */
const CTA_SHAPE = 'land-cta h-auto min-h-14 rounded-full border-3 px-9 text-2xl leading-none font-normal'

/**
 * The logged-out landing page (PLAN-LANDING-PAGE.md §4, "Curtain Up"): the
 * title, pitch and both buttons on the first screen, then three acts on a
 * stage framed by curtains.
 *
 * Copy contract (`Home.test.tsx` and `Landing.test.tsx`): the h1, the lede,
 * the privacy rule and the mechanism sentence are verbatim, the last two in
 * one element each, and there is exactly one Register link and one Log in
 * link. The art never repeats those phrases.
 *
 * Every piece of art is lazy (`./lazyArt`) and sits inside a frame this
 * page owns. The empty frame is the loading state, so the copy and buttons
 * render immediately and the layout doesn't move when the art lands.
 */
export function Landing() {
  return (
    <CurtainFrame>
      {/* Shared symbols and filters for every scene below; rendered once, before them. */}
      <Suspense fallback={null}>
        <SceneDefs />
      </Suspense>

      <main>
        <header className="land-header">
          <TitleRibbon />
          <p className="land-lede">
            Upload a video of yourself giving a speech. Invite the specific people whose feedback
            you actually want. They watch, and leave notes.
          </p>
          <div className="land-ctas">
            {/* `render={<Link/>}` is the codebase's button-as-link idiom.
                Deliberately not `nativeButton={false}`: that stamps
                `role="button"` on the anchor (see `Dashboard.tsx`). */}
            <Button
              render={<Link to="/register" />}
              className={`${CTA_SHAPE} border-[#2B211B] bg-[#0F6B66] text-white hover:bg-[#0F6B66] hover:text-white focus-visible:border-[#2B211B]`}
            >
              Register
            </Button>
            <Button
              variant="outline"
              render={<Link to="/login" />}
              className={`${CTA_SHAPE} border-[#0F6B66] bg-[#FFF5E6] text-[#0F6B66] hover:bg-[#FFF5E6] hover:text-[#0B4F4B] focus-visible:border-[#0F6B66]`}
            >
              Log in
            </Button>
          </div>
          <div className="land-stage-lip">
            <Suspense fallback={null}>
              <StageLip />
            </Suspense>
          </div>
        </header>

        <Act number="I" title="The empty house" className="land-act-one">
          <div className="land-rehearsal">
            <div className="land-scene land-scene-rehearsal">
              <Suspense fallback={null}>
                <RehearsalScene />
              </Suspense>
            </div>
            <ClosedRehearsalSign />
          </div>
        </Act>

        <Act number="II" title="How it plays" className="land-act-two">
          <p className="land-mechanism">
            Upload your speech, invite your reviewers, and as it plays back their notes fade in at the
            exact second they apply — and fade out again once the moment's passed — so feedback lines
            up with the part of the speech it's actually about.
          </p>
          <PlaybackTimeline />
        </Act>

        <Act number="III" title="Full house" className="land-act-three">
          <div className="land-scene land-scene-full-house">
            <Suspense fallback={null}>
              <FullHouseScene />
            </Suspense>
          </div>
          <p className="land-caption">Same speaker, a few rounds of notes later.</p>
        </Act>
      </main>

      <LandingFooter />
    </CurtainFrame>
  )
}
