import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { NAVIGATION } from './navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useAuth();

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-30 bg-ink/35 lg:hidden" onClick={onClose} aria-hidden />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-panel',
          'transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <NavLink to="/" className="flex items-center gap-2.5" onClick={onClose}>
            <div className="flex h-5 items-end gap-0.5" aria-hidden>
              <span className="h-5 w-1.5 bg-accent" />
              <span className="h-3.5 w-1.5 bg-accent/55" />
              <span className="h-2 w-1.5 bg-warning" />
            </div>
            <span className="font-display text-sm font-semibold tracking-tight text-ink">Probild</span>
          </NavLink>
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={onClose} aria-label="Close menu">
            <X aria-hidden className="size-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-4" aria-label="Main">
          {NAVIGATION.map((group) => {
            const visible = group.items.filter((item) => !item.permission || can(item.permission));
            if (visible.length === 0) return null;

            return (
              <div key={group.label ?? 'root'} className="mb-5 last:mb-0">
                {group.label ? <p className="eyebrow px-2.5 pb-2">{group.label}</p> : null}
                <ul className="flex flex-col gap-0.5">
                  {visible.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={onClose}
                        className={({ isActive }) =>
                          cn(
                            'group relative flex items-center gap-2.5 rounded-md py-2 pr-2.5 pl-3 text-[0.8125rem] font-medium transition-colors',
                            isActive
                              ? 'edge-marker bg-accent-soft text-accent'
                              : 'text-ink-soft hover:bg-neutral-soft hover:text-ink',
                          )
                        }
                      >
                        <item.icon aria-hidden className="size-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <p className="font-mono text-[0.625rem] tracking-wide text-ink-faint uppercase">
            Probild CRM · v0.1
          </p>
        </div>
      </aside>
    </>
  );
}
