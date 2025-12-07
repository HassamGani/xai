export const dynamic = "force-dynamic";

import { listMarkets } from "@/lib/markets";
import { MarketList } from "@/components/market/market-list";

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
        {supabaseMissing && (
          <p className="mt-2 text-xs text-destructive">
            Supabase env vars not detected; showing empty list until configured.
          </p>
        )}
      </div>

      <MarketList markets={markets} />
    </div>
  );
}
