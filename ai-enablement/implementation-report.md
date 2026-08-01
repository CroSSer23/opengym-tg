# AI Coach — implementation report

**Branch:** `ai-enablement` on `alexpcosta/openGym` · **Commit:** `10a24f0`
**Companion documents:** [`functional-plan.md`](./functional-plan.md) · [`implementation-plan.md`](./implementation-plan.md)
**Status:** Phases 1–3 implemented, tested and pushed. Two items need a human before release (§5).

---

## 1. What was built

All three phases of the implementation plan, in one branch rather than the nine PRs the plan
sequenced. The phasing was written so each PR could merge green with the feature dormant; since
this landed as a single reviewable change, that ordering bought nothing and the branch is
structured by workstream instead.

| Plan item | Status | Where |
|---|---|---|
| **WS-A** CLI in the image, unprivileged jobs, `/data` unreadable | Done | `api/Dockerfile`, `api/coach/adapters/spawn.js`, `api/server.js` |
| **WS-B** Config store, encryption, admin endpoints, caps | Done | `api/coach/config.js`, `api/coach/routes.js` |
| **WS-C** In-UI OAuth connect + API-key fallback + refresh | Done | `api/coach/oauth.js`, `frontend/src/views/AdminCoach.jsx` |
| **WS-D** Job runner, single-flight, timeout, repair round, boot recovery | Done | `api/coach/jobs.js` |
| **WS-E** Adapters, payload allowlist, validator, prompts | Done | `api/coach/{payload,validate}.js`, `adapters/`, `prompts/` |
| **WS-F** Client domain logic + tests | Done | `frontend/src/lib/coach.js`, `coach.test.js` |
| **WS-G** UI surfaces | Done | `Coach.jsx`, `CoachIntake.jsx`, `CoachProposal.jsx`, `AdminCoach.jsx`, edits to Home/Plan/Settings/Admin/sheets |
| **WS-H** (Phase 2) Cadence, push, session rating, extra adapters, instance cap | Done | `api/coach/cadence.js`, `sheets.jsx`, `adapters/index.js` |
| **Phase 3** Demo canned proposal | Done | `frontend/src/lib/coach-demo.js` |
| **Phase 3** Richer Coach-profile editing | Done | intake wizard doubles as the editor (`/coach/intake?edit=1`) |
| **Phase 3** Per-job cost surfacing | **Not built** — see §5 |
| Tests, CI, docs, i18n | Done | `api/test/`, `.github/workflows/test.yml`, README/SELF_HOSTING/CHANGELOG/NOTICE/`.env.example`, 11 locale packs |

**Verification:** 261 tests pass (54 `node:test` in `api/`, 207 Vitest in `frontend/`),
production and demo builds both succeed, 11 locales in sync at 781 keys each, generated
exercise index verified in sync with the dataset.

---

## 2. Decisions taken during implementation

Six things the plan left open or specified differently. Each is called out because it changes
something a reviewer would otherwise expect to find.

### 2.1 The server needs the exercise catalogue — so it's generated and committed

Not anticipated in the plan. The server must resolve exercise ids to validate proposals
(FR-16) **and** build payloads for scheduled reviews, which run with no browser open. The api
build context is `./api`, so it cannot reach into `frontend/`.

`scripts/build-coach-library.mjs` generates `api/coach/library.json` (1,324 exercises, 123 KB,
id/name/body-part/target/equipment only) from the frontend dataset. It is committed — the same
arrangement the repo already uses for translated instruction packs — and CI runs the script
with `--check` so a dataset change that forgets to regenerate it fails the build instead of
surfacing as "the Coach can't find that exercise" on somebody's instance.

### 2.2 The plan fingerprint is computed from a shared canonical shape

The plan had client and server each hash "the plan". Implementing it exposed a way for the two
to disagree: the server hashed its *cleaned* payload plan, where a `weight: 0` is dropped,
while the client would hash raw state where it is present. Same plan, different hash, every
proposal permanently stale.

Both sides now hash the output of a `canonicalPlan()` function — mode-aware, every absent value
written out as a zero — mirrored field for field in `api/coach/payload.js` and
`frontend/src/lib/coach.js`. `coach.test.js` imports the **server's actual source** and asserts
the two agree on shared fixtures, so the duplication cannot drift silently.

### 2.3 The fixture CLI lives in `api/coach/`, not `scripts/`

The plan put it at `scripts/coach-fixture-cli.mjs`. That path is outside the api build context,
so the `fixture` provider would have worked in tests and been missing from the image. It is
`api/coach/fixture-cli.mjs` instead, which means an instance owner can select **Fixture
(testing)** in the admin dashboard and walk the entire loop — intake, proposal, accept, revert
— before connecting an account that costs money. It remains the reference implementation for
the `custom` provider contract.

### 2.4 The demo build runs the Coach against a local canned provider

Phase 3 listed this as "nice-to-have (marketing value)"; it is built. `coach-demo.js` generates
a proposal **from the demo profile's own routines** rather than hard-coding one, so every id
resolves and applying it exercises the real validate → snapshot → apply → log → revert path.
Only the provider is faked. `coachAvailable()` therefore returns true for demo builds — the one
deliberate exception to the gating rule, since hiding the app's most interesting feature from
the page people are sent to look at it on seemed like the wrong trade. Mobile stays excluded.

### 2.5 All four Phase-2 adapters shipped

Gemini, Codex and the custom-command escape hatch are implemented alongside Claude Code rather
than deferred. Only Claude Code is installed in the image; the others expect an owner-derived
image, which the admin card says. This was cheap because the adapter interface was built
provider-agnostic from day one, as ID3 intended.

### 2.6 Sixteen pre-existing untranslated strings were picked up

Extracting new keys surfaced ten demo/mobile-only strings (`Demo`, `Reset demo data`,
`Self-host openGym`…) that were already missing from every locale pack before this work. They
are in the same files, so they were translated too. The locale packs went 613 → 781 keys.

---

## 3. Bugs found and fixed during implementation

- **Daily cap never incremented.** `bumpDaily()` existed and was never called, so
  `caps.perProfileDaily` was checked against a counter permanently at zero — the cap would have
  silently done nothing on a live instance. Caught by the integration test; the counter is now
  bumped at enqueue (not completion), since queueing twenty jobs spends the owner's account
  whether or not the twentieth finishes.

---

## 4. Where the implementation is stricter than the plan

Three places worth a reviewer's attention, because they are load-bearing:

- **Consent is enforced server-side**, by reading `S.coach.consent` from the state file before
  any job is queued. The plan implied this; a UI-only gate would not survive FR-13's threat
  model.
- **The job environment is built from nothing**, not filtered from `process.env`. The child
  cannot inherit `RP_ID`, `ADMIN_UIDS`, VAPID keys or anything else the server holds. There is
  a test that asserts the environment has exactly four keys.
- **`/data` is chmod 0700 at boot** and jobs run as an unprivileged `coach` user, so the CLI
  cannot read state files, `db.json`, the session secret or the stored credential — it sees its
  own job payload and nothing else. This is what makes NFR-3's "access to the job payload only"
  a fact rather than an intention.

---

## 5. What is left to do

### Needs a human before release

1. **Verify the OAuth client parameters against a real Anthropic account.** This is the one
   thing CI cannot cover and the highest-risk item in the change (risk R2 in the plan). The
   PKCE flow in `api/coach/oauth.js` is written against the Claude Code CLI's own client
   parameters, gathered in a single constants block and pinned to CLI `2.1.212`. It has not
   been exercised against a live provider from this environment. **Test connect → test →
   token refresh → disconnect on a staging instance before shipping.** If the parameters have
   moved, the API-key path in the same admin card works today and is the documented fallback.

2. **Confirm the pinned CLI version.** `api/Dockerfile` pins `2.1.212` — the current `stable`
   dist-tag, chosen over `latest` (2.1.220) as the conservative default for a self-hosted
   product. The image build runs `claude --version`, so an unusable pin fails CI rather than
   reaching users, but the choice of which version is a judgement call worth confirming. The
   `api-image` CI job builds `api/` on every PR and is the check that proves alpine/musl
   compatibility.

### Deferred deliberately

3. **Per-job cost surfacing** (Phase 3). Not built. The CLIs do not report cost consistently
   enough to show a number an owner could rely on, and a wrong cost figure is worse than none.
   Job duration is surfaced in the admin card instead. Revisit when there is real usage data.

4. **Model override default.** Left at the CLI's own default, as the plan's open item (b)
   suggested. The admin card takes an override string. Revisit after beta cost data.

5. **Guest mode** stays out of scope (functional §5 / §16 Q7) — unchanged product decision.

### Recommended before merging upstream

6. **Run the loop end-to-end on a real instance.** Everything here is proven against the
   fixture provider, which is deterministic by design. A real model will produce answers the
   validator rejects in ways a fixture never will — that path is implemented (one repair round,
   then a clean failure) and unit-tested, but the *rate* at which it fires is only observable
   against a live model, and it is the number that decides whether the prompts need work.

7. **Watch the first few reviews for prompt quality.** The validator guarantees nothing invalid
   reaches a plan. It cannot guarantee the advice is *good* — that is a prompt-tuning loop that
   needs real training data behind it. `api/coach/prompts/` is versioned in git for exactly
   this reason.

---

## 6. Reviewing this branch

Suggested reading order, highest-consequence first:

1. `api/coach/validate.js` — the closed change-type list is the security boundary.
2. `api/coach/payload.js` — the allowlist is the privacy boundary. `api/test/payload.test.js`
   asserts on what is *absent*.
3. `frontend/src/lib/coach.js` — everything that mutates a plan.
4. `api/coach/jobs.js` — lifecycle, caps, repair round, boot recovery.
5. `api/coach/oauth.js` — the piece that needs live verification (§5.1).
6. Everything else is UI, adapters and docs.

Two test files are worth reading as specifications rather than checks:
`frontend/src/lib/coach.test.js` (what a change-set may and may not do) and
`api/test/validate.test.js` (what the model is allowed to say).
