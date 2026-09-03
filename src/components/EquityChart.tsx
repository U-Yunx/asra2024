/**
 * EquityChart — an area line chart of account/backtest equity over time.
 * Accepts plain { time, value } points so both paper accounts and backtests can
 * share it. Colors the line by net direction and fills an accent gradient.
 */
import { useEffect, useRef } from 'react'
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts'
import type { EquityPoint } from '../lib/types'

const ACCENT = '#22d3ee'
export function EquityChart({ points, height = 260 }: { points: EquityPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.08)' },
        horzLines: { color: 'rgba(148,163,184,0.08)' },
      },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)' },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)' },
      crosshair: {
        vertLine: { color: ACCENT, labelBackgroundColor: '#0e7490' },
        horzLine: { color: ACCENT, labelBackgroundColor: '#0e7490' },
      },
    })
    const series = chart.addSeries(AreaSeries, {
      lineColor: ACCENT,
      topColor: 'rgba(34,211,238,0.25)',
      bottomColor: 'rgba(34,211,238,0.02)',
      lineWidth: 2,
    })
    chartRef.current = chart
    seriesRef.current = series
    const ro = new ResizeObserver(() => chart.applyOptions({ width: containerRef.current!.clientWidth }))
    ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!seriesRef.current || points.length === 0) return
    const data = points.map((p) => ({
      time: /^\d{4}-\d{2}-\d{2}$/.test(p.time)
        ? p.time
        : (Math.floor(Date.parse(p.time) / 1000) as Time),
      value: p.equity,
    }))
    seriesRef.current.setData(data)
    chartRef.current?.timeScale().fitContent()
  }, [points])

  if (points.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex w-full items-center justify-center rounded-lg border border-dashed border-border bg-secondary/10 text-sm text-muted-foreground"
      >
        No equity history yet — run the robot or a backtest to see a curve.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full rounded-lg border border-border/60 bg-secondary/10"
      role="img"
      aria-label="Equity curve"
    />
  )
}