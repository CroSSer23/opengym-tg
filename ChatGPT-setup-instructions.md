# Set up the AI Coach with ChatGPT / Codex CLI

This guide is for the person who owns an openGym server and wants to run its AI Coach using a
ChatGPT account through the bundled **OpenAI Codex CLI**. It does not use an OpenAI Platform API
key.

Use this only on a server you control and trust. Codex's local sign-in cache contains refreshable
access credentials, so treat the server and its `data/codex` backup exactly as you would treat a
password manager or private CI runner. Do not use this setup for a public, shared, or untrusted
execution environment.

## Before you begin

You need:

- a current openGym deployment built from this source revision;
- an openGym administrator profile;
- a ChatGPT account with access to Codex; and
- a trusted browser, such as the iPad you use to administer the server.

Codex device-code sign-in is currently a beta feature. Enable device-code login in your ChatGPT
security settings, or ask your ChatGPT workspace administrator to enable it for the workspace.
OpenAI documents the flow in its [Codex authentication guide](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).

If you are upgrading an existing installation, build and restart first so the Codex CLI and the
private auth-volume mount exist:

```bash
docker compose up -d --build
```

## Connect ChatGPT to the Coach

1. Sign in to openGym and open **Settings → Admin dashboard → AI Coach**.
2. Turn on **AI Coach**.
3. Under **Provider**, select **OpenAI Codex CLI**.
4. Confirm that **Runtime** says `ready`. If it does not, rebuild with the command above.
5. Under **Credential**, select **Sign in with ChatGPT**.
6. Choose **Start device sign-in**.
7. The sheet shows a link and a one-time verification code. On your iPad or another trusted
   browser, open that link, sign in to the ChatGPT account that will run Coach jobs, and enter
   the code.
8. Return to openGym. The sheet closes after Codex saves its local login, and the credential card
   shows **connected**.
9. Select **Test the Coach**. A green result confirms an actual Codex response rather than only
   a successful sign-in.

The browser authorization happens between you and OpenAI. openGym only starts the local Codex
CLI and shows its short-lived device instructions; it never asks for, stores, or displays a
ChatGPT password, API key, or OAuth access token.

## What openGym stores

The Codex CLI stores its own file-based login cache at `data/codex/auth.json` on the Docker host.
The file is mounted only into the API container at `/codex`, owned by the unprivileged `coach`
user, and is never copied into `data/coach.json` or returned by the API. Coach jobs receive that
directory as `CODEX_HOME`, while their ordinary home directory is a fresh temporary folder.

This lets Codex refresh its own ChatGPT session during normal use. It also means:

- back up `data/codex` only in encrypted, access-controlled backups;
- never commit, email, paste, or screenshot `auth.json`;
- never mount `data/codex` into the web container or any unrelated container; and
- restrict access to the openGym admin dashboard to people you trust with the ChatGPT account.

## Use the Coach safely

Set a sensible **Per user / day** limit and, for a family or shared household, a non-zero **Whole
instance / day** limit before enabling it for other profiles. Each plan creation, revision, and
review consumes your Codex / ChatGPT allowance.

Each profile must separately read the disclosure and consent before its training data is sent to
the provider. The Coach proposes plan changes; it never applies them automatically. Users can
accept individual changes, dismiss a proposal, or turn the Coach off for their own profile.

## Disconnect, rotate, or recover

To revoke this server's Codex access:

1. Go to **Settings → Admin dashboard → AI Coach**.
2. Select **Disconnect**.
3. If you want to use Codex again, repeat the device-code sign-in above.

Disconnect runs `codex logout` in the private Coach runtime and removes its exact `auth.json`
cache. Also revoke the session from your ChatGPT account if you suspect the server or its backup
was exposed.

If the card reports an expired credential, or **Test the Coach** reports a sign-in problem,
disconnect and sign in again. If the device-code option is unavailable, first check your ChatGPT
security settings or workspace policy.

## Troubleshooting

| What you see | What to do |
|---|---|
| `Runtime: missing` | Run `docker compose up -d --build`, then reload the admin page. |
| No device-code link or code | Confirm device-code login is enabled for your ChatGPT account/workspace, then start the flow again. |
| Device sign-in timed out | Start it again; codes are short-lived and intentionally expire. |
| Credential is `expired` | Choose **Disconnect**, then use **Sign in with ChatGPT** again. |
| The Coach cannot sign in after a restore | Restore the matching `data/codex` cache from a protected backup, or connect again. |
| A profile cannot see Coach | Confirm the card is enabled and connected, then have that profile consent in its Coach area. |

## Official references

- [OpenAI: Codex authentication and device-code login](https://learn.chatgpt.com/docs/auth)
- [OpenAI: Codex non-interactive mode and trusted automation guidance](https://learn.chatgpt.com/docs/non-interactive-mode)
- [openGym self-hosting guide](docs/SELF_HOSTING.md#8-the-ai-coach-optional)
