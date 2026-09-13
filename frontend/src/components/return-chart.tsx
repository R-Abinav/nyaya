import { useEffect, useRef } from 'react';
import { createChart, type IChartApi, type ISeriesApi, LineStyle } from 'lightweight-charts';
import type { JurorReturnPoint } from '../types';

/**
 * Real return-on-capital-over-time chart, one point per real settled case (GET /jurors/:id/history — see
 * backend/src/config/contracts.js's getJurorReturnHistory, which reads each point from the resolver's own
 * historical state at that settlement's block). Renders a real, honest empty state for a juror with no
 * settled cases yet, rather than an empty chart canvas or a crash.
 */
export function ReturnChart({ history }: { history: JurorReturnPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi>();
  const seriesRef = useRef<ISeriesApi<'Line'>>();

  useEffect(() => {
    if (!containerRef.current) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: 'rgba(148, 163, 184, 0.9)',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
      },
      crosshair: {
        vertLine: { color: 'rgba(56, 189, 248, 0.3)', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#38bdf8' },
        horzLine: { color: 'rgba(56, 189, 248, 0.3)', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#38bdf8' },
      },
      handleScroll: !prefersReducedMotion,
      handleScale: !prefersReducedMotion,
      autoSize: true,
    });

    const series = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(0)}bps`, minMove: 1 },
      lastValueVisible: true,
      priceLineVisible: true,
      crosshairMarkerVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => chart.remove();
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    const points = history
      .map(point => ({ time: point.timestamp as unknown as import('lightweight-charts').Time, value: Number(point.returnBps) }))
      .sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number));
    seriesRef.current.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [history]);

  if (history.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-panel/50 text-center">
        <p className="text-sm font-medium text-ink">No case history yet</p>
        <p className="max-w-xs text-xs text-muted-fg">
          This juror hasn't had a case settle yet. Its return-on-capital chart will appear here after its first real settlement.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="h-56 w-full" />;
}
