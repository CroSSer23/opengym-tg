import { describe, it, expect } from 'vitest'
import { SITES, SITE_KEYS, siteName, lengthUnit, seriesFor, latest, delta, measuredSites, putMeasure, chartPoints } from './measures.js'

const S = () => ({
  unit: 'kg',
  measures: [
    { d: '2026-06-01', k: 'waist', v: 86 },
    { d: '2026-07-01', k: 'waist', v: 84.5 },
    { d: '2026-08-01', k: 'waist', v: 83 },
    { d: '2026-07-01', k: 'arm', v: 38 }
  ]
})

describe('body measurements', () => {
  it('measures the sites people actually measure, in tape order', () => {
    expect(SITE_KEYS).toContain('waist')
    expect(SITE_KEYS).toContain('arm')
    expect(SITES[0].k).toBe('neck')
    expect(SITES[SITES.length - 1].k).toBe('calf')
    expect(siteName('waist')).toBe('Waist')
    expect(siteName('nonsense')).toBe('nonsense')
  })

  it('takes its length unit from the weight unit rather than asking again', () => {
    expect(lengthUnit('kg')).toBe('cm')
    expect(lengthUnit('lb')).toBe('in')
  })

  it('reads a site oldest-first and reports the latest', () => {
    expect(seriesFor(S(), 'waist').map(m => m.v)).toEqual([86, 84.5, 83])
    expect(latest(S(), 'waist').v).toBe(83)
    expect(latest(S(), 'neck')).toBe(null)
  })

  it('has no trend to report from a single measurement', () => {
    expect(delta(S(), 'arm')).toBe(null)
    expect(delta(S(), 'waist')).toBe(-1.5)
  })

  it('only lists sites that have actually been measured', () => {
    expect(measuredSites(S())).toEqual(['arm', 'waist'])
    expect(measuredSites({ measures: [] })).toEqual([])
  })

  it('corrects a day rather than adding a second point to it', () => {
    const s = S()
    putMeasure(s, 'waist', 83.5, '2026-08-01')
    const waist = seriesFor(s, 'waist')
    expect(waist).toHaveLength(3)
    expect(waist[2].v).toBe(83.5)
  })

  it('treats zero as deleting the day, because a 0 cm waist is not a measurement', () => {
    const s = S()
    putMeasure(s, 'waist', 0, '2026-08-01')
    expect(seriesFor(s, 'waist').map(m => m.v)).toEqual([86, 84.5])
  })

  it('survives a profile that has never measured anything', () => {
    const empty = {}
    expect(seriesFor(empty, 'waist')).toEqual([])
    expect(chartPoints(empty, 'waist')).toEqual([])
    putMeasure(empty, 'arm', 40, '2026-08-02')
    expect(empty.measures).toHaveLength(1)
  })

  it('gives the chart dated points in order', () => {
    const pts = chartPoints(S(), 'waist')
    expect(pts.map(p => p.y)).toEqual([86, 84.5, 83])
    expect(pts.every(p => p.t > 0 && p.d)).toBe(true)
  })
})