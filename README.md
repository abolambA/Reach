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
| Hosting | Vercel |
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

## Get it running locally — 5 minutes

```bash
git clone https://github.com/abolambA/Linkedin-Messages-Concluder-.git lumen
cd lumen
npm install
cp .env.example .env.local
```

Fill `.env.local` with your own values:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
GEMINI_API_KEY=AIza...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Run the two SQL files in `supabase/migrations/` in your Supabase SQL Editor (in order: `001` then `002`).

```bash
npm run dev
```

Open **http://localhost:3000**.

---

## Deploy to Vercel — 60 seconds via CLI

```bash
npm i -g vercel
vercel login
vercel                   # link + deploy preview in one shot

# push every env var
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
vercel env add SUPABASE_SECRET_KEY production
vercel env add GEMINI_API_KEY production
vercel env add NEXT_PUBLIC_SITE_URL production

vercel --prod
```

Set `NEXT_PUBLIC_SITE_URL` to the URL Vercel prints after the first deploy.

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
