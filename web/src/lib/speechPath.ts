/** `/speeches/:id?review=<id>` asks the speech owner's watch page to open that review's commentary track. */
export const REVIEW_QUERY_PARAM = 'review'

/** Build a watch route, optionally naming the review whose track the owner should land on. */
export function speechPath(speechId: number, reviewId?: number): string {
  return reviewId === undefined ? `/speeches/${speechId}` : `/speeches/${speechId}?${REVIEW_QUERY_PARAM}=${reviewId}`
}

/** A requested review id from the query string, or null unless it is a plain positive safe integer. */
export function parseReviewQueryParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
