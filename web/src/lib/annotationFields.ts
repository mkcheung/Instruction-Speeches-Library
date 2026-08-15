interface ComparableAnnotationFields {
  body: string
  start_seconds: number | null
  duration_seconds: number
  kind: string
  topic: string | null
}

/** The one "have the editable fields actually changed" check, shared by
 * `useAnnotationEditor` (clean-vs-dirty for the conflict/silent-adopt
 * decision) and `AnnotationComposerPanel` (whether a live override still
 * differs from its server row). Kept in one place so a future field
 * addition can't update one comparator and silently miss the other. */
export function annotationFieldsEqual(a: ComparableAnnotationFields, b: ComparableAnnotationFields): boolean {
  return (
    a.body === b.body &&
    a.start_seconds === b.start_seconds &&
    a.duration_seconds === b.duration_seconds &&
    a.kind === b.kind &&
    a.topic === b.topic
  )
}
