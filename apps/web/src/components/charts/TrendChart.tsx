import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Currency } from '@probild/shared';
import { formatMoney } from '@/lib/utils';

export interface TrendPoint {
  label: string;
  won: number;
  received: number;
}

/**
 * Two money series over the same months.
 *
 * Both are amounts in the same currency, so they share one axis — a second
 * y-scale would let the shapes imply a relationship the numbers do not have.
 */
export function TrendChart({
  data,
  currency,
  height = 240,
}: {
  data: TrendPoint[];
  currency: Currency;
  height?: number;
}) {
  const hasValues = data.some((point) => point.won > 0 || point.received > 0);

  if (!hasValues) {
    return (
      <p className="flex items-center justify-center py-16 text-center text-[0.8125rem] text-ink-faint">
        No {currency} closed in this window yet.
      </p>
    );
  }

  const axisTick = { fill: 'var(--app-ink-faint)', fontSize: 11, fontFamily: 'var(--font-mono)' };

  return (
    <>
      {/* Two series, so the key is always present — identity is never colour alone. */}
      <ul className="mb-3 flex flex-wrap gap-4">
        <LegendEntry label="Won" swatch="bg-series-1" />
        <LegendEntry label="Received" swatch="bg-series-2" />
      </ul>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--app-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: 'var(--app-line)' }}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(value: number) => compact(value, currency)}
          />
          <Tooltip
            cursor={{ stroke: 'var(--app-line-strong)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-md border border-line-strong bg-panel px-3 py-2 shadow-lg">
                  <p className="eyebrow mb-1.5">{label}</p>
                  {payload.map((entry) => (
                    <p
                      key={entry.dataKey as string}
                      className="flex items-center gap-2 text-[0.8125rem] text-ink"
                    >
                      <span
                        aria-hidden
                        className="size-2 rounded-[2px]"
                        style={{ background: entry.color }}
                      />
                      <span className="text-ink-soft">
                        {entry.dataKey === 'won' ? 'Won' : 'Received'}
                      </span>
                      <span className="tabular ml-auto font-mono">
                        {formatMoney(entry.value as number, currency)}
                      </span>
                    </p>
                  ))}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="won"
            stroke="var(--app-series-1)"
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: 'var(--app-series-1)' }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--app-panel)' }}
          />
          <Line
            type="monotone"
            dataKey="received"
            stroke="var(--app-series-2)"
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: 'var(--app-series-2)' }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--app-panel)' }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* The figures in full, so the chart is never the only way to read them. */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[24rem] text-[0.8125rem]">
          <thead>
            <tr>
              <th className="eyebrow py-1.5 text-left">Month</th>
              {data.map((point) => (
                <th key={point.label} className="eyebrow py-1.5 text-right">
                  {point.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['won', 'received'] as const).map((series) => (
              <tr key={series} className="border-t border-line">
                <td className="py-1.5 text-ink-soft">{series === 'won' ? 'Won' : 'Received'}</td>
                {data.map((point) => (
                  <td
                    key={point.label}
                    className="tabular py-1.5 text-right font-mono text-ink-soft"
                  >
                    {point[series] === 0 ? '—' : compact(point[series], currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LegendEntry({ label, swatch }: { label: string; swatch: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={`size-2 rounded-[2px] ${swatch}`} />
      <span className="text-[0.8125rem] text-ink-soft">{label}</span>
    </li>
  );
}

/** Axis labels need to be short: ₹6.8L, $24k. */
function compact(value: number, currency: Currency): string {
  if (value === 0) return '0';
  if (currency === 'INR') {
    if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)}Cr`;
    if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
    if (value >= 1000) return `₹${Math.round(value / 1000)}k`;
    return `₹${value}`;
  }
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}
