import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, ExternalLink, Link2Off, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingState } from '@/components/ui/States';
import { toMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import {
  useCalendarConnection,
  useConnectGoogle,
  useDisconnectGoogle,
  useSyncCalendar,
  useUpdateConnection,
} from './api';

/**
 * Connect, disconnect and choose what gets mirrored.
 *
 * The OAuth round trip returns to `/settings?google=…`, which this reads once
 * and then clears so a refresh does not repeat the message.
 */
export function GoogleCalendarPanel() {
  const [params, setParams] = useSearchParams();
  const state = useCalendarConnection();
  const connect = useConnectGoogle();
  const disconnect = useDisconnectGoogle();
  const update = useUpdateConnection();
  const sync = useSyncCalendar();

  useEffect(() => {
    const outcome = params.get('google');
    if (!outcome) return;

    if (outcome === 'connected') {
      toast.success('Google Calendar connected');
    } else {
      const reason = params.get('reason');
      toast.error(
        reason === 'invalid_state'
          ? 'That sign-in link had expired. Try connecting again.'
          : 'Google did not complete the connection. Try again.',
      );
    }

    const next = new URLSearchParams(params);
    next.delete('google');
    next.delete('reason');
    setParams(next, { replace: true });
  }, [params, setParams]);

  if (state.isPending || !state.data) {
    return (
      <Panel>
        <PanelHeader eyebrow="Integration" title="Google Calendar" />
        <LoadingState label="Checking the connection" />
      </Panel>
    );
  }

  const { configured, connection } = state.data;

  if (!configured) {
    return (
      <Panel>
        <PanelHeader eyebrow="Integration" title="Google Calendar" />
        <PanelBody className="flex flex-col gap-3">
          <p className="text-[0.8125rem] text-ink-soft">
            Not set up yet. An administrator needs to add Google OAuth credentials to the API
            before anyone can connect their calendar.
          </p>
          <p className="edge-marker rounded-r bg-neutral-soft py-2.5 pr-3 pl-3.5 font-mono text-[0.6875rem] text-ink-faint">
            GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in apps/api/.env
          </p>
        </PanelBody>
      </Panel>
    );
  }

  if (!connection?.isActive) {
    return (
      <Panel>
        <PanelHeader eyebrow="Integration" title="Google Calendar" />
        <PanelBody className="flex flex-col gap-4">
          <p className="text-[0.8125rem] text-ink-soft">
            Connect your calendar and the meetings you organise in Probild appear in Google, with a
            Meet link when you ask for one. Changes made in Google come back the other way.
          </p>
          <div>
            <Button
              variant="primary"
              loading={connect.isPending}
              onClick={async () => {
                try {
                  const { authUrl } = await connect.mutateAsync();
                  window.location.href = authUrl;
                } catch (error) {
                  toast.error(toMessage(error));
                }
              }}
            >
              <CalendarCheck aria-hidden className="size-4" />
              Connect Google Calendar
            </Button>
          </div>
          <p className="text-xs text-ink-faint">
            Probild asks only for calendar access. Your Google credentials stay with Google, and the
            tokens are held encrypted on the server.
          </p>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        eyebrow="Integration"
        title="Google Calendar"
        action={<Badge tone="success">Connected</Badge>}
      />
      <PanelBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <Row label="Account">{connection.providerEmail ?? 'Google account'}</Row>
          <Row label="Calendar">{connection.calendarId ?? 'primary'}</Row>
          <Row label="Last synced">
            {connection.lastSyncedAt ? formatDateTime(connection.lastSyncedAt) : 'Not yet'}
          </Row>
        </div>

        <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
          <legend className="eyebrow mb-1">What gets mirrored</legend>

          <Toggle
            checked={connection.syncMeetings}
            label="Meetings you organise"
            hint="Pushed to Google when you create or change them."
            onChange={(value) => void update.mutateAsync({ syncMeetings: value })}
          />
          <Toggle
            checked={connection.syncTasks}
            label="Your task deadlines"
            hint="A 30-minute marker before each deadline."
            onChange={(value) => void update.mutateAsync({ syncTasks: value })}
          />
        </fieldset>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button
            variant="secondary"
            loading={sync.isPending}
            onClick={async () => {
              try {
                const result = await sync.mutateAsync();
                toast.success(
                  result.updated + result.cancelled === 0
                    ? 'Already up to date'
                    : `Pulled ${result.updated} change${result.updated === 1 ? '' : 's'} from Google`,
                );
              } catch (error) {
                toast.error(toMessage(error));
              }
            }}
          >
            <RefreshCw aria-hidden className="size-4" />
            Sync now
          </Button>

          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[0.8125rem] text-ink-soft hover:bg-panel-muted"
          >
            Open Google Calendar
            <ExternalLink aria-hidden className="size-3.5" />
          </a>

          <Button
            variant="ghost"
            loading={disconnect.isPending}
            onClick={async () => {
              try {
                await disconnect.mutateAsync();
                toast.success('Google Calendar disconnected');
              } catch (error) {
                toast.error(toMessage(error));
              }
            }}
          >
            <Link2Off aria-hidden className="size-4" />
            Disconnect
          </Button>
        </div>
      </PanelBody>
    </Panel>
  );
}

function Toggle({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-[var(--app-accent)]"
      />
      <span>
        <span className="block text-[0.8125rem] font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-faint">{hint}</span>
      </span>
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[0.8125rem] text-ink-faint">{label}</span>
      <span className="truncate text-[0.8125rem] font-medium text-ink">{children}</span>
    </div>
  );
}
