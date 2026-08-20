import { cn } from '@/lib/utils';

/**
 * Completion, shown as a filled rule.
 *
 * It borrows the same 2px edge marker the rest of the app uses for "this one",
 * stretched along the horizontal — colour still means status, so a late project
 * fills in the warning tone rather than the accent.
 */
export function ProgressBar({
  value,
  tone = 'accent',
  showLabel = false,
  className,
}: {
  value: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  showLabel?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const fills = {
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  } as const;

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-neutral-soft"
      >
        <div
          className={cn('h-full rounded-full transition-[width]', fills[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel ? (
        <span className="tabular w-9 shrink-0 text-right font-mono text-[0.6875rem] text-ink-faint">
          {clamped}%
        </span>
      ) : null}
    </div>
  );
}
