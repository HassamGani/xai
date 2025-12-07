import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Outcome = {
  id: string;
  label: string;
  probability: number;
};

type Props = {
  outcomes: Outcome[];
  updatedAt?: string;
};

function formatPct(p: number) {
  return `${(p * 100).toFixed(1)}%`;
}

// Color based on probability - higher = more green, lower = more red
function getProbColor(p: number) {
  if (p >= 0.5) return "text-emerald-400";
  if (p >= 0.3) return "text-amber-400";
  return "text-rose-400";
}

export function OutcomeCards({ outcomes, updatedAt }: Props) {
  // Sort by probability descending
  const sorted = [...outcomes].sort((a, b) => b.probability - a.probability);

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((o, idx) => (
          <Card key={o.id} className="border border-white/15 bg-white/5 relative overflow-hidden">
            {/* Background bar showing probability */}
            <div 
              className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-transparent" 
              style={{ width: `${Math.max(o.probability * 100, 5)}%` }}
            />
            <CardHeader className="relative pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {idx === 0 && <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Leading</span>}
                {o.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="relative">
              <div className={`text-4xl font-bold ${getProbColor(o.probability)}`}>
                {formatPct(o.probability)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {updatedAt && (
        <p className="text-xs text-muted-foreground">
          Last updated {new Date(updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
