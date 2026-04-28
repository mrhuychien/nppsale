"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"

export interface TrendSeries {
  key: string
  label: string
  color: string
  data: number[]
}

interface TrendChartProps {
  labels: string[]
  series: TrendSeries[]
  height?: number
  /** Format for tooltip values. */
  valueFormatter?: (n: number) => string
}

function defaultFormatter(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} tỷ`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} tr`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(Math.round(n))
}

export function TrendChart({
  labels,
  series,
  height = 240,
  valueFormatter = defaultFormatter,
}: TrendChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const W = 1000
  const H = height
  const PAD_L = 56
  const PAD_R = 16
  const PAD_T = 16
  const PAD_B = 28
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const max = useMemo(() => {
    let m = 0
    for (const s of series) for (const v of s.data) m = Math.max(m, v)
    return m === 0 ? 1 : m
  }, [series])

  const xStep = labels.length > 1 ? innerW / (labels.length - 1) : 0
  const x = (i: number) => PAD_L + i * xStep
  const y = (v: number) => PAD_T + innerH - (v / max) * innerH

  // Y-axis ticks (5 lines)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    v: max * p,
    yPx: PAD_T + innerH - p * innerH,
  }))

  // Show labels every Nth tick if too many
  const labelStride = Math.max(1, Math.ceil(labels.length / 8))

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={t.yPx}
              y2={t.yPx}
              stroke="currentColor"
              className="text-border/40"
              strokeDasharray="3 4"
            />
            <text
              x={PAD_L - 8}
              y={t.yPx + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {valueFormatter(t.v)}
            </text>
          </g>
        ))}

        {/* X labels */}
        {labels.map((lab, i) =>
          i % labelStride === 0 ? (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {lab}
            </text>
          ) : null
        )}

        {/* Lines */}
        {series.map((s) => {
          const d = s.data
            .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`)
            .join(" ")
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} />
              {s.data.map((v, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(v)}
                  r={hoverIdx === i ? 4 : 2.5}
                  fill={s.color}
                />
              ))}
            </g>
          )
        })}

        {/* Hover capture: vertical bands */}
        {labels.map((_, i) => {
          const bandX = x(i) - xStep / 2
          return (
            <rect
              key={`hit-${i}`}
              x={bandX}
              y={PAD_T}
              width={xStep || innerW}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          )
        })}

        {/* Hover crosshair */}
        {hoverIdx !== null && (
          <line
            x1={x(hoverIdx)}
            x2={x(hoverIdx)}
            y1={PAD_T}
            y2={H - PAD_B}
            stroke="currentColor"
            className="text-muted-foreground/40"
            strokeDasharray="2 3"
          />
        )}
      </svg>

      {/* Tooltip */}
      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-border/60 bg-card px-3 py-2 text-xs shadow-md"
          style={{
            left: `${((x(hoverIdx) / W) * 100).toFixed(2)}%`,
            top: `${((y(Math.max(...series.map((s) => s.data[hoverIdx] || 0))) / H) * 100).toFixed(2)}%`,
          }}
        >
          <p className="mb-1 font-semibold text-foreground">{labels[hoverIdx]}</p>
          <ul className="space-y-0.5">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.label}:</span>
                <span className="font-semibold text-foreground">
                  {valueFormatter(s.data[hoverIdx] || 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-4 px-2">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs">
            <span
              className={cn("h-2.5 w-2.5 rounded-full")}
              style={{ background: s.color }}
            />
            <span className="text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
