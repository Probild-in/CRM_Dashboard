import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/Button';
import { GlobalSearch } from './GlobalSearch';
import { NotificationCenter } from '@/features/notifications/NotificationCenter';
import { cn, humanise, initials } from '@/lib/utils';

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  if (!user) return null;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-panel/85 px-4 backdrop-blur lg:px-6">
      <Button variant="ghost" size="sm" className="lg:hidden" onClick={onOpenMenu} aria-label="Open menu">
        <Menu aria-hidden className="size-4.5" />
      </Button>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun aria-hidden className="size-4.5" /> : <Moon aria-hidden className="size-4.5" />}
        </Button>

        <NotificationCenter />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-md py-1 pr-2 pl-1 transition-colors hover:bg-neutral-soft"
          >
            <span className="flex size-7 items-center justify-center rounded bg-accent-soft font-mono text-[0.6875rem] font-semibold text-accent">
              {initials(user.firstName, user.lastName)}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-[0.8125rem] leading-tight font-medium text-ink">
                {user.fullName}
              </span>
              <span className="block font-mono text-[0.625rem] tracking-wide text-ink-faint uppercase">
                {humanise(user.role)}
              </span>
            </span>
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className={cn(
                'absolute right-0 mt-1.5 w-52 overflow-hidden rounded-md border border-line bg-panel shadow-lg',
              )}
            >
              <div className="border-b border-line px-3 py-2.5">
                <p className="truncate text-[0.8125rem] font-medium text-ink">{user.fullName}</p>
                <p className="truncate text-xs text-ink-faint">{user.email}</p>
              </div>
              <Link
                to="/settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-[0.8125rem] text-ink-soft hover:bg-neutral-soft hover:text-ink"
              >
                <UserIcon aria-hidden className="size-4" />
                Your profile
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => void signOut()}
                className="flex w-full items-center gap-2.5 border-t border-line px-3 py-2 text-left text-[0.8125rem] text-ink-soft hover:bg-neutral-soft hover:text-ink"
              >
                <LogOut aria-hidden className="size-4" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
