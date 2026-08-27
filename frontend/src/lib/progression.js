// Automatic progression (issue #17).
//
// Everything here is a pure function of the workout history. Nothing writes back into a
// finished workout: the log is what happened, and the next prescription is *derived* from
// it every time it is needed. That means changing a policy — or fixing a mistyped set —
// immediately produces the right next target, with no stored counters to drift out of sync.
//
// It replaces a single hard-coded rule ("all reps done → add 2.5") with a small set of named
// policies. The rule that applies is always visible in the app, together with the reason it
// picked this weight, because a suggestion you can't audit is one you stop trusting.
//
// Reading a session honestly is the whole game:
//   · a set checked off with at least its target reps  → hit
//   · a set checked off with fewer reps                → miss (you logged what you got)
//   · a set never checked off                          → miss (it was not performed)
//   · fewer sets than prescribed                       → miss
// So a session that fell apart can never advance the load as though it had succeeded.

import { modeOf } from './history.js'
import { EXIDX } from './exercises.js'
import { best1RM } from './onerm.js'

export const POLICIES = ['off', 'linear', 'greyskull', 'double', '531', 'time']

// Which policies can sensibly drive which logging mode.
export const POLICIES_FOR = {
  reps: ['off', 'linear', 'greyskull', 'double', '531'],
  time: ['off', 'time'],
  cardio: ['off']
}

export const POLICY_NAME = {
  off: 'No automatic progression',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  '531': '5/3/1',
  time: 'Add time'
}
export const POLICY_DESC = {
  off: 'Targets stay where you set them.',
  linear: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
  greyskull: 'Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up — double if you double the reps. One failure resets 10 %.',
  double: 'Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.',
  '531': 'A four-week cycle of percentages off a training max, ending in a deload. The last work set of the first three weeks is taken for as many reps as you have, and the training max goes up once the cycle is done.',
  time: 'Hold every set for the full duration and the target goes up.'
}

// Sessions of repeated misses before a deload. Greyskull resets on the first failure by
// design; the general linear policy gives you two more cracks at it first.
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, time: 3 }
const DELOAD_FACTOR = 0.9

// Body parts where a 5 kg jump is normal rather than brutal.
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes']

// Default load step. Lower-body lifts take the bigger jump — that is the "lift-specific
// increment" a linear program lives on; an exercise can override it with cfg.inc.
export function defaultIncrement(exId, unit) {
  const ex = EXIDX[exId]
  const heavy = ex && HEAVY_BP.includes(ex.bp)
  if (unit === 'lb') return heavy ? 10 : 5
  return heavy ? 5 : 2.5
}
export const DEFAULT_SEC_INCREMENT = 5

// The policy in force for one exercise: its own override, else the routine's default, else
// the mode's default. Reps keeps behaving the way the app always did (all reps → add a step).
export function policyFor(cfg, routine, mode) {
  const m = mode || modeOf(cfg || {})
  const allowed = POLICIES_FOR[m] || ['off']
  const pick = (cfg && cfg.prog) || (routine && routine.prog) || (m === 'reps' ? 'linear' : 'off')
  return allowed.includes(pick) ? pick : 'off'
}

const round1 = v => Math.round(v * 10) / 10
// Snap to a loadable multiple of the step.
function snap(v, step) {
  if (!(step > 0)) return round1(v)
  return round1(Math.round(v / step) * step)
}
// Back off by DELOAD_FACTOR, landing on something you can actually load. Rounding to the
// nearest step keeps the cut close to the intended 10 %, but on small weights the nearest
// step can be the weight you started from — so a deload that did not actually reduce
// anything takes one step down instead. Never goes below a single step.
function deloadTo(cur, step) {
  let next = snap(cur * DELOAD_FACTOR, step)
  if (next >= cur) next = snap(cur - step, step)
  return Math.max(step, next)
}

/**
 * Reduce one finished workout entry to what a policy needs to judge it.
 *
 * Workouts only started recording their prescription in v1.2.2, so most existing history has
 * no `target` at all. Judging those against nothing would score every past session as a miss
 * — and then greet a long-standing user with "missed reps 11 sessions running, deload". So an
 * entry without its own target is judged against `fallback`, the exercise's current plan,
 * which is exactly what the app's old weight hint compared against.
 */
export function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {}
  const mode = modeOf({ ...target, id: entry && entry.id })
  const sets = (entry && entry.sets) || []
  const planned = target.sets || sets.length
  const enough = sets.length >= planned

  if (mode === 'time') {
    const goal = target.sec || 0
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0))
    return {
      mode, goal, held,
      weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
      best: Math.max(0, ...held),
      ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal)
    }
  }
  const goal = target.reps || 0
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0))
  return {
    mode, goal, reps,
    weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
    low: reps.length ? Math.min(...reps) : 0,
    amrap: reps.length ? reps[reps.length - 1] : 0,       // Greyskull's final set
    ok: goal > 0 && enough && reps.length > 0 && reps.every(r => r >= goal)
  }
}

/** Every past session for one exercise, oldest first. `fallback` — see readSession. */
export function sessionsFor(S, exId, fallback) {
  const out = []
  ;(S.workouts || []).forEach(w => {
    const entry = w.entries.find(e => e.id === exId)
    if (entry && entry.sets.some(s => s.done)) out.push({ d: w.d, ...readSession(entry, fallback) })
  })
  return out
}

// How many sessions in a row ended in a miss, counting back from the most recent.
export function stallCount(sessions) {
  let n = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].ok) break
    n++
  }
  return n
}

/* ============================== 5/3/1 ==============================
 *
 * The first policy here that does not compute one number for the whole exercise. 5/3/1 is a
 * four-week table of percentages, three work sets a session, each at a different load and a
 * different rep target - so it prescribes per set, and applyPrescription had to learn to
 * apply per set with it.
 *
 * Two things about it are non-negotiable and both are easy to get wrong:
 *
 *   · Percentages are of a TRAINING MAX, not of a real one-rep max. The training max is about
 *     90% of what you could actually lift, and the whole programme works because it is
 *     deliberately conservative. Running the percentages off a true max turns week three into
 *     a max attempt.
 *   · The last work set of the first three weeks is an AMRAP - "5+", "3+", "1+". Taking it for
 *     exactly the prescribed reps is not the programme; the extra reps are where the progress
 *     is measured.
 *
 * Everything below stays a pure function of history, like the rest of this file: the week you
 * are in is derived by counting logged sessions, never stored, so fixing a mistyped session
 * moves the cycle rather than leaving a counter behind that disagrees with the log.
 */

// week -> [ [percentage of training max, rep target, is it an AMRAP] ... ]
export const CYCLE_531 = [
  { key: '5s',     sets: [[0.65, 5, false], [0.75, 5, false], [0.85, 5, true]] },
  { key: '3s',     sets: [[0.70, 3, false], [0.80, 3, false], [0.90, 3, true]] },
  { key: '531',    sets: [[0.75, 5, false], [0.85, 3, false], [0.95, 1, true]] },
  { key: 'deload', sets: [[0.40, 5, false], [0.50, 5, false], [0.60, 5, false]] }
]
export const WEEKS_531 = CYCLE_531.length

// Work weights round DOWN to something loadable. Rounding a percentage up quietly makes the
// week heavier than the programme asked for, which is the one direction 5/3/1 never goes.
const floorSnap = (v, step) => (step > 0 ? Math.max(step, round1(Math.floor(v / step) * step)) : round1(v))

/**
 * Where the training max starts. An explicitly configured one always wins; otherwise it is
 * derived at the documented 90% of the best estimated 1RM this exercise has on record, so
 * switching an exercise to 5/3/1 does something sensible without a setup form first.
 */
export function baseTrainingMax(S, cfg) {
  if (cfg && cfg.tm > 0) return cfg.tm
  // best1RM answers with the set the estimate came from, not a bare number - "142.5 from
  // 100x10" is a different claim from "142.5 from 140x1", and the caller usually wants both.
  const best = best1RM(S, cfg.id)
  return best && best.est > 0 ? round1(best.est * 0.9) : 0
}

/** Sessions counted toward the cycle: reps work logged since the training max was set. */
function sessions531(S, cfg) {
  const from = (cfg && cfg.tmFrom) || ''
  return sessionsFor(S, cfg.id, cfg).filter(s => s.mode === 'reps' && (!from || s.d >= from)).length
}

/** Which week of the cycle the next session is, 0-indexed. */
export function cycleWeek(S, cfg) { return sessions531(S, cfg) % WEEKS_531 }

/** The training max in force now: the base, plus one increment per cycle already completed. */
export function trainingMax(S, cfg, inc) {
  const base = baseTrainingMax(S, cfg)
  if (!(base > 0)) return 0
  const step = inc > 0 ? inc : defaultIncrement(cfg.id, 'kg')
  return snap(base + Math.floor(sessions531(S, cfg) / WEEKS_531) * step, step)
}

function prescribe531(S, cfg, inc, unit) {
  const tm = trainingMax(S, cfg, inc)
  if (!(tm > 0)) {
    return { policy: '531', kind: 'hold', why: ['5/3/1 works off a training max — log a set of this lift, or set one in the exercise settings.'] }
  }
  const week = cycleWeek(S, cfg)
  const w = CYCLE_531[week]
  const perSet = w.sets.map(([pct, reps, amrap]) => ({ w: floorSnap(tm * pct, inc), r: reps, amrap }))
  const top = perSet[perSet.length - 1]
  const cycle = Math.floor(sessions531(S, cfg) / WEEKS_531) + 1

  if (w.key === 'deload') {
    return {
      policy: '531', kind: 'deload', week, cycle, tm, perSet,
      why: ['Deload week — cycle {0} done, so next time the training max goes up to {1} {2}.', cycle, snap(tm + inc, inc), unit]
    }
  }
  return {
    policy: '531', kind: '531', week, cycle, tm, perSet,
    why: ['Week {0} of cycle {1} off a {2} {3} training max — last set is {4}+, so take every rep you have.',
      week + 1, cycle, tm, unit, top.r]
  }
}

/**
 * The next prescription for one exercise.
 *
 * Returns `{ weight, reps, sec, why, kind }` — `kind` being one of
 * first | up | hold | deload | off, and `why` a translatable template + args so the app can
 * always answer "why this number?". A field the policy has no opinion on comes back
 * undefined and the caller keeps whatever the plan said.
 */
export function nextPrescription(S, cfg, routine) {
  const mode = modeOf(cfg)
  const policy = policyFor(cfg, routine, mode)
  const unit = S.unit || 'kg'
  const inc = cfg.inc > 0 ? cfg.inc : (mode === 'time' ? DEFAULT_SEC_INCREMENT : defaultIncrement(cfg.id, unit))
  if (policy === 'off') return { policy, kind: 'off' }
  // Ahead of everything below: 5/3/1 reads a table, not the last session, so it works from
  // the very first workout rather than needing history to get started.
  if (policy === '531') return prescribe531(S, cfg, inc, unit)

  const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === mode)
  const last = sessions[sessions.length - 1]
  if (!last) return { policy, kind: 'first', why: ['Nothing logged yet — this session sets the baseline.'] }

  const stalls = stallCount(sessions)
  const deloadAt = DELOAD_AFTER[policy] || 3

  if (mode === 'time') {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + inc
      return { policy, kind: 'up', sec, why: ['Held every set for the full time — target up by {0}s.', inc] }
    }
    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5)
      return { policy, kind: 'deload', sec, why: ['Short {0} sessions in a row — back off to {1}s and build up again.', stalls, sec] }
    }
    return { policy, kind: 'hold', sec: last.goal || cfg.sec, why: ['Last time came up short — same target again.'] }
  }

  const w = last.weight
  // Bodyweight work carries no external load, so there is nothing to add or take away —
  // "deload your push-ups to 2.5 kg" is not advice. Progress in reps instead. This runs
  // ahead of the individual policies because it is true for all of them; a rep range set on
  // top of it simply gets passed once you exceed it, which is the right moment to add load
  // or move to a harder variation anyway.
  if (w <= 0) {
    const goal = last.goal || cfg.reps || 0
    if (last.ok && goal > 0) return { policy, kind: 'up', weight: 0, reps: goal + 1, why: ['Bodyweight — every rep last time, so go for {0} this time.', goal + 1] }
    return { policy, kind: 'hold', weight: 0, reps: goal || undefined, why: ['Bodyweight — same target again until every set is clean.'] }
  }
  if (policy === 'double') {
    const top = cfg.reps || last.goal || 10
    const bottom = Math.min(cfg.repsMin || Math.max(1, top - 2), top)
    if (last.ok) return { policy, kind: 'up', weight: snap(w + inc, inc), reps: bottom, why: ['Top of the rep range in every set — {0} {1} more, back to {2} reps.', inc, unit, bottom] }
    if (stalls >= deloadAt) {
      const dw = deloadTo(w, inc)
      return { policy, kind: 'deload', weight: dw, reps: bottom, why: ['Stalled {0} sessions — deload to {1} {2}.', stalls, dw, unit] }
    }
    const aim = Math.min(top, Math.max(bottom, last.low + 1))
    return { policy, kind: 'hold', weight: w, reps: aim, why: ['Same weight — aim for {0} reps this time.', aim] }
  }

  // linear + greyskull
  if (last.ok) {
    // Greyskull's final set is taken to failure: double the target reps there and you have
    // earned a double jump.
    const dbl = policy === 'greyskull' && last.goal > 0 && last.amrap >= last.goal * 2
    const step = dbl ? inc * 2 : inc
    return {
      policy, kind: 'up', weight: snap(w + step, inc),
      why: dbl
        ? ['Last set hit {0} reps — twice the target, so take a double jump of {1} {2}.', last.amrap, step, unit]
        : ['Every rep last time — {0} {1} more.', step, unit]
    }
  }
  if (stalls >= deloadAt) {
    const dw = deloadTo(w, inc)
    return {
      policy, kind: 'deload', weight: dw,
      why: stalls > 1
        ? ['Missed reps {0} sessions running — reset to {1} {2} and work back up.', stalls, dw, unit]
        : ['Missed reps — reset to {0} {1} and work back up.', dw, unit]
    }
  }
  return { policy, kind: 'hold', weight: w, why: ['Missed reps last time — same weight again ({0} of {1} to go).', deloadAt - stalls, deloadAt] }
}

/**
 * What this session actually asked for: the routine's configuration, with whatever the policy
 * decided this time laid over it. This is the number the app put in the row before anyone
 * touched it, which is what makes it the target rather than just "the current value".
 */
export function targetOf(entry) {
  const cfg = (entry && entry.target) || {}
  const plan = (entry && entry.plan) || {}
  // A per-set policy defines the shape of the session, so it also defines how many sets there
  // are meant to be — the routine's own `sets` is what the lifter configured, not what 5/3/1
  // asked for.
  const perSet = Array.isArray(plan.perSet) ? plan.perSet : null
  return {
    perSet,
    week: plan.week,
    cycle: plan.cycle,
    tm: plan.tm,
    sets: perSet ? perSet.length : (cfg.sets || (entry && entry.sets ? entry.sets.length : 0)),
    reps: plan.reps != null ? plan.reps : cfg.reps,
    weight: plan.weight != null ? plan.weight : cfg.weight,
    sec: plan.sec != null ? plan.sec : cfg.sec,
    min: cfg.min,
    speed: cfg.speed
  }
}

/**
 * Did one logged set meet what was asked of it?
 *
 * This is the same reading the policies above use, pulled out so the UI can show a target
 * being met by exactly the rule that decides whether the weight goes up. Two copies of
 * "what counts as a hit" is how the screen and the engine end up disagreeing in front of
 * someone holding a barbell.
 *
 * Returns null for a set that was never checked off: that is not a miss, it is unanswered.
 */
export function setMeetsTarget(set, goal, mode = 'reps') {
  if (!set || !set.done) return null
  if (!(goal > 0)) return true                  // nothing was asked, so nothing was missed
  const got = mode === 'time' ? set.sec : set.r
  return (got || 0) >= goal
}

/**
 * How a whole exercise stands against its target, for the one readout that says so:
 *   'pending' - nothing logged yet
 *   'partial' - everything logged so far landed, but there is more to do
 *   'hit'     - every prescribed set is logged and every one of them landed
 *   'miss'    - at least one logged set came up short
 * A miss is sticky. Falling short on set two is not undone by set three going well, and the
 * readout should not pretend otherwise.
 */
export function targetState(sets, goal, mode = 'reps', prescribed = 0) {
  // `goal` may be one number for the whole exercise, or one per set when the policy
  // prescribes per set. Past the end of a per-set table the last entry carries on, matching
  // what applyPrescription does with extra sets.
  const goalAt = i => (Array.isArray(goal) ? (goal[i] != null ? goal[i] : goal[goal.length - 1]) : goal)
  const answers = (sets || []).map((s, i) => setMeetsTarget(s, goalAt(i), mode));
  if (answers.some(a => a === false)) return 'miss'
  const landed = answers.filter(a => a === true).length
  if (!landed) return 'pending'
  return landed >= Math.max(prescribed, (sets || []).length) ? 'hit' : 'partial'
}

/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet.
 */
export function applyPrescription(sets, p) {
  if (!p || p.kind === 'off' || p.kind === 'first') return sets
  let base = sets
  if (Array.isArray(p.perSet) && sets.length < p.perSet.length) {
    base = sets.slice()
    while (base.length < p.perSet.length) base.push({ w: 0, r: 0, done: false })
  }
  return base.map((s, i) => {
    if (s.done) return s
    const out = { ...s }
    // A policy that prescribes per set (5/3/1) wins for the sets it covers; anything past the
    // end of its table keeps whatever the plan said, so adding a fourth set to a 5/3/1 day
    // gives you a back-off set rather than an error.
    const per = Array.isArray(p.perSet) ? p.perSet[i] : null
    if (per) {
      if (per.w != null) out.w = per.w
      if (per.r != null) out.r = per.r
      return out
    }
    if (p.weight != null) out.w = p.weight
    if (p.reps != null) out.r = p.reps
    if (p.sec != null) out.sec = p.sec
    return out
  })
}
