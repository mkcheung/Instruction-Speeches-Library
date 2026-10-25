import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FriendPersonAvatar } from './FriendPersonAvatar'
import { useAcceptConnectionMutation, useDeclineConnectionMutation, useSendConnectionRequestMutation } from '@/features/connection/connectionApi'
import { connectionErrorMessage } from '@/features/connection/connectionSession'
import type { Friend, FriendCandidate } from '@/features/connection/types'
import { getErrorStatus } from '@/lib/errorStatus'

type Props = { disabled?: boolean; onComplete?: (personId: number, message: string) => void; onUnavailable?: (message: string) => void } & (
  | { mode: 'accepted' | 'incoming'; person: Friend }
  | { mode: 'find'; person: FriendCandidate }
)

export function FriendPersonCard(props: Props) {
  const { person: entry, mode, disabled, onComplete, onUnavailable } = props
  const { person, mutual_friends_count: mutualCount } = entry
  const [accept, accepting] = useAcceptConnectionMutation()
  const [decline, declining] = useDeclineConnectionMutation()
  const [send, sending] = useSendConnectionRequestMutation()
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(false)
  const busy = accepting.isLoading || declining.isLoading || sending.isLoading
  async function act(action: 'accept' | 'decline' | 'send') {
    if (disabled || busy || completed) return
    setError('')
    try {
      const result = action === 'send'
        ? await send({ user_id: person.id }).unwrap()
        : action === 'accept'
          ? await accept((entry as Friend).connection_id).unwrap()
          : await decline((entry as Friend).connection_id).unwrap()
      setCompleted(true)
      const message = action === 'decline' ? `Request from ${person.name} declined.`
        : result.state === 'accepted' ? `You are now connected with ${person.name}.`
          : `Request sent to ${person.name}.`
      onComplete?.(person.id, message)
    } catch (failure) {
      const message = connectionErrorMessage(failure)
      setError(message)
      if ([403, 404, 409, 422].includes(Number(getErrorStatus(failure)))) onUnavailable?.(message)
    }
  }
  const identity = <><FriendPersonAvatar src={person.avatar_url} /><span className="friend-person-name">{person.name}</span></>
  return (
    <li className="friend-person-card" aria-busy={busy}>
      {mode === 'accepted' ? <Link className="friend-person-identity" to={`/u/${encodeURIComponent((entry as Friend).person.username)}`}>{identity}</Link>
        : <div className="friend-person-identity">{identity}</div>}
      <p>{mutualCount} mutual {mutualCount === 1 ? 'friend' : 'friends'}</p>
      {mode === 'incoming' && (entry as Friend).note && <p className="friend-person-note">{(entry as Friend).note}</p>}
      {mode !== 'accepted' && <div className="friend-person-actions">
        {mode === 'incoming' ? <>
          <button type="button" disabled={disabled || busy || completed} onClick={() => void act('accept')}>{accepting.isLoading ? 'Accepting…' : 'Accept'}</button>
          <button type="button" className="friends-secondary" disabled={disabled || busy || completed} onClick={() => void act('decline')}>{declining.isLoading ? 'Declining…' : 'Decline'}</button>
        </> : <button type="button" disabled={disabled || busy || completed} onClick={() => void act('send')}>{sending.isLoading ? 'Sending…' : completed ? 'Request sent' : 'Send request'}</button>}
      </div>}
      {error && <p role="alert" className="friends-error">{error}</p>}
    </li>
  )
}
