"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useTheme } from "next-themes";

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

type TimeRange = "1h" | "1d" | "1w" | "1m" | "all";

const TIME_RANGES: { value: TimeRange; label: string; seconds: number | null }[] = [
  { value: "1h", label: "1H", seconds: 60 * 60 },
  { value: "1d", label: "1D", seconds: 24 * 60 * 60 },
  { value: "1w", label: "1W", seconds: 7 * 24 * 60 * 60 },
  { value: "1m", label: "1M", seconds: 30 * 24 * 60 * 60 },
  { value: "all", label: "All", seconds: null }
];

const TOOLTIP_HEIGHT = 26;

const CHART_COLORS = {
  light: {
    text: "#64748b",
    gridLines: "#e2e8f0",
    crosshair: "#94a3b8"
  },
  dark: {
    text: "#94a3b8",
    gridLines: "#334155",
    crosshair: "#64748b"
  }
};

// Format time in the viewer's local time zone (time-only, no tz label)
const formatLocalTime = (tsSeconds: number) => {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(tsSeconds * 1000));
};

// Lightweight-charts can pass time as number or business day object; normalize to epoch seconds
const toSeconds = (ts: any): number => {
  if (typeof ts === "number") return ts;
  if (ts?.timestamp) return Number(ts.timestamp);
  // Fallback: build from y/m/d if provided
  if (typeof ts === "object" && ts.year && ts.month && ts.day) {
    return Math.floor(new Date(ts.year, ts.month - 1, ts.day).getTime() / 1000);
  }
  return Number(ts) || 0;
};

type TooltipItem = {
  id: string;
  y: number;
  label: string;
  color: string;
  value: number;
};

export function ProbabilityChart({ series, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const seriesMapRef = useRef<Map<string, any>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const { resolvedTheme } = useTheme();
  
  // Separate state for cursor position and tooltip data
  const [isHovering, setIsHovering] = useState(false);
  const [cursorX, setCursorX] = useState<number>(0);
  const [tooltipItems, setTooltipItems] = useState<TooltipItem[]>([]);

  const isDark = resolvedTheme === "dark";
  const colors = isDark ? CHART_COLORS.dark : CHART_COLORS.light;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Memoize filtered series to prevent unnecessary recalculations
  const filteredSeries = useMemo(() => {
    return series.map((s) => {
      const rangeConfig = TIME_RANGES.find((r) => r.value === timeRange);
      if (!rangeConfig?.seconds) return s;
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - rangeConfig.seconds;
      return { ...s, data: s.data.filter((d) => d.time >= cutoff) };
    });
  }, [series, timeRange]);

  // Serialize for dependency comparison
  const seriesKey = useMemo(() => {
    return JSON.stringify(filteredSeries.map(s => ({ id: s.id, len: s.data.length })));
  }, [filteredSeries]);

  // Store current data in ref for callbacks
  const dataRef = useRef({ filteredSeries, height, colors, isDark });
  dataRef.current = { filteredSeries, height, colors, isDark };

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    const currentSeries = dataRef.current.filteredSeries;
    const validSeries = currentSeries
      .map((s) => ({
        ...s,
        data: (s.data || [])
          .filter((d) => typeof d.time === "number" && !isNaN(d.time) && d.time > 0 && typeof d.value === "number" && !isNaN(d.value))
          .sort((a, b) => a.time - b.time)
      }))
      .map((s) => {
        const seen = new Set<number>();
        return { ...s, data: s.data.filter((d) => !seen.has(d.time) && seen.add(d.time)) };
      })
      .filter((s) => s.data.length > 0);

    if (validSeries.length === 0) return;

    let cleanup: (() => void) | undefined;

    const init = async () => {
      try {
        const lc = await import("lightweight-charts");
        const { createChart, ColorType, LineSeries } = lc;

        if (!containerRef.current) return;

        // Cleanup old chart
        if (chartRef.current?.remove) {
          try { chartRef.current.remove(); } catch {}
        }
        chartRef.current = null;
        seriesMapRef.current.clear();

        const { colors: chartColors, isDark: dark } = dataRef.current;

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: chartColors.text
          },
          grid: {
            vertLines: { color: chartColors.gridLines },
            horzLines: { color: chartColors.gridLines }
          },
          rightPriceScale: {
            visible: true,
            borderColor: chartColors.gridLines
          },
          leftPriceScale: { visible: false },
          timeScale: {
            borderColor: chartColors.gridLines,
            timeVisible: true,
            secondsVisible: false,
            tickMarkFormatter: (t: any) => formatLocalTime(toSeconds(t))
          },
          localization: {
            priceFormatter: (p: number) => `${(p * 100).toFixed(1)}%`,
            timeFormatter: (ts: number | { timestamp: number }) => {
              const val = toSeconds(ts);
              return formatLocalTime(val);
            }
          },
          crosshair: {
            mode: 1,
            vertLine: {
              width: 1,
              color: chartColors.crosshair,
              style: 2,
              labelVisible: true
            },
            horzLine: { visible: false, labelVisible: false }
          },
          handleScale: false,
          handleScroll: false
        });

        chartRef.current = chart;

        // Add series
        for (const s of validSeries) {
          const opts = {
            color: s.color,
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 5,
            crosshairMarkerBorderWidth: 2,
            crosshairMarkerBorderColor: dark ? "#0f172a" : "#ffffff",
            crosshairMarkerBackgroundColor: s.color
          };

          let line: any;
          const chartAny = chart as any;
          if (typeof chartAny.addLineSeries === "function") {
            line = chartAny.addLineSeries(opts);
          } else if (LineSeries) {
            line = chartAny.addSeries(LineSeries, opts);
          }

          if (line) {
            line.setData(s.data);
            seriesMapRef.current.set(s.id, line);
          }
        }

        // Helper to get tooltip items
        const getTooltipItems = (time: any, seriesData: Map<any, any> | null): TooltipItem[] => {
          const items: TooltipItem[] = [];
          const containerH = containerRef.current?.clientHeight ?? height;
          
          dataRef.current.filteredSeries.forEach((s) => {
            const seriesObj = seriesMapRef.current.get(s.id);
            if (!seriesObj || s.data.length === 0) return;
            
            let value: number;
            if (seriesData) {
              const dataAtCursor = seriesData.get(seriesObj);
              if (!dataAtCursor || typeof dataAtCursor.value !== "number") return;
              value = dataAtCursor.value;
            } else {
              value = s.data[s.data.length - 1].value;
            }
            
            const y = seriesObj.priceToCoordinate?.(value);
            if (y != null && !isNaN(y)) {
              items.push({ id: s.id, y, label: s.label, color: s.color, value });
            }
          });
          
          // Apply collision detection
          if (items.length > 0) {
            items.sort((a, b) => a.y - b.y);
            for (let i = 1; i < items.length; i++) {
              if (items[i].y < items[i - 1].y + TOOLTIP_HEIGHT) {
                items[i].y = items[i - 1].y + TOOLTIP_HEIGHT;
              }
            }
            const last = items[items.length - 1];
            if (last && last.y > containerH - TOOLTIP_HEIGHT / 2) {
              last.y = containerH - TOOLTIP_HEIGHT / 2;
              for (let i = items.length - 2; i >= 0; i--) {
                if (items[i + 1].y - items[i].y < TOOLTIP_HEIGHT) {
                  items[i].y = items[i + 1].y - TOOLTIP_HEIGHT;
                }
              }
            }
          }
          
          return items;
        };

        // Crosshair handler
        chart.subscribeCrosshairMove((param: any) => {
          if (!param.time || !param.point || !param.seriesData) {
            setIsHovering(false);
            const items = getTooltipItems(null, null);
            setTooltipItems(items);
            return;
          }

          setIsHovering(true);
          setCursorX(param.point.x);
          const items = getTooltipItems(param.time, param.seriesData);
          setTooltipItems(items);
        });

        chart.timeScale().fitContent();

        // Initial tooltips (show latest values)
        requestAnimationFrame(() => {
          const items = getTooltipItems(null, null);
          setTooltipItems(items);
        });

        const onResize = () => {
          if (!containerRef.current || !chartRef.current) return;
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        };
        window.addEventListener("resize", onResize);

        cleanup = () => {
          window.removeEventListener("resize", onResize);
          if (chartRef.current?.remove) {
            try { chartRef.current.remove(); } catch {}
          }
          chartRef.current = null;
          seriesMapRef.current.clear();
        };
      } catch (err) {
        console.error("Chart error:", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    init();
    return () => cleanup?.();
  }, [mounted, height, seriesKey, isDark]);

  if (!mounted) {
    return <div className="w-full rounded-lg animate-pulse bg-muted" style={{ height }} />;
  }

  if (error) {
    return (
      <div className="w-full rounded-lg flex items-center justify-center text-sm text-muted-foreground bg-muted" style={{ height }}>
        Chart error: {error}
      </div>
    );
  }

  const hasData = series.some((s) => s.data?.length > 0);
  if (!hasData) {
    return (
      <div className="w-full rounded-lg flex items-center justify-center text-sm text-muted-foreground bg-muted" style={{ height }}>
        No probability history yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
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

      <div className="relative rounded-lg overflow-hidden border border-border bg-card">
        <div ref={containerRef} style={{ height }} />

        {tooltipItems.map((item) => (
          <div
            key={item.id}
            className="absolute pointer-events-none z-10 transition-all duration-75"
            style={{
              left: isHovering ? cursorX + 12 : undefined,
              right: isHovering ? undefined : 8,
              top: item.y,
              transform: "translateY(-50%)"
            }}
          >
            <div 
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs whitespace-nowrap"
              style={{ 
                backgroundColor: isDark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.95)",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)"
              }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
              <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}>{item.label}</span>
              <span className="font-semibold tabular-nums" style={{ color: item.color }}>
                {(item.value * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 text-xs">
        {series.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
