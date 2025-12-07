export const dynamic = "force-dynamic";

import Link from "next/link";
import { listMarkets } from "@/lib/markets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function HomePage() {
  const markets = await listMarkets();

  const supabaseMissing = markets.length === 0;

  return (
    <div className="space-y-6">
      <div className="glass-strong rounded-2xl border border-white/12 px-6 py-5">
        <h2 className="text-xl font-semibold">Markets</h2>
        <p className="text-sm text-muted-foreground">
          Probabilities are derived from X posts scored by Grok. Click a market to view details.
        </p>
        {supabaseMissing ? (
          <p className="mt-2 text-xs text-destructive">
            Supabase env vars not detected; showing empty list until configured.
          </p>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {markets.map((m) => (
          <Link key={m.id} href={`/market/${m.id}`} className="group">
            <Card className="h-full transition hover:border-primary/60 hover:bg-white/10">
              <CardHeader>
                <CardTitle>{m.question}</CardTitle>
                <CardDescription>
                  Created {new Date(m.created_at).toLocaleString()} • Posts{" "}
                  {m.total_posts_processed ?? 0}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Normalized: {m.normalized_question ?? "n/a"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
        {markets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No markets found.</p>
        ) : null}
      </div>
    </div>
  );
}

