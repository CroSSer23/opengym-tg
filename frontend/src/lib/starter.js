// The ready-made plans, for the "I just want to start training" path.
//
// Four now, where there was one. A starter plan is not a recommendation about what is best;
// it is a shape that is known to work and that someone can begin on this afternoon without
// having to design anything. Which is why each one names the days it wants and the rule it
// progresses under, rather than leaving both as an exercise for the reader.
//
// Every id below was resolved against the exercise library by exact name - an id that
// resolves to nothing renders as a blank row the first time it is trained, which is a
// miserable way to find out.
import { uid } from './format.js'

// [ id, sets, reps ]
const PPL = [
  ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['Pull Day', 'pullup',  [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['Leg Day',  'legs',    [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

const UPPER_LOWER = [
  ['Upper', 'arm',  [['0025', 4, 6], ['0027', 4, 6], ['1456', 3, 8], ['2330', 3, 10], ['0031', 3, 10], ['0201', 3, 12]]],
  ['Lower', 'legs', [['0043', 4, 6], ['0085', 3, 8], ['1463', 3, 10], ['0586', 3, 10], ['1372', 4, 12]]]
]

const FULL_BODY = [
  ['Full Body A', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['0027', 3, 8], ['1456', 3, 10], ['0472', 3, 12]]],
  ['Full Body B', 'figureStrength', [['0032', 3, 5], ['0047', 3, 8], ['2330', 3, 10], ['0336', 3, 10], ['0334', 3, 12]]]
]

// StrongLifts' A/B, which is where most people meet linear progression. The deadlift is one
// set of five on purpose: five sets of deadlifts is how a novice programme eats someone.
const FIVE_BY_FIVE = [
  ['Workout A', 'barbell', [['0043', 5, 5], ['0025', 5, 5], ['0027', 5, 5]]],
  ['Workout B', 'barbell', [['0043', 5, 5], ['1456', 5, 5], ['0032', 1, 5]]]
]

/**
 * The plans on offer.
 *
 * `week` maps weekday (0 = Sunday) to an index into `spec`, so a plan can repeat a routine
 * across the week - which upper/lower and 5x5 both do, and which is the reason this is a map
 * of indices rather than one routine per day.
 */
export const STARTER_PLANS = [
  {
    key: 'ppl',
    name: 'Push / Pull / Legs',
    days: 3,
    blurb: 'Three sessions, split by movement. The most common way to train three days a week, and the easiest to add a fourth day to later.',
    schedule: 'Mon Push · Wed Pull · Fri Legs',
    spec: PPL,
    week: { 1: 0, 3: 1, 5: 2 }
  },
  {
    key: 'upper-lower',
    name: 'Upper / Lower',
    days: 4,
    blurb: 'Four sessions across two routines, so every muscle gets trained twice a week. The standard answer once three days stops being enough.',
    schedule: 'Mon & Thu Upper · Tue & Fri Lower',
    spec: UPPER_LOWER,
    week: { 1: 0, 2: 1, 4: 0, 5: 1 }
  },
  {
    key: 'full-body',
    name: 'Full body',
    days: 3,
    blurb: 'Two alternating full-body sessions. The most training per hour in the gym, and the most forgiving of a week where you only make it twice.',
    schedule: 'Mon · Wed · Fri, alternating A and B',
    spec: FULL_BODY,
    week: { 1: 0, 3: 1, 5: 0 }
  },
  {
    key: '5x5',
    name: '5 × 5',
    days: 3,
    blurb: 'Five sets of five on the barbell lifts, alternating two workouts. Nothing here is optional and nothing here is fancy; it is the classic novice programme.',
    schedule: 'Mon · Wed · Fri, alternating A and B',
    spec: FIVE_BY_FIVE,
    week: { 1: 0, 3: 1, 5: 0 },
    prog: 'linear'
  }
]

/** Fresh routine objects (new ids) for one plan, in the order its `week` indexes them. */
export function planRoutines(plan) {
  return plan.spec.map(([name, emoji, list]) => ({
    id: uid(),
    name,
    emoji,
    ...(plan.prog ? { prog: plan.prog } : {}),
    ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 }))
  }))
}

/** The weekday -> routine-id map for a set of routines built from `plan`. */
export function planWeek(plan, routines) {
  const week = {}
  for (const [day, i] of Object.entries(plan.week)) week[day] = routines[i].id
  return week
}

// The original three-routine helper, kept because the demo build seeds a history on top of
// exactly these routines and has its own opinions about their order.
export const starterRoutines = () => planRoutines(STARTER_PLANS[0])