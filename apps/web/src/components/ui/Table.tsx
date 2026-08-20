import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@probild/shared';
import { cn } from '@/lib/utils';
import { Button } from './Button';

export function TableWrap({ children }: { children: ReactNode }) {
  // Wide tables scroll inside their own panel; the page never scrolls sideways.
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = 'left',
}: {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'eyebrow border-b border-line px-5 py-2.5 whitespace-nowrap',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = 'left',
}: {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  return (
    <td
      className={cn(
        'border-b border-line px-5 py-3 align-middle text-ink-soft',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Pagination({
  meta,
  onPageChange,
  label = 'records',
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <p className="tabular text-xs text-ink-faint">
        {first}–{last} of {meta.total} {label}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onPageChange(meta.page - 1)}
          disabled={!meta.hasPreviousPage}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onPageChange(meta.page + 1)}
          disabled={!meta.hasNextPage}
          aria-label="Next page"
        >
          Next
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
