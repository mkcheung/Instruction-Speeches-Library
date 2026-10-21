import { Fragment } from 'react'
import type { SearchTextPart } from '@/features/transcript/types'

/** Render server-provided text as text nodes, including HTML-looking strings. */
export function HighlightedText({ parts }: { parts: SearchTextPart[] }) {
  return parts.map((part, index) =>
    part.matched ? (
      <mark key={index} className="bg-yellow-200 text-gray-950 dark:bg-yellow-200 dark:text-gray-950">
        {part.text}
      </mark>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  )
}
