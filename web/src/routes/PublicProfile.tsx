import { useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { useGetPublicProfileQuery } from '@/features/profile/profileApi'
import NotFound from '@/routes/NotFound'

/**
 * `/u/{username}` — identity only, per §12 S1's "deliberately stubbed":
 * avatar, name, bio. No timeline, no connections rail until later steps.
 */
export default function PublicProfile() {
  const { username } = useParams<{ username: string }>()
  const { data: profile, isLoading, isError } = useGetPublicProfileQuery(username ?? '', {
    skip: !username,
  })

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (isError || !profile) {
    return <NotFound />
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md items-center px-4">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="size-28 rounded-full object-cover ring-1 ring-foreground/10"
            />
          ) : (
            <div className="size-28 rounded-full bg-muted" aria-hidden="true" />
          )}
          <div>
            <h1 className="text-lg font-medium">{profile.display_name || `@${profile.username}`}</h1>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
          </div>
          {profile.bio && <p className="text-sm">{profile.bio}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
