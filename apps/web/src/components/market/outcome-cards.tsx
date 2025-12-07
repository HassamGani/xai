import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Outcome = {
  id: string;
  label: string;
  probability: number;
};

type Props = {
  outcomes: Outcome[];
  updatedAt?: string;
  winningOutcomeId?: string;
};

function formatPct(p: number) {
  return `${(p * 100).toFixed(1)}%`;
}

function getProbColorByRank(rank: number, isWinner?: boolean) {
  if (isWinner) return "text-emerald-600 dark:text-emerald-400";
  // rank is 0-based after sorting descending
  if (rank === 0) return "text-emerald-600 dark:text-emerald-400";
  if (rank === 1) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function OutcomeCards({ outcomes, updatedAt, winningOutcomeId }: Props) {
  const sorted = [...outcomes].sort((a, b) => b.probability - a.probability);
  const isResolved = !!winningOutcomeId;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((o, idx) => {
          const isWinner = o.id === winningOutcomeId;
          const isLeading = !isResolved && idx === 0;
          
          return (
            <Card 
              key={o.id} 
              className={`relative overflow-hidden transition-all ${
                isWinner 
                  ? "ring-2 ring-emerald-500 bg-emerald-500/5" 
                  : isResolved && !isWinner 
                    ? "opacity-50" 
                    : ""
              }`}
            >
              <div
                className={`absolute inset-0 ${isWinner ? "bg-emerald-500/10" : "bg-primary/5"}`}
                style={{ width: `${Math.max(o.probability * 100, 5)}%` }}
              />
              <CardHeader className="relative pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {isWinner && (
                    <span className="text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Winner
                    </span>
                  )}
                  {isLeading && (
                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-medium">
                      Leading
                    </span>
                  )}
                  {o.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="relative pt-0">
                <div className={`text-3xl font-bold tabular-nums ${getProbColorByRank(idx, isWinner)}`}>
                  {formatPct(o.probability)}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {updatedAt && (
        <p className="text-xs text-muted-foreground">
          Last updated {new Date(updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
