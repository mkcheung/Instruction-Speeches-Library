import { useOutletContext } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import type { PublicProfileOutletContext } from '@/routes/PublicProfile'

/**
 * STEP-13-FROZEN-CONTRACT.md §9: the default `/u/:username` route content
 * — identity/bio only, the same content the pre-STEP-13 stub rendered,
 * now living in its own routed section instead of being the whole page.
 */
export default function ProfileAbout() {
  const { profile } = useOutletContext<PublicProfileOutletContext>()

  if (!profile.bio && !profile.pronouns && !profile.location) {
    return <p className="text-sm text-muted-foreground">No bio yet.</p>
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4 text-sm">
        {profile.bio && <p>{profile.bio}</p>}
        {profile.pronouns && (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Pronouns: </span>
            {profile.pronouns}
          </p>
        )}
        {profile.location && (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Location: </span>
            {profile.location}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
