import { useOutletContext } from 'react-router-dom'
import { ProfileTimelineFeed } from '@/components/profile/ProfileTimelineFeed'
import type { PublicProfileOutletContext } from '@/routes/PublicProfile'

/** `/u/:username/reviews-received` — §6.7.3's "Reviews they left you" tab
 * (the mirror query: same shape, direction swapped, zero new grants). */
export default function ProfileReviewsReceived() {
  const { profile } = useOutletContext<PublicProfileOutletContext>()
  const firstName = profile.display_name?.split(' ')[0] || profile.username

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Your history with {firstName}</h2>
      <ProfileTimelineFeed key={profile.username} username={profile.username} tab="received" firstName={firstName} />
    </div>
  )
}
