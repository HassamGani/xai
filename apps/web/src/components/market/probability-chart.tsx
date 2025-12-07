"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  type ISeriesApi,
  type LineData,
  type Time
} from "lightweight-charts";

type Series = {
  id: string;
  label: string;
  color: string;
  data: LineData<Time>[];
};

type Props = {
  series: Series[];
  height?: number;
};

export function ProbabilityChart({ series, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#dbeafe" },
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

    series.forEach((s) => {
      const line = chart.addSeries(
        {
          type: "Line",
          color: s.color,
          lineWidth: 2,
          priceFormat: { type: "price", minMove: 0.001 },
          lastValueVisible: true,
          title: s.label
        } as const
      ) as ISeriesApi<"Line">;
      line.setData(s.data);
      seriesRefs.current.set(s.id, line);
    });

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      seriesRefs.current.clear();
      chartRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    series.forEach((s) => {
      const ref = seriesRefs.current.get(s.id);
      if (ref) ref.setData(s.data);
    });
  }, [series]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}

