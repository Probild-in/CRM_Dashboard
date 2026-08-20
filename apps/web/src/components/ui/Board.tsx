import { useState, type ReactNode } from 'react';
import { cn, humanise } from '@/lib/utils';

/**
 * A status board.
 *
 * Generic over whatever it is showing: the caller says how to read an item's id
 * and status, and how to draw its card. Moving a card calls `onMove`; this
 * component holds no opinion about what a status change means.
 *
 * Statuses listed in `collapsed` render as narrow drop zones rather than full
 * columns — finished and cancelled work should be reachable in one drag without
 * taking the same width as work in progress.
 */

export interface BoardColumn<S extends string> {
  status: S;
  /** Defaults to a humanised status. */
  label?: string;
}

export interface BoardProps<T, S extends string> {
  columns: BoardColumn<S>[];
  collapsed?: BoardColumn<S>[];
  items: T[];
  getId: (item: T) => string;
  getStatus: (item: T) => S;
  renderCard: (item: T) => ReactNode;
  /** Dragging is disabled when false; the board stays readable. */
  canMove: boolean;
  onMove: (item: T, status: S) => void;
  /** Shown under the board when the fetch was capped. */
  footer?: ReactNode;
  emptyLabel?: string;
}

export function Board<T, S extends string>({
  columns,
  collapsed = [],
  items,
  getId,
  getStatus,
  renderCard,
  canMove,
  onMove,
  footer,
  emptyLabel = 'Nothing here',
}: BoardProps<T, S>) {
  const [dragging, setDragging] = useState<T | null>(null);
  const [dropTarget, setDropTarget] = useState<S | null>(null);

  const grouped = new Map<S, T[]>();
  for (const column of [...columns, ...collapsed]) grouped.set(column.status, []);
  for (const item of items) {
    const bucket = grouped.get(getStatus(item));
    // An item whose status has no column simply is not on the board, rather
    // than being silently dropped into the first one.
    if (bucket) bucket.push(item);
  }

  const handleDrop = (status: S): void => {
    const item = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!item || getStatus(item) === status) return;
    onMove(item, status);
  };

  const dropHandlers = (status: S) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!canMove) return;
      event.preventDefault();
      setDropTarget(status);
    },
    onDragLeave: () => setDropTarget((current) => (current === status ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      handleDrop(status);
    },
  });

  return (
    <div className="p-4">
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((column) => {
          const columnItems = grouped.get(column.status) ?? [];
          const isTarget = dropTarget === column.status;

          return (
            <section
              key={column.status}
              {...dropHandlers(column.status)}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-panel border bg-panel-muted transition-colors',
                isTarget ? 'border-accent bg-accent-soft' : 'border-line',
              )}
            >
              <header className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <h3 className="font-display text-[0.8125rem] font-semibold text-ink">
                  {column.label ?? humanise(column.status)}
                </h3>
                <span className="tabular font-mono text-xs text-ink-faint">
                  {columnItems.length}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-2 p-2.5">
                {columnItems.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-ink-faint">
                    {isTarget ? 'Drop to move here' : emptyLabel}
                  </p>
                ) : (
                  columnItems.map((item) => (
                    <article
                      key={getId(item)}
                      draggable={canMove}
                      onDragStart={() => setDragging(item)}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                      className={cn(
                        'rounded-md border border-line bg-panel p-3 transition-opacity',
                        canMove && 'cursor-grab active:cursor-grabbing',
                        dragging && getId(dragging) === getId(item) && 'opacity-40',
                      )}
                    >
                      {renderCard(item)}
                    </article>
                  ))
                )}
              </div>
            </section>
          );
        })}

        {collapsed.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-3">
            {collapsed.map((column) => {
              const count = grouped.get(column.status)?.length ?? 0;
              const isTarget = dropTarget === column.status;

              return (
                <section
                  key={column.status}
                  {...dropHandlers(column.status)}
                  className={cn(
                    'flex w-44 flex-1 flex-col items-center justify-center rounded-panel border border-dashed px-4 py-6 text-center transition-colors',
                    isTarget ? 'border-accent bg-accent-soft' : 'border-line bg-panel-muted',
                  )}
                >
                  <p className="font-display text-[0.8125rem] font-semibold text-ink">
                    {column.label ?? humanise(column.status)}
                  </p>
                  <p className="tabular mt-1 font-mono text-xs text-ink-faint">
                    {isTarget ? 'Drop to move here' : `${count}`}
                  </p>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>

      {footer}
    </div>
  );
}
