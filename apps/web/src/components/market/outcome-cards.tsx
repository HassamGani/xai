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

function getProbColor(p: number) {
  if (p >= 0.5) return "text-emerald-600 dark:text-emerald-400";
  if (p >= 0.3) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function OutcomeCards({ outcomes, updatedAt }: Props) {
  const sorted = [...outcomes].sort((a, b) => b.probability - a.probability);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((o, idx) => (
          <Card key={o.id} className="relative overflow-hidden">
            <div
              className="absolute inset-0 bg-primary/5"
              style={{ width: `${Math.max(o.probability * 100, 5)}%` }}
            />
            <CardHeader className="relative pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                {idx === 0 && (
                  <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-medium">
                    Leading
                  </span>
                )}
                {o.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="relative pt-0">
              <div className={`text-3xl font-bold tabular-nums ${getProbColor(o.probability)}`}>
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
