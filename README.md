# Lumen

### Read every LinkedIn DM. Reply to none of them yourself.

A triage cockpit for the people drowning in their LinkedIn inbox. Hand it your messages CSV — it hands back every thread classified, every reply drafted, and a keyboard-first interface that gets you through 200 conversations in 10 minutes.

> *"LinkedIn DMs are where ambition goes to die. This is the resuscitation."*

---

## What it does

You drop in the CSV that LinkedIn lets you export. The platform reads every conversation and gives you:

- **8 categories** — Sales pitch · Recruiter · Job inquiry · Networking · Real question · Personal · Spam · Other
- **A draft reply for each one** — written in your sender's tone, capped at 60 words
- **A queue you fly through with the keyboard** — `J/K` to move, `D` mark replied, `A` archive, `F` follow up, `S` skip
- **State that lives in Postgres** — close the tab, come back next week, you're exactly where you left off
- **Zero login friction** — single shared URL, no email/password, no magic links

It looks like an editorial newspaper, not a SaaS dashboard. Fraunces serif, cream paper, terracotta accents. Built for *reading*, which is what triage actually is.

---

## Why this exists

LinkedIn has no inbox UI worth defending. No filters. No bulk actions. No public messaging API. Just an infinite scroll of *"Hope this finds you well!"* recruiter pings buried under the messages that actually matter — the introductions from the parent of a kid in your school, the journalist who saw your work, the founder you'd actually want to call back.

This is the bridge between *"I have 200 unread messages"* and *"I responded to the 12 that mattered."*

---

## Stack

| Layer | Tool |
|---|---|
| App framework | Next.js 14 (App Router) + TypeScript |
| Database | Supabase (Postgres) |
| AI engine | Gemini 2.5 Flash via `@google/genai` |
| Styling | Tailwind + Fraunces / Geist / JetBrains Mono |
| Hosting | Self-hosted (runs entirely on your machine) |
| Live LinkedIn sync *(optional)* | [Unipile](https://unipile.com) |

---

## How a message moves through it

```
LinkedIn CSV
    │
    ▼
Parser groups rows by conversation_id
    │
    ▼
Threads + messages written to Supabase
    │
    ▼
Gemini classifies in batches of 4
    │   ├─ category
    │   ├─ one-sentence summary
    │   ├─ draft reply (or "" if not worth one)
    │   └─ urgency + worth_replying flag
    ▼
Triage UI: queue → thread → action panel
    │
    ▼
Decisions saved to Postgres on every change
    │
    ▼
Export everything as a final CSV
```

---

## Run it entirely on your machine

Everything runs locally: the Next.js app, and a full Postgres + Supabase stack in Docker. The only things that leave your machine are Gemini API calls (classification/drafting) and, if you enable it, Unipile.

**Prerequisites:** Node 18+, Docker Desktop running, and the [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase` or `npx supabase`).

```bash
npm install

# 1. Bring up local Postgres + Supabase (first run pulls Docker images).
#    This auto-applies every migration in supabase/migrations/.
npx supabase start

# 2. Print the local stack's URL + keys.
npx supabase status
```

`supabase status` prints an **API URL** (`http://127.0.0.1:54321`), an **anon key**, and a **service_role key**. Drop them into `.env.local`:

```ini
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon key from `supabase status`>
SUPABASE_SECRET_KEY=<service_role key from `supabase status`>
GEMINI_API_KEY=AIza...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
REACH_INGEST_TOKEN=<openssl rand -hex 32>   # only needed for the Chrome extension
```

> The local anon/service keys are the standard Supabase demo keys — fine for a tool that only ever runs on `localhost`. They are **not** secrets and must never be used for an internet-facing deployment.

```bash
npm run dev          # dev server, hot reload
# or, for a production-style local run:
npm run build && npm start
```

Open **http://localhost:3000**.

Local stack housekeeping:

```bash
npx supabase stop            # shut the stack down (data persists)
npx supabase db reset        # wipe + re-apply all migrations from scratch
npx supabase studio          # open the local DB GUI
```

### Pointing at a hosted Supabase instead

Nothing in the app is tied to the local stack — it reads three env vars. To use a cloud (or any external) Supabase, swap those three values in `.env.local` and apply the migrations once:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

```bash
# apply the schema to the remote project (one time)
npx supabase link --project-ref <your-ref>
npx supabase db push
```

No code changes — just restart `npm run dev`.

---

## Three things to know

**There is no auth.** Anyone with the URL gets in. The URL is the password. Don't post it publicly.

**LinkedIn has no public messaging API.** The only two real ways to get messages into this app are the free CSV export (manual) and Unipile ($59/mo, near-real-time). Anyone selling you a third option is either using Unipile under the hood, scraping (will get the account banned), or lying.

**Gemini Flash is fast and basically free.** Free tier gives you 15 requests/min. A 200-thread inbox costs roughly 50 cents on the paid tier.

---

## Importing from LinkedIn

1. **linkedin.com** → top-right profile picture → **Settings & Privacy**
2. Left sidebar → **Data Privacy** → **Get a copy of your data**
3. Pick **"Want something in particular?"**
4. Tick only **Messages** (everything else takes 24 hours; messages-only takes ~10–30 min)
5. **Request archive** → re-enter your password
6. Wait for the email titled *"Your LinkedIn data is ready"*
7. Click the link → download the ZIP → extract → grab `messages.csv`
8. In Lumen, go to **Import** → drop the CSV → wait for Gemini to finish classifying

---

## Roadmap

- [ ] Real-time Unipile sync via webhooks
- [ ] Send replies directly through Unipile (today: copy/paste)
- [ ] Email digest of pending threads
- [ ] Multi-account support (separate inboxes for different people)
- [ ] Mobile-friendly triage view
- [ ] Bulk actions (select N, archive all)

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `J` / `↓` | Next thread |
| `K` / `↑` | Previous thread |
| `D` | Mark replied |
| `A` | Archive |
| `F` | Follow up later |
| `S` | Skip |
| `/` | Focus search |
| `?` | Show this list |
| `Esc` | Close panels |

---

## Built by

A team that got tired of triaging their own LinkedIn inbox by hand.

If you ship something with it, drop a star. If you ship something *because* of it, drop a screenshot.

## License

MIT. Do whatever. The world is better with more inbox-zero people in it.
