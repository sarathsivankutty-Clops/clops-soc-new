'use client';

/**
 * Shared per-row action primitives for the Playbooks page.
 *
 * Extracted from PlaybooksView.tsx so the gallery can reuse them without a
 * circular import. The original behavior is preserved exactly (same fetch
 * URLs, same SWR cache keys, same UX).
 */

import React, { useEffect, useState } from 'react';
import { mutate } from 'swr';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import type { Playbook } from './types';
import { apiFetch } from '@/lib/api';

/**
 * Switch that flips Playbook.enabled via PUT /api/v1/playbooks/<id>.
 * Shipped packs are toggled per tenant by the agents store. The flip is shown at once and
 * rolled back with a toast if the save fails; the old version ignored the response, so a
 * refused save looked like a dead switch.
 */
export function EnabledToggle({ playbook }: { playbook: Playbook }) {
  const [loading, setLoading] = useState(false);
  const [on, setOn] = useState(playbook.enabled);
  useEffect(() => setOn(playbook.enabled), [playbook.enabled]);

  async function toggle() {
    const next = !on;
    setOn(next);
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/playbooks/${playbook.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `HTTP ${res.status}`);
      }
      await mutate('/api/v1/playbooks');
    } catch (err) {
      setOn(!next);
      toast.error(`Could not ${next ? 'enable' : 'disable'} ${playbook.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      disabled={loading}
      title={on ? 'Enabled. Click to disable' : 'Disabled. Click to enable'}
      aria-label={`${on ? 'Disable' : 'Enable'} ${playbook.name}`}
      className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
    >
      <span
        aria-hidden
        className={clsx('relative inline-flex h-5 w-9 items-center rounded-pill transition-colors', on ? 'bg-dot-success' : 'bg-surface-border-strong')}
      >
        <span
          className={clsx('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform', on ? 'translate-x-4' : 'translate-x-1')}
        />
      </span>
    </button>
  );
  /* [HIDDEN-UI RUNBOOK-G5 previous switch: raw palette classes, aria-pressed, 20px hit area]
  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={playbook.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
      aria-label={`${playbook.enabled ? 'Disable' : 'Enable'} ${playbook.name}`}
      aria-pressed={playbook.enabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-900 disabled:opacity-50 ${
        playbook.enabled ? 'bg-green-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          playbook.enabled ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  );
  */
}

/** "Run" / dry-run button that POSTs to /api/v1/playbooks/<id>/run. */
export function RunButton({ playbook }: { playbook: Playbook }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'err'>('idle');
  async function run() {
    setStatus('running');
    try {
      const res = await apiFetch(`/api/v1/playbooks/${playbook.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: {}, dry_run: true }),
      });
      if (!res.ok) throw new Error();
      setStatus('done');
    } catch {
      setStatus('err');
    }
    setTimeout(() => setStatus('idle'), 3000);
  }
  const label = { idle: 'Run', running: '…', done: 'OK', err: 'Err' }[status];
  const color = {
    idle:    'text-green-500 hover:text-green-400',
    running: 'text-yellow-500',
    done:    'text-green-400',
    err:     'text-red-400',
  }[status];
  return (
    <button
      onClick={run}
      disabled={status === 'running'}
      title="Dry run"
      aria-label={`Dry-run ${playbook.name}`}
      className={`text-xs px-2.5 py-1 rounded border border-gray-700 transition-colors ${color}`}
    >
      {label}
    </button>
  );
}

/** Delete a playbook (used only for user-created playbooks, not shipped packs). */
export async function deletePlaybook(id: string) {
  if (!confirm('Delete this runbook?')) return;
  await apiFetch(`/api/v1/playbooks/${id}`, { method: 'DELETE' });
  await mutate('/api/v1/playbooks');
}
