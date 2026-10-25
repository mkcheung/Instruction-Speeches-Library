import { useState } from 'react'
import { UserRound } from 'lucide-react'

/** Failed signed URLs are remembered only for that URL. A new URL gets a fresh image. */
export function FriendPersonAvatar({ src }: { src: string | null }) {
  return <AvatarImage key={src} src={src} />
}

function AvatarImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="friend-person-avatar" aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" width={72} height={72} loading="lazy" onError={() => setFailed(true)} />
      ) : <UserRound aria-hidden="true" size={28} />}
    </span>
  )
}
