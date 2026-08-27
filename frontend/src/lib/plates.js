// What to actually put on the bar.
//
// Every weight in this app is a total, because that is what a lifter records and what the
// progression engine reasons about. Standing in front of a rack, though, the useful number is
// a different one: which discs go on each side. Doing that arithmetic at rep eight of five
// sets is exactly when people get it wrong, and a 2.5 kg mistake is invisible in the log.
//
// Pure functions, no state, no rounding opinions beyond the ones a barbell forces on you.

/** Standard bar, by unit. An Olympic bar is 20 kg; the same bar is sold as 45 lb. */
export const DEFAULT_BAR = { kg: 20, lb: 45 }

/**
 * The discs a normal gym has, heaviest first. These are the plates, not the pairs - the
 * breakdown below always loads them symmetrically, because a barbell loaded any other way is
 * a different problem.
 */
export const PLATES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5]
}

const round2 = v => Math.round(v * 100) / 100
// Every denomination is a whole number of grams, so the search runs in grams. Rounding each
// intermediate remainder to two decimals instead put 40.625 kg per side at 40.63 and reported
// a 101.25 kg bar as "99.99 loaded, 1.26 left over" - two numbers with no physical meaning.
const GRAMS = 1000
const grams = v => Math.round(v * GRAMS)

/**
 * Break a total down into what goes on each side.
 *
 * Greedy from the heaviest disc, which is both what a person does and provably optimal for
 * these denominations. Returns what it could load and what it could not: `leftover` is the
 * remainder that no combination of available discs can make, doubled back into a total
 * weight, so the caller can say "closest is 62.5" rather than silently lying by 1.25.
 */
export function plateBreakdown(total, { unit = 'kg', bar = DEFAULT_BAR[unit], plates = PLATES[unit] } = {}) {
  const target = Number(total) || 0
  if (target < bar) return { bar, ok: false, reason: 'below-bar', perSide: [], loaded: bar, leftover: round2(bar - target) }
  let side = Math.round((target - bar) * GRAMS / 2)
  const perSide = []
  for (const p of plates) {
    const disc = grams(p)
    let n = 0
    while (side - disc >= 0) { side -= disc; n++ }
    if (n) perSide.push({ plate: p, count: n })
  }
  const leftover = round2(side * 2 / GRAMS)
  return { bar, ok: side === 0, perSide, loaded: round2(target - leftover), leftover }
}

/** "25 + 20 + 2.5" — the side of the bar, read left to right the way you load it. */
export function perSideLabel(breakdown) {
  if (!breakdown.perSide.length) return ''
  return breakdown.perSide
    .flatMap(({ plate, count }) => Array.from({ length: count }, () => plate))
    .join(' + ')
}

/** Total number of discs to fetch, both sides. Handy for "is this worth the walk". */
export const plateCount = breakdown => breakdown.perSide.reduce((n, p) => n + p.count, 0) * 2