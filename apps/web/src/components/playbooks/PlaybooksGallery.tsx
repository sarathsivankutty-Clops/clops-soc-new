'use client';

/**
 * PlaybooksGallery
 * ================
 * Faceted gallery for the /playbooks "All" tab. Surfaces the 50+ shipped
 * reference packs alongside any user-created playbooks with:
 *
 *   • Source filter pills      ("All" / "Shipped Packs" / "Custom")
 *   • Category dropdown       (account-takeover, ransomware, …)
 *   • MITRE tactic dropdown   (Initial Access, Lateral Movement, …)
 *   • Severity dropdown       (info / low / medium / high / critical)
 *   • Integration dropdown    (EDR, IAM, Ticketing, SIEM, …)
 *   • Free-text search         (matches name, description, tags)
 *   • Per-row PACK badge       (purple) + colored category badge
 *   • One-click "Preview"      (read-only DAG drawer)
 *   • One-click "Fork"         (clones a pack into a user-owned playbook)
 *   • "Edit" / "Delete"        (existing flow for custom playbooks)
 *
 * The gallery is driven entirely from the existing `GET /api/v1/playbooks`
 * payload — no new backend endpoints required. See packHelpers.ts for the
 * pack-detection heuristic, MITRE/severity/integration helpers, and forking.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mutate } from 'swr';
import clsx from 'clsx';

import type { Playbook } from './types';
import {
  PACK_CATEGORIES,
  MITRE_TACTICS,
  SEVERITY_LEVELS,
  INTEGRATION_TYPES,
  type PackCategory,
  type PlaybookSource,
  type MitreTactic,
  type SeverityLevel,
  type IntegrationType,
  isShippedPack,
  categoryOf,
  categoryLabel,
  categoryBadgeClass,
  mitreTacticsOf,
  severitiesOf,
  integrationsOf,
  filterPlaybooks,
  countBySource,
  countByCategory,
  forkPlaybook,
} from './packHelpers';
import { DAGPreviewDrawer } from './DAGPreviewDrawer';
import { EnabledToggle, RunButton, deletePlaybook } from './rowActions';

const TRIGGER_COLORS: Record<string, string> = {
  // [UI-OVERHAUL-3] Raw palette classes replaced with semantic tokens so
  // trigger badges follow the active theme.
  alert:    'bg-pill-danger-bg text-tone-danger',
  case:     'bg-pill-info-bg text-accent',
  manual:   'bg-pill-neutral-bg text-fg-muted',
  schedule: 'bg-pill-purple-bg text-tone-purple',
};

/** Filter snapshot that can be saved as a named preset via SavedViewsBar. */
export interface PlaybookGalleryFilters {
  source: PlaybookSource;
  category: PackCategory | 'all';
  mitreTactic: MitreTactic | 'all';
  severity: SeverityLevel | 'all';
  integration: IntegrationType | 'all';
  search: string;
}

interface PlaybooksGalleryProps {
  playbooks: Playbook[];
  /** Pre-seed local filter state from a saved view preset. */
  initialFilters?: Partial<PlaybookGalleryFilters>;
}

export function PlaybooksGallery({ playbooks, initialFilters }: PlaybooksGalleryProps) {
  const router = useRouter();
  const [source, setSource] = useState<PlaybookSource>(initialFilters?.source ?? 'all');
  const [category, setCategory] = useState<PackCategory | 'all'>(initialFilters?.category ?? 'all');
  const [mitreTactic, setMitreTactic] = useState<MitreTactic | 'all'>(initialFilters?.mitreTactic ?? 'all');
  const [severity, setSeverity] = useState<SeverityLevel | 'all'>(initialFilters?.severity ?? 'all');
  const [integration, setIntegration] = useState<IntegrationType | 'all'>(initialFilters?.integration ?? 'all');
  const [search, setSearch] = useState(initialFilters?.search ?? '');
  const [previewing, setPreviewing] = useState<Playbook | null>(null);
  const [forkingId, setForkingId] = useState<string | null>(null);
  const [forkError, setForkError] = useState<string | null>(null);

  const sourceCounts = useMemo(() => countBySource(playbooks), [playbooks]);
  const categoryCounts = useMemo(() => countByCategory(playbooks), [playbooks]);

  // Counts for MITRE tactics across current source+category selection (before tactic filter)
  const mitreCounts = useMemo(() => {
    const pre = playbooks.filter((pb) => {
      const isPack = isShippedPack(pb);
      if (source === 'pack' && !isPack) return false;
      if (source === 'custom' && isPack) return false;
      if (category !== 'all' && categoryOf(pb) !== category) return false;
      return true;
    });
    const counts: Record<MitreTactic, number> = {} as Record<MitreTactic, number>;
    for (const t of MITRE_TACTICS) counts[t] = 0;
    for (const pb of pre) {
      for (const t of mitreTacticsOf(pb)) counts[t]++;
    }
    return counts;
  }, [playbooks, source, category]);

  // Counts for severity levels
  const severityCounts = useMemo(() => {
    const pre = playbooks.filter((pb) => {
      const isPack = isShippedPack(pb);
      if (source === 'pack' && !isPack) return false;
      if (source === 'custom' && isPack) return false;
      if (category !== 'all' && categoryOf(pb) !== category) return false;
      if (mitreTactic !== 'all' && !mitreTacticsOf(pb).includes(mitreTactic)) return false;
      return true;
    });
    const counts: Record<SeverityLevel, number> = {} as Record<SeverityLevel, number>;
    for (const s of SEVERITY_LEVELS) counts[s] = 0;
    for (const pb of pre) {
      for (const s of severitiesOf(pb)) counts[s]++;
    }
    return counts;
  }, [playbooks, source, category, mitreTactic]);

  // Counts for integration types
  const integrationCounts = useMemo(() => {
    const pre = playbooks.filter((pb) => {
      const isPack = isShippedPack(pb);
      if (source === 'pack' && !isPack) return false;
      if (source === 'custom' && isPack) return false;
      if (category !== 'all' && categoryOf(pb) !== category) return false;
      if (mitreTactic !== 'all' && !mitreTacticsOf(pb).includes(mitreTactic)) return false;
      if (severity !== 'all' && !severitiesOf(pb).includes(severity)) return false;
      return true;
    });
    const counts: Record<IntegrationType, number> = {} as Record<IntegrationType, number>;
    for (const i of INTEGRATION_TYPES) counts[i] = 0;
    for (const pb of pre) {
      for (const i of integrationsOf(pb)) counts[i]++;
    }
    return counts;
  }, [playbooks, source, category, mitreTactic, severity]);

  const filtered = useMemo(
    () => filterPlaybooks(playbooks, { source, category, mitreTactic, severity, integration, search }),
    [playbooks, source, category, mitreTactic, severity, integration, search],
  );

  // The category facet only meaningfully applies to packs.
  const showCategoryRow = source !== 'custom';

  // Reset downstream filters when source changes.
  function handleSetSource(s: PlaybookSource) {
    setSource(s);
    setCategory('all');
    setMitreTactic('all');
    setSeverity('all');
    setIntegration('all');
  }

  const hasActiveFilters =
    category !== 'all' ||
    mitreTactic !== 'all' ||
    severity !== 'all' ||
    integration !== 'all' ||
    search !== '';

  function clearAllFilters() {
    setCategory('all');
    setMitreTactic('all');
    setSeverity('all');
    setIntegration('all');
    setSearch('');
  }

  async function handleFork(pb: Playbook) {
    setForkError(null);
    setForkingId(pb.id);
    try {
      const created = await forkPlaybook(pb);
      // Refresh the gallery list so the fork shows up under "Custom".
      await mutate('/api/v1/playbooks');
      // Drop the user into the editor for their fresh fork.
      setPreviewing(null);
      router.push(`/playbooks/${created.id}`);
    } catch (e) {
      setForkError(e instanceof Error ? e.message : 'Fork failed.');
    } finally {
      setForkingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* [UI-OVERHAUL-3] One toolbar card. The four stacked chip rows
          (Category / MITRE / Severity / Uses) became dropdowns so the facet
          bar no longer pushes the first runbook below the fold. */}
      <div className="space-y-3 rounded-container border border-surface-border bg-surface-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-56 flex-1 gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search runbooks…"
              aria-label="Search runbooks"
              className="flex-1 rounded-control border border-surface-border bg-surface-elevated px-3 py-2 text-body text-fg-primary placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <div
            className="flex gap-1 rounded-control border border-surface-border bg-surface-card p-1"
            role="tablist"
            aria-label="Runbook source"
          >
            <SourcePill
              label="All"
              count={sourceCounts.all}
              active={source === 'all'}
              onClick={() => handleSetSource('all')}
            />
            <SourcePill
              label="Shipped Packs"
              count={sourceCounts.pack}
              active={source === 'pack'}
              onClick={() => handleSetSource('pack')}
              tone="pack"
            />
            <SourcePill
              label="Custom"
              count={sourceCounts.custom}
              active={source === 'custom'}
              onClick={() => handleSetSource('custom')}
            />
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="rounded-control border border-surface-border px-2 py-1 text-xs text-fg-muted transition-colors hover:border-tone-danger/40 hover:text-tone-danger"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {showCategoryRow && (
            <FilterSelect
              label="Category"
              value={category}
              onChange={(value) => setCategory(value as PackCategory | 'all')}
            >
              <option value="all">All categories</option>
              {PACK_CATEGORIES.filter(
                (cat) => categoryCounts[cat] > 0 || category === cat,
              ).map((cat) => (
                <option key={cat} value={cat}>
                  {categoryLabel(cat)} ({categoryCounts[cat]})
                </option>
              ))}
            </FilterSelect>
          )}

          <FilterSelect
            label="MITRE tactic"
            value={mitreTactic}
            onChange={(value) => setMitreTactic(value as MitreTactic | 'all')}
          >
            <option value="all">All tactics</option>
            {MITRE_TACTICS.filter(
              (tactic) => mitreCounts[tactic] > 0 || mitreTactic === tactic,
            ).map((tactic) => (
              <option key={tactic} value={tactic}>
                {tactic} ({mitreCounts[tactic]})
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Severity"
            value={severity}
            onChange={(value) => setSeverity(value as SeverityLevel | 'all')}
          >
            <option value="all">All severities</option>
            {SEVERITY_LEVELS.filter(
              (sev) => severityCounts[sev] > 0 || severity === sev,
            ).map((sev) => (
              <option key={sev} value={sev}>
                {sev} ({severityCounts[sev]})
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Uses"
            value={integration}
            onChange={(value) => setIntegration(value as IntegrationType | 'all')}
          >
            <option value="all">All integrations</option>
            {INTEGRATION_TYPES.filter(
              (intType) =>
                integrationCounts[intType] > 0 || integration === intType,
            ).map((intType) => (
              <option key={intType} value={intType}>
                {intType} ({integrationCounts[intType]})
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>

      {/* [HIDDEN-UI UI-OVERHAUL-3 the four stacked chip rows (Category / MITRE /
          Severity / Uses) were replaced by the FilterSelect dropdowns above.
          Kept verbatim so the chip layout can be restored.
      {showCategoryRow && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filter by category">
          <span className="text-xs text-fg-subtle w-16 shrink-0">Category</span>
          <CategoryPill
            label="All"
            active={category === 'all'}
            onClick={() => setCategory('all')}
          />
          {PACK_CATEGORIES.map((cat) => {
            const n = categoryCounts[cat];
            if (n === 0) return null;
            return (
              <CategoryPill
                key={cat}
                label={`${categoryLabel(cat)} (${n})`}
                active={category === cat}
                onClick={() => setCategory(cat)}
                tone={cat}
              />
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" aria-label="Filter by MITRE tactic">
        <span className="text-xs text-fg-subtle w-16 shrink-0">MITRE</span>
        <FacetPill
          label="All"
          active={mitreTactic === 'all'}
          onClick={() => setMitreTactic('all')}
        />
        {MITRE_TACTICS.map((tactic) => {
          const n = mitreCounts[tactic];
          if (n === 0) return null;
          return (
            <FacetPill
              key={tactic}
              label={`${tactic} (${n})`}
              active={mitreTactic === tactic}
              onClick={() => setMitreTactic(tactic)}
              activeClass="bg-pill-danger-bg text-tone-danger border-transparent"
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filter by severity">
        <span className="text-xs text-fg-subtle w-16 shrink-0">Severity</span>
        <FacetPill
          label="All"
          active={severity === 'all'}
          onClick={() => setSeverity('all')}
        />
        {SEVERITY_LEVELS.map((sev) => {
          const n = severityCounts[sev];
          if (n === 0) return null;
          const COLOR_MAP: Record<SeverityLevel, string> = {
            info:     'bg-severity-info-bg text-severity-info-ink border-transparent',
            low:      'bg-severity-low-bg text-severity-low-ink border-transparent',
            medium:   'bg-severity-medium-bg text-severity-medium-ink border-transparent',
            high:     'bg-severity-high-bg text-severity-high-ink border-transparent',
            critical: 'bg-severity-critical-bg text-severity-critical-ink border-transparent',
          };
          return (
            <FacetPill
              key={sev}
              label={`${sev} (${n})`}
              active={severity === sev}
              onClick={() => setSeverity(sev)}
              activeClass={COLOR_MAP[sev]}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filter by integration">
        <span className="text-xs text-fg-subtle w-16 shrink-0">Uses</span>
        <FacetPill
          label="All"
          active={integration === 'all'}
          onClick={() => setIntegration('all')}
        />
        {INTEGRATION_TYPES.map((intType) => {
          const n = integrationCounts[intType];
          if (n === 0) return null;
          return (
            <FacetPill
              key={intType}
              label={`${intType} (${n})`}
              active={integration === intType}
              onClick={() => setIntegration(intType)}
              activeClass="bg-pill-info-bg text-tone-info border-transparent"
            />
          );
        })}
      </div>
      */}

      {forkError && (
        <div
          role="alert"
          className="rounded-control border border-severity-critical-ink/30 bg-severity-critical-bg px-4 py-2 text-xs text-severity-critical-ink"
        >
          {forkError}
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-lg font-medium text-fg-secondary mb-2">No matching runbooks</div>
          <div className="text-body text-fg-muted mb-6">
            Try clearing your filters, or create a new runbook from scratch.
          </div>
          <Link
            href="/playbooks/new"
            className="px-4 py-2 rounded-control border border-surface-border bg-surface-elevated hover:bg-surface-hover text-fg-primary text-control font-medium transition-colors"
          >
            Create a runbook
          </Link>
        </div>
      )}

      {/* List */}
      {filtered.length > 0 && (
        <div className="grid gap-3">
          {filtered.map((pb) => (
            <PlaybookRow
              key={pb.id}
              playbook={pb}
              forking={forkingId === pb.id}
              onPreview={() => setPreviewing(pb)}
              onFork={() => handleFork(pb)}
            />
          ))}
        </div>
      )}

      <DAGPreviewDrawer
        playbook={previewing}
        onClose={() => setPreviewing(null)}
        onFork={(pb) => handleFork(pb)}
        forking={forkingId !== null}
      />
    </div>
  );
}

/* ─────────────────────────── Filter dropdown ─────────────────────────── */

/**
 * Labelled `<select>` used by the runbook toolbar. Native select keeps the
 * keyboard and screen-reader behaviour the chip rows never had, and the
 * `<option>` labels carry the live counts the pills used to show.
 */
function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-eyebrow font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="w-full rounded-control border border-surface-border bg-surface-elevated px-3 py-2 text-control-sm text-fg-primary focus:border-accent focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

/* [HIDDEN-UI UI-OVERHAUL-3 the pill facets were replaced by FilterSelect.
   Kept so the chip layout can be restored without rewriting it.

function FacetPill({
  label,
  active,
  onClick,
  activeClass,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  activeClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-pill px-3 py-0.5 text-xs font-medium border transition-colors',
        active
          ? activeClass ?? 'bg-nav-active-bg text-accent border-accent/30'
          : 'border-surface-border text-fg-muted hover:text-fg-primary hover:bg-surface-hover',
      )}
    >
      {label}
    </button>
  );
}
*/

/* ─────────────────────────── Source / Category pills ─────────────────────────── */

function SourcePill({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: 'pack';
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        'rounded-control px-2.5 py-1.5 text-xs font-medium transition-colors',
        active
          ? tone === 'pack'
            ? 'bg-pill-purple-bg text-tone-purple'
            : 'bg-nav-active-bg text-fg-primary'
          : 'text-fg-muted hover:text-fg-primary',
      )}
    >
      {label} ({count})
    </button>
  );
}

/* [HIDDEN-UI UI-OVERHAUL-3 category chips replaced by the Category dropdown.
function CategoryPill({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: PackCategory;
}) {
  const activeClasses = tone ? categoryBadgeClass(tone) : 'bg-nav-active-bg text-accent border-accent/30';
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-pill px-3 py-1 text-xs font-medium border transition-colors',
        active ? activeClasses : 'border-surface-border text-fg-muted hover:text-fg-primary hover:bg-surface-hover',
      )}
    >
      {label}
    </button>
  );
}
*/

/* ─────────────────────────── Row ─────────────────────────── */

function PlaybookRow({
  playbook,
  forking,
  onPreview,
  onFork,
}: {
  playbook: Playbook;
  forking: boolean;
  onPreview: () => void;
  onFork: () => void;
}) {
  const isPack = isShippedPack(playbook);
  const cat = categoryOf(playbook);
  const triggerOn = playbook.trigger?.on ?? 'manual';
  const tactics = mitreTacticsOf(playbook);
  const sevs = severitiesOf(playbook);
  const integrations = integrationsOf(playbook);

  const SEVERITY_MINI: Record<SeverityLevel, string> = {
    info:     'bg-severity-info-bg text-severity-info-ink',
    low:      'bg-severity-low-bg text-severity-low-ink',
    medium:   'bg-severity-medium-bg text-severity-medium-ink',
    high:     'bg-severity-high-bg text-severity-high-ink',
    critical: 'bg-severity-critical-bg text-severity-critical-ink',
  };

  return (
    <div
      className={clsx(
        'bg-surface-card border rounded-container px-5 py-4 flex items-center gap-4 transition-colors',
        playbook.enabled ? 'border-surface-border hover:bg-surface-elevated' : 'border-surface-border opacity-70',
      )}
    >
      <EnabledToggle playbook={playbook} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {isPack && (
            <span
              className="text-eyebrow font-semibold tracking-wide px-1.5 py-0.5 rounded-pill bg-pill-purple-bg text-tone-purple"
              title="Shipped reference pack — fork to customize."
            >
              PACK
            </span>
          )}
          {cat && (
            <span
              className={`text-eyebrow px-1.5 py-0.5 rounded-pill ${categoryBadgeClass(cat)}`}
              title={`Category: ${categoryLabel(cat)}`}
            >
              {categoryLabel(cat)}
            </span>
          )}
          <Link
            href={`/playbooks/${playbook.id}`}
            className="text-fg-primary font-medium hover:text-accent transition-colors truncate"
          >
            {playbook.name}
          </Link>
          <span
            className={`text-xs px-2 py-0.5 rounded-pill ${
              TRIGGER_COLORS[triggerOn] ?? TRIGGER_COLORS.manual
            }`}
          >
            {triggerOn}
          </span>
          {!playbook.enabled && (
            <span className="text-xs px-1.5 py-0.5 rounded-pill bg-pill-neutral-bg text-tone-neutral">
              disabled
            </span>
          )}
        </div>
        {playbook.description && (
          <p className="text-body text-fg-muted mt-0.5 line-clamp-2">{playbook.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-fg-subtle">
          <span>{playbook.steps.length} steps</span>
          <span>v{playbook.version}</span>
          {playbook.author && <span>by {playbook.author}</span>}
        </div>
        {/* MITRE tactics + severity chips */}
        {(tactics.length > 0 || sevs.length > 0 || integrations.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {tactics.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-eyebrow px-1.5 py-0.5 rounded-pill bg-pill-danger-bg text-tone-danger"
                title={`MITRE tactic: ${t}`}
              >
                {t}
              </span>
            ))}
            {tactics.length > 3 && (
              <span className="text-eyebrow text-fg-subtle">+{tactics.length - 3} more</span>
            )}
            {sevs.map((s) => (
              <span
                key={s}
                className={`text-eyebrow px-1.5 py-0.5 rounded-pill ${SEVERITY_MINI[s]}`}
                title={`Trigger severity: ${s}`}
              >
                {s}
              </span>
            ))}
            {integrations.slice(0, 2).map((i) => (
              <span
                key={i}
                className="text-eyebrow px-1.5 py-0.5 rounded-pill bg-pill-info-bg text-tone-info"
                title={`Integration: ${i}`}
              >
                {i}
              </span>
            ))}
            {integrations.length > 2 && (
              <span className="text-eyebrow text-fg-subtle">+{integrations.length - 2} integrations</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <RunButton playbook={playbook} />
        <button
          onClick={onPreview}
          aria-label={`Preview DAG for ${playbook.name}`}
          className="text-xs px-2.5 py-1 rounded-control border border-surface-border text-fg-secondary hover:text-fg-primary hover:bg-surface-hover transition-colors"
        >
          Preview
        </button>
        {isPack ? (
          <button
            onClick={onFork}
            disabled={forking}
            aria-label={`Fork ${playbook.name}`}
            className="text-xs px-2.5 py-1 rounded-control bg-pill-purple-bg text-tone-purple hover:brightness-110 transition-colors disabled:opacity-50"
          >
            {forking ? 'Forking…' : 'Fork'}
          </button>
        ) : (
          <>
            <Link
              href={`/playbooks/${playbook.id}`}
              className="text-xs px-2.5 py-1 rounded-control border border-surface-border text-fg-secondary hover:text-fg-primary hover:bg-surface-hover transition-colors"
            >
              Edit
            </Link>
            <button
              onClick={() => deletePlaybook(playbook.id)}
              className="text-xs px-2.5 py-1 rounded-control border border-surface-border text-fg-muted hover:text-tone-danger hover:border-severity-critical-ink/40 transition-colors"
              aria-label={`Delete ${playbook.name}`}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
