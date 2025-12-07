export function softmax(evidence: Record<string, number>): Record<string, number> {
  const values = Object.values(evidence);
  if (values.length === 0) return {};
  const max = Math.max(...values);
  const exps = Object.fromEntries(
    Object.entries(evidence).map(([k, v]) => [k, Math.exp(v - max)])
  ) as Record<string, number>;
  const sum = Object.values(exps).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(exps).map(([k, v]) => [k, v / (sum || 1)]));
}

