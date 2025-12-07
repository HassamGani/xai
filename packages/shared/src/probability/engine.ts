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

