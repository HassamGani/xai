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
  const seriesRefs = useRef<Map<string, unknown>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    // Check if we have any valid data
    const hasData = series.some((s) => s.data && s.data.length > 0);
    if (!hasData) {
      return;
    }

    let cleanup: (() => void) | undefined;

    const initChart = async () => {
      try {
        const lc = await import("lightweight-charts");
        const { createChart, ColorType } = lc;

        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
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

        const chartAny = chart as Record<string, unknown>;

        series.forEach((s) => {
          // Filter and sort data - must be monotonically increasing time
          const validData = (s.data || [])
            .filter((d) => typeof d.time === "number" && !isNaN(d.time) && typeof d.value === "number" && !isNaN(d.value))
            .sort((a, b) => a.time - b.time);

          // Dedupe by time (keep last value for each timestamp)
          const dedupedData: { time: number; value: number }[] = [];
          const seenTimes = new Set<number>();
          for (let i = validData.length - 1; i >= 0; i--) {
            if (!seenTimes.has(validData[i].time)) {
              seenTimes.add(validData[i].time);
              dedupedData.unshift(validData[i]);
            }
          }

          if (dedupedData.length === 0) return;

          const opts = {
            color: s.color,
            lineWidth: 2,
            priceFormat: { type: "price" as const, precision: 2, minMove: 0.01 },
            lastValueVisible: true,
            title: s.label
          };

          let line: unknown;
          if (typeof chartAny.addLineSeries === "function") {
            line = (chartAny.addLineSeries as Function)(opts);
          } else if (typeof chartAny.addSeries === "function") {
            line = (chartAny.addSeries as Function)({ type: "Line" });
            if (line && typeof (line as Record<string, unknown>).applyOptions === "function") {
              (line as { applyOptions: Function }).applyOptions(opts);
            }
          }

          if (line && typeof (line as Record<string, unknown>).setData === "function") {
            (line as { setData: Function }).setData(dedupedData);
            seriesRefs.current.set(s.id, line);
          }
        });

        chart.timeScale().fitContent();

        const handleResize = () => {
          if (!containerRef.current || !chartRef.current) return;
          (chartRef.current as { applyOptions: Function }).applyOptions({
            width: containerRef.current.clientWidth
          });
        };

        window.addEventListener("resize", handleResize);

        cleanup = () => {
          window.removeEventListener("resize", handleResize);
          if (chartRef.current && typeof (chartRef.current as Record<string, unknown>).remove === "function") {
            (chartRef.current as { remove: Function }).remove();
          }
          seriesRefs.current.clear();
          chartRef.current = null;
        };
      } catch (err) {
        console.error("Chart init error:", err);
        setError(err instanceof Error ? err.message : "Failed to load chart");
      }
    };

    initChart();

    return () => {
      if (cleanup) cleanup();
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
