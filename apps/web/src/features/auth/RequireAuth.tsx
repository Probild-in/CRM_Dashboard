import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Permission } from '@probild/shared';
import { useAuth } from './AuthContext';
import { EmptyState } from '@/components/ui/States';
import { ShieldAlert } from 'lucide-react';

/** Blocks the app shell until a session is confirmed. */
export function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return <BootScreen />;
  }

  if (!user) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/**
 * Hides a route the signed-in role cannot use. This is a courtesy only — the
 * API enforces the same rule and is the actual boundary.
 */
export function RequirePermission({ permission }: { permission: Permission }) {
  const { can } = useAuth();

  if (!can(permission)) {
    return (
      <div className="rounded-panel border border-line bg-panel">
        <EmptyState
          icon={<ShieldAlert aria-hidden className="size-4.5" />}
          title="You do not have access to this area"
          description="Ask a super admin if you need this added to your role."
        />
      </div>
    );
  }

  return <Outlet />;
}

function BootScreen() {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-8 items-end gap-1" aria-hidden>
          <span className="w-1.5 animate-pulse bg-accent" style={{ height: '100%' }} />
          <span className="w-1.5 animate-pulse bg-accent/60" style={{ height: '70%', animationDelay: '120ms' }} />
          <span className="w-1.5 animate-pulse bg-warning" style={{ height: '45%', animationDelay: '240ms' }} />
        </div>
        <p className="eyebrow">Loading Probild</p>
      </div>
    </div>
  );
}
