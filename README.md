# Reach

A LinkedIn network intelligence platform. Maps your connections, finds paths to people you want to reach, drafts outreach in your voice, and keeps your inbox from owning your week.

**Live app:** https://linkedin-messages-concluder.vercel.app

---

## What's in this repo

```
reach/
├── app/                Next.js 14 web app (Reach UI + API routes)
├── components/         Shared React components
├── lib/                Supabase client, Gemini wrapper, RAG retrieval, types
├── supabase/migrations/  Versioned schema migrations
├── extension/          Chrome extension (passive LinkedIn ingestion)
├── sql/                One-time data cleanup / fix scripts
├── package.json
└── README.md
```

The web app and the extension live in the same repository so a single `git push` updates both. Vercel watches the repo root and ignores `extension/`.

---

## Architecture

```
┌──────────────────────┐                    ┌─────────────────────────┐
│  Chrome extension    │   HTTPS + token    │  Next.js app on Vercel  │
│  (passive scrape of  │ ─────────────────▶ │  - /api/extension/*     │
│   LinkedIn DOM)      │                    │  - /api/classify        │
└──────────────────────┘                    │  - /api/path            │
                                            │  - /api/plan            │
                                            │  - /api/search/people   │
                                            └────────────┬────────────┘
                                                         │
                                                         ▼
                                            ┌─────────────────────────┐
                                            │  Supabase (Postgres +   │
                                            │  pgvector)              │
                                            │  - people, edges        │
                                            │  - threads, messages    │
                                            │  - goals, actions       │
                                            │  - style_corpus (vec)   │
                                            └────────────┬────────────┘
                                                         │
                                                         ▼
                                            ┌─────────────────────────┐
                                            │  Google Gemini          │
                                            │  - 2.5 Flash (classify, │
                                            │    drafting)            │
                                            │  - text-embedding-004   │
                                            └─────────────────────────┘
```

### How the pieces fit together

1. The **Chrome extension** runs in your LinkedIn browser tab. It watches what you naturally browse — your profile, your connections page, your messaging inbox, your feed — and ingests structured data via HTTPS POST to the Reach backend. It never auto-clicks, never auto-sends, never logs in on your behalf.

2. The **Next.js app** stores everything in Supabase and exposes a UI for working with it. The API routes accept ingest from the extension (bearer-token auth) and serve the UI (no user-facing auth — single-user mode for now).

3. **Gemini** classifies inbound messages into categories (Sales / Job / Network / Question / Personal / Spam / Other), drafts replies in the user's voice using RAG against a personal style corpus, and embeds text for similarity search.

4. **Supabase** with pgvector stores everything. A recursive SQL function `find_path` does breadth-first search across the connection graph to find intros.

---

## Features

### Network mapping
The extension passively captures everyone you encounter on LinkedIn — connections, messaging contacts, post authors, profile views. Each person stored with name, headline, company, position, profile URL, and a 1st-degree flag if they're in your direct network. Browse them all at `/network`.

### Path finding
Open `/search`, type a name or paste a LinkedIn URL. Reach shows the shortest path from you to that person through your captured graph. If they're a direct connection, you get a 1-hop path (DM them directly). If they're a friend-of-a-friend, you get a 2-hop intro path (ask the mutual to make the introduction).

### Inbox triage
The extension captures conversation list previews from `/messaging/`. Gemini classifies each incoming message into a category and drafts a context-aware reply using your style brief. Tap to copy the draft, paste in LinkedIn, send.

> ⚠️ As of this writing, LinkedIn has obfuscated the messaging DOM heavily enough that the extension's auto-ingest of conversations is unreliable. The web app supports manual paste-in as a fallback. See "Known limitations" below.

### Goal-driven outreach
At `/goals`, define what you're trying to do (build followers, reach 100 hires, target named accounts, custom). Click "Plan" — Reach finds candidates from your graph, computes the path to each, and drafts personalized outreach using RAG against your style corpus.

### Action queue
Tinder-style approval card stack at `/queue`. Each card is a drafted message with rationale ("Why this person, why now"). Swipe approve → copy to clipboard. Swipe skip → moves on. Actions auto-expire after 14 days.

### Style brief & corpus
At `/style`, paste in messages you've actually sent on LinkedIn. They get embedded into pgvector. When drafting a new reply, Reach retrieves the 5 most similar past messages and instructs Gemini to write in that voice. The more samples, the more the drafts sound like you.

---

## The Chrome extension

Lives in `extension/`. Manifest V3, Brave/Chrome compatible.

### What it does

| Page you visit                              | What gets captured                                        |
| ------------------------------------------- | --------------------------------------------------------- |
| `linkedin.com/in/yourself/`                 | Sets your profile as "self" (path-finding starting node)  |
| `linkedin.com/in/anyone-else/`              | Indexes that person + their headline + activity posts     |
| `linkedin.com/mynetwork/.../connections/`   | Indexes the visible connections, marks them as 1st-degree |
| `linkedin.com/messaging/`                   | Indexes conversation list previews                        |
| `linkedin.com/messaging/thread/{id}/`       | Indexes the conversation list (open thread DOM is hard)   |
| `linkedin.com/feed/`                        | Captures post authors and their headlines                 |

### How it talks to the backend

Every ingest POST uses a bearer token (`REACH_INGEST_TOKEN`). The token is set once in the extension's popup (API URL + token), stored in `chrome.storage.local`. Requests go to `/api/extension/{people,edges,messages,posts,interactions,ping,self,stats}`.

### Loading it

1. Open `brave://extensions/` (or `chrome://extensions/`)
2. Enable Developer Mode
3. Click "Load unpacked"
4. Select the `extension/` folder from this repo
5. Open the extension's popup → paste API URL and token → Save → Test connection

After any code edit, click the ↻ icon in `brave://extensions/` and refresh your LinkedIn tab.

### What it does NOT do

- It does **not** auto-send messages
- It does **not** auto-connect or auto-follow
- It does **not** scrape pages you didn't visit
- It does **not** replay session cookies on a server
- It does **not** authenticate as you anywhere

This is a deliberate design choice. LinkedIn's account-detection systems look for automated session activity. Reach extension only indexes what you would have seen anyway by browsing normally.

---

## Setup

### Prerequisites

- Node 18+
- A Supabase project
- A Gemini API key
- A Vercel account (for deployment) or `npm run dev` for local

### Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Required:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
GEMINI_API_KEY=AIza...
NEXT_PUBLIC_SITE_URL=http://localhost:3000   # or your prod URL
REACH_INGEST_TOKEN=<generate with: openssl rand -hex 32>
```

### Database

Run the migrations in order in the Supabase SQL editor:

```
supabase/migrations/001_initial.sql        — initial v1 schema
supabase/migrations/002_remove_auth.sql    — disable RLS for single-user mode
supabase/migrations/003_reach_v2.sql       — people/edges/posts/goals/actions/pgvector
```

For one-off data fixes accumulated during development, see `sql/`:

```
006_fix_concatenated_names.sql      — split "NameHeadline" rows that the old extractor produced
007_clean_reset.sql                 — wipe captured data, preserve goals/style
008_remove_false_positives.sql      — delete UI-label "people" records (Sort by:, Connections)
009_wipe_bad_messages.sql           — wipe message data from buggy v0.3.4
010_wipe_messages_again.sql         — same, plus notification-imposter rows
```

A fresh setup only needs `001 → 002 → 003`. The `sql/` scripts are historical fixes preserved for traceability.

### Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Deployment

Push to GitHub. Vercel auto-deploys from `main`. Set the same env vars in the Vercel project settings (Production + Preview + Development).

---

## Stack

| Layer       | Choice                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Frontend    | Next.js 14 App Router, TypeScript, Tailwind                                |
| Backend     | Next.js API routes (Node runtime), bearer-token auth                       |
| Database    | Supabase (Postgres 15) + pgvector for embeddings                           |
| AI          | Google Gemini 2.5 Flash (classify, draft) + text-embedding-004 (768 dim)   |
| Hosting     | Vercel                                                                     |
| Extension   | Vanilla JS, Manifest V3, no build step                                     |

Design language: Fraunces serif headings, Geist sans body, JetBrains Mono for code. Editorial / "magazine" feel — cream paper background, terracotta accents.

---

## Known limitations

**Messaging DOM is unreliable.** LinkedIn frequently redesigns the messaging interface and obfuscates class names. The extension's conversation-list extraction is brittle and may capture 0 conversations even when they're visible. The codebase has a fallback path for manual paste-in classification. For production-grade messaging automation, Unipile's hosted LinkedIn API is the recommended upgrade path — placeholder routes are already scaffolded at `app/api/unipile/`.

**Single-user mode.** No login. Anyone with the URL and the ingest token can read/write. Use `ALLOWED_EMAILS` env var with the future auth migration when productionizing for a real team.

**No deep crawling.** The extension never visits pages you didn't navigate to yourself. This is a safety feature, not a bug. To map 2nd-degree connections, you'd need to actually visit those profiles.

**Vercel cold starts.** First request after idle can take 2-3 seconds. Not an issue once warm.

---

## License & ownership

Private project. Not licensed for redistribution.

---

## Credits

Built with [Claude](https://claude.ai) as the pair-programming partner across multiple sessions, the long-running conversation log being equal parts spec, design doc, and therapy.
