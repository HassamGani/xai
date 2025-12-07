export function softmax(
  evidence: Record<string, number>,
  temperature: number = 1.0
): Record<string, number> {
  const entries = Object.entries(evidence);
  if (entries.length === 0) return {};
  
  // Scale by temperature (lower = more extreme, higher = more uniform)
  const scaled = entries.map(([k, v]) => [k, v / temperature] as const);
  
  // Numerical stability: subtract max
  const max = Math.max(...scaled.map(([, v]) => v));
  const exps = scaled.map(([k, v]) => [k, Math.exp(v - max)] as const);
  const sum = exps.reduce((a, [, v]) => a + v, 0);
  
  return Object.fromEntries(exps.map(([k, v]) => [k, v / (sum || 1)]));
}

