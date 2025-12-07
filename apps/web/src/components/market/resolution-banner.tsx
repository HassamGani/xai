"use client";

interface ResolutionBannerProps {
  winningOutcome: string;
  resolvedAt: string;
  resolutionSummary?: string | null;
  resolutionSource?: string | null;
}

export function ResolutionBanner({
  winningOutcome,
  resolvedAt,
  resolutionSummary,
  resolutionSource
}: ResolutionBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl" />
      
      <div className="relative space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
            Market Resolved
          </span>
        </div>

        {/* Winning outcome */}
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Final Result</p>
          <p className="text-2xl font-bold text-foreground">{winningOutcome}</p>
        </div>

        {/* Resolution details */}
        {resolutionSummary && (
          <div className="space-y-1 pt-2 border-t border-emerald-500/20">
            <p className="text-sm text-muted-foreground">Resolution Summary</p>
            <p className="text-sm text-foreground">{resolutionSummary}</p>
          </div>
        )}

        {/* Source and date */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-2">
          {resolutionSource && (
            <div className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span>{resolutionSource}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Resolved {new Date(resolvedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

