// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise instructions come from separately generated packs in src/instr/ (one per
// language, from the upstream dataset) — also lazy-loaded on language switch.
import { useSyncExternalStore } from 'react'

// UI languages. Ukrainian sits second because this fork is maintained in Ukraine, and Russian
// sits last; the rest keep upstream's order. Every language has an instruction pack — upstream
// shipped ten, this fork adds uk/de/pt (see scripts/instructions/).
export const LANGS = {
  en: 'English', uk: 'Українська', de: 'Deutsch', es: 'Español', fr: 'Français',
  it: 'Italiano', pt: 'Português', pl: 'Polski', tr: 'Türkçe', zh: '中文',
  ko: '한국어', hi: 'हिन्दी', ru: 'Русский'
}
export const INSTR_LANGS = Object.keys(LANGS)
// Exercise names are translated in this repo rather than by the upstream dataset, which
// only ever named them in English. Which languages have a pack is whatever is present in
// src/names/, so adding one is a build step and not a code change.
const DATE_LOCALES = {
  en: 'en-GB', uk: 'uk-UA', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT',
  pt: 'pt-PT', pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')
const namePacks = import.meta.glob('../names/*.js')

let lang = 'en'
let dict = {}
let instr = null            // { exId: [steps] } for the current language, null = English
let names = null            // { exId: name }    for the current language, null = English
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Plural categories are not the same everywhere: English has two forms, Ukrainian, Russian
// and Polish have three, and French counts zero as singular. Intl knows every rule; the
// forms English has no word for live in the locale files under "<plural key>#few" and
// "#many", so a language that does not need them simply does not carry the entry.
let rules = null
function pluralRules() {
  if (!rules || rules.lang !== lang) rules = { lang, r: new Intl.PluralRules(dateLocale()) }
  return rules.r
}
export function tn(n, one, other) {
  const cat = pluralRules().select(n)
  if (cat === 'one') return t(one, n)
  const variant = other + '#' + cat
  return t(dict[variant] === undefined ? other : variant, n)
}
// The API answers in English. Its messages are the same kind of source string as the UI's,
// so they resolve through the same locale files - no error-code contract in between, and a
// message with no translation still reads exactly as the server sent it. A few of them end
// in a detail the server appends (a URL, an HTTP status): those are keyed by their fixed
// prefix, and the detail is carried over untouched.
let prefixes = null
export function tError(msg) {
  const s = String(msg == null ? '' : msg)
  if (!s) return s
  const whole = t(s)
  if (whole !== s) return whole
  if (!prefixes || prefixes.lang !== lang) {
    prefixes = { lang, keys: Object.keys(dict).filter(k => /[ (]$/.test(k)) }
  }
  for (const k of prefixes.keys) if (s.startsWith(k)) return t(k) + s.slice(k.length)
  return s
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []
// The exercise's name in the current language. A custom exercise has no dataset id and
// carries the name its owner typed, in whatever language they typed it.
export const exNameOf = ex => (ex && names && names[ex.id]) || (ex && ex.n) || ''
// Whether names arrive already cased the way the language writes them, which is the one
// thing the title-casing in the stylesheet needs to know.
export const namesLocalised = () => !!names

export async function setLang(l) {
  if (!LANGS[l]) l = 'en'
  if (l === lang && version > 0) return
  lang = l
  try {
    dict = l === 'en' ? {} : (await localePacks['../locales/' + l + '.js']()).default
    instr = l === 'en' || !INSTR_LANGS.includes(l) ? null : (await instrPacks['../instr/' + l + '.js']()).default
  } catch (e) { dict = {}; instr = null }
  // Separately, because a language that has no name pack - which is most of them - must
  // not take the dictionary down with it.
  try {
    const load = namePacks['../names/' + l + '.js']
    names = load ? (await load()).default : null
  } catch (e) { names = null }
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
