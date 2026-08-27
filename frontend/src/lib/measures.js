// Body measurements, alongside body weight.
//
// Weight is one number and it lies regularly: a month of good training can hold it flat while
// the tape says the waist went down and the arms went up. This is the same idea as the body
// weight log - a sparse, dated series you can chart - applied to the places people actually
// measure.
//
// Entries are `{ d, k, v }`: date, site key, value. Sparse on purpose. Nobody measures nine
// sites every week, and a shape that demands all of them turns one honest number into eight
// blanks or, worse, eight copies of last month's.

/** The sites, in the order a tape measure goes down a body. */
export const SITES = [
  { k: 'neck',      name: 'Neck' },
  { k: 'shoulders', name: 'Shoulders' },
  { k: 'chest',     name: 'Chest' },
  { k: 'arm',       name: 'Arm' },
  { k: 'forearm',   name: 'Forearm' },
  { k: 'waist',     name: 'Waist' },
  { k: 'hips',      name: 'Hips' },
  { k: 'thigh',     name: 'Thigh' },
  { k: 'calf',      name: 'Calf' }
]
export const SITE_KEYS = SITES.map(s => s.k)
export const siteName = k => (SITES.find(s => s.k === k) || {}).name || k

/**
 * Length unit, taken from the weight unit rather than asked for separately. Someone logging
 * kilos measures in centimetres and someone logging pounds measures in inches; a second
 * setting to say so would be a question with one plausible answer.
 */
export const lengthUnit = weightUnit => (weightUnit === 'lb' ? 'in' : 'cm')

const stamp = e => e.t || new Date(e.d + 'T12:00:00').getTime()

/** Every entry for one site, oldest first. */
export function seriesFor(S, k) {
  return (S.measures || [])
    .filter(m => m.k === k && m.v > 0)
    .slice()
    .sort((a, b) => stamp(a) - stamp(b))
}

/** The most recent entry for a site, or null. */
export function latest(S, k) {
  const s = seriesFor(S, k)
  return s.length ? s[s.length - 1] : null
}

/**
 * Change since the previous entry for a site. Null when there is nothing to compare against -
 * a first measurement has no trend, and showing it as +0 invents one.
 */
export function delta(S, k) {
  const s = seriesFor(S, k)
  if (s.length < 2) return null
  return Math.round((s[s.length - 1].v - s[s.length - 2].v) * 10) / 10
}

/** Sites that have ever been measured, in tape order. */
export const measuredSites = S => SITE_KEYS.filter(k => seriesFor(S, k).length > 0)

/**
 * Record one measurement, replacing any entry for the same site on the same day. Re-measuring
 * because the first read looked wrong should correct the day, not add a second point to it.
 */
export function putMeasure(S, k, v, d) {
  const value = Math.round((Number(v) || 0) * 10) / 10
  S.measures = (S.measures || []).filter(m => !(m.k === k && m.d === d))
  if (value > 0) S.measures.push({ d, k, v: value, t: Date.now() })
  return S.measures
}

/** Chart points for one site, in the shape LineChart takes. */
export const chartPoints = (S, k) => seriesFor(S, k).map(m => ({ t: stamp(m), y: m.v, d: m.d }))