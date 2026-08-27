/* Running inside a Telegram Mini App.
 *
 * This is a deliberate reimplementation of the parts of telegram-web-app.js this app uses,
 * rather than a script tag pointing at telegram.org. Three reasons, in order of weight:
 *
 *   1. openGym is offline-capable and advertises no cloud dependencies. A blocking third-party
 *      script in <head> would be a request every user makes on every load, including the ones
 *      who have never heard of Telegram, and a single point of failure for the whole app when
 *      the CDN is unreachable.
 *   2. The official script has to run before anything touches location.hash, because Telegram
 *      delivers the launch parameters in the fragment -- and this app routes on the fragment
 *      (HashRouter). Owning the capture is how those two coexist: read the parameters, stash
 *      them, hand the router a clean hash.
 *   3. What we need is small and specified: the launch data, the theme, the back button,
 *      haptics, viewport height, expand and close.
 *
 * Everything degrades to a no-op outside Telegram, so the rest of the app can call any of it
 * unconditionally.
 *
 * Protocol: https://core.telegram.org/bots/webapps
 */

/* ------------------------------ launch parameters ------------------------------ */

// Nothing here means anything without a document, and the pure-function tests run in node.
const BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined'
const STORE = 'gym_tg_launch'

/** Telegram puts its parameters in the fragment, and (on some clients) the query string. */
function readLaunch() {
  const found = {}
  if (!BROWSER) return found
  for (const source of [location.hash.slice(1), location.search.slice(1)]) {
    if (!source) continue
    for (const [k, v] of new URLSearchParams(source)) if (k.startsWith('tgWebApp')) found[k] = v
  }
  if (Object.keys(found).length) {
    // A Mini App reloads (a PWA update, a pull-to-refresh) with a URL we have already cleaned,
    // so the launch has to outlive the first paint. sessionStorage is per-tab and dies with
    // the WebView, which is exactly the lifetime of a launch.
    try { sessionStorage.setItem(STORE, JSON.stringify(found)) } catch { /* private mode */ }
    return found
  }
  try { return JSON.parse(sessionStorage.getItem(STORE) || 'null') || {} } catch { return {} }
}

/** Give the fragment back to the router, and take Telegram's noise out of the query string. */
function cleanURL() {
  if (!BROWSER) return
  const search = new URLSearchParams(location.search)
  let touched = false
  for (const k of [...search.keys()]) if (k.startsWith('tgWebApp')) { search.delete(k); touched = true }
  const hadHash = location.hash.includes('tgWebApp')
  if (!touched && !hadHash) return
  const qs = search.toString()
  try {
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + (hadHash ? '' : location.hash))
  } catch { /* nothing to do about it, and the app still works */ }
}

const LAUNCH = readLaunch()
const json = (raw, fallback) => { try { return JSON.parse(raw) } catch { return fallback } }

export const IN_TELEGRAM = BROWSER && (!!LAUNCH.tgWebAppData || !!window.TelegramWebviewProxy)
/** The signed launch string. Opaque here on purpose -- only the server may believe it. */
export const initData = LAUNCH.tgWebAppData || ''
export const platform = LAUNCH.tgWebAppPlatform || null
export const version = LAUNCH.tgWebAppVersion || '6.0'
const targetOrigin = LAUNCH.tgWebAppTargetOrigin || 'https://web.telegram.org'

/** The account, for showing a name before the server has answered. Never trusted for anything. */
export const tgUser = (() => {
  if (!initData) return null
  try { return JSON.parse(new URLSearchParams(initData).get('user') || 'null') } catch { return null }
})()

/** Where a notification asked us to land: `?to=coach` becomes `/coach`. */
export const deepLink = (() => {
  if (!BROWSER) return null
  const to = new URLSearchParams(location.search).get('to')
  return to && /^[a-z0-9/-]{1,40}$/i.test(to) ? '/' + to.replace(/^\/+/, '') : null
})()

if (IN_TELEGRAM) cleanURL()

/* ------------------------------ talking to Telegram ------------------------------ */

// Bot API versions that gate the features used below.
const atLeast = min => {
  const a = String(version).split('.').map(Number), b = min.split('.').map(Number)
  return (a[0] || 0) !== (b[0] || 0) ? (a[0] || 0) > (b[0] || 0) : (a[1] || 0) >= (b[1] || 0)
}

function postEvent(eventType, eventData = {}) {
  if (!IN_TELEGRAM) return
  try {
    if (window.TelegramWebviewProxy?.postEvent) return window.TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData))
    if (window.external?.notify) return window.external.notify(JSON.stringify({ eventType, eventData }))
    if (window.parent && window.parent !== window) return window.parent.postMessage(JSON.stringify({ eventType, eventData }), targetOrigin)
  } catch { /* an unsupported client is a client that gets a plain web app */ }
}

/* ------------------------------ events from Telegram ------------------------------ */

const listeners = new Map()
const on = (event, fn) => {
  const set = listeners.get(event) || new Set()
  set.add(fn); listeners.set(event, set)
  return () => set.delete(fn)
}
function receiveEvent(eventType, eventData) {
  for (const fn of listeners.get(eventType) || []) {
    try { fn(eventData) } catch (e) { console.error('telegram handler', eventType, e) }
  }
}

if (IN_TELEGRAM) {
  // Native clients deliver events by calling into these globals by name; the official script
  // defines both, and a client will happily call whichever it knows about.
  window.Telegram = window.Telegram || {}
  window.Telegram.WebView = { receiveEvent, postEvent }
  window.TelegramGameProxy = { receiveEvent }
  // Telegram Web runs the Mini App in an iframe and posts instead.
  window.addEventListener('message', e => {
    if (e.source !== window.parent) return
    if (!/(^|\.)telegram\.org$/.test(new URL(e.origin).hostname)) return
    const msg = json(e.data, null)
    if (msg?.eventType) receiveEvent(msg.eventType, json(msg.eventData, msg.eventData))
  })
}

/* ------------------------------ the small API the app uses ------------------------------ */

/** Tell Telegram the app has painted, and take the whole sheet height while we are at it. */
export function ready() {
  if (!IN_TELEGRAM) return
  postEvent('web_app_ready')
  postEvent('web_app_expand')
  // Swiping down inside a scrollable workout list should scroll it, not dismiss the app.
  if (atLeast('7.7')) postEvent('web_app_setup_swipe_behavior', { allow_vertical_swipe: false })
  if (atLeast('8.0')) postEvent('web_app_request_content_safe_area')
}

export const close = () => postEvent('web_app_close')

/**
 * The hardware-ish back button in Telegram's own header. Wiring it is what stops a Mini App
 * feeling like a web page in a box: the platform's back affordance moves you back through the
 * app, and going back from the first screen closes it.
 */
export function setBackButton(visible) {
  if (atLeast('6.1')) postEvent('web_app_setup_back_button', { is_visible: !!visible })
}
export const onBackButton = fn => on('back_button_pressed', fn)

const HAPTIC = {
  light: { type: 'impact', impact_style: 'light' },
  medium: { type: 'impact', impact_style: 'medium' },
  heavy: { type: 'impact', impact_style: 'heavy' },
  success: { type: 'notification', notification_type: 'success' },
  warning: { type: 'notification', notification_type: 'warning' },
  error: { type: 'notification', notification_type: 'error' },
  select: { type: 'selection_change' }
}
/** A set completed, a PR hit, a proposal applied. Silent everywhere that cannot buzz. */
export function haptic(kind = 'light') {
  if (atLeast('6.1') && HAPTIC[kind]) postEvent('web_app_trigger_haptic_feedback', HAPTIC[kind])
}

/* ------------------------------ theme + viewport ------------------------------ */

let THEME = null
export const themeParams = () => (THEME ||= json(LAUNCH.tgWebAppThemeParams, {}) || {})
export const colorScheme = () => {
  const bg = themeParams().bg_color
  if (!bg) return null
  // Telegram sends the scheme only as colours, so it is read back off the background: the
  // same relative-luminance test a designer would apply by eye, and it never guesses wrong
  // on the actual palettes Telegram ships.
  const n = parseInt(bg.replace('#', ''), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128 ? 'dark' : 'light'
}

/**
 * Publish Telegram's palette as CSS custom properties. The design system decides how much of
 * it to honour; this only makes it available, so a Mini App can sit inside the client's own
 * colours instead of fighting them.
 */
function publishTheme(params) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(params || {})) {
    if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) root.style.setProperty('--tg-' + k.replace(/_/g, '-'), v)
  }
}
function publishViewport(height, stable) {
  const root = document.documentElement
  if (height) root.style.setProperty('--tg-viewport-height', height + 'px')
  if (stable) root.style.setProperty('--tg-viewport-stable-height', stable + 'px')
}
function publishInsets(prefix, inset) {
  if (!inset) return
  const root = document.documentElement
  for (const side of ['top', 'right', 'bottom', 'left']) {
    if (typeof inset[side] === 'number') root.style.setProperty(`--tg-${prefix}-${side}`, inset[side] + 'px')
  }
}

if (IN_TELEGRAM) {
  document.documentElement.dataset.tg = platform || 'unknown'
  publishTheme(themeParams())
  on('theme_changed', d => { THEME = d?.theme_params || THEME; publishTheme(THEME); for (const fn of themeSubs) fn() })
  on('viewport_changed', d => publishViewport(d?.height, d?.is_stable ? d.height : null))
  on('content_safe_area_changed', d => publishInsets('content-safe', d))
  on('safe_area_changed', d => publishInsets('safe', d))
}

/** Told when the viewer flips Telegram's own light/dark switch while the app is open. */
const themeSubs = new Set()
export function onThemeChanged(fn) { themeSubs.add(fn); return () => themeSubs.delete(fn) }

/** Everything the app needs to know in one object, for the store. */
export const telegramContext = () => ({
  inTelegram: IN_TELEGRAM,
  initData,
  user: tgUser,
  platform,
  colorScheme: colorScheme(),
  deepLink
})