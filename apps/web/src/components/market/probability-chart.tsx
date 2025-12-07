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

export function ProbabilityChart({ series, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    // Check if we have any valid data
    const validSeries = series
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

    console.log("Chart validSeries:", validSeries.map(s => ({ id: s.id, label: s.label, dataLen: s.data.length, firstPoint: s.data[0], lastPoint: s.data[s.data.length - 1] })));

    if (validSeries.length === 0) {
      console.log("No valid series data");
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
          }
        });
        chartRef.current = chart;

        const chartAny = chart as unknown as Record<string, unknown>;

        for (const s of validSeries) {
          try {
            let line: unknown;

            // Try v4 style first (addLineSeries)
            if (typeof chartAny.addLineSeries === "function") {
              line = (chartAny.addLineSeries as Function)({
                color: s.color,
                lineWidth: 2,
                title: s.label
              });
            }
            // Try v5 style with LineSeries
            else if (LineSeries && typeof chartAny.addSeries === "function") {
              line = (chartAny.addSeries as Function)(LineSeries, {
                color: s.color,
                lineWidth: 2,
                title: s.label
              });
            }
            // Fallback
            else if (typeof chartAny.addSeries === "function") {
              line = (chartAny.addSeries as Function)({ type: "Line" });
              if (line && typeof (line as Record<string, unknown>).applyOptions === "function") {
                (line as { applyOptions: Function }).applyOptions({
                  color: s.color,
                  lineWidth: 2,
                  title: s.label
                });
              }
            }

            if (line && typeof (line as Record<string, unknown>).setData === "function") {
              console.log(`Setting data for ${s.label}:`, s.data.slice(0, 3), "...", s.data.length, "points");
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
  }, [mounted, height, series]);

  if (!mounted) {
    return <div className="w-full bg-white/5 rounded animate-pulse" style={{ height }} />;
  }

  if (error) {
    return (
      <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Chart error: {error}
      </div>
    );
  }

  const hasData = series.some((s) => s.data && s.data.length > 0);
  if (!hasData) {
    return (
      <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No probability history yet
      </div>
    );
  }

  return <div ref={containerRef} className="w-full rounded bg-white/5" style={{ height }} />;
}
