import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabDefinition {
  key: string;
  label: string;
  /** Shown beside the label; omit rather than passing 0 for empty sections. */
  count?: number;
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDefinition[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="tablist" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <div className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => onChange(tab.key)}
              className={cn(
                'relative flex items-center gap-1.5 px-3.5 py-2.5 text-[0.8125rem] font-medium transition-colors',
                isActive ? 'text-accent' : 'text-ink-faint hover:text-ink',
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 ? (
                <span className="tabular rounded bg-neutral-soft px-1.5 py-0.5 font-mono text-[0.625rem] text-ink-soft">
                  {tab.count}
                </span>
              ) : null}
              {/* The active marker is the same 2px rule used throughout, turned on its side. */}
              {isActive ? (
                <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-accent" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TabPanel({ active, tabKey, children }: { active: string; tabKey: string; children: ReactNode }) {
  if (active !== tabKey) return null;
  return (
    <div role="tabpanel" className="pt-5">
      {children}
    </div>
  );
}
