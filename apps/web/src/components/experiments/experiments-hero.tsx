export function ExperimentsHero() {
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-emerald-500/10 p-6 shadow-sm space-y-3">
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-primary font-semibold">Experiments</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Backtest resolved questions</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create experiment markets for past events, pull historical X posts, run Grok scoring, and rebuild
          probability timelines to benchmark against known outcomes.
        </p>
      </div>
    </div>
  );
}

