import { describe, it, expect } from 'vitest'
import {
  readSession, sessionsFor, stallCount, nextPrescription, applyPrescription,
  policyFor, defaultIncrement, POLICIES_FOR, DELOAD_AFTER
, targetOf, setMeetsTarget, targetState, trainingMax, cycleWeek, baseTrainingMax, CYCLE_531, WEEKS_531 } from './progression.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp)).id
const HEAVY = EXDB.find(e => e.bp === 'upper legs').id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id

// Build a state whose history is a list of sessions given as [weight, ...repsPerSet].
// A rep count of null means "the set was never checked off".
const hist = (id, rows, target) => ({
  unit: 'kg',
  workouts: rows.map((row, i) => ({
    d: '2026-01-0' + (i + 1),
    entries: [{
      id,
      target: target || { sets: 3, reps: 5, weight: row[0] },
      sets: row.slice(1).map(r => (r === null ? { w: row[0], r: 0, done: false } : { w: row[0], r, done: true }))
    }]
  }))
})

describe('readSession', () => {
  const T = { sets: 3, reps: 5 }
  it('counts a session where every set made its reps as a hit', () => {
    const s = readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 6, done: true }] })
    expect(s.ok).toBe(true)
    expect(s.weight).toBe(60)
    expect(s.amrap).toBe(6)
    expect(s.low).toBe(5)
  })

  it('counts short reps as a miss even when the set was checked off', () => {
    expect(readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 3, done: true }] }).ok).toBe(false)
  })

  it('counts an unchecked set as a miss — it was not performed', () => {
    const s = readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 0, done: false }] })
    expect(s.ok).toBe(false)
    expect(s.weight).toBe(60)       // the working weight is still known from the sets that counted
  })

  it('counts fewer sets than prescribed as a miss', () => {
    expect(readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }).ok).toBe(false)
  })

  it('refuses to call a session a hit when nothing was prescribed', () => {
    expect(readSession({ id: LIFT, target: {}, sets: [{ w: 60, r: 5, done: true }] }).ok).toBe(false)
  })

  it('reads a timed session by the hold, not by reps', () => {
    const s = readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [{ sec: 45, w: 0, done: true }, { sec: 50, w: 0, done: true }] })
    expect(s.mode).toBe('time')
    expect(s.ok).toBe(true)
    expect(s.best).toBe(50)
    expect(readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [{ sec: 45, done: true }, { sec: 30, done: true }] }).ok).toBe(false)
  })
})

describe('stallCount', () => {
  it('counts consecutive misses back from the most recent session', () => {
    expect(stallCount([{ ok: true }, { ok: true }])).toBe(0)
    expect(stallCount([{ ok: true }, { ok: false }])).toBe(1)
    expect(stallCount([{ ok: false }, { ok: false }, { ok: false }])).toBe(3)
    expect(stallCount([{ ok: false }, { ok: true }, { ok: false }])).toBe(1)
    expect(stallCount([])).toBe(0)
  })
})

describe('policyFor', () => {
  it('keeps the app\'s long-standing behaviour as the default for reps work', () => {
    expect(policyFor({ id: LIFT }, null, 'reps')).toBe('linear')
  })
  it('leaves timed and cardio work alone unless asked', () => {
    expect(policyFor({ id: LIFT, mode: 'time' }, null, 'time')).toBe('off')
    expect(policyFor({ id: CARDIO }, null, 'cardio')).toBe('off')
  })
  it('lets the exercise override the routine, and the routine override the default', () => {
    expect(policyFor({ id: LIFT }, { prog: 'greyskull' }, 'reps')).toBe('greyskull')
    expect(policyFor({ id: LIFT, prog: 'double' }, { prog: 'greyskull' }, 'reps')).toBe('double')
  })
  it('refuses a policy that makes no sense for the mode', () => {
    expect(policyFor({ id: LIFT, mode: 'time', prog: 'greyskull' }, null, 'time')).toBe('off')
    expect(policyFor({ id: CARDIO, prog: 'linear' }, null, 'cardio')).toBe('off')
    expect(POLICIES_FOR.cardio).toEqual(['off'])
  })
})

describe('defaultIncrement', () => {
  it('gives lower-body lifts the bigger jump', () => {
    expect(defaultIncrement(LIFT, 'kg')).toBe(2.5)
    expect(defaultIncrement(HEAVY, 'kg')).toBe(5)
  })
  it('scales to pounds', () => {
    expect(defaultIncrement(LIFT, 'lb')).toBe(5)
    expect(defaultIncrement(HEAVY, 'lb')).toBe(10)
  })
  it('falls back for an unknown exercise', () => {
    expect(defaultIncrement('nope', 'kg')).toBe(2.5)
  })
})

describe('linear progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('says nothing useful before there is any history', () => {
    const p = nextPrescription({ unit: 'kg', workouts: [] }, cfg)
    expect(p.kind).toBe('first')
    expect(p.weight).toBeUndefined()
  })

  it('adds the increment after a clean session', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('repeats the weight after a miss instead of advancing', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(60)
  })

  it('does not advance when the last set was left unchecked', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, null]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(60)
  })

  it('deloads after three misses in a row, onto a loadable weight', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [60, 5, 4, 4], [60, 5, 5, 4]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(55)             // 60 × 0.9 = 54 → nearest loadable 2.5 step
    expect(DELOAD_AFTER.linear).toBe(3)
  })

  it('a good session in between clears the stall', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [60, 5, 5, 5], [60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('hold')
  })

  it('never deloads below one increment, however light the lift already is', () => {
    const p = nextPrescription(hist(LIFT, [[2.5, 1, 1, 1], [2.5, 1, 1, 1], [2.5, 1, 1, 1]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(2.5)
  })

  it('always makes a deload actually lighter, even when rounding would not', () => {
    // 20 × 0.9 = 18 → nearest 2.5 step is 17.5, fine. 5 × 0.9 = 4.5 → nearest step is 5,
    // which is no deload at all, so it has to step down instead.
    const p = nextPrescription(hist(LIFT, [[5, 1, 1, 1], [5, 1, 1, 1], [5, 1, 1, 1]]), cfg)
    expect(p.weight).toBeLessThan(5)
  })

  it('uses the heavier step for a lower-body lift', () => {
    const p = nextPrescription(hist(HEAVY, [[100, 5, 5, 5]]), { id: HEAVY, sets: 3, reps: 5, prog: 'linear' })
    expect(p.weight).toBe(105)
  })

  it('honours a per-exercise increment override', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { ...cfg, inc: 1 })
    expect(p.weight).toBe(61)
  })

  it('works in pounds', () => {
    const S = { ...hist(LIFT, [[135, 5, 5, 5]]), unit: 'lb' }
    expect(nextPrescription(S, cfg).weight).toBe(140)
  })
})

describe('bodyweight exercises', () => {
  const cfg = { id: LIFT, sets: 3, reps: 10, weight: 0, prog: 'linear' }
  const bw = rows => hist(LIFT, rows, { sets: 3, reps: 10 })

  it('never invents a weight to deload to — there is nothing to take off a push-up', () => {
    const p = nextPrescription(bw([[0, 10, 10, 8], [0, 10, 10, 9], [0, 10, 10, 8]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(10)
  })

  it('progresses in reps instead of load after a clean session', () => {
    const p = nextPrescription(bw([[0, 10, 10, 10]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(11)
  })

  it('applies to every policy, not just linear', () => {
    for (const prog of ['linear', 'greyskull', 'double']) {
      const p = nextPrescription(bw([[0, 10, 10, 4], [0, 10, 10, 4], [0, 10, 10, 4]]), { ...cfg, prog })
      expect(p.weight, prog).toBe(0)
      expect(p.kind, prog).toBe('hold')
    }
  })

  it('still adds load the moment the exercise is actually weighted', () => {
    const p = nextPrescription(hist(LIFT, [[10, 10, 10, 10]], { sets: 3, reps: 10 }), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(12.5)
  })
})

describe('Greyskull LP', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }

  it('advances when the final set makes the target', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('takes a double jump when the last set doubles the target reps', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 10]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(65)
    expect(p.why[0]).toContain('double')
  })

  it('resets 10 % on the very first failure, unlike plain linear', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(55)
    expect(DELOAD_AFTER.greyskull).toBe(1)
  })

  it('keeps resetting from the reduced weight, not the original', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [55, 5, 5, 2]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(50)            // 55 × 0.9 = 49.5 → nearest loadable 2.5 step
  })
})

describe('double progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 40, prog: 'double' }

  it('adds weight and drops back to the bottom of the range at the top of it', () => {
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 12]], { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(42.5)
    expect(p.reps).toBe(8)
  })

  it('keeps the weight and asks for one more rep while inside the range', () => {
    const p = nextPrescription(hist(LIFT, [[40, 10, 9, 9]], { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(40)
    expect(p.reps).toBe(10)             // worst set was 9 → aim for 10
  })

  it('never asks for more than the top of the range', () => {
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 11]], { sets: 3, reps: 12 }), cfg)
    expect(p.reps).toBeLessThanOrEqual(12)
  })

  it('deloads after a run of stalls and restarts at the bottom of the range', () => {
    const rows = [[40, 9, 9, 9], [40, 9, 9, 9], [40, 9, 9, 9]]
    const p = nextPrescription(hist(LIFT, rows, { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('deload')
    expect(p.reps).toBe(8)
    expect(p.weight).toBe(35)           // 40 × 0.9 = 36 → nearest loadable 2.5 step
  })
})

describe('timed progression', () => {
  const cfg = { id: LIFT, mode: 'time', sets: 2, sec: 45, prog: 'time' }
  const T = { sets: 2, sec: 45, mode: 'time' }
  const timeHist = rows => ({
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: '2026-02-0' + (i + 1),
      entries: [{ id: LIFT, target: T, sets: row.map(sec => ({ sec, w: 0, done: true })) }]
    }))
  })

  it('adds time when every set went the full duration', () => {
    const p = nextPrescription(timeHist([[45, 45]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.sec).toBe(50)
    expect(p.weight).toBeUndefined()
  })

  it('repeats the target when a hold came up short', () => {
    const p = nextPrescription(timeHist([[45, 38]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.sec).toBe(45)
  })

  it('backs the target off after a run of short sessions', () => {
    const p = nextPrescription(timeHist([[45, 30], [45, 32], [45, 31]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.sec).toBe(40)              // 45 × 0.9 = 40.5 → nearest 5 s step
  })

  it('ignores reps history when the exercise switched to time', () => {
    const S = hist(LIFT, [[60, 5, 5, 5]])
    const p = nextPrescription({ ...S, unit: 'kg' }, cfg)
    expect(p.kind).toBe('first')        // no timed session yet, so no opinion
  })
})

describe('policy "off"', () => {
  it('has no opinion at all', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { id: LIFT, sets: 3, reps: 5, prog: 'off' })
    expect(p.kind).toBe('off')
    expect(p.weight).toBeUndefined()
  })
  it('is what cardio always gets', () => {
    expect(nextPrescription({ unit: 'kg', workouts: [] }, { id: CARDIO, sets: 1, min: 20 }).kind).toBe('off')
  })
})

describe('sessionsFor', () => {
  it('skips workouts where the exercise was never actually logged', () => {
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-01-01', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: true }] }] },
        { d: '2026-01-02', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 0, done: false }] }] },
        { d: '2026-01-03', entries: [{ id: 'other', target: {}, sets: [{ w: 20, r: 5, done: true }] }] }
      ]
    }
    expect(sessionsFor(S, LIFT).map(s => s.d)).toEqual(['2026-01-01'])
  })

  it('reads a legacy entry that has no target without crashing', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 5, done: true }] }] }] }
    expect(sessionsFor(S, LIFT)).toHaveLength(1)
  })
})

// Workouts only began storing their prescription in v1.2.2. Everything logged before that is
// targetless, and reading it as "missed" would tell every long-standing user to deload on
// their first session after updating — which is exactly what the demo history did.
describe('history logged before targets were recorded', () => {
  const legacy = rows => ({
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: '2026-03-' + String(i + 1).padStart(2, '0'),
      entries: [{ id: LIFT, sets: row.slice(1).map(r => ({ w: row[0], r, done: true })) }]   // no target
    }))
  })
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('judges a targetless session against the current plan instead of calling it a miss', () => {
    const p = nextPrescription(legacy([[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('does not manufacture a stall out of a long clean history', () => {
    const p = nextPrescription(legacy(Array.from({ length: 11 }, () => [60, 5, 5, 5])), cfg)
    expect(p.kind).toBe('up')
  })

  it('still spots a genuine miss in old data', () => {
    expect(nextPrescription(legacy([[60, 5, 5, 2]]), cfg).kind).toBe('hold')
  })

  it('matches the weight hint the app showed before this engine existed', () => {
    // Old rule: every set at or above the plan's reps, with a real weight → suggest a step up.
    expect(nextPrescription(legacy([[60, 5, 6, 5]]), cfg).weight).toBe(62.5)
    expect(nextPrescription(legacy([[60, 5, 4, 5]]), cfg).kind).toBe('hold')
  })
})

describe('applyPrescription', () => {
  const sets = [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: false }]

  it('rewrites only what the policy decided, and only unlogged sets', () => {
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5 })
    expect(out[0]).toEqual({ w: 60, r: 5, done: true })
    expect(out[1]).toEqual({ w: 62.5, r: 5, done: false })
  })

  it('sets reps too when the policy has an opinion about them', () => {
    expect(applyPrescription(sets, { kind: 'up', weight: 42.5, reps: 8 })[1]).toEqual({ w: 42.5, r: 8, done: false })
  })

  it('touches nothing for "off" or a first session', () => {
    expect(applyPrescription(sets, { kind: 'off' })).toBe(sets)
    expect(applyPrescription(sets, { kind: 'first' })).toBe(sets)
    expect(applyPrescription(sets, null)).toBe(sets)
  })

  it('adjusts a timed set without inventing a weight', () => {
    const timed = [{ sec: 45, w: 0, done: false }]
    expect(applyPrescription(timed, { kind: 'up', sec: 50 })).toEqual([{ sec: 50, w: 0, done: false }])
  })
})

/* ---------------- the target readout ---------------- */

describe('targetOf', () => {
  it('lays this session\u2019s prescription over the routine\u2019s configuration', () => {
    const entry = { target: { sets: 3, reps: 8, weight: 60 }, plan: { kind: 'up', weight: 62.5 }, sets: [{}, {}, {}] }
    expect(targetOf(entry)).toMatchObject({ sets: 3, reps: 8, weight: 62.5 })
  })
  it('falls back to the configuration when no policy ran', () => {
    expect(targetOf({ target: { sets: 3, reps: 10, weight: 40 }, plan: { kind: 'off' } })).toMatchObject({ reps: 10, weight: 40 })
  })
  it('counts the sets actually on screen when the configuration does not say', () => {
    expect(targetOf({ target: { reps: 5 }, sets: [{}, {}] }).sets).toBe(2)
  })
})

describe('setMeetsTarget', () => {
  it('is unanswered until the set is checked off', () => {
    expect(setMeetsTarget({ r: 10, done: false }, 10)).toBe(null)
  })
  it('reads reps against the goal, and short is short', () => {
    expect(setMeetsTarget({ r: 10, done: true }, 10)).toBe(true)
    expect(setMeetsTarget({ r: 11, done: true }, 10)).toBe(true)
    expect(setMeetsTarget({ r: 9, done: true }, 10)).toBe(false)
  })
  it('reads a hold in seconds', () => {
    expect(setMeetsTarget({ sec: 45, done: true }, 45, 'time')).toBe(true)
    expect(setMeetsTarget({ sec: 38, done: true }, 45, 'time')).toBe(false)
  })
  it('cannot be missed when nothing was asked', () => {
    expect(setMeetsTarget({ r: 0, done: true }, 0)).toBe(true)
  })
})

describe('targetState', () => {
  const hit = { r: 10, done: true }, short = { r: 8, done: true }, todo = { r: 10, done: false }
  it('is pending until something lands', () => {
    expect(targetState([todo, todo, todo], 10, 'reps', 3)).toBe('pending')
  })
  it('is partial while the landed sets are still landing', () => {
    expect(targetState([hit, todo, todo], 10, 'reps', 3)).toBe('partial')
  })
  it('is hit only once every prescribed set is in', () => {
    expect(targetState([hit, hit, hit], 10, 'reps', 3)).toBe('hit')
  })
  it('does not call it hit when sets were dropped from the prescription', () => {
    expect(targetState([hit, hit], 10, 'reps', 3)).toBe('partial')
  })
  it('makes a miss stick, because a later good set does not undo an earlier short one', () => {
    expect(targetState([short, hit, hit], 10, 'reps', 3)).toBe('miss')
    expect(targetState([hit, short, todo], 10, 'reps', 3)).toBe('miss')
  })
})

/* ---------------- 5/3/1 ---------------- */

describe('5/3/1 cycle window', () => {
  // The cycle counts sessions logged since tmFrom. Without that date every reps session the
  // lifter ever logged counts, which drops a first-time 5/3/1 user into the middle of a cycle
  // they never ran and inflates the training max — so the exercise sheet stamps tmFrom on
  // save whether or not a training max was typed in.
  const history = n => ({
    unit: 'kg', routines: [], customEx: [], exWeights: {},
    workouts: Array.from({ length: n }, (_, i) => ({
      d: '2026-0' + (i + 1) + '-01',
      entries: [{ id: '0025', mode: 'reps', sets: [{ w: 100, r: 5, done: true }] }]
    }))
  })
  const cfg = { id: '0025', sets: 3, reps: 5, mode: 'reps', prog: '531' }

  it('starts a fresh cycle from the date the training max was set', () => {
    const S = history(5)
    const stamped = { ...cfg, tmFrom: '2026-12-01' }
    expect(cycleWeek(S, stamped)).toBe(0)
    expect(trainingMax(S, stamped, 2.5)).toBe(baseTrainingMax(S, stamped))
  })

  it('counts only the sessions logged since then', () => {
    const S = history(5)
    const mid = { ...cfg, tmFrom: '2026-03-01' }   // leaves the March, April and May sessions
    expect(cycleWeek(S, mid)).toBe(3)
  })
})

describe('5/3/1', () => {
  // A bench (upper body) so the increment is 2.5 kg, and a training max round enough that the
  // percentages are checkable by hand.
  const CFG = { id: '0025', sets: 3, reps: 5, prog: '531', tm: 100, tmFrom: '2026-01-01' }
  const state = (sessions = []) => ({ unit: 'kg', workouts: sessions, exWeights: {} })
  const session = (d, sets) => ({
    d, entries: [{ id: '0025', target: { sets: 3, reps: 5, weight: 60 }, sets }]
  })
  const logged = (d) => session(d, [{ w: 65, r: 5, done: true }, { w: 75, r: 5, done: true }, { w: 85, r: 8, done: true }])

  it('reads percentages off the training max, never off a real max', () => {
    const p = nextPrescription(state(), CFG, null)
    expect(p.policy).toBe('531')
    expect(p.tm).toBe(100)
    expect(p.perSet.map(s => s.w)).toEqual([65, 75, 85])
    expect(p.perSet.map(s => s.r)).toEqual([5, 5, 5])
  })

  it('makes the last set of a working week an AMRAP, and the deload week not one', () => {
    const wk1 = nextPrescription(state(), CFG, null)
    expect(wk1.perSet[2].amrap).toBe(true)
    expect(wk1.perSet[0].amrap).toBe(false)
    const wk4 = nextPrescription(state([logged('2026-01-05'), logged('2026-01-12'), logged('2026-01-19')]), CFG, null)
    expect(wk4.kind).toBe('deload')
    expect(wk4.perSet.every(s => !s.amrap)).toBe(true)
    expect(wk4.perSet.map(s => s.w)).toEqual([40, 50, 60])
  })

  it('walks the cycle one logged session at a time', () => {
    const days = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']
    const weeks = days.map((_, i) => cycleWeek(state(days.slice(0, i).map(logged)), CFG))
    expect(weeks).toEqual([0, 1, 2, 3])
  })

  it('raises the training max once a cycle is complete, and not before', () => {
    const days = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']
    expect(trainingMax(state(days.slice(0, 3).map(logged)), CFG, 2.5)).toBe(100)
    expect(trainingMax(state(days.map(logged)), CFG, 2.5)).toBe(102.5)
    expect(cycleWeek(state(days.map(logged)), CFG)).toBe(0)
  })

  it('only counts sessions from the day the training max was set', () => {
    // Two sessions before the cycle started must not put the lifter in week three of it.
    const before = [logged('2025-11-01'), logged('2025-12-01')]
    expect(cycleWeek(state(before), CFG)).toBe(0)
    expect(cycleWeek(state([...before, logged('2026-02-01')]), CFG)).toBe(1)
  })

  it('rounds work weights DOWN, because a percentage is a ceiling', () => {
    // 0.65 x 97.5 = 63.375, which is not loadable; 63.75 would be heavier than asked.
    const p = nextPrescription(state(), { ...CFG, tm: 97.5 }, null)
    expect(p.perSet[0].w).toBe(62.5)
    expect(p.perSet.every(s => s.w % 2.5 === 0)).toBe(true)
  })

  it('derives a training max from the estimated 1RM when none was set', () => {
    // One clean set of 5 at 100 estimates well above 100, and 90% of that is the training max.
    const s = state([session('2026-02-02', [{ w: 100, r: 5, done: true }])])
    const derived = baseTrainingMax(s, { id: '0025' })
    expect(derived).toBeGreaterThan(90)
    expect(derived).toBeLessThan(110)
  })

  it('says what it needs instead of inventing a weight it cannot know', () => {
    const p = nextPrescription(state(), { id: '0025', sets: 3, reps: 5, prog: '531' }, null)
    expect(p.kind).toBe('hold')
    expect(p.perSet).toBeUndefined()
    expect(p.why[0]).toMatch(/training max/)
  })

  it('is a rep-mode policy only', () => {
    expect(POLICIES_FOR.reps).toContain('531')
    expect(POLICIES_FOR.time).not.toContain('531')
    expect(POLICIES_FOR.cardio).not.toContain('531')
    expect(CYCLE_531).toHaveLength(WEEKS_531)
  })
})

describe('applyPrescription with a per-set policy', () => {
  const per = { kind: '531', perSet: [{ w: 65, r: 5 }, { w: 75, r: 5 }, { w: 85, r: 5 }] }

  it('gives each set its own weight and reps', () => {
    const out = applyPrescription([{ w: 0, r: 0 }, { w: 0, r: 0 }, { w: 0, r: 0 }], per)
    expect(out.map(s => [s.w, s.r])).toEqual([[65, 5], [75, 5], [85, 5]])
  })

  it('grows a short plan rather than dropping the top set', () => {
    const out = applyPrescription([{ w: 0, r: 0 }], per)
    expect(out).toHaveLength(3)
    expect(out[2].w).toBe(85)
  })

  it('leaves extra sets alone, so a back-off set stays a back-off set', () => {
    const out = applyPrescription([{ w: 0, r: 0 }, { w: 0, r: 0 }, { w: 0, r: 0 }, { w: 40, r: 12 }], per)
    expect(out).toHaveLength(4)
    expect([out[3].w, out[3].r]).toEqual([40, 12])
  })

  it('never rewrites a set that is already logged', () => {
    const out = applyPrescription([{ w: 60, r: 6, done: true }, { w: 0, r: 0 }, { w: 0, r: 0 }], per)
    expect([out[0].w, out[0].r]).toEqual([60, 6])
    expect(out[1].w).toBe(75)
  })
})

describe('targetState with per-set goals', () => {
  it('judges every set against its own target', () => {
    const goals = [5, 5, 5]
    expect(targetState([{ r: 5, done: true }, { r: 5, done: true }, { r: 9, done: true }], goals, 'reps', 3)).toBe('hit')
    expect(targetState([{ r: 5, done: true }, { r: 4, done: true }, { r: 9, done: true }], goals, 'reps', 3)).toBe('miss')
  })
  it('carries the last goal forward past the end of the table', () => {
    expect(targetState([{ r: 5, done: true }, { r: 5, done: true }], [5], 'reps', 2)).toBe('hit')
  })
})