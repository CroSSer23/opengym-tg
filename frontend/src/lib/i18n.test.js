/* The translation layer.
 *
 * Two failures matter here and neither one throws. A key that differs from the source string
 * by a single character silently renders English, and a translation that loses a {0} silently
 * renders a sentence with a hole in it. Both look fine in review and wrong on a phone.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LANGS, INSTR_LANGS } from './i18n.js'

const SRC = path.resolve(__dirname, '..')
const LOCALES = path.join(SRC, 'locales')

/** Every string the app passes to t(), read out of the source. */
function sourceStrings() {
  const found = new Set()
  const walk = d => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name)
      if (f.isDirectory()) { if (!/locales|instr|fonts/.test(f.name)) walk(p) }
      else if (/\.jsx?$/.test(f.name) && !/\.test\./.test(f.name)) {
        const s = fs.readFileSync(p, 'utf8')
        for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) found.add(m[1].replace(/\\'/g, "'"))
        // tn(count, singular, plural) picks its key at runtime, so both forms are read here
        // too — otherwise converting a call site to tn() would quietly drop it from this check.
        for (const m of s.matchAll(/\btn\(\s*[^,]+,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) {
          found.add(m[1].replace(/\\'/g, "'")); found.add(m[2].replace(/\\'/g, "'"))
        }
        for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) found.add(m[1].replace(/\\"/g, '"'))
      }
    }
  }
  walk(SRC)
  return found
}

const packs = Object.fromEntries(
  Object.keys(LANGS).filter(l => l !== 'en').map(l => [l, require(path.join(LOCALES, l + '.js'))])
)

describe('language list', () => {
  it('has a locale file for every language it offers', () => {
    for (const code of Object.keys(LANGS)) {
      if (code === 'en') continue                       // English is the source, not a pack
      expect(fs.existsSync(path.join(LOCALES, code + '.js')), code + '.js exists').toBe(true)
    }
  })

  it('only claims an instruction pack where one exists', () => {
    for (const code of INSTR_LANGS) {
      if (code === 'en') continue
      expect(fs.existsSync(path.join(SRC, 'instr', code + '.js')), 'instr/' + code + '.js exists').toBe(true)
    }
  })

  it('offers Ukrainian', () => {
    expect(LANGS.uk).toBe('Українська')
  })
})

describe('placeholders survive translation', () => {
  // {0} and friends are substituted by t() at call time. A translation that drops one renders
  // a sentence missing its number; one that invents an extra renders a literal "{1}".
  for (const [code, pack] of Object.entries(packs)) {
    it(code + ' keeps every {n} its key has, and invents none', () => {
      const broken = []
      for (const [k, v] of Object.entries(pack.default ?? pack)) {
        const want = [...new Set([...k.matchAll(/\{(\d+)\}/g)].map(m => m[1]))].sort()
        const got = [...new Set([...String(v).matchAll(/\{(\d+)\}/g)].map(m => m[1]))].sort()
        if (want.join() !== got.join()) broken.push(`${k}  ->  ${v}`)
      }
      expect(broken).toEqual([])
    })
  }
})

describe('Ukrainian', () => {
  const uk = packs.uk.default ?? packs.uk

  it('translates every string the app actually shows', () => {
    const missing = [...sourceStrings()].filter(s => !(s in uk))
    expect(missing).toEqual([])
  })

  it('covers everything an existing locale covers', () => {
    // The literal scan above cannot see strings passed to t() indirectly - body parts,
    // equipment, muscle names, policy labels are all t(someVariable) - so completeness is
    // measured against a locale that already shipped rather than against the scan.
    const de = packs.de.default ?? packs.de
    const missing = Object.keys(de).filter(k => !(k in uk))
    expect(missing).toEqual([])
  })

  it('is actually Ukrainian, not copied Russian', () => {
    const values = Object.values(uk).join(' ')
    // Letters that exist in Ukrainian and not in Russian.
    expect(/[іїєґ]/i.test(values)).toBe(true)
    // Letters that exist in Russian and not in Ukrainian: a few can appear in proper nouns,
    // but a wholesale copy would be riddled with them.
    const russianOnly = (values.match(/[ыэъё]/gi) || []).length
    expect(russianOnly).toBeLessThan(20)
  })
})