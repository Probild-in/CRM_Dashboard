import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CheckCheck,
  FileText,
  FolderKanban,
  ListChecks,
  Target,
  Wallet,
} from 'lucide-react';
import type { NotificationType } from '@probild/shared';
import { Button } from '@/components/ui/Button';
import { cn, relativeTime } from '@/lib/utils';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
  type Notification,
} from './api';

const ICONS: Record<NotificationType, typeof Bell> = {
  TASK: ListChecks,
  MEETING: CalendarClock,
  FOLLOW_UP: Target,
  PROJECT: FolderKanban,
  MILESTONE: FolderKanban,
  PAYMENT: Wallet,
  QUOTATION: FileText,
  SYSTEM: Bell,
};

/**
 * The reminders the engine raised, in the top bar.
 *
 * Opening one takes you to the thing it is about and marks it read — reading a
 * reminder and acting on it are the same gesture.
 */
export function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unread = useUnreadCount();
  const notifications = useNotifications({ page: 1, pageSize: 12 });
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const count = unread.data?.count ?? 0;
  const items = notifications.data?.items ?? [];

  const openNotification = (notification: Notification): void => {
    if (!notification.readAt) void markRead.mutateAsync(notification.id);
    setOpen(false);
    if (notification.actionUrl) navigate(notification.actionUrl);
  };

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((current) => !current)}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative"
      >
        <Bell aria-hidden className="size-4.5" />
        {count > 0 ? (
          <span className="tabular absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-mono text-[0.5625rem] font-semibold text-white dark:text-ink">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 z-30 mt-1.5 w-88 overflow-hidden rounded-md border border-line bg-panel shadow-lg">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="text-[0.8125rem] font-semibold text-ink">
              Notifications
              {count > 0 ? (
                <span className="ml-1.5 font-mono text-[0.625rem] font-normal text-ink-faint">
                  {count} unread
                </span>
              ) : null}
            </p>
            {count > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead.mutateAsync()}
                className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-accent"
              >
                <CheckCheck aria-hidden className="size-3.5" />
                Mark all read
              </button>
            ) : null}
          </header>

          {notifications.isPending ? (
            <p className="px-4 py-8 text-center text-[0.8125rem] text-ink-faint">Loading…</p>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[0.8125rem] font-medium text-ink">Nothing to see</p>
              <p className="mt-1 text-xs text-ink-faint">
                Probild raises a reminder here when something is due or late.
              </p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((notification) => {
                const Icon = ICONS[notification.type] ?? Bell;
                const late =
                  notification.priority === 'URGENT' &&
                  /overdue|expired|passed its/i.test(notification.message);

                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      className={cn(
                        'flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-panel-muted',
                        !notification.readAt && 'bg-accent-soft/40',
                        late && 'edge-marker text-danger',
                      )}
                    >
                      <span className="mt-0.5 shrink-0 text-ink-faint">
                        {late ? (
                          <AlarmClock aria-hidden className="size-4" />
                        ) : (
                          <Icon aria-hidden className="size-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate text-[0.8125rem]',
                            notification.readAt ? 'text-ink-soft' : 'font-medium text-ink',
                          )}
                        >
                          {notification.title}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-xs text-ink-faint">
                          {notification.message}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[0.625rem] whitespace-nowrap text-ink-faint">
                        {relativeTime(notification.createdAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <footer className="border-t border-line px-4 py-2.5">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-ink-faint hover:text-accent"
            >
              See everything
            </Link>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
