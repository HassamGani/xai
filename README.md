# xPredict — Probabilities from Public Discourse

AI-powered “Kalshi-like” probability tickers that turn live X (Twitter) posts into calibrated outcome probabilities—without order books or trading liquidity.

## Inspiration

We love how Kalshi demonstrated regulated prediction markets, but order books require liquidity. X already contains dense, real-time signals from experts and the public. By combining:
- Structured outcomes from prediction markets
- Real-time X discourse
- xAI Grok for reasoning and structured scoring

…we derive probabilities directly from public conversation.

## What It Does

- Ask a question (e.g., “Will the Fed cut rates in December 2024?”) and Grok normalizes it, proposes mutually exclusive outcomes, and creates X filter rules.
- Ingestion worker listens to X filtered stream; posts are scored by Grok for relevance, stance, strength, and credibility.
- Deterministic probability engine aggregates evidence with decay, dilution, and temperature-scaled softmax; Supabase stores markets, posts, scores, and snapshots.
- Web app shows live probabilities, charts, and curated evidence. Users can “Ask Grok” for explanations, deep dives, and cross-market correlations.
- Automatic resolution uses Grok’s knowledge; resolved markets feed the ML feedback loop for calibration.

## Core Formula (Simplified)

For outcome \(o\) at time \(t\):
- \(P(o|t) = \text{softmax}(E_o / T)\)
- \(E_o(t) = \sum_p \Delta E_{o,p}\)
- \(\Delta E_o = \text{sign}(\text{stance}_o) \cdot (\text{relevance} \cdot \text{strength} \cdot \text{credibility})^\gamma \cdot M \cdot A \cdot D \cdot S\)

Modifiers include temporal decay, author dilution, metric weighting, and smoothing to keep probabilities stable.

## Architecture

- `apps/web` — Next.js 14 App Router UI (Vercel). Stateless handlers only.
- `packages/shared` — Pure TypeScript: probability engine, contracts, Grok schemas.
- `services/ingestion-worker` — Long-lived X filtered-stream consumer; adds rules, ingests posts, writes to Supabase.
- `services/scoring-worker` — Batch Grok scoring (can be merged with ingestion).
- `supabase` — Source-of-truth migrations, schema, and RLS.

### Data Flow
1) Ask → market + outcomes + X rules created  
2) X filtered stream → raw_posts  
3) Grok scores → scored_posts  
4) Probability engine → market_probabilities + snapshots  
5) Supabase Realtime → web UI updates  
6) Resolution → training data for calibration

## Tech Stack

- Web: Next.js 14, React 18, TailwindCSS, Radix UI, Lightweight Charts
- Backend: Next.js API Routes, Supabase (Postgres, Auth, Realtime)
- AI/ML: xAI Grok 3; LightGBM and PyTorch for calibration/quality; Optuna/SHAP for tuning
- Validation: Zod schemas for every LLM boundary and API contract
- Languages: TypeScript, Python, SQL

## Key Implementation Notes

- Pure probability engine in `packages/shared/src/probability/*` (deterministic, no I/O).
- Grok calls are schema-validated; defensive parsing handles fenced JSON or malformed outputs.
- Stability controls: author dilution (cap repeat authors), temporal decay with grace period, adaptive temperature, EMA smoothing.
- Duplicate market detection via semantic similarity before creating new markets.
- Multi-depth Grok analysis (Quick/Standard/Deep Dive) with web search + citations.

## Getting Started (Local)

Prereqs: Node 20+, npm 10 (workspace root uses npm), Python 3.10+ for ML workers if needed.

Install deps:
```
npm install
```

Run web (from repo root):
```
npm run dev
```

Other scripts:
- `npm run build` — Next.js build for web
- `npm run lint` — lint web
- `npm test` — Vitest (shared package tests)

Workers: `services/ingestion-worker` and `services/scoring-worker` are Node-based; install inside each package if running locally. ML service lives in `services/ml` (Python).

## Environment

Add a `.env` (or `.env.local` for web) with at least:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (workers only; never ship to web)
- `X_API_KEY`, `X_API_SECRET`, `X_BEARER_TOKEN` (ingestion worker)
- `GROK_API_KEY` (workers)
- `INTERNAL_WEBHOOK_SECRET` (internal routes)

Never commit secrets; keep `.env.example` updated when adding required keys.

## Deployment

- Web (`apps/web`) deploys to Vercel; keep handlers stateless and short-lived.
- Long-lived ingestion/scoring run off Vercel (separate runtime).
- Supabase migrations in `supabase/migrations` are authoritative; apply via CI or Supabase CLI.

## Testing

- Probability engine and shared utilities: `npm test` (Vitest).
- Web lint/typecheck: `npm run lint`.
- Add integration tests for API routes (happy path + auth failure + invalid payload).

## Roadmap

- Train calibration models on resolved markets to reduce bias.
- Expand ingestion sources (Reddit, news, official data).
- Add user accounts and reputation for forecast accuracy.
- Backtesting and historical replay for accuracy metrics.
- Public API for probabilities.
- Mobile experience for on-the-go tracking.

