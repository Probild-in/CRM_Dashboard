import { LayoutGrid, List } from 'lucide-react';
import type { ViewMode } from '@/hooks/useViewMode';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'list', label: 'List', Icon: List },
  { value: 'board', label: 'Board', Icon: LayoutGrid },
] as const;

export function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Change view"
      className={cn('flex items-center rounded-md border border-line bg-panel p-0.5', className)}
    >
      {OPTIONS.map(({ value: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            'flex items-center gap-1.5 rounded px-2.5 py-1 text-[0.8125rem] transition-colors',
            value === option
              ? 'bg-accent-soft font-medium text-accent'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          <Icon aria-hidden className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
