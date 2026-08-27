# Project website

Source of the fork's site. Plain hand-written HTML, CSS and JS, no build step, served by nginx.

Three pages: `index.html` (landing), `docs.html` (self-host, Telegram, Coach), `about.html`
(who wrote which part of this, which matters on a fork).

The two typefaces are committed under `fonts/`, Latin subsets only, because the site has no
build step and no third-party font request. Both are SIL OFL and the licences ship beside them.

Not in this folder, added at deploy time:

- `icon-180.png` / `icon-512.png`, copied from `../frontend/public/`, so the tab icon matches
  the app's.

Deliberately absent: screenshots. The five in `../assets/screenshots/` show the design this
fork replaced, and putting them on the page would advertise a UI the app no longer has. The
hero renders the app's own target readout with the app's own CSS instead, which is a real
component rather than a picture of one. Add real screenshots when there are current ones.

`site.js` reads the star and fork counts from the public GitHub API at view time and fails
silently, so the page is fine without it.