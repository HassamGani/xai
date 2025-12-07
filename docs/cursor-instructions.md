# Project: X + Grok Real-Time Prediction Ticker

You are helping build a full-stack TypeScript app deployed on Vercel with Supabase as the database, plus integrations to:

- X API (filtered stream) for real-time posts
- xAI Grok API for LLM scoring

Cursor has MCP access to Vercel and Supabase: use that for env vars and DB where useful.

## High-level product

Build an app that turns X into a Kalshi-style prediction ticker:

- Users ask questions about future events, e.g., “Who will win the 2028 presidential election?”
- The system creates or reuses a **market** for that question.
- Each market has **outcomes** (e.g. `DONALD_TRUMP`, `KAMALA_HARRIS`, `OTHER`) with probabilities that always sum to 1.
- We **never** show raw firehose data; users see:
  - A canonical question
  - Outcome probability tickers and a probability-over-time graph
  - A small curated list of relevant posts with AI-generated labels (stance, credibility, short reason)

Under the hood, the system:

- Uses Grok (xAI API) to:
  - Normalize questions into structured markets and generate outcome sets
  - Propose X filtered-stream rules (keywords, handles, hashtags)
  - Score posts w.r.t. each outcome (relevance, stance, strength, credibility)
  - Label a small subset of posts for the UI (stance label, credibility label, reason)
- Uses X API filtered stream to:
  - Receive posts in real time matching market-specific rules
  - Include `public_metrics` and author metrics for weighting
- Maintains per-market state:
  - Cumulative “evidence” per outcome
  - A softmax-based probability vector over outcomes
  - A rolling active pool of posts (time-bounded, but contributions remain in cumulative evidence)

We **do not** resample metrics for old posts; all weighting is done at ingestion time based on author stats and initial public metrics.

## Architecture requirements

Use a modular monorepo-style structure (you can adapt for Vercel’s recommended layout):

- `/app` – Next.js app (React, TypeScript) for UI + API routes
- `/lib` – Shared application logic (market math, prompt builders, types)
- `/supabase` – SQL migrations / schema
- `/docs` – High-level docs (architecture, prompts, etc.)

Use:

- Next.js App Router
- TypeScript everywhere
- Supabase Postgres for persistence
- Vercel for hosting (Edge/Node as appropriate)
- Node fetch or axios for X/xAI HTTP calls

### Core services/modules

1. **Market Service**
   - Responsibilities:
     - Create markets from user questions
     - Normalize questions and outcomes via Grok
     - Store markets and outcomes in Supabase
     - Lookup/attach to existing markets (semantic similarity or keyword match)
   - Needs:
     - Data model for Market, Outcome
     - API endpoints:
       - `POST /api/markets/ask` – given a question, return existing or new market
       - `GET /api/markets` – list markets with current probabilities
       - `GET /api/markets/[id]` – market detail
       - `GET /api/markets/[id]/history` – probability time series
       - `GET /api/markets/[id]/posts` – curated posts for UI

2. **X Integration Service**
   - Responsibilities:
     - Manage filtered stream rules per market
     - Connect to X filtered stream and ingest posts
   - Behavior:
     - For each new market, take Grok’s suggested rule templates and register rules with X API
     - Maintain a dedicated ingestion endpoint or worker that:
       - Receives posts from a streaming connection or webhook
       - Enriches with author metrics (from expansions)
       - Publishes to an internal queue / directly to a scoring function
   - Implementation constraints:
     - For now, simulate the streaming pipeline with:
       - A serverless API route that can be wired to a separate worker or cron-like process
       - A simple in-memory or Supabase-backed “posts_inbox” table
     - Make it easy to later swap in a proper streaming worker

3. **Grok Scoring Service**
   - Responsibilities:
     - Batch posts and call xAI Grok API
     - For each post and outcome:
       - Compute `relevance`, `stance` (-1..1), `strength`, `credibility` (all floats)
   - Implementation:
     - Provide a reusable prompt builder that:
       - Takes a market question, outcomes, and a batch of posts (with text + metrics)
       - Asks Grok to return JSON mapping post IDs -> per-outcome scores
     - Implement a scoring function that:
       - Takes Grok output and computes `signal_weight` and `ΔE_o(p)` for each outcome

4. **Market Updater / Aggregation Logic**
   - Responsibilities:
     - Maintain per-market evidence state and probabilities
     - Apply cutoff logic for posts entering/leaving the active pool
   - Rules:
     - For each post p and outcome o:
       - `signal_weight_o(p) = relevance * |stance| * strength * credibility`
       - `metric_weight(p)` is a function of:
         - `log(author_followers + 1)`
         - `author_verified`
         - initial likes/reposts/replies/quotes
       - `ΔE_o(p) = sign(stance_o(p)) * signal_weight_o(p) * metric_weight(p)`
     - Accumulate evidence:
       - `E_o(t) = Σ ΔE_o(p) over all accepted posts up to t`
     - Compute probabilities:
       - `P(o | t) = softmax(E_o(t))` across all outcomes
     - Active pool:
       - Entry conditions: `relevance >= R_min`, `signal_weight >= S_min`, and basic metric cutoffs
       - Active for T hours, then marked inactive (but contribution to E_o already applied)

5. **UI Layer**
   - Market list page:
     - Shows list of markets with:
       - Canonical question
       - Current probabilities per outcome
       - Basic trend indicator
   - Market detail page:
     - Header with question, creation time, data volume
     - Outcome cards: label + current probability + sparkline
     - Time-series graph (multi-line) of probabilities
     - Below the graph: curated post list with:
       - Post text (or truncated)
       - Author handle + follower count
       - Stance label (e.g., “Bullish on Trump”)
       - Credibility label (“High credibility”, “Rumor / low credibility”)
       - One-sentence reason
   - Use client-side polling or WebSocket/SSE for live updates (start with polling for simplicity).

## Data model (Supabase)

Define tables roughly like this (Cursor should convert into proper SQL + types):

- `markets`:
  - `id` (uuid, pk)
  - `question` (text)
  - `normalized_question` (text)
  - `status` (enum: active/closed/resolved)
  - `created_at` (timestamp)
  - `x_rule_templates` (jsonb)
  - `total_posts_processed` (int)
- `outcomes`:
  - `id` (uuid, pk)
  - `market_id` (fk)
  - `outcome_id` (text, e.g., “DONALD_TRUMP”)
  - `label` (text)
  - `current_probability` (float)
  - `cumulative_support` (float)
  - `cumulative_oppose` (float)
  - `post_count` (int)
- `posts`:
  - `id` (uuid, pk)
  - `market_id` (fk)
  - `x_post_id` (text)
  - `ingested_at` (timestamp)
  - `expires_at` (timestamp)
  - `text` (text)
  - `author_id` (text)
  - `author_followers` (int)
  - `author_verified` (bool)
  - `metrics` (jsonb)  // likes, reposts, etc.
  - `scores` (jsonb)   // per-outcome relevance/stance/strength/credibility/signal_weight
  - `is_active` (bool)
  - `display_labels` (jsonb, nullable) // stance_label, credibility_label, reason for UI
- `probability_snapshots`:
  - `id` (uuid, pk)
  - `market_id` (fk)
  - `timestamp` (timestamp)
  - `probabilities` (jsonb: outcome_id -> float)

Cursor: generate migrations and Supabase types for these.

## External API integration details

### X API (filtered stream)

Implement a module like `lib/xClient.ts` which:

- Wraps X API calls using `X_BEARER_TOKEN` from env
- Provides functions:
  - `createFilteredRulesForMarket(market)`:
    - Takes Grok’s `x_rule_templates`
    - Calls X API rule endpoint to add rules
  - `connectStream()`:
    - (For now) provide a function that could be called from a Vercel function / separate worker to simulate or manage stream ingestion
    - Accepts a callback to push posts into Supabase or an in-memory queue

When requesting posts from the stream, request:

- `tweet.fields=created_at,public_metrics,lang,possibly_sensitive,referenced_tweets`
- `user.fields=created_at,public_metrics,verified,description`
- `expansions=author_id`

### xAI Grok API

Implement `lib/grokClient.ts` which:

- Uses `XAI_API_KEY` from env
- Exposes:
  - `createMarketFromQuestion(question: string)`:
    - Calls Grok with a prompt that returns JSON:
      - `normalized_question`
      - `outcomes[]`
      - `priors`
      - `x_rule_templates[]`
  - `scorePostsForMarket(market, postsBatch)`:
    - Batches N posts and calls Grok with a JSON-returning prompt
    - Returns per-post per-outcome scores
  - `labelPostsForDisplay(market, posts)`:
    - Takes scored posts and returns stance_label, credibility_label, reason per post for UI

Follow JSON-only responses (no extra commentary) so parsing is easy.

## Cursor best practices

When you operate:

1. First, read this file and summarize how you understand the system and what files you’ll create or modify.
2. Work incrementally:
   - Step 1: create Supabase schema/migrations + TypeScript types
   - Step 2: create `lib/xClient.ts` and `lib/grokClient.ts` with stubs
   - Step 3: implement market creation API + frontend
   - Step 4: implement a simple “mock stream ingestion” path to test end-to-end without a real X stream
3. Whenever you generate code:
   - Keep functions small and composable
   - Add inline comments where the logic is non-obvious
   - Prefer pure functions for math (e.g., evidence aggregation, softmax) in `lib/marketMath.ts`
4. Ask for clarification if anything in the spec is ambiguous before making big structural decisions.

Do **not**:

- Hardcode any secrets (X or xAI keys, Supabase keys)
- Overcomplicate streaming; a mock ingestion path is enough for v1

Your first action: list the concrete files and modules you propose to create, then wait for my confirmation before writing code.

## 2. What to do with X API keys

### Step 1: Get X API access

1. Go to https://developer.x.com and create a developer account (or log in).
2. Create a project/app and request access to v2 endpoints, including filtered stream.
3. Generate:
   - A **Bearer token** (App-level)
   - API key/secret (for future use if needed; for now, Bearer token is enough for server-side calls)

### Step 2: Store in Vercel env vars

In Vercel (via dashboard or `vercel env`):

- Add:
  - `X_BEARER_TOKEN=...`  (the long bearer token)
  - Optionally `X_API_KEY` / `X_API_SECRET` if you need them later

In Cursor, with MCP:

- Open the Vercel integration and ensure these env vars are available for your project.
- In your code, read them with `process.env.X_BEARER_TOKEN`.

### Step 3: Local dev

Create a local `.env.local` for Next.js:

```
X_BEARER_TOKEN=your-dev-token-here
```

Never commit this file.

## 3. What to do with xAI (Grok) API keys

### Step 1: Get a Grok API key

1. Go to xAI’s developer portal / docs (e.g. https://x.ai/api or the xAI console).
2. Create an account and load credits if needed.
3. Generate an API key from the “API Keys” page.

### Step 2: Store in Vercel env vars

Add to your Vercel project env:

```
XAI_API_KEY=your-grok-api-key
```

In code, read via `process.env.XAI_API_KEY`.

### Step 3: Local dev

Add to `.env.local`:

```
XAI_API_KEY=your-dev-grok-key
```

Again, don’t commit.

## 4. Supabase + Vercel wiring with Cursor MCP

Given you’re using Supabase and Vercel together:

1. In Supabase:
   - Create a project
   - Get the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` or anon key (for server-side API, service role is typical, but keep it server-only).
2. In Vercel:
   - Add env vars:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
3. Use the Vercel–Supabase integration (optional but nice) so Vercel can pull env vars directly from Supabase.

In Cursor:

- Use MCP Supabase access to:
  - Apply migrations
  - Inspect tables
- Use MCP Vercel access to:
  - Verify env vars
  - Deploy when ready

If you want, next step can be: “Generate the initial Supabase SQL schema and `lib/types.ts` for these tables based on the spec in the Cursor prompt.”

