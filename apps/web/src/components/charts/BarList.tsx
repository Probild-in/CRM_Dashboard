import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Shown at the end of the row — the formatted figure people actually read. */
  display: string;
  /** Optional second fact, e.g. a conversion rate. Text, never a second axis. */
  note?: string;
}

/**
 * Magnitude across labelled categories.
 *
 * One hue throughout: every row is the same measure, so colour would only
 * repeat what the label already says. Each row carries its own value, which
 * doubles as the table view — no tooltip is needed to read the number.
 */
export function BarList({
  data,
  emptyMessage = 'Nothing to show yet.',
  tone = 'series-1',
  className,
}: {
  data: BarDatum[];
  emptyMessage?: string;
  tone?: 'series-1' | 'series-2';
  className?: string;
}) {
  const max = Math.max(...data.map((row) => row.value), 0);

  if (data.length === 0 || max === 0) {
    return <p className={cn('px-5 py-8 text-center text-[0.8125rem] text-ink-faint', className)}>{emptyMessage}</p>;
  }

  /*
   * The value column is a fixed width, not `auto`. With `auto`, a row carrying
   * a note squeezes the track and two bars of equal value come out different
   * lengths — the one thing a bar chart must never do.
   */
  return (
    <ul className={cn('flex flex-col gap-2.5', className)}>
      {data.map((row) => (
        <li key={row.key} className="grid grid-cols-[8rem_1fr_7.5rem] items-center gap-3">
          <span className="truncate text-[0.8125rem] text-ink-soft" title={row.label}>
            {row.label}
          </span>

          <span className="flex h-4 items-center">
            <span
              className={cn(
                'h-2 rounded-r-[4px] transition-[width]',
                tone === 'series-1' ? 'bg-series-1' : 'bg-series-2',
              )}
              style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0)}%` }}
            />
          </span>

          <span className="flex items-baseline justify-end gap-2 overflow-hidden text-right">
            {row.note ? (
              <span className="font-mono text-[0.625rem] text-ink-faint">{row.note}</span>
            ) : null}
            <span className="tabular font-mono text-[0.8125rem] whitespace-nowrap text-ink">
              {row.display}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Composition of a whole, as one segmented rule plus a labelled key.
 *
 * Used for status breakdowns, where the colours are the reserved status set —
 * so every segment is named in the key rather than relying on colour alone.
 */
export function StatusBar({
  segments,
  total,
}: {
  segments: Array<{ key: string; label: string; value: number; className: string }>;
  total: number;
}) {
  const shown = segments.filter((segment) => segment.value > 0);

  if (total === 0 || shown.length === 0) {
    return <p className="py-6 text-center text-[0.8125rem] text-ink-faint">Nothing tracked yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* 2px surface gaps between segments, so adjacent fills never merge. */}
      <div className="flex h-2.5 gap-0.5 overflow-hidden">
        {shown.map((segment) => (
          <span
            key={segment.key}
            className={cn('h-full first:rounded-l-[4px] last:rounded-r-[4px]', segment.className)}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2 rounded-[2px]', segment.className)} />
            <span className="text-[0.8125rem] text-ink-soft">{segment.label}</span>
            <span className="tabular font-mono text-[0.8125rem] text-ink">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartFrame({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-line bg-panel">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <h2 className="text-[0.9375rem] font-semibold text-ink">{title}</h2>
        </div>
        {action}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
