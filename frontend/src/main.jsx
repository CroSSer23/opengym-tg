// First, and deliberately: inside Telegram the launch parameters arrive in the URL fragment,
// which is also where HashRouter keeps the route. This module reads them and hands the router
// a clean hash, so it has to run before anything that touches location.hash.
import './lib/telegram.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
