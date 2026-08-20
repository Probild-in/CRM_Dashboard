import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PRIORITY_TONES } from '@/components/ui/tones';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Table';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/api';
import { toMessage } from '@/lib/api';
import { cn, formatDateTime, humanise, relativeTime } from '@/lib/utils';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const unread = useUnreadCount();
  const query = useNotifications({ page, pageSize: 25, unreadOnly });
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const count = unread.data?.count ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Notifications"
        description="Everything Probild has raised for you — deadlines, follow-ups and things that have gone late."
        action={
          count > 0 ? (
            <Button
              variant="secondary"
              loading={markAllRead.isPending}
              onClick={async () => {
                try {
                  const result = await markAllRead.mutateAsync();
                  toast.success(`Marked ${result.marked} read`);
                } catch (error) {
                  toast.error(toMessage(error));
                }
              }}
            >
              <CheckCheck aria-hidden className="size-4" />
              Mark all read
            </Button>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {[
          { key: false, label: 'Everything' },
          { key: true, label: 'Unread', count },
        ].map((filter) => (
          <button
            key={String(filter.key)}
            type="button"
            onClick={() => {
              setUnreadOnly(filter.key);
              setPage(1);
            }}
            className={cn(
              'flex items-baseline gap-2 rounded-md border px-3.5 py-2 transition-colors',
              unreadOnly === filter.key
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-panel text-ink-soft hover:border-line-strong',
            )}
          >
            {filter.count !== undefined ? (
              <span className="tabular font-display text-lg font-semibold">{filter.count}</span>
            ) : null}
            <span className="text-[0.8125rem]">{filter.label}</span>
          </button>
        ))}
      </div>

      <Panel>
        {query.isPending ? (
          <TableSkeleton rows={8} columns={3} />
        ) : query.isError ? (
          <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={<Bell aria-hidden className="size-4.5" />}
            title={unreadOnly ? 'Nothing unread' : 'Nothing raised yet'}
            description={
              unreadOnly
                ? 'You are up to date.'
                : 'Probild raises a reminder here when something is due or has gone late.'
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {query.data.items.map((notification) => {
                const late = /overdue|expired|passed its/i.test(notification.message);
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!notification.readAt) void markRead.mutateAsync(notification.id);
                        if (notification.actionUrl) navigate(notification.actionUrl);
                      }}
                      className={cn(
                        'flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-panel-muted',
                        !notification.readAt && 'bg-accent-soft/40',
                        late && 'edge-marker text-danger',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'truncate text-[0.8125rem]',
                              notification.readAt ? 'text-ink-soft' : 'font-medium text-ink',
                            )}
                          >
                            {notification.title}
                          </span>
                          <Badge tone={PRIORITY_TONES[notification.priority] ?? 'neutral'}>
                            {notification.priority}
                          </Badge>
                          <Badge>{humanise(notification.type)}</Badge>
                        </span>
                        <span className="mt-1 block text-xs text-ink-faint">
                          {notification.message}
                        </span>
                      </span>

                      <span className="shrink-0 text-right">
                        <span className="tabular block font-mono text-[0.6875rem] text-ink-faint">
                          {relativeTime(notification.createdAt)}
                        </span>
                        <span className="mt-0.5 block font-mono text-[0.625rem] text-ink-faint">
                          {formatDateTime(notification.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="notifications" />
          </>
        )}
      </Panel>
    </>
  );
}
