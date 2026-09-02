import { useOutletContext } from 'react-router-dom'
import { ProfileTimelineFeed } from '@/components/profile/ProfileTimelineFeed'
import type { PublicProfileOutletContext } from '@/routes/PublicProfile'

/** `/u/:username/reviews-left` — §6.7.3's "Reviews you left" tab: the
 * viewer's own commentary on the profile owner's speeches. */
export default function ProfileReviewsLeft() {
  const { profile } = useOutletContext<PublicProfileOutletContext>()
  const firstName = profile.display_name?.split(' ')[0] || profile.username

  return (
    <div className="flex flex-col gap-4">
      {/* §6.7.3: named for what it is, not "Timeline" — the empty state
       * then reads as accurate rather than broken. */}
      <h2 className="text-lg font-semibold">Your history with {firstName}</h2>
      <ProfileTimelineFeed key={profile.username} username={profile.username} tab="left" firstName={firstName} />
    </div>
  )
}
