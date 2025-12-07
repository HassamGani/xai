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

type HoverData = {
  time: string;
  values: { label: string; color: string; value: number }[];
} | null;

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
  const [hoverData, setHoverData] = useState<HoverData>(null);

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
    const p = param as { time?: number; seriesData?: Map<unknown, { value?: number }> };
    
    if (!p.time || !p.seriesData) {
      setHoverData(null);
      return;
    }

    const time = new Date(p.time * 1000).toLocaleString();
    const values: { label: string; color: string; value: number }[] = [];

    // Get values from each series
    for (const s of series) {
      const seriesRef = seriesMapRef.current.get(s.id);
      if (seriesRef) {
        const data = p.seriesData.get(seriesRef);
        if (data && typeof data.value === "number") {
          values.push({
            label: s.label,
            color: s.color,
            value: data.value
          });
        }
      }
    }

    if (values.length > 0) {
      setHoverData({ time, values });
    } else {
      setHoverData(null);
    }
  }, [series]);

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
            mode: 0,
            vertLine: {
              width: 1,
              color: "rgba(255,255,255,0.4)",
              style: 0,
              labelBackgroundColor: "rgba(59, 130, 246, 0.9)"
            },
            horzLine: {
              visible: false // Hide horizontal line since we show all values in tooltip
            }
          }
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
              lastValueVisible: false, // Hide last value labels on right
              priceLineVisible: false,
              crosshairMarkerVisible: true,
              crosshairMarkerRadius: 6,
              crosshairMarkerBorderWidth: 2,
              crosshairMarkerBorderColor: s.color,
              crosshairMarkerBackgroundColor: "#1e293b"
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

  // Get latest values for legend when not hovering
  const latestValues = series.map((s) => {
    const lastPoint = s.data[s.data.length - 1];
    return {
      label: s.label,
      color: s.color,
      value: lastPoint?.value ?? 0
    };
  });

  const displayValues = hoverData?.values ?? latestValues;

  return (
    <div className="space-y-3">
      {/* Time range selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 p-1 bg-white/5 rounded-lg">
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

        {/* Live values display */}
        <div className="flex items-center gap-4 text-sm">
          {displayValues.map((v) => (
            <div key={v.label} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.color }} />
              <span className="text-muted-foreground">{v.label}:</span>
              <span className="font-semibold tabular-nums" style={{ color: v.color }}>
                {(v.value * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart container */}
      <div className="relative">
        {hasFilteredData ? (
          <div ref={containerRef} className="w-full rounded bg-white/5" style={{ height }} />
        ) : (
          <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            No data for selected time range
          </div>
        )}

        {/* Hover timestamp */}
        {hoverData && (
          <div className="absolute top-2 left-2 text-xs text-muted-foreground bg-black/50 px-2 py-1 rounded backdrop-blur-sm">
            {hoverData.time}
          </div>
        )}
      </div>
    </div>
  );
}
