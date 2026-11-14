/** Identical accessible names get a ", N of M with this name" suffix. */
export function dedupeNames(names: readonly string[]): string[] {
  const totals = new Map<string, number>(); names.forEach((n) => totals.set(n, (totals.get(n) ?? 0) + 1))
  const seen = new Map<string, number>()
  return names.map((n) => {
    const total = totals.get(n) ?? 1
    if (total < 2) return n
    const i = (seen.get(n) ?? 0) + 1; seen.set(n, i)
    return `${n}, ${i} of ${total} with this name`
  })
}
