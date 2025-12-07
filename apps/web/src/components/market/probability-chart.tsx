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

    let chart: unknown;

    const initChart = async () => {
      try {
        const lc = await import("lightweight-charts");
        const { createChart, ColorType } = lc;

        chart = createChart(containerRef.current!, {
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
            scaleMargins: { top: 0.2, bottom: 0.2 }
          },
          timeScale: {
            borderVisible: false
          }
        });
        chartRef.current = chart;

        const chartAny = chart as Record<string, unknown>;

        series.forEach((s) => {
          const opts = {
            color: s.color,
            lineWidth: 2,
            priceFormat: { type: "price", minMove: 0.001 },
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
            (line as { setData: Function }).setData(s.data);
            seriesRefs.current.set(s.id, line);
          }
        });

        const handleResize = () => {
          if (!containerRef.current || !chartRef.current) return;
          (chartRef.current as { applyOptions: Function }).applyOptions({
            width: containerRef.current.clientWidth
          });
        };

        handleResize();
        window.addEventListener("resize", handleResize);

        return () => {
          window.removeEventListener("resize", handleResize);
        };
      } catch (err) {
        console.error("Chart init error:", err);
        setError(err instanceof Error ? err.message : "Failed to load chart");
      }
    };

    initChart();

    return () => {
      if (chartRef.current && typeof (chartRef.current as Record<string, unknown>).remove === "function") {
        (chartRef.current as { remove: Function }).remove();
      }
      seriesRefs.current.clear();
      chartRef.current = null;
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

  if (!series.length || series.every((s) => !s.data.length)) {
    return (
      <div className="w-full bg-white/5 rounded flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No probability history yet
      </div>
    );
  }

  return <div ref={containerRef} className="w-full rounded bg-white/5" style={{ height }} />;
}
