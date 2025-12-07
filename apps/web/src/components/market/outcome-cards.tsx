import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

export function OutcomeCards({ outcomes, updatedAt }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {outcomes.map((o) => (
        <Card key={o.id} className="border border-white/15 bg-white/5">
          <CardHeader>
            <CardTitle>{o.label}</CardTitle>
            <CardDescription>Outcome</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-3xl font-semibold">{formatPct(o.probability)}</div>
            <Badge variant="secondary">{o.id}</Badge>
          </CardContent>
        </Card>
      ))}
      {updatedAt ? (
        <p className="col-span-full text-xs text-muted-foreground">
          Updated {new Date(updatedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

