"use client";

interface MarketInfoProps {
  normalizedQuestion?: string | null;
  estimatedResolutionDate?: string | null;
  resolutionCriteria?: string | null;
  totalPostsProcessed?: number;
  isResolved?: boolean;
}

export function MarketInfo({
  normalizedQuestion,
  estimatedResolutionDate,
  resolutionCriteria,
  totalPostsProcessed,
  isResolved
}: MarketInfoProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return {
        formatted: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        relative: "Past due",
        isPast: true
      };
    } else if (diffDays === 0) {
      return {
        formatted: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        relative: "Today",
        isPast: false
      };
    } else if (diffDays === 1) {
      return {
        formatted: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        relative: "Tomorrow",
        isPast: false
      };
    } else if (diffDays <= 7) {
      return {
        formatted: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        relative: `In ${diffDays} days`,
        isPast: false
      };
    } else if (diffDays <= 30) {
      const weeks = Math.ceil(diffDays / 7);
      return {
        formatted: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        relative: `In ${weeks} week${weeks > 1 ? "s" : ""}`,
        isPast: false
      };
    } else {
      const months = Math.ceil(diffDays / 30);
      return {
        formatted: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        relative: `In ~${months} month${months > 1 ? "s" : ""}`,
        isPast: false
      };
    }
  };

  const dateInfo = estimatedResolutionDate ? formatDate(estimatedResolutionDate) : null;
  
  // Don't render if there's nothing to show
  const hasContent = normalizedQuestion || estimatedResolutionDate || resolutionCriteria || (totalPostsProcessed && totalPostsProcessed > 0);
  if (!hasContent && !isResolved) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      {/* Resolution Date - always show for active markets */}
      {!isResolved && (
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Estimated Resolution</p>
            {dateInfo ? (
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-lg font-semibold text-foreground">{dateInfo.formatted}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  dateInfo.isPast 
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" 
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                }`}>
                  {dateInfo.relative}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">
                To be determined based on event
              </p>
            )}
          </div>
        </div>
      )}

      {/* Resolution Criteria */}
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Resolution Criteria</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {resolutionCriteria || "Resolves when the outcome becomes definitively known"}
          </p>
        </div>
      </div>

      {/* Normalized Question - only if different */}
      {normalizedQuestion && (
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Normalized Question</p>
            <p className="text-sm text-muted-foreground mt-0.5">{normalizedQuestion}</p>
          </div>
        </div>
      )}

      {/* Stats */}
      {typeof totalPostsProcessed === "number" && (
        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <span>{totalPostsProcessed > 0 ? `${totalPostsProcessed.toLocaleString()} posts analyzed` : "Awaiting posts"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
