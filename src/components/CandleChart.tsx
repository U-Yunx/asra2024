/**
 * CandleChart — a lightweight candlestick chart for historical bars (backtest
 * results, saved strategies). Static series: caller owns the data. Uses the
 * same lightweight-charts setup as the live chart so visuals stay consistent.
 */
import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts'
import type { Bar } from '../lib/types'

const UP = '#4ade80'
const DOWN = '#f87171'

function toCandle(b: Bar): CandlestickData {
  // Bars are ISO strings; day bars are date-only. lightweight-charts accepts
  // YYYY-MM-DD or a unix timestamp. Use the date part for day bars and unix
  // seconds otherwise (same convention as the live chart).
  const t = /^\d{4}-\d{2}-\d{2}$/.test(b.time) ? b.time : Math.floor(Date.parse(b.time) / 1000)
  return { time: t as Time, open: b.open, high: b.high, low: b.low, close: b.close }
}

export function CandleChart({ bars, height = 360 }: { bars: Bar[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  // Identity of the series currently fitted: fit the visible range when a new
  // series loads (mount / pair or interval change) but NOT on every live tick —
  // otherwise a ticking last bar keeps zooming the chart back out.
  const fittedRef = useRef<string | null>(null)

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
        vertLine: { color: '#22d3ee', labelBackgroundColor: '#0e7490' },
        horzLine: { color: '#22d3ee', labelBackgroundColor: '#0e7490' },
      },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
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
    if (!seriesRef.current || bars.length === 0) return
    seriesRef.current.setData(bars.map(toCandle))
    const first = bars[0].time
    if (fittedRef.current !== first) {
      fittedRef.current = first
      chartRef.current?.timeScale().fitContent()
    }
  }, [bars])

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full rounded-lg border border-border/60 bg-secondary/10"
      role="img"
      aria-label="Candlestick chart"
    />
  )
}