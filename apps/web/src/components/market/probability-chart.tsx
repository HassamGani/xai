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
  id: string;
  x: number | null; // null means "align right"
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
  
  // Single source of truth for tooltips to avoid duplication
  const [activeTooltips, setActiveTooltips] = useState<TooltipData>([]);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter series data by time range
  const filteredSeries = series.map((s) => {
    const rangeConfig = TIME_RANGES.find((r) => r.value === timeRange);
    if (!rangeConfig?.seconds) return s;

    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - rangeConfig.seconds;

    return {
      ...s,
      data: s.data.filter((d) => d.time >= cutoff)
    };
  });

  // Helper to calculate static labels (right-aligned)
  const updateStaticLabels = useCallback(() => {
    if (!chartRef.current || isHovering) return;
    
    const tips: TooltipData = [];
    const containerWidth = containerRef.current?.clientWidth ?? 0;

    filteredSeries.forEach(s => {
      if (s.data.length === 0) return;
      
      const lastPoint = s.data[s.data.length - 1];
      const seriesRef = seriesMapRef.current.get(s.id);
      
      if (seriesRef && typeof (seriesRef as any).priceToCoordinate === 'function') {
        const y = (seriesRef as any).priceToCoordinate(lastPoint.value);
        if (y !== null) {
          tips.push({
            id: s.id,
            x: null, // Signal to align right
            y: y,
            label: s.label,
            color: s.color,
            value: lastPoint.value
          });
        }
      }
    });

    applyCollisionDetection(tips, (containerRef.current?.clientHeight ?? height));
    setActiveTooltips(tips);
  }, [filteredSeries, height, isHovering]);

  const applyCollisionDetection = (tips: TooltipData, containerHeight: number) => {
    // Sort by Y coordinate
    tips.sort((a, b) => a.y - b.y);

    const TOOLTIP_HEIGHT = 28;

    // Forward pass
    for (let i = 1; i < tips.length; i++) {
      const prev = tips[i - 1];
      const curr = tips[i];
      if (curr.y < prev.y + TOOLTIP_HEIGHT) {
        curr.y = prev.y + TOOLTIP_HEIGHT;
      }
    }

    // Bottom check
    const last = tips[tips.length - 1];
    if (last && last.y > containerHeight - TOOLTIP_HEIGHT/2) {
      const diff = last.y - (containerHeight - TOOLTIP_HEIGHT/2);
      last.y -= diff;
      for (let i = tips.length - 2; i >= 0; i--) {
        if (tips[i + 1].y - tips[i].y < TOOLTIP_HEIGHT) {
          tips[i].y = tips[i + 1].y - TOOLTIP_HEIGHT;
        }
      }
    }

    // Top check
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
  };

  const handleCrosshairMove = useCallback((param: unknown) => {
    const p = param as { 
      time?: number; 
      point?: { x: number; y: number };
      seriesData?: Map<unknown, { value?: number }>;
    };
    
    // Mouse leave or invalid data
    if (!p.time || !p.point || !p.seriesData || !chartRef.current) {
      if (isHovering) {
        setIsHovering(false);
        // We will trigger updateStaticLabels via useEffect when isHovering changes
      }
      return;
    }

    if (!isHovering) setIsHovering(true);

    const tips: TooltipData = [];
    
    // Get values from each series
    for (const s of filteredSeries) {
      const seriesRef = seriesMapRef.current.get(s.id);
      if (seriesRef) {
        const data = p.seriesData.get(seriesRef);
        if (data && typeof data.value === "number") {
          const y = (seriesRef as any).priceToCoordinate(data.value);
          if (y !== null) {
            tips.push({
              id: s.id,
              x: p.point.x,
              y: y,
              label: s.label,
              color: s.color,
              value: data.value
            });
          }
        }
      }
    }

    applyCollisionDetection(tips, (containerRef.current?.clientHeight ?? height));
    setActiveTooltips(tips);
  }, [filteredSeries, height, isHovering]);

  // Update static labels when not hovering or when data/layout changes
  useEffect(() => {
    if (!isHovering) {
      // Small timeout to ensure chart has rendered new layout
      const timer = requestAnimationFrame(() => updateStaticLabels());
      return () => cancelAnimationFrame(timer);
    }
  }, [isHovering, updateStaticLabels]);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    // Filter valid data
    const validSeries = filteredSeries
      .map((s) => ({
        ...s,
        data: (s.data || [])
          .filter((d) => typeof d.time === "number" && !isNaN(d.time) && d.time > 0 && typeof d.value === "number" && !isNaN(d.value))
          .sort((a, b) => a.time - b.time)
      }))
      .map((s) => {
        // Dedupe
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
            mode: 1, // Magnet
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
              lastValueVisible: false, // Hide built-in axis labels
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

        if (chart && typeof (chart as Record<string, unknown>).subscribeCrosshairMove === "function") {
          (chart as { subscribeCrosshairMove: Function }).subscribeCrosshairMove(handleCrosshairMove);
        }

        if (chart && typeof (chart as Record<string, unknown>).timeScale === "function") {
          ((chart as { timeScale: Function }).timeScale() as { fitContent: Function }).fitContent();
        }

        // Subscribe to time range changes to update static labels
        if (chart && typeof (chart as Record<string, unknown>).timeScale === "function") {
            const timeScale = (chart as any).timeScale();
            if (timeScale && typeof timeScale.subscribeVisibleLogicalRangeChange === 'function') {
                timeScale.subscribeVisibleLogicalRangeChange(() => {
                    if (!isHovering) {
                        requestAnimationFrame(() => updateStaticLabels());
                    }
                });
            }
        }

        const handleResize = () => {
          if (!containerRef.current || !chartRef.current) return;
          (chartRef.current as { applyOptions: Function }).applyOptions({
            width: containerRef.current.clientWidth
          });
          if (!isHovering) updateStaticLabels();
        };

        window.addEventListener("resize", handleResize);

        cleanupFn = () => {
          window.removeEventListener("resize", handleResize);
          if (chartRef.current) {
            // cleanup
            if (typeof (chartRef.current as any).remove === "function") {
              try { (chartRef.current as any).remove(); } catch (e) {}
            }
          }
          chartRef.current = null;
          seriesMapRef.current.clear();
        };
        
        // Initial label update
        setTimeout(() => updateStaticLabels(), 100);

      } catch (err) {
        console.error("Chart init error:", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    initChart();

    return () => {
      if (cleanupFn) cleanupFn();
    };
  }, [mounted, height, filteredSeries, timeRange, handleCrosshairMove]); // Re-init on data change

  if (!mounted) {
    return <div className="w-full bg-white/5 rounded animate-pulse" style={{ height: height + 48 }} />;
  }

  if (error) {
    return <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>Chart error: {error}</div>;
  }

  const hasData = series.some((s) => s.data && s.data.length > 0);
  if (!hasData) {
    return <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>No probability history yet</div>;
  }

  return (
    <div className="space-y-3">
      {/* Header with Legend (Static) */}
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

        {/* Legend - Just Colors & Labels */}
        <div className="flex items-center gap-4 text-sm">
          {filteredSeries.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart container */}
      <div className="relative group cursor-crosshair">
        <div ref={containerRef} className="w-full rounded bg-white/5" style={{ height }} />

        {/* Unified Tooltips Rendering */}
        {activeTooltips.map((tip) => (
          <div
            key={tip.id}
            className="absolute pointer-events-none flex items-center gap-2 transform -translate-y-1/2 z-10 transition-all duration-150 ease-out"
            style={{
              // If x is null, align right. Else align to x.
              left: tip.x !== null ? tip.x + 10 : undefined,
              right: tip.x === null ? 10 : undefined,
              top: tip.y,
            }}
          >
            <div 
              className="px-2 py-1 rounded shadow-lg backdrop-blur-md border border-white/10 text-xs font-medium flex items-center gap-2"
              style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
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
