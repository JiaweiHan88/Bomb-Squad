import type { ReactNode } from 'react';

interface AppShellProps {
  /** Optional operator-world header content (title bar / nav). */
  header?: ReactNode;
  children: ReactNode;
}

/**
 * Operator-world (non-diegetic) frame for landing / lobby / dashboard surfaces.
 *
 * Uses ONLY the operator palette (surface + cream ink, body font). Bomb-world
 * tokens (bakelite / brass / led-* / timer-*) are reserved for the R3F chassis
 * and HUD in Epic 4 — never use them here (DESIGN.md "Don'ts").
 *
 * Thin layout primitive: a full-viewport column with an optional header slot.
 */
export default function AppShell({ header, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-surface font-body text-ink-primary">
      {header != null && (
        <header className="border-b border-surface-raised px-8 py-4">{header}</header>
      )}
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
