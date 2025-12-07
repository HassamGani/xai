"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Series = {
  id: string;
  label: string;
  color: string;
  data: { time: number; value: number }[];
};

type Props = {
  series: Series[];
  height?: number;
};

type TimeRange = "1d" | "1w" | "1m" | "all";

type TooltipData = {
  x: number;
  y: number;
  label: string;
  color: string;
  value: number;
}[];

const TIME_RANGES: { value: TimeRange; label: string; seconds: number | null }[] = [
  { value: "1d", label: "1D", seconds: 24 * 60 * 60 },
  { value: "1w", label: "1W", seconds: 7 * 24 * 60 * 60 },
  { value: "1m", label: "1M", seconds: 30 * 24 * 60 * 60 },
  { value: "all", label: "All", seconds: null }
];

export function ProbabilityChart({ series, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<unknown>(null);
  const seriesMapRef = useRef<Map<string, unknown>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [tooltips, setTooltips] = useState<TooltipData>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter series data by time range
  const filteredSeries = series.map((s) => {
    const rangeConfig = TIME_RANGES.find((r) => r.value === timeRange);
    if (!rangeConfig?.seconds) return s; // "all" - no filtering

    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - rangeConfig.seconds;

    return {
      ...s,
      data: s.data.filter((d) => d.time >= cutoff)
    };
  });

  const handleCrosshairMove = useCallback((param: unknown) => {
    const p = param as { 
      time?: number; 
      point?: { x: number; y: number };
      seriesData?: Map<unknown, { value?: number }>;
    };
    
    if (!p.time || !p.point || !p.seriesData || !chartRef.current) {
      setTooltips([]);
      return;
    }

    const tips: TooltipData = [];
    const chart = chartRef.current as { timeScale: () => { width: () => number } };

    // Get values from each series
    for (const s of series) {
      const seriesRef = seriesMapRef.current.get(s.id);
      if (seriesRef) {
        const data = p.seriesData.get(seriesRef);
        if (data && typeof data.value === "number") {
          // Calculate Y coordinate for this series value
          const priceScale = (seriesRef as { priceToCoordinate: (price: number) => number | null }).priceToCoordinate(data.value);
          
          if (priceScale !== null) {
            tips.push({
              x: p.point.x,
              y: priceScale,
              label: s.label,
              color: s.color,
              value: data.value
            });
          }
        }
      }
    }

    // Sort by Y coordinate (screen position top-to-bottom)
    tips.sort((a, b) => a.y - b.y);

    // Prevent Overlap Logic
    const TOOLTIP_HEIGHT = 28; // Approximate height of tooltip
    const CHART_HEIGHT = (containerRef.current?.clientHeight ?? height);

    // Forward pass: push down
    for (let i = 1; i < tips.length; i++) {
      const prev = tips[i - 1];
      const curr = tips[i];
      if (curr.y < prev.y + TOOLTIP_HEIGHT) {
        curr.y = prev.y + TOOLTIP_HEIGHT;
      }
    }

    // Check bottom bound and ripple up
    const last = tips[tips.length - 1];
    if (last && last.y > CHART_HEIGHT - TOOLTIP_HEIGHT/2) {
      const diff = last.y - (CHART_HEIGHT - TOOLTIP_HEIGHT/2);
      last.y -= diff;
      for (let i = tips.length - 2; i >= 0; i--) {
        if (tips[i + 1].y - tips[i].y < TOOLTIP_HEIGHT) {
          tips[i].y = tips[i + 1].y - TOOLTIP_HEIGHT;
        }
      }
    }

    // Check top bound and ripple down (rare but possible)
    const first = tips[0];
    if (first && first.y < TOOLTIP_HEIGHT/2) {
      const diff = (TOOLTIP_HEIGHT/2) - first.y;
      first.y += diff;
      for (let i = 1; i < tips.length; i++) {
        if (tips[i].y - tips[i - 1].y < TOOLTIP_HEIGHT) {
          tips[i].y = tips[i - 1].y + TOOLTIP_HEIGHT;
        }
      }
    }

    setTooltips(tips);
  }, [series, height]);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    // Check if we have any valid data
    const validSeries = filteredSeries
      .map((s) => ({
        ...s,
        data: (s.data || [])
          .filter((d) => typeof d.time === "number" && !isNaN(d.time) && d.time > 0 && typeof d.value === "number" && !isNaN(d.value))
          .sort((a, b) => a.time - b.time)
      }))
      .map((s) => {
        // Dedupe by time
        const seen = new Set<number>();
        const deduped: { time: number; value: number }[] = [];
        for (const d of s.data) {
          if (!seen.has(d.time)) {
            seen.add(d.time);
            deduped.push(d);
          }
        }
        return { ...s, data: deduped };
      })
      .filter((s) => s.data.length > 0);

    if (validSeries.length === 0) {
      return;
    }

    let chart: unknown;
    let cleanupFn: (() => void) | undefined;

    const initChart = async () => {
      try {
        const lc = await import("lightweight-charts");
        const { createChart, ColorType, LineSeries } = lc;

        if (!containerRef.current) return;

        chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "#dbeafe"
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.08)" },
            horzLines: { color: "rgba(255,255,255,0.08)" }
          },
          rightPriceScale: {
            borderVisible: false,
            scaleMargins: { top: 0.1, bottom: 0.1 }
          },
          timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: false
          },
          crosshair: {
            mode: 1, // Magnet mode
            vertLine: {
              width: 1,
              color: "rgba(255,255,255,0.4)",
              style: 0,
              labelBackgroundColor: "rgba(59, 130, 246, 0.9)"
            },
            horzLine: {
              visible: false,
              labelVisible: false
            }
          },
          handleScale: false,
          handleScroll: false
        });
        chartRef.current = chart;
        seriesMapRef.current.clear();

        const chartAny = chart as unknown as Record<string, unknown>;

        for (const s of validSeries) {
          try {
            const seriesOpts = {
              color: s.color,
              lineWidth: 2,
              title: s.label,
              lastValueVisible: false,
              priceLineVisible: false,
              crosshairMarkerVisible: true,
              crosshairMarkerRadius: 4,
              crosshairMarkerBorderColor: s.color,
              crosshairMarkerBackgroundColor: s.color // Solid dot
            };

            let line: unknown;

            // Try v4 style first (addLineSeries)
            if (typeof chartAny.addLineSeries === "function") {
              line = (chartAny.addLineSeries as Function)(seriesOpts);
            }
            // Try v5 style with LineSeries
            else if (LineSeries && typeof chartAny.addSeries === "function") {
              line = (chartAny.addSeries as Function)(LineSeries, seriesOpts);
            }
            // Fallback
            else if (typeof chartAny.addSeries === "function") {
              line = (chartAny.addSeries as Function)({ type: "Line" });
              if (line && typeof (line as Record<string, unknown>).applyOptions === "function") {
                (line as { applyOptions: Function }).applyOptions(seriesOpts);
              }
            }

            if (line && typeof (line as Record<string, unknown>).setData === "function") {
              (line as { setData: Function }).setData(s.data);
              seriesMapRef.current.set(s.id, line);
            }
          } catch (seriesErr) {
            console.error(`Error adding series ${s.label}:`, seriesErr);
          }
        }

        // Subscribe to crosshair move
        if (chart && typeof (chart as Record<string, unknown>).subscribeCrosshairMove === "function") {
          (chart as { subscribeCrosshairMove: Function }).subscribeCrosshairMove(handleCrosshairMove);
        }

        if (chart && typeof (chart as Record<string, unknown>).timeScale === "function") {
          ((chart as { timeScale: Function }).timeScale() as { fitContent: Function }).fitContent();
        }

        const handleResize = () => {
          if (!containerRef.current || !chartRef.current) return;
          (chartRef.current as { applyOptions: Function }).applyOptions({
            width: containerRef.current.clientWidth
          });
        };

        window.addEventListener("resize", handleResize);

        cleanupFn = () => {
          window.removeEventListener("resize", handleResize);
          if (chartRef.current) {
            if (typeof (chartRef.current as Record<string, unknown>).unsubscribeCrosshairMove === "function") {
              (chartRef.current as { unsubscribeCrosshairMove: Function }).unsubscribeCrosshairMove(handleCrosshairMove);
            }
            if (typeof (chartRef.current as Record<string, unknown>).remove === "function") {
              try {
                (chartRef.current as { remove: Function }).remove();
              } catch (e) {
                // ignore
              }
            }
          }
          chartRef.current = null;
          seriesMapRef.current.clear();
        };
      } catch (err) {
        console.error("Chart init error:", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    initChart();

    return () => {
      if (cleanupFn) cleanupFn();
    };
  }, [mounted, height, filteredSeries, timeRange, handleCrosshairMove]);

  if (!mounted) {
    return <div className="w-full bg-white/5 rounded animate-pulse" style={{ height: height + 48 }} />;
  }

  if (error) {
    return (
      <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Chart error: {error}
      </div>
    );
  }

  const hasData = series.some((s) => s.data && s.data.length > 0);
  const hasFilteredData = filteredSeries.some((s) => s.data && s.data.length > 0);

  if (!hasData) {
    return (
      <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No probability history yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Time range selector */}
      <div className="flex items-center gap-1 p-1 bg-white/5 rounded-lg w-fit">
        {TIME_RANGES.map((range) => (
          <button
            key={range.value}
            onClick={() => setTimeRange(range.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              timeRange === range.value
                ? "bg-blue-500/80 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-white/10"
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>

      {/* Chart container */}
      <div className="relative group cursor-crosshair">
        {hasFilteredData ? (
          <div ref={containerRef} className="w-full rounded bg-white/5" style={{ height }} />
        ) : (
          <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            No data for selected time range
          </div>
        )}

        {/* Floating Tooltips */}
        {tooltips.map((tip) => (
          <div
            key={tip.label}
            className="absolute pointer-events-none flex items-center gap-2 transform -translate-y-1/2 z-10 transition-transform duration-75"
            style={{
              left: tip.x + 10, // Offset to right of cursor
              top: tip.y,
            }}
          >
            <div 
              className="px-2 py-1 rounded shadow-lg backdrop-blur-md border border-white/10 text-xs font-medium flex items-center gap-2"
              style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tip.color }} />
              <span className="text-white whitespace-nowrap">{tip.label}</span>
              <span className="font-bold tabular-nums" style={{ color: tip.color }}>
                {(tip.value * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
