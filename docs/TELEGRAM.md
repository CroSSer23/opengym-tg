# LiftMate in Telegram

LiftMate can run as a **Telegram Mini App**: the same tracker, opened from a chat, signed in by
your Telegram account, with the alerts it already sends arriving as messages instead of browser
push. It is off unless you give the api container a bot token.

Nothing about the web app changes. With no token set, `/api/config` carries no `telegram` key,
every Telegram route answers 503, and not one byte of Telegram UI renders anywhere.

---

## What you get

| | |
| --- | --- |
| **A Mini App** | The whole tracker inside Telegram — plan, guided workouts, stats, Coach. Telegram's back arrow moves you back through the app, and a completed set buzzes. |
| **Sign-in with no sign-in** | The first launch creates the profile and signs it in. There is no password, no passkey prompt inside a WebView that may not support one, and no second account to remember. |
| **Notifications that arrive** | Rest timer, workout-day reminder and Coach proposals, delivered as messages from your bot. This is the reason to bother on iOS, where web push inside a Mini App is not a thing. |

## Setting it up

**1. Make a bot.** Message [@BotFather](https://t.me/BotFather), send `/newbot`, answer the two
questions, and keep the token it gives you. It looks like `8012345678:AAH…`.

**2. Give it to LiftMate.** In your `.env`:

```bash
TELEGRAM_BOT_TOKEN=8012345678:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Only if the Mini App is served from somewhere other than ORIGIN:
# TELEGRAM_WEBAPP_URL=https://gym.example.com
```

```bash
docker compose up -d
```

That is the whole configuration. On boot the api container introduces itself to Telegram, sets
the bot's command list, and installs the chat menu button that opens your instance.

**3. Open it.** Find your bot in Telegram, `/start`, tap the button.

> **HTTPS is not optional here.** Telegram refuses to open a Mini App over plain HTTP, so
> `http://localhost:8080` will not work — the bot answers `/start` by saying so rather than
> handing you a button that does nothing. Put the instance behind an HTTPS domain first; see
> [SELF_HOSTING.md](SELF_HOSTING.md).

## Already have a profile?

A passkey profile and a Telegram account are two credentials for one account, not two accounts.
Open the Mini App, and on the sign-in screen it will create a *new* profile — which is not what
you want. Instead:

1. Sign in to the **web** app with your passkey, on your phone.
2. Open the Mini App from Telegram.
3. **Settings → Telegram → Link this Telegram account.**

From then on either door reaches the same profile. Unlinking is in the same place, and the app
warns you if Telegram is the only way back in.

## Invite-only instances

`INVITE_ONLY=1` covers Telegram too — an open bot is not an open instance. A first launch
without a code is refused, and the Mini App shows a field for one.

You can also put the code in the link, so nobody has to retype it:

```
https://t.me/YourBotName?startapp=A1B2C3D4E5F6A7B8
```

Telegram delivers that as part of the signed launch, and the code is spent on the profile it
creates.

## How the sign-in actually works

Telegram signs the launch parameters it puts in the Mini App's URL with a key derived from your
bot token. `api/telegram/verify.js` recomputes that HMAC and compares it in constant time; a
launch that fails is anonymous traffic. A launch that passes is Telegram — which holds the other
half of your bot token — vouching for the account id inside it.

Some consequences worth knowing:

- **The bot token is a credential.** Anyone holding it can mint valid launches for any account
  id and walk into any profile on the instance. Treat it like the session secret; if it leaks,
  revoke it in BotFather and set the new one.
- **Telegram ids are a lookup key, never an identity.** They are public and guessable, so a
  profile created from Telegram still gets LiftMate's own random id, and nothing else in the app
  hangs off the Telegram number.
- **A launch expires after 24 hours.** Not sooner: Telegram fixes `initData` for the lifetime of
  a Mini App session, and a tighter window would sign people out mid-workout. The session cookie
  it mints is the normal 90-day one, so the exchange happens once, not every launch.
  `TELEGRAM_AUTH_MAX_AGE` (seconds) tightens it if you want.

## What the bot can see

The bot is a door and a doorbell. It reads `/start`, `/app` and `/help` in a private chat and
ignores everything else — no group updates, no message history, no callback queries. Telegram is
told only what a notification says: *"Rest over"*, *"Push Day today"*, *"3 suggestions after this
week"*. Your plan, your logged sets and your body weight never leave your server for Telegram.

Turn the messages off per profile in **Settings → Telegram → Notify me on Telegram**; the web-push
channel is independent and stays as it was.

## Long polling, not webhooks

The container asks Telegram for updates rather than being called back. A webhook needs a publicly
resolvable HTTPS URL that works *before* anyone has signed in, plus a secret header and a route to
guard — and when any of that is subtly wrong, the symptom is a bot that silently never answers.
Long polling works wherever outbound HTTPS works, which is the same bar the rest of LiftMate sets.

The cost is one held-open request at a time, and one rule: **only one process may poll a bot
token.** Run two api containers against one bot and Telegram answers 409; the log says so in
those words rather than backing off quietly.

## Troubleshooting

| What you see | What it is |
| --- | --- |
| `telegram: getMe failed — Unauthorized` | The token is wrong, or was revoked in BotFather. |
| Bot answers `/start` with "Telegram will only open a Mini App over HTTPS" | `TELEGRAM_WEBAPP_URL` (or `ORIGIN`) is `http://`. |
| `another process is polling this bot token (409)` | A second container, or a webhook still registered on the bot. One poller only. |
| The Mini App opens on the sign-in screen instead of Home | The launch was refused — usually invite-only with no code, or a clock more than five minutes ahead of real time. |
| Notifications stop arriving | Blocking the bot makes Telegram answer 403; LiftMate drops the link and Settings shows "Not linked". Send `/start` again and re-link. |