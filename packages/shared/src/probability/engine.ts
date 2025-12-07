/**
 * Probability Engine V1
 * 
 * Core probability computation for prediction markets.
 * See packages/shared/40-probability-engine for algorithm details.
 * 
 * ML Integration:
 * - When ML_MODE is enabled, the engine can use ML-corrected probabilities
 * - The ML service learns from resolved markets to improve predictions
 * - See packages/shared/src/ml/ for the ML client
 */

const EPS = 1e-12;
const LN2 = Math.log(2);

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function softmaxStable(logits: number[]) {
  const m = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - m));
  const s = exps.reduce((a, b) => a + b, 0) + EPS;
  return exps.map((e) => e / s);
}

function renormFloor(probs: number[], floor: number) {
  const floored = probs.map((p) => Math.max(p, floor));
  const s = floored.reduce((a, b) => a + b, 0) + EPS;
  return floored.map((p) => p / s);
}

function centeredLogitsFromProbs(probs: number[]) {
  const logs = probs.map((p) => Math.log(p + EPS));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  return logs.map((l) => l - mean);
}

export type Scores = {
  relevance: number;
  stance: number;
  strength: number;
  credibility: number;
  confidence?: number;
};

export type PostInput = {
  id: string;
  created_at_ms: number;
  author_id: string;
  author_followers?: number | null;
  author_verified?: boolean | null;
  author_created_at_ms?: number | null;
  text?: string | null;
  features?: { cashtag_count?: number; url_count?: number; is_reply?: boolean; is_quote?: boolean };
  initial_metrics?: { likes?: number; reposts?: number; replies?: number; quotes?: number };
  scores: Record<string, Scores>;
};

export type OutcomeInput = { id: string; label: string; prior_probability?: number | null };

export function computeProbabilitiesV1(args: {
  now_ms: number;
  outcomes: OutcomeInput[];
  prev_probabilities?: Record<string, number>;
  posts: PostInput[];
}) {
  const { now_ms, outcomes, posts } = args;
  const K = outcomes.length;

  // previous probs (fallback to priors or uniform)
  const prior = outcomes.map((o) => clamp(o.prior_probability ?? 1 / K, 1e-6, 1));
  const priorNorm = (() => {
    const s = prior.reduce((a, b) => a + b, 0) + EPS;
    return prior.map((p) => p / s);
  })();

  const prev = outcomes.map((o, i) => {
    const p = args.prev_probabilities?.[o.id];
    return p == null ? priorNorm[i] : clamp(p, 1e-6, 1);
  });
  const prevNorm = (() => {
    const s = prev.reduce((a, b) => a + b, 0) + EPS;
    return prev.map((p) => p / s);
  })();

  // author counts (24h window) for dilution
  const authorCounts = new Map<string, number>();
  const DAY_MS = 24 * 3600 * 1000;
  for (const p of posts) {
    if (now_ms - p.created_at_ms <= DAY_MS) {
      authorCounts.set(p.author_id, (authorCounts.get(p.author_id) ?? 0) + 1);
    }
  }

  // params
  const GRACE_SEC = 300;
  const HALF_LIFE_SEC = 6 * 3600; // 6h
  const MAX_AGE_SEC = 72 * 3600;
  const GAMMA = 1.15;
  const STANCE_K = 1.6;
  const W_MIN = 0.018;

  const muF = 8,
    sigF = 1.5;
  const muE = 2,
    sigE = 1.5;

  const deltaE = new Array(K).fill(0);
  let Wbatch = 0;
  let accepted = 0;

  for (const p of posts) {
    const ageSec = Math.max(0, (now_ms - p.created_at_ms) / 1000);
    if (ageSec > MAX_AGE_SEC) continue;

    const D = ageSec <= GRACE_SEC ? 1 : Math.exp(-LN2 * ((ageSec - GRACE_SEC) / HALF_LIFE_SEC));

    const followers = Math.max(0, p.author_followers ?? 0);
    const verified = !!p.author_verified;

    const likes = p.initial_metrics?.likes ?? 0;
    const reposts = p.initial_metrics?.reposts ?? 0;
    const replies = p.initial_metrics?.replies ?? 0;
    const quotes = p.initial_metrics?.quotes ?? 0;

    const E = Math.log1p(likes + 2 * reposts + 1.5 * replies + 2.5 * quotes);

    const f = sigmoid((Math.log1p(followers) - muF) / sigF);
    const e = sigmoid((E - muE) / sigE);

    const M = (0.75 + 0.25 * f) * (0.85 + 0.15 * e) * (verified ? 1.2 : 1.0);

    const n = authorCounts.get(p.author_id) ?? 1;
    const A = Math.max(0.35, 1 / Math.sqrt(1 + 0.75 * Math.max(0, n - 1)));

    const cashtags = p.features?.cashtag_count ?? 0;
    const urls = p.features?.url_count ?? 0;
    const Sc = cashtags >= 6 ? 0.55 : cashtags >= 4 ? 0.75 : 1.0;
    const Su = urls >= 2 ? 0.85 : 1.0;
    const S = Sc * Su;

    // compute Zp and Wp
    let maxRel = 0;
    let maxCred = 0;
    let Zp = 0;

    for (const [, sc] of Object.entries(p.scores)) {
      const r = clamp(sc.relevance, 0, 1);
      const st = clamp(sc.strength, 0, 1);
      const cr = clamp(sc.credibility, 0, 1);
      const stance = clamp(sc.stance, -1, 1);
      maxRel = Math.max(maxRel, r);
      maxCred = Math.max(maxCred, cr);

      const sem = r * st * cr;
      Zp = Math.max(Zp, sem * Math.abs(stance));
    }

    const Wp = Math.pow(Zp, GAMMA) * M * A * D * S;

    // thresholding
    const accept =
      ageSec <= GRACE_SEC
        ? maxRel >= 0.1 && Zp >= 0.025
        : maxRel >= 0.2 && maxCred >= 0.15 && Wp >= W_MIN;

    if (!accept) continue;

    // apply per-outcome deltas
    for (let i = 0; i < K; i++) {
      const oid = outcomes[i].id;
      const sc = p.scores[oid];
      if (!sc) continue;

      const r = clamp(sc.relevance, 0, 1);
      const st = clamp(sc.strength, 0, 1);
      const cr0 = clamp(sc.credibility, 0, 1);
      const conf = clamp(sc.confidence ?? 1, 0, 1);
      const cr = cr0 * conf;

      const stance = clamp(sc.stance, -1, 1);
      const sem = r * st * cr;
      const stanceAdj = Math.tanh(STANCE_K * stance);

      const d = (stanceAdj * Math.pow(sem, GAMMA) * M * A * D * S) / Math.sqrt(K);
      deltaE[i] += d;
    }

    Wbatch += Wp;
    accepted++;
  }

  const prevLogits = centeredLogitsFromProbs(prevNorm);
  const instLogits = prevLogits.map((l, i) => l + deltaE[i]);

  const T0 = 1.0;
  const alpha = 0.6;
  const T = T0 * (1 + alpha / Math.sqrt(1 + Wbatch));

  const pInst = softmaxStable(instLogits.map((x) => x / T));

  const tau = 0.65;
  const beta = 1 - Math.exp(-Wbatch / tau);

  const pNew = prevNorm.map((p, i) => (1 - beta) * p + beta * pInst[i]);

  const floor = Math.max(0.001, 0.01 / K);
  const pFinal = renormFloor(pNew, floor);

  const out: Record<string, number> = {};
  outcomes.forEach((o, i) => (out[o.id] = pFinal[i]));

  return {
    probabilities: out,
    algorithm: "evidence-softmax-v1",
    notes: { accepted_posts: accepted, Wbatch, beta, temperature: T, floor }
  };
}

/**
 * ML-enhanced probability computation
 * 
 * This wraps computeProbabilitiesV1 and optionally applies ML corrections
 * when the ML service is available and returns a valid correction.
 * 
 * @param args - Same args as computeProbabilitiesV1, plus ML options
 * @returns Probabilities with optional ML correction metadata
 */
export async function computeProbabilitiesWithML(args: {
  now_ms: number;
  outcomes: OutcomeInput[];
  prev_probabilities?: Record<string, number>;
  posts: PostInput[];
  market_id?: string;
  ml_enabled?: boolean;
  ml_client?: {
    predictCorrection: (req: unknown) => Promise<{
      probabilities_corrected: Record<string, number>;
      model_version: string;
      confidence: number;
    } | null>;
  };
}) {
  // First compute base probabilities using V1 algorithm
  const baseResult = computeProbabilitiesV1({
    now_ms: args.now_ms,
    outcomes: args.outcomes,
    prev_probabilities: args.prev_probabilities,
    posts: args.posts,
  });

  // If ML is not enabled or no client, return base result
  if (!args.ml_enabled || !args.ml_client || !args.market_id) {
    return {
      ...baseResult,
      ml_applied: false,
    };
  }

  // Try to get ML correction
  try {
    const { notes } = baseResult;
    
    // Prepare ML request
    const mlRequest = {
      market_id: args.market_id,
      current_probabilities: baseResult.probabilities,
      market_features: {
        K: args.outcomes.length,
        duration_days: 0, // Would need to compute from market data
        avg_posts_per_hour: 0,
      },
      recent_summary: {
        Wbatch: notes.Wbatch,
        last_hour_delta: 0,
        top_post_features: args.posts.slice(0, 5).map(p => {
          const scores = Object.values(p.scores)[0] || { relevance: 0, stance: 0, strength: 0, credibility: 0, confidence: 0 };
          return {
            relevance: scores.relevance,
            stance: scores.stance,
            strength: scores.strength,
            credibility: scores.credibility,
            confidence: scores.confidence || 0,
            log_followers: Math.log1p(p.author_followers || 0),
            author_verified: !!p.author_verified,
          };
        }),
      },
    };

    const correction = await args.ml_client.predictCorrection(mlRequest);

    if (correction && correction.confidence > 0.5) {
      return {
        probabilities: correction.probabilities_corrected,
        algorithm: "evidence-softmax-v1+ml",
        notes: {
          ...notes,
          ml_version: correction.model_version,
          ml_confidence: correction.confidence,
          base_probabilities: baseResult.probabilities,
        },
        ml_applied: true,
      };
    }
  } catch (error) {
    // ML failed, fall back to base result
    console.error("ML correction failed:", error);
  }

  return {
    ...baseResult,
    ml_applied: false,
  };
}

/**
 * Compute expected usefulness of a post (for filtering/ranking)
 * 
 * This can be used to pre-filter posts before scoring,
 * or to rank posts by expected impact.
 */
export function computePostUsefulness(post: PostInput, outcome_id: string): number {
  const scores = post.scores[outcome_id];
  if (!scores) return 0;

  const { relevance, stance, strength, credibility, confidence = 1 } = scores;
  
  // Semantic strength (same as in V1)
  const semanticStrength = relevance * strength * credibility * confidence;
  
  // Stance contribution (absolute value matters for impact)
  const stanceImpact = Math.abs(stance);
  
  // Author quality proxy
  const followers = post.author_followers || 0;
  const authorQuality = sigmoid((Math.log1p(followers) - 8) / 1.5);
  
  // Combined usefulness score
  return semanticStrength * stanceImpact * (0.5 + 0.5 * authorQuality);
}

