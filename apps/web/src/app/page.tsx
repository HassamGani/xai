export const dynamic = "force-dynamic";

import { listMarkets } from "@/lib/markets";
import { MarketList } from "@/components/market/market-list";

export default async function HomePage() {
  const markets = await listMarkets();

  const supabaseMissing = markets.length === 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Markets</h2>
        <p className="text-sm text-muted-foreground">
          Probabilities derived from X posts scored by Grok
        </p>
        {supabaseMissing && (
          <p className="text-xs text-destructive">
            Database not configured or no markets found
          </p>
        )}
      </div>

      <MarketList markets={markets} />
    </div>
  );
}
