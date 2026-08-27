import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import * as tg from './lib/telegram.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Settings from './views/Settings.jsx'
import Admin from './views/Admin.jsx'
import Coach from './views/Coach.jsx'
import CoachIntake from './views/CoachIntake.jsx'
import CoachProposal from './views/CoachProposal.jsx'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

/**
 * Inside Telegram the app is a sheet inside someone else's window, and a dark Mini App in a
 * light client reads as broken rather than as a preference. So Telegram's own scheme wins
 * there by default — and only by default: turning "Match Telegram's theme" off in Settings
 * hands control back to the profile's own choice, on every device.
 */
function effectiveTheme(S) {
  if (tg.IN_TELEGRAM && S.tgTheme !== false) {
    const scheme = tg.colorScheme()
    if (scheme) return scheme
  }
  return S.theme
}

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f4f4f2' : '#0a0b0b'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(effectiveTheme(S), S.accent) }, [S.theme, S.accent, S.tgTheme])
  // Telegram's theme can flip while the app is open, and the sheet has to follow it live.
  useEffect(() => tg.onThemeChanged(() => applyPrefs(effectiveTheme(useStore.getState().S), useStore.getState().S.accent)), [])
  useEffect(() => { setLang(S.lang || 'en') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang || 'en' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  // Telegram's own back arrow, wired to the router. Without this a Mini App is a web page in
  // a box: the platform's back affordance is right there in the header and does nothing.
  const atRoot = loc.pathname === '/home' || loc.pathname === '/'
  useEffect(() => { tg.setBackButton(!atRoot) }, [atRoot])
  useEffect(() => tg.onBackButton(() => {
    // A Mini App is often opened straight onto a deep link, so there may be nothing behind
    // this screen to go back to.
    if (window.history.length > 1) navigate(-1); else navigate('/home')
  }), [navigate])

  const authed = user || isGuest
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? <Login /> : (
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/settings" element={<Settings />} />
              {/* The Coach screens gate themselves on the instance config; the routes exist
                  unconditionally so a deep link from a notification lands somewhere sane
                  rather than on the catch-all. */}
              <Route path="/coach" element={<Coach />} />
              <Route path="/coach/intake" element={<CoachIntake />} />
              <Route path="/coach/proposal" element={<CoachProposal />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          )}
        </ErrorBoundary>
      </div>
      <TabBar onStart={startFlow} />
      <RestTimer />
      <Modals />
      <Toast />
    </>
  )
}

/**
 * A notification's deep link, applied once the app is signed in and routable. It arrives as
 * `?to=coach` rather than in the fragment because Telegram owns the fragment on launch.
 */
function DeepLink() {
  const navigate = useNavigate()
  const authed = useStore(s => !!s.user || s.isGuest())
  const ready = useStore(s => s.ready)
  useEffect(() => {
    if (!ready || !authed || !tg.deepLink) return
    navigate(tg.deepLink, { replace: true })
  }, [ready, authed, navigate])
  return null
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  // Told once, after the first paint: Telegram shows its own placeholder until a Mini App
  // says it is ready, and expands the sheet to full height only when asked.
  useEffect(() => { tg.ready() }, [])
  return <HashRouter><DeepLink /><Shell /></HashRouter>
}
