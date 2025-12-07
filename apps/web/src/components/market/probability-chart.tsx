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

type TooltipItem = {
  id: string;
  y: number;
  label: string;
  color: string;
  value: number;
};

const TIME_RANGES: { value: TimeRange; label: string; seconds: number | null }[] = [
  { value: "1d", label: "1D", seconds: 24 * 60 * 60 },
  { value: "1w", label: "1W", seconds: 7 * 24 * 60 * 60 },
  { value: "1m", label: "1M", seconds: 30 * 24 * 60 * 60 },
  { value: "all", label: "All", seconds: null }
];

const TOOLTIP_HEIGHT = 26;

function applyCollisionDetection(tips: TooltipItem[], containerHeight: number) {
  if (tips.length === 0) return;
  
  tips.sort((a, b) => a.y - b.y);

  for (let i = 1; i < tips.length; i++) {
    if (tips[i].y < tips[i - 1].y + TOOLTIP_HEIGHT) {
      tips[i].y = tips[i - 1].y + TOOLTIP_HEIGHT;
    }
  }

  const last = tips[tips.length - 1];
  if (last && last.y > containerHeight - TOOLTIP_HEIGHT / 2) {
    last.y = containerHeight - TOOLTIP_HEIGHT / 2;
    for (let i = tips.length - 2; i >= 0; i--) {
      if (tips[i + 1].y - tips[i].y < TOOLTIP_HEIGHT) {
        tips[i].y = tips[i + 1].y - TOOLTIP_HEIGHT;
      }
    }
  }

  const first = tips[0];
  if (first && first.y < TOOLTIP_HEIGHT / 2) {
    first.y = TOOLTIP_HEIGHT / 2;
    for (let i = 1; i < tips.length; i++) {
      if (tips[i].y - tips[i - 1].y < TOOLTIP_HEIGHT) {
        tips[i].y = tips[i - 1].y + TOOLTIP_HEIGHT;
      }
    }
  }
}

export function ProbabilityChart({ series, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<unknown>(null);
  const seriesMapRef = useRef<Map<string, unknown>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  
  // Tooltip state: cursorX is null when not hovering (show at right edge)
  const [cursorX, setCursorX] = useState<number | null>(null);
  const [tooltips, setTooltips] = useState<TooltipItem[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter series data by time range
  const filteredSeries = series.map((s) => {
    const rangeConfig = TIME_RANGES.find((r) => r.value === timeRange);
    if (!rangeConfig?.seconds) return s;
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - rangeConfig.seconds;
    return { ...s, data: s.data.filter((d) => d.time >= cutoff) };
  });

  // Compute tooltips from latest data (for right-edge display)
  const computeStaticTooltips = useCallback(() => {
    if (!chartRef.current) return;
    
    const tips: TooltipItem[] = [];
    filteredSeries.forEach((s) => {
      if (s.data.length === 0) return;
      const lastPoint = s.data[s.data.length - 1];
      const seriesRef = seriesMapRef.current.get(s.id);
      if (seriesRef && typeof (seriesRef as any).priceToCoordinate === "function") {
        const y = (seriesRef as any).priceToCoordinate(lastPoint.value);
        if (y !== null && !isNaN(y)) {
          tips.push({ id: s.id, y, label: s.label, color: s.color, value: lastPoint.value });
        }
      }
    });
    applyCollisionDetection(tips, containerRef.current?.clientHeight ?? height);
    setTooltips(tips);
  }, [filteredSeries, height]);

  const handleCrosshairMove = useCallback(
    (param: unknown) => {
      const p = param as {
        time?: number;
        point?: { x: number; y: number };
        seriesData?: Map<unknown, { value?: number }>;
      };

      if (!p.time || !p.point || !p.seriesData || !chartRef.current) {
        // Mouse left the chart
        setCursorX(null);
        computeStaticTooltips();
        return;
      }

      setCursorX(p.point.x);

      const tips: TooltipItem[] = [];
      filteredSeries.forEach((s) => {
        const seriesRef = seriesMapRef.current.get(s.id);
        if (!seriesRef) return;
        const data = p.seriesData!.get(seriesRef);
        if (data && typeof data.value === "number") {
          const y = (seriesRef as any).priceToCoordinate(data.value);
          if (y !== null && !isNaN(y)) {
            tips.push({ id: s.id, y, label: s.label, color: s.color, value: data.value });
          }
        }
      });
      applyCollisionDetection(tips, containerRef.current?.clientHeight ?? height);
      setTooltips(tips);
    },
    [filteredSeries, height, computeStaticTooltips]
  );

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    const validSeries = filteredSeries
      .map((s) => ({
        ...s,
        data: (s.data || [])
          .filter((d) => typeof d.time === "number" && !isNaN(d.time) && d.time > 0 && typeof d.value === "number" && !isNaN(d.value))
          .sort((a, b) => a.time - b.time)
      }))
      .map((s) => {
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

    if (validSeries.length === 0) return;

    let cleanupFn: (() => void) | undefined;

    const initChart = async () => {
      try {
        const lc = await import("lightweight-charts");
        const { createChart, ColorType, LineSeries } = lc;

        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "hsl(var(--muted-foreground))"
          },
          grid: {
            vertLines: { color: "hsl(var(--border))" },
            horzLines: { color: "hsl(var(--border))" }
          },
          rightPriceScale: {
            visible: false // Hide built-in price scale completely
          },
          timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: false
          },
          crosshair: {
            mode: 1,
            vertLine: {
              width: 1,
              color: "hsl(var(--muted-foreground) / 0.3)",
              style: 2,
              labelBackgroundColor: "hsl(var(--primary))"
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
          const seriesOpts = {
            color: s.color,
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            crosshairMarkerBorderColor: s.color,
            crosshairMarkerBackgroundColor: s.color
          };

          let line: unknown;
          if (typeof chartAny.addLineSeries === "function") {
            line = (chartAny.addLineSeries as Function)(seriesOpts);
          } else if (LineSeries && typeof chartAny.addSeries === "function") {
            line = (chartAny.addSeries as Function)(LineSeries, seriesOpts);
          } else if (typeof chartAny.addSeries === "function") {
            line = (chartAny.addSeries as Function)({ type: "Line" });
            if (line && typeof (line as any).applyOptions === "function") {
              (line as any).applyOptions(seriesOpts);
            }
          }

          if (line && typeof (line as any).setData === "function") {
            (line as any).setData(s.data);
            seriesMapRef.current.set(s.id, line);
          }
        }

        if (typeof chartAny.subscribeCrosshairMove === "function") {
          (chartAny.subscribeCrosshairMove as Function)(handleCrosshairMove);
        }

        if (typeof chartAny.timeScale === "function") {
          ((chartAny.timeScale as Function)() as any).fitContent();
        }

        // Compute initial static tooltips
        setTimeout(() => computeStaticTooltips(), 50);

        const handleResize = () => {
          if (!containerRef.current || !chartRef.current) return;
          (chartRef.current as any).applyOptions({ width: containerRef.current.clientWidth });
          if (cursorX === null) computeStaticTooltips();
        };

        window.addEventListener("resize", handleResize);

        cleanupFn = () => {
          window.removeEventListener("resize", handleResize);
          if (chartRef.current && typeof (chartRef.current as any).remove === "function") {
            try { (chartRef.current as any).remove(); } catch {}
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
    return () => { if (cleanupFn) cleanupFn(); };
  }, [mounted, height, filteredSeries, timeRange, handleCrosshairMove, computeStaticTooltips, cursorX]);

  if (!mounted) {
    return <div className="w-full bg-muted/50 rounded-lg animate-pulse" style={{ height }} />;
  }

  if (error) {
    return (
      <div className="w-full bg-muted/50 rounded-lg flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Chart error: {error}
      </div>
    );
  }

  const hasData = series.some((s) => s.data && s.data.length > 0);
  if (!hasData) {
    return (
      <div className="w-full bg-muted/50 rounded-lg flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No probability history yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Time range buttons */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
        {TIME_RANGES.map((range) => (
          <button
            key={range.value}
            onClick={() => setTimeRange(range.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              timeRange === range.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="relative border border-border rounded-lg overflow-hidden">
        <div ref={containerRef} className="w-full bg-card" style={{ height }} />

        {/* Custom Tooltips */}
        {tooltips.map((tip) => (
          <div
            key={tip.id}
            className="absolute pointer-events-none transform -translate-y-1/2 z-10"
            style={{
              left: cursorX !== null ? cursorX + 12 : undefined,
              right: cursorX === null ? 8 : undefined,
              top: tip.y
            }}
          >
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-card border border-border shadow-sm text-xs">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: tip.color }}
              />
              <span className="text-muted-foreground">{tip.label}</span>
              <span className="font-semibold tabular-nums" style={{ color: tip.color }}>
                {(tip.value * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
