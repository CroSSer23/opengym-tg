import { describe, it, expect } from 'vitest'
import { plateBreakdown, perSideLabel, plateCount, DEFAULT_BAR, PLATES } from './plates.js'

const side = b => b.perSide.map(p => [p.plate, p.count])

describe('plateBreakdown', () => {
  it('loads a clean total symmetrically from the heaviest disc down', () => {
    const b = plateBreakdown(100)
    expect(b.bar).toBe(20)
    expect(side(b)).toEqual([[25, 1], [15, 1]])
    expect(b.ok).toBe(true)
    expect(b.loaded).toBe(100)
    expect(perSideLabel(b)).toBe('25 + 15')
    expect(plateCount(b)).toBe(4)
  })

  it('an empty bar needs no plates and is not an error', () => {
    const b = plateBreakdown(20)
    expect(b.ok).toBe(true)
    expect(b.perSide).toEqual([])
    expect(perSideLabel(b)).toBe('')
  })

  it('keeps the smallest disc that floating point would otherwise eat', () => {
    // 62.5 total is 21.25 a side: 20 + 1.25. Subtracting without rounding lands on
    // 1.2500000000000018 and drops the change.
    const b = plateBreakdown(62.5)
    expect(side(b)).toEqual([[20, 1], [1.25, 1]])
    expect(b.ok).toBe(true)
    expect(b.leftover).toBe(0)
  })

  it('says what it could not load rather than rounding the answer silently', () => {
    // 21 kg: half a kilo a side, and nothing in the rack makes it.
    const b = plateBreakdown(21)
    expect(b.ok).toBe(false)
    expect(b.loaded).toBe(20)
    expect(b.leftover).toBe(1)
  })

  it('refuses a total lighter than the bar', () => {
    const b = plateBreakdown(15)
    expect(b.ok).toBe(false)
    expect(b.reason).toBe('below-bar')
    expect(b.perSide).toEqual([])
  })

  it('works in pounds off the pound bar and the pound discs', () => {
    const b = plateBreakdown(225, { unit: 'lb' })
    expect(b.bar).toBe(45)
    expect(side(b)).toEqual([[45, 2]])
    expect(b.ok).toBe(true)
  })

  it('takes a bar the gym actually has', () => {
    const b = plateBreakdown(60, { bar: 15 })
    expect(b.bar).toBe(15)
    expect(side(b)).toEqual([[20, 1], [2.5, 1]])
  })

  it('takes a restricted rack and reports what it cannot reach', () => {
    // Dumbbell-only garage gym: 5s and 2.5s, nothing heavier.
    const b = plateBreakdown(100, { plates: [5, 2.5] })
    expect(side(b)).toEqual([[5, 8]])
    expect(b.ok).toBe(true)
    const odd = plateBreakdown(101, { plates: [5] })
    expect(odd.ok).toBe(false)
    expect(odd.loaded).toBe(100)
  })

  it('keeps an odd 1.25 kg remainder exact', () => {
    // (101.25 - 20) / 2 is 40.625 per side, and no disc makes the last 0.625. Rounding each
    // intermediate remainder to two decimals used to report 99.99 loaded with 1.26 left over.
    const b = plateBreakdown(101.25, { bar: 20 })
    expect(b.ok).toBe(false)
    expect(side(b)).toEqual([[25, 1], [15, 1]])
    expect(b.loaded).toBe(100)
    expect(b.leftover).toBe(1.25)
    // The loadable neighbour either side stays exact too.
    expect(plateBreakdown(102.5, { bar: 20 })).toMatchObject({ ok: true, loaded: 102.5, leftover: 0 })
    expect(plateBreakdown(61.25, { bar: 20 })).toMatchObject({ ok: false, loaded: 60, leftover: 1.25 })
  })

  it('has a sane default bar and plate set per unit', () => {
    expect(DEFAULT_BAR.kg).toBe(20)
    expect(DEFAULT_BAR.lb).toBe(45)
    for (const set of Object.values(PLATES)) {
      expect([...set].sort((a, b) => b - a)).toEqual(set)   // heaviest first, which greedy relies on
    }
  })
})