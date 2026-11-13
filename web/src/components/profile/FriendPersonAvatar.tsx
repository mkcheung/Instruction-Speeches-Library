import { useState, type ImgHTMLAttributes, type ReactNode } from 'react'
import { UserRound } from 'lucide-react'

type PhotoProps = { src: string | null; fallback: ReactNode } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'>

/** A person's photo, or `fallback` when there is no URL or it fails to load. Failed signed URLs are
 * remembered only for that URL: a new URL remounts and gets a fresh image. */
export function PhotoOrFallback(props: PhotoProps) {
  return <Photo key={props.src} {...props} />
}

function Photo({ src, fallback, ...image }: PhotoProps) {
  const [failed, setFailed] = useState(false)
  return src && !failed ? <img alt="" {...image} src={src} onError={() => setFailed(true)} /> : fallback
}

export function FriendPersonAvatar({ src }: { src: string | null }) {
  return (
    <span className="friend-person-avatar" aria-hidden="true">
      <PhotoOrFallback src={src} width={72} height={72} loading="lazy" fallback={<UserRound aria-hidden="true" size={28} />} />
    </span>
  )
}
