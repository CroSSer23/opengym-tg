/* The starter plans.
 *
 * The point of these tests is one thing above all: every exercise id in every plan has to
 * resolve against the real library. An id that resolves to nothing is not a crash, it is a
 * blank row that someone discovers the first time they train the plan, which is the worst
 * possible moment.
 */
import { describe, it, expect } from 'vitest'
import { STARTER_PLANS, planRoutines, planWeek, starterRoutines } from './starter.js'
import { EXIDX } from './exercises.js'

describe('starter plans', () => {
  it('offers the four shapes the roadmap asked for', () => {
    expect(STARTER_PLANS.map(p => p.key)).toEqual(['ppl', 'upper-lower', 'full-body', '5x5'])
  })

  for (const plan of STARTER_PLANS) {
    describe(plan.name, () => {
      it('references only exercises that exist', () => {
        const missing = []
        for (const [name, , list] of plan.spec) {
          for (const [id] of list) if (!EXIDX[id]) missing.push(name + ' -> ' + id)
        }
        expect(missing).toEqual([])
      })

      it('prescribes a sane number of sets and reps', () => {
        for (const [, , list] of plan.spec) {
          for (const [, sets, reps] of list) {
            expect(sets).toBeGreaterThan(0)
            expect(sets).toBeLessThanOrEqual(6)
            expect(reps).toBeGreaterThan(0)
            expect(reps).toBeLessThanOrEqual(20)
          }
        }
      })

      it('schedules every routine it defines, and only routines it defines', () => {
        const used = new Set(Object.values(plan.week))
        expect([...used].sort()).toEqual(plan.spec.map((_, i) => i))
        expect(Object.keys(plan.week)).toHaveLength(plan.days)
        for (const d of Object.keys(plan.week)) expect(+d).toBeGreaterThanOrEqual(0), expect(+d).toBeLessThanOrEqual(6)
      })

      it('builds routines with fresh ids that the week map points at', () => {
        const routines = planRoutines(plan)
        const week = planWeek(plan, routines)
        expect(routines).toHaveLength(plan.spec.length)
        expect(new Set(routines.map(r => r.id)).size).toBe(routines.length)
        for (const id of Object.values(week)) expect(routines.some(r => r.id === id)).toBe(true)
        // Loading the same plan twice must not collide with the first copy.
        const again = planRoutines(plan)
        expect(again[0].id).not.toBe(routines[0].id)
      })
    })
  }

  it('carries a progression rule only where the plan is opinionated about one', () => {
    const byKey = Object.fromEntries(STARTER_PLANS.map(p => [p.key, planRoutines(p)]))
    expect(byKey['5x5'][0].prog).toBe('linear')
    expect(byKey.ppl[0].prog).toBeUndefined()
  })

  it('keeps the original three-routine helper the demo build seeds from', () => {
    const [push, pull, legs] = starterRoutines()
    expect([push.name, pull.name, legs.name]).toEqual(['Push Day', 'Pull Day', 'Leg Day'])
  })
})