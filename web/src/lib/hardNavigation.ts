/**
 * Hard (new-document) navigation. Identity changes must leave the old
 * document, with its Redux store and in-flight promises, behind (R1, plan
 * §8.1). Wrapped so call sites read as intent and tests can observe them.
 */
export const hardNavigation = {
  /** Replaces the current history entry; Back does not return to the old document. */
  replace(url: string): void {
    window.location.replace(url)
  },
  /** Adds a history entry (explicit logout). */
  assign(url: string): void {
    window.location.assign(url)
  },
}
