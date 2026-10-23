import type { Entity } from '@pharos/schema';
import clsx from 'clsx';
import { Bot, Square } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../catalog/menu';
import { Tooltip } from '../catalog/tooltip';
import { useResource } from '../lib/api';
import { terminalsChanged, useTerminalHints } from './running';

/** A dot on a terminal mark: new output since you last looked (accent), or just running. */
export function TerminalDot({ unseen, className }: { unseen: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      data-terminal-dot={unseen ? 'unseen' : 'running'}
      className={clsx(
        'pointer-events-none absolute size-2 rounded-full ring-2 ring-surface',
        unseen ? 'bg-accent' : 'bg-ok',
        className,
      )}
    />
  );
}

/**
 * The rail's hint of where agents run (R17): agents keep running when you leave their project,
 * so with the sidebar collapsed this says how many, and opens a list of their projects (new
 * output marked) that takes you back with the panel open.
 */
export function RunningAgentsButton() {
  const { running, hints } = useTerminalHints();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const navigate = useNavigate();
  const projects = useResource<Entity<'project'>[]>(
    running.length ? '/api/entities/project' : null,
  );
  if (!running.length) return null;
  const nameOf = (id: string) => projects.data?.find((p) => p.id === id)?.data.name ?? 'Project';
  const unseen = [...hints.values()].some((h) => h.unseen);
  const label = `${running.length} agent ${running.length === 1 ? 'terminal' : 'terminals'} running${unseen ? ', with new output' : ''}`;
  return (
    <>
      <Tooltip label={label}>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          data-running-agents={running.length}
          onClick={(e: MouseEvent<HTMLButtonElement>) =>
            setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())
          }
          className="relative flex size-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-ink"
        >
          <Bot aria-hidden className="size-4" />
          <TerminalDot unseen={unseen} className="-top-0.5 -right-0.5" />
        </button>
      </Tooltip>
      {anchor && (
        <Menu anchor={anchor} label="Agent terminals" onClose={() => setAnchor(null)}>
          <MenuLabel>Agent terminals running</MenuLabel>
          {running.map((r) => {
            const first = r.projectIds[0];
            if (!first) return null;
            const hint = hints.get(first);
            return (
              <MenuItem
                key={r.projectIds.join(',')}
                icon={Bot}
                onClick={() => {
                  setAnchor(null);
                  navigate(`/projects/${first}?terminal=1`);
                }}
              >
                {r.projectIds.map(nameOf).join(', ')}
                {hint?.unseen ? ' · new output' : r.watched ? ' · open' : ''}
              </MenuItem>
            );
          })}
          <MenuSeparator />
          {running.map((r) =>
            r.projectIds[0] ? (
              <MenuItem
                key={`stop-${r.projectIds.join(',')}`}
                icon={Square}
                onClick={() => {
                  setAnchor(null);
                  // Its conversation is kept: opening the panel again resumes it.
                  void fetch(`/api/projects/${r.projectIds[0]}/terminal/stop`, {
                    method: 'POST',
                    headers: { 'x-pharos-author': 'human:me' },
                  })
                    .catch(() => {})
                    .finally(terminalsChanged);
                }}
              >
                Stop {r.projectIds.map(nameOf).join(', ')}
              </MenuItem>
            ) : null,
          )}
        </Menu>
      )}
    </>
  );
}
