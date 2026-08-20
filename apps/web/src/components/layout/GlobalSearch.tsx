import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import type { EntityType } from '@probild/shared';
import { apiGet } from '@/lib/api';
import { cn, humanise } from '@/lib/utils';

interface SearchHit {
  entityType: EntityType;
  id: string;
  reference: string | null;
  title: string;
  subtitle: string | null;
  url: string;
}

/** Waits for typing to settle before asking the server. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebounced(term.trim(), 250);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => apiGet<SearchHit[]>('/search', { params: { q: debounced } }),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
  });

  // "/" focuses search from anywhere, the way every tool people already use does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const hits = results.data ?? [];

  const go = (hit: SearchHit): void => {
    navigate(hit.url);
    setOpen(false);
    setTerm('');
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % hits.length);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => (index - 1 + hits.length) % hits.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[highlighted];
      if (hit) go(hit);
    }
  };

  return (
    <div ref={containerRef} className="relative max-w-md flex-1">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
      />
      <input
        ref={inputRef}
        type="search"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setHighlighted(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search leads, people…"
        aria-label="Search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        className="h-9 w-full rounded-md border border-line bg-panel-muted pr-10 pl-9 text-sm text-ink placeholder:text-ink-faint focus:border-accent"
      />
      {results.isFetching ? (
        <Loader2
          aria-hidden
          className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin text-ink-faint"
        />
      ) : (
        <kbd className="absolute top-1/2 right-3 hidden -translate-y-1/2 font-mono text-[0.625rem] text-ink-faint sm:block">
          /
        </kbd>
      )}

      {open && debounced.length >= 2 ? (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute top-full right-0 left-0 mt-1.5 overflow-hidden rounded-md border border-line bg-panel shadow-lg"
        >
          {results.isPending ? (
            <p className="px-3.5 py-3 text-[0.8125rem] text-ink-faint">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-3.5 py-3 text-[0.8125rem] text-ink-faint">
              Nothing matches “{debounced}”.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {hits.map((hit, index) => (
                <li key={`${hit.entityType}-${hit.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => go(hit)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3.5 py-2 text-left',
                      index === highlighted ? 'bg-neutral-soft' : '',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] font-medium text-ink">
                        {hit.title}
                      </span>
                      {hit.subtitle ? (
                        <span className="block truncate text-xs text-ink-faint">{hit.subtitle}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[0.625rem] tracking-wide text-ink-faint uppercase">
                      {hit.reference ?? humanise(hit.entityType)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
