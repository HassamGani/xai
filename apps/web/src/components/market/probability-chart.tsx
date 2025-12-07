"use client";

import { useEffect, useRef, useState } from "react";

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

const TIME_RANGES: { value: TimeRange; label: string; seconds: number | null }[] = [
  { value: "1d", label: "1D", seconds: 24 * 60 * 60 },
  { value: "1w", label: "1W", seconds: 7 * 24 * 60 * 60 },
  { value: "1m", label: "1M", seconds: 30 * 24 * 60 * 60 },
  { value: "all", label: "All", seconds: null }
];

export function ProbabilityChart({ series, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");

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
            mode: 0, // Normal mode - crosshair moves freely
            vertLine: {
              width: 1,
              color: "rgba(255,255,255,0.3)",
              style: 2, // Dashed
              labelBackgroundColor: "rgba(59, 130, 246, 0.8)"
            },
            horzLine: {
              width: 1,
              color: "rgba(255,255,255,0.3)",
              style: 2,
              labelBackgroundColor: "rgba(59, 130, 246, 0.8)"
            }
          }
        });
        chartRef.current = chart;

        const chartAny = chart as unknown as Record<string, unknown>;

        for (const s of validSeries) {
          try {
            let line: unknown;

            const seriesOpts = {
              color: s.color,
              lineWidth: 2,
              title: s.label,
              lastValueVisible: true,
              priceLineVisible: false,
              crosshairMarkerVisible: true,
              crosshairMarkerRadius: 5,
              crosshairMarkerBorderColor: s.color,
              crosshairMarkerBackgroundColor: "#fff"
            };

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
            }
          } catch (seriesErr) {
            console.error(`Error adding series ${s.label}:`, seriesErr);
          }
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
          if (chartRef.current && typeof (chartRef.current as Record<string, unknown>).remove === "function") {
            try {
              (chartRef.current as { remove: Function }).remove();
            } catch (e) {
              // ignore
            }
          }
          chartRef.current = null;
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
  }, [mounted, height, filteredSeries, timeRange]);

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
      {hasFilteredData ? (
        <div ref={containerRef} className="w-full rounded bg-white/5" style={{ height }} />
      ) : (
        <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
          No data for selected time range
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        {series.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
