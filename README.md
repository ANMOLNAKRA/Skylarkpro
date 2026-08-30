# Skylark Drones — monday.com Business Intelligence Agent

A conversational AI agent that answers founder-level business questions by
querying live data from two monday.com boards (Work Orders, Deals), cleaning
it on the fly, and reasoning over it with an LLM.

**Live demo:** _[add your Vercel URL after deploying]_
**Repo:** _[add your GitHub URL]_

---

## Architecture

```
Browser (chat UI)
      │
      ▼
Next.js API route  /api/chat
      │
      ▼
Gemini 2.0 Flash (function calling)
      │  decides when to call tools
      ▼
Tool: get_work_orders / get_deals
      │
      ▼
monday.com GraphQL API (read-only)
      │  raw items + column_values
      ▼
Data cleaning layer (lib/dataClean.ts)
      │  strips junk rows, normalizes nulls/dates/numbers
      ▼
Cleaned JSON handed back to Gemini → reasons over it → conversational answer
```

**Why this shape:**
- **Single Next.js app** (UI + API in one deploy) — fastest to ship and host on
  Vercel with zero extra infra.
- **Board discovery by name, not hardcoded IDs** (`lib/monday.ts::findBoardId`) —
  satisfies "do not hardcode CSV data; query monday.com dynamically." The agent
  looks up boards by name substring match ("deal", "work order") every
  request (with a 5-minute in-memory cache to avoid hammering the API on
  every turn of a conversation).
- **Cleaning happens in code, not in the prompt** — deterministic, testable,
  and keeps token usage down. The LLM receives already-clean JSON and focuses
  purely on business reasoning, not on guessing what `""` or a duplicate
  header row means.
- **Gemini for reasoning** — free tier, function calling support, large
  context window (comfortably fits both boards' full cleaned data — ~520
  records total — so the model reasons over complete data rather than a
  sample).

## Setup

### 1. monday.com

1. Create a free monday.com account.
2. Import the two provided CSVs as **separate boards** via
   `+ Add → Import data → Excel/CSV`. Keep the original column headers —
   the cleaning layer uses keyword heuristics (`date`, `amount`, `value`,
   `quantity` in the header) to decide how to parse each column.
3. Name the boards so they contain the words "deal" and "work order"
   somewhere in the name (e.g. `skylark_deals`, `skylark_work_orders`).
4. Get a personal API token: profile avatar → **Developers** → **API token**.

### 2. Gemini

Get a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
(no credit card required).

### 3. Local development

```bash
npm install
cp .env.local.example .env.local
# fill in MONDAY_API_TOKEN and GEMINI_API_KEY in .env.local
npm run dev
```

### 4. Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel ([vercel.com/new](https://vercel.com/new)).
3. Add environment variables `MONDAY_API_TOKEN` and `GEMINI_API_KEY` in the
   Vercel project settings.
4. Deploy.

## Project structure

```
app/
  page.tsx            chat UI
  api/chat/route.ts   chat endpoint — runs the agent loop
lib/
  monday.ts           monday.com GraphQL client (board discovery, pagination)
  dataClean.ts         normalization: nulls, dates, numbers, junk-row filtering
  agent.ts             Gemini function-calling orchestration + system prompt
```

## Known limitations / what's not handled

See `DECISION_LOG.md` for the full breakdown of assumptions, trade-offs, and
what we'd improve with more time.

## AI tools used

Built with assistance from Claude (Anthropic) for scaffolding, data-cleaning
logic design, and debugging; Gemini 2.0 Flash powers the deployed agent's
reasoning at runtime.
