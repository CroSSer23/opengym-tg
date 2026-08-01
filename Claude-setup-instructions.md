# Claude AI Coach: setup and user guide

This guide explains how to configure the AI Coach on this openGym instance and how each profile can use it safely.

Instance URL: <https://opengym.cc-software.com>

There are two distinct roles:

- **Instance owner / admin** connects Claude Code once, sets usage limits, and maintains the service.
- **Profile user** opts in separately, chooses what they want help with, and reviews every proposed change before it affects their plan.

## Read this first: account and credential policy

The Claude setup-token flow is an official Claude Code mechanism for scripts and automated environments. `claude setup-token` creates a long-lived OAuth token (currently one year) after the account owner completes Claude Code's normal browser sign-in. It requires a Claude Pro, Max, Team, or Enterprise account. See Anthropic's [authentication documentation](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).

Treat that token like a password:

- Generate it only on a trusted computer.
- Paste it only into the openGym admin sheet.
- Do not send it in chat, email, screenshots, issue trackers, or notes.
- Disconnect it and create a replacement immediately if you suspect exposure.

Important: Anthropic's current legal guidance says that developers building products or services with the Agent SDK should use a Claude Console API key or supported cloud provider, and must not route Free, Pro, or Max credentials on behalf of their users. Review the [official credential-use policy](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) and make sure this owner-controlled deployment is permitted by your Anthropic agreement before enabling it for other people. This document describes the technical setup; it is not a grant of permission to use a subscription token in a way Anthropic does not allow.

## What is installed here

openGym uses the **Claude Agent SDK**, not a manually scripted `claude --print` command and not an Anthropic API key. The application:

- stores the setup token encrypted at rest;
- passes it only to the short-lived Coach job that needs it;
- runs that job as an unprivileged `coach` user;
- disables tools, MCP servers, filesystem settings, automatic memory, and session persistence; and
- never applies a plan or workout change automatically.

The Coach only becomes visible to normal profiles after it is both enabled and successfully connected.

## Part 1 — instance owner: connect Claude Code

### Before you begin

You need all of the following:

- An openGym profile with administrator access.
- A trusted laptop or desktop with Claude Code installed.
- A Claude account that can use Claude Code and is allowed for your intended deployment.
- Access to the browser used to sign in to that Claude account.

You do **not** need to put an API key in `.env`, change Docker configuration, or restart openGym for normal credential changes.

### 1. Open the Coach administration card

1. Sign in to openGym at <https://opengym.cc-software.com>.
2. Open **Settings**.
3. Open **Admin dashboard**.
4. Open **AI Coach**.
5. Turn the Coach switch on if it is off.
6. Under **Provider**, select **Claude Code**.

The card should show:

- **Runtime:** `Claude Agent SDK` and `ready`.
- **Credential:** `needed` until a setup token is saved.

### 2. Create a Claude Code setup token

On the trusted computer—not in openGym—open a terminal and run:

```bash
claude setup-token
```

Claude Code opens its normal browser authorization page. Sign in with the Claude account that will own and pay for Coach usage, approve the request, then copy the token printed in the terminal.

If a browser does not open, Claude Code can provide a URL to copy into a browser. Complete the sign-in in that browser and return to the terminal until it prints the token. Do not use the old openGym browser redirect or paste a browser authorization code into openGym; this deployment intentionally does not use that flow.

### 3. Save and test the token in openGym

1. Return to **Settings → Admin dashboard → AI Coach**.
2. Under **Credential**, choose **Add CLI token**.
3. Paste the token into the password-style field.
4. Select **Save and test**.

Expected result: a **Connected** confirmation and a successful Coach test. The token is not shown again after it is saved.

If the test fails, keep the error message from the admin card, but never include the token in a support request.

### 4. Set sensible limits before inviting people

In the same card, set:

- **Per user / day** — maximum Coach requests one profile can make in a day. The default is 10.
- **Whole instance / day** — combined maximum for everyone. `0` means no instance-wide limit.
- **Model** — normally leave blank to use Claude Code's default. Only set a model if you know it is available to the connected account.

For a family or small shared instance, use a non-zero instance-wide limit. Every plan creation, plan revision, and training review is a Claude request on the instance owner's account.

### 5. Confirm that it is live

When setup succeeds, the card shows:

- Runtime: **ready**
- Credential: **connected**
- Provider: **Claude Code**

Normal signed-in profiles can now see the Coach. They still must opt in individually before their training data is used.

## Part 2 — profile user: turn on the Coach

The Coach is optional for every profile. One person's consent never enables it for another person.

### 1. Find the Coach

Sign in to your openGym profile and open the **Coach** area from the plan-related screens. If the Coach does not appear, ask the instance owner to confirm that Claude Code is connected and the Coach is enabled.

### 2. Review the disclosure and consent

The first card is **Meet the Coach**. Choose **See what it would use** before enabling it.

The disclosure explains that the Coach may receive:

- your plan: routines, exercises, sets, reps, weekly schedule, and progression settings;
- your logged training in the review window: weights, reps, time, effort ratings, and session duration;
- relevant body-weight entries and an optional goal weight;
- the answers you give in the Coach intake, including limitations or injuries; and
- your unit, language, and effort-scale preferences.

Your name, passkey/sign-in data, push subscriptions, and other profiles' data stay in openGym. The Coach does not apply changes by itself. If you agree, choose **I understand — turn the Coach on**.

The Coach is not a doctor or physiotherapist. Do not use it to diagnose pain or replace professional medical advice.

## Part 3 — create your first plan

If you do not have a plan yet, the Coach offers **Let the Coach build my plan**. This opens a six-step intake. Only your goal and training experience are required; the rest makes the result more useful.

1. **Goal and experience**
   - Choose a goal: strength, muscle, general fitness, fat loss, or endurance.
   - Choose your starting point: new to lifting, returning after a break, or training regularly.
2. **Days per week**
   - Choose two to six training days.
   - Optionally select the days that fit your schedule.
3. **Session length**
   - Choose 30, 45, 60, 75, or 90 minutes.
4. **Equipment**
   - Select the equipment you can use. Leave it empty only if the full exercise library is available to you.
5. **Limitations**
   - Describe injuries, movements to avoid, joints that are troublesome, or practical limits such as a quiet early-morning workout.
6. **Preferences**
   - Add exercises you like, exercises you prefer to avoid, and any extra context.

Choose **Build my plan**. The Coach normally takes a minute or two; you can leave the screen while it works.

### Review a newly generated plan

When the plan is ready, open the pending Coach item and review:

- the overall summary and rationale;
- each routine, exercise, set/rep target, and explanation;
- the proposed weekly schedule; and
- any body-map preview of routine load.

You can:

- turn **Use this weekly schedule** on or off before accepting;
- write a plain-language request under **Want something different?** and choose **Ask for a revision**;
- choose **Accept plan** to make it live; or
- choose **Discard** to save nothing.

Accepting a plan creates a reversible snapshot of your existing plan. It does not rewrite workouts you have already logged.

## Part 4 — ask for a training review

Once you have logged workouts, open **Coach** and use **Ask for a review**.

1. Optionally add a short note, for example: `My shoulder pinches on overhead work` or `I only have 35 minutes this week`.
2. Select **Ask for a review**.
3. Wait for **Suggestions ready**. You can leave the screen while the job runs.
4. Open the suggestions and read the reason for every proposed change.
5. Keep the changes you want checked and uncheck any you do not want.
6. Choose **Apply N changes**, **Apply nothing**, or **Dismiss all**.

Each accepted review change is recorded in your Coach history. The app checks whether your plan changed while the Coach was working; stale suggestions are greyed out and cannot overwrite a newer manual edit.

## Part 5 — automate reviews or keep them manual

Under **Automatic reviews**, choose one of:

- **Off** — the Coach only reviews training when you request it.
- **Weekly** — choose a day and time.
- **After every few workouts** — choose 3, 4, 5, 6, 8, or 10 workouts.

Automatic review timing controls when openGym asks Claude to look. It does not automatically change your plan. You are notified only when there is a suggestion to review, subject to your notification settings.

Use **Coach profile → Your answers** whenever your goal, schedule, equipment, limitations, or preferences change.

## Part 6 — stay in control

### Accept selectively

For a review, each individual change has its own checkbox. Accept only the changes you understand and want.

### Undo the last accepted Coach change-set

In **Coach → Controls**, choose **Undo the last Coach changes**. This restores the plan and weekly schedule snapshot from before that accepted change-set. It does not alter workouts you have already logged.

### Turn the Coach off for your profile

In **Coach → Controls**, choose **Turn the Coach off**.

This:

- withdraws your consent;
- stops your scheduled reviews;
- discards pending server-side suggestions for your profile; and
- leaves your existing Coach history available in your local profile state.

You can opt in again later.

## Owner maintenance and troubleshooting

| What you see | What to do |
|---|---|
| **Credential: needed** | Generate a token with `claude setup-token`, then use **Add CLI token**. |
| **The old Claude credential is no longer used** | Replace it with a new Claude Code setup token. Old browser-OAuth and API-key credentials are deliberately disabled for Claude. |
| **Test failed** or **The Coach couldn't sign in** | Generate a fresh setup token on the trusted computer, verify the account still has Claude Code access, then replace the token. |
| **Runtime: missing** | Rebuild and restart the API image: `docker compose up -d --build`. |
| A profile cannot see Coach | Confirm the Coach is enabled and connected, the person is signed in, and their profile has not turned the Coach off. |
| **The Coach is resting** | A daily per-profile or instance-wide cap was reached. Wait until the next day or change the limits. |
| **The Coach is already thinking** | One job is already queued or running for that profile. Wait for it to finish. |
| A proposal is greyed out | The related plan changed after the review started. Ask for a fresh review rather than trying to apply an outdated change. |
| **Force-disabled by COACH_DISABLED** | Remove or change `COACH_DISABLED=1` in the deployment environment, then restart the API service. |
| Stored credential cannot be decrypted | Restore the matching `data/secret` file from backup or disconnect and add a new setup token. |

### Rotate or revoke access

To replace a token:

1. In **Admin dashboard → AI Coach**, choose **Disconnect**.
2. Generate a new token with `claude setup-token` on the trusted computer.
3. Use **Add CLI token** and **Save and test**.

The token is currently valid for one year. Rotate it sooner whenever the account, operator, or trust boundary changes.

### Pause the Coach for everyone

Use either option:

- Turn the **AI Coach** switch off in the admin card to hide the feature from users while retaining the stored configuration.
- Set `COACH_DISABLED=1` in the server environment for a host-level kill switch. This overrides dashboard configuration until it is removed and the API is restarted.

### Backups

Back up the entire `data/` directory, including `data/secret`. The Coach credential is encrypted using material derived from that secret. A backup containing `coach.json` without the matching secret cannot decrypt the token; a backup containing both should be protected like any other credential-bearing backup.

## Quick operating checklist

### Instance owner

- [ ] Confirm the intended use complies with Anthropic's credential policy.
- [ ] Set a per-profile and instance-wide daily cap.
- [ ] Generate the setup token only on a trusted computer.
- [ ] Save it through **Add CLI token** and run **Save and test**.
- [ ] Keep the token out of chat, screenshots, and backups that are not encrypted.
- [ ] Review the admin card for failed jobs and rotate the token when needed.

### Profile user

- [ ] Read the disclosure before consenting.
- [ ] Give accurate equipment, time, and limitation information.
- [ ] Review every plan and change before applying it.
- [ ] Keep medical or pain-related decisions with a qualified professional.
- [ ] Turn the Coach off when you no longer want it to use your training data.

## References

- [Anthropic: Claude Code authentication and setup tokens](https://code.claude.com/docs/en/authentication)
- [Anthropic: Claude Code legal and credential-use guidance](https://code.claude.com/docs/en/legal-and-compliance)
- [openGym self-hosting guide](docs/SELF_HOSTING.md#8-the-ai-coach-optional)
