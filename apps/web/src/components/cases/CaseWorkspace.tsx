"use client";

/**
 * Case workspace.
 *
 * The single screen an analyst lives on while working an incident:
 *   - Header with title, severity, status, assignee, timing, MITRE tags
 *   - Action bar: status transitions, assign, link alerts, run copilot
 *   - Three-pane layout
 *       Left:    summary + linked alerts + assets/IOCs
 *       Center:  timeline (audit + activity feed)
 *       Right:   tasks + notes
 *
 * The hosted demo has no backend of its own, so a failed load falls back to
 * a seeded case *there and only there* — `buildDemoCase()` copies the route
 * param into the record it invents, which on any other deployment would put
 * a fabricated incident on screen under the id the analyst had opened.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { clsx } from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import {
  apiFetch,
  type AttackChainTimeline,
  type AttackChainWindow,
  type Case,
  type CaseAttackPath,
  type CaseExternalRef,
  casesApi,
  responderApi,
  type ApprovalRequest,
  type CaseSeverity,
  type CaseStatus,
  type CaseTask,
  type CaseTimelineEvent,
  graphApi,
  realtimeApi,
} from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SafeMarkdown } from "@/components/ui/SafeMarkdown";
import { InvestigationLedger } from "./InvestigationLedger";
import { WarRoomPanel } from "./WarRoomPanel";
import { ContextualActions } from "@/components/copilot/ContextualActions";
import { canUseDemoData } from "@/lib/demoFallback";
import { useUrlTab } from "@/hooks/useUrlTab";

type WorkspaceTab =
  "overview" | "investigation" | "attack-path" | "attack-chain" | "ledger" | "report";

const VALID_TABS: readonly WorkspaceTab[] = [
  "overview",
  "investigation",
  "attack-path",
  "attack-chain",
  "ledger",
  "report",
];

// ─── Demo case ────────────────────────────────────────────────────────────────

function buildDemoCase(id: string): Case {
  const now = new Date("2026-05-06T12:00:00Z").getTime();
  return {
    id,
    title: "Suspected lateral movement from finance subnet",
    description:
      "Multiple high-severity alerts indicate an attacker pivoted from " +
      "WIN-FIN-DB01 to BACKUP-SRV-12 using compromised service account credentials. " +
      "Behavior consistent with T1021.002 (SMB/Windows Admin Shares).",
    status: "investigating",
    severity: "critical",
    assignee: "sasha.lin@example.com",
    alertIds: ["alert-9012", "alert-9013", "alert-9019", "alert-9024"],
    alertCount: 4,
    tags: ["lateral-movement", "credential-access", "finance-subnet"],
    mitre: ["T1021.002", "T1078", "T1003.001"],
    createdBy: "system",
    createdAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 12 * 60 * 1000).toISOString(),
    dueAt: new Date(now + 18 * 60 * 60 * 1000).toISOString(),
    timeline: [
      {
        id: "tl-1",
        type: "created",
        timestamp: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
        title: "Case created from correlation rule",
        actor: "system",
        description:
          'Rule "Lateral movement from privileged subnet" matched 3 alerts within 4 minutes.',
      },
      {
        id: "tl-2",
        type: "assigned",
        timestamp: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
        title: "Assigned to Sasha Lin",
        actor: "andre.k",
      },
      {
        id: "tl-3",
        type: "agent",
        timestamp: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
        title: "Auto-investigation completed",
        actor: "aisoc-agent",
        description:
          "Confirmed pivot via SMB. Recommend isolating WIN-FIN-DB01 and rotating service account creds.",
      },
      {
        id: "tl-4",
        type: "note",
        timestamp: new Date(now - 90 * 60 * 1000).toISOString(),
        title: "Note added",
        actor: "sasha.lin",
        description:
          "IT confirmed the service account belongs to the legacy backup tool. " +
          "Proceeding to rotate creds and revoke session.",
      },
      {
        id: "tl-5",
        type: "status",
        timestamp: new Date(now - 12 * 60 * 1000).toISOString(),
        title: "Status changed to In progress",
        actor: "sasha.lin",
      },
    ],
    tasks: [
      {
        id: "task-1",
        title: "Isolate WIN-FIN-DB01 from network",
        status: "done",
        assignee: "andre.k",
        createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "task-2",
        title: "Rotate svc_backup credentials",
        status: "in_progress",
        assignee: "sasha.lin",
        createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "task-3",
        title: "Forensic image of BACKUP-SRV-12",
        status: "todo",
        createdAt: new Date(now - 60 * 60 * 1000).toISOString(),
      },
    ],
  };
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const SEVERITY_BADGE: Record<CaseSeverity, string> = {
  critical: "bg-red-500/15 text-red-300 ring-red-500/30",
  high: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  medium: "bg-yellow-500/15 text-yellow-300 ring-yellow-500/30",
  low: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
};

// Keyed on the six states the database actually permits. These used to name
// `open`, `in_progress` and `pending` -- none of which `aisoc_cases` allows --
// and omit `new`, `triaged`, `investigating` and `contained`, which is where a
// case spends nearly all of its life. A real case rendered `undefined` as its
// label and had no dot colour, while `Record<CaseStatus, …>` called the maps
// exhaustive because the union was wrong in the same direction.
const STATUS_LABEL: Record<CaseStatus, string> = {
  new: "New",
  triaged: "Triaged",
  investigating: "Investigating",
  contained: "Contained",
  resolved: "Resolved",
  closed: "Closed",
};

const STATUS_DOT: Record<CaseStatus, string> = {
  new: "bg-slate-400",
  triaged: "bg-sky-400",
  investigating: "bg-blue-400 animate-pulse",
  contained: "bg-amber-400",
  resolved: "bg-emerald-400",
  closed: "bg-slate-600",
};

const TASK_STATUS_BADGE: Record<CaseTask["status"], string> = {
  todo: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  in_progress: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  done: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
};

const TIMELINE_ICON: Record<string, string> = {
  created: "new",
  assigned: "asn",
  status: "sts",
  note: "note",
  agent: "ai",
  comment: "cmt",
  alert: "alrt",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: CaseStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/70 bg-slate-800/40 px-2 py-0.5 text-xs font-medium text-slate-200">
      <span className={clsx("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function MitreChip({ id }: { id: string }) {
  return (
    <a
      href={`https://attack.mitre.org/techniques/${id.replace(".", "/")}/`}
      target="_blank"
      rel="noreferrer"
      className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-300 transition-colors hover:bg-orange-500/20"
    >
      {id} ↗
    </a>
  );
}

function TimelineItem({ event }: { event: CaseTimelineEvent }) {
  const icon = TIMELINE_ICON[event.type] ?? "·";
  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-1 flex h-7 w-7 items-center justify-center rounded-full border border-slate-700/70 bg-slate-900 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {icon}
      </span>
      <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-sm font-medium text-slate-100">{event.title}</p>
          {event.actor && <span className="text-[11px] text-slate-500">by {event.actor}</span>}
          <span className="ml-auto text-[11px] text-slate-500" suppressHydrationWarning>
            {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
          </span>
        </div>
        {event.description && <p className="mt-1.5 text-xs text-slate-400">{event.description}</p>}
      </div>
    </li>
  );
}

interface TaskRowProps {
  task: CaseTask;
  onChangeStatus: (status: CaseTask["status"]) => void;
}

function TaskRow({ task, onChangeStatus }: TaskRowProps) {
  const next: CaseTask["status"] =
    task.status === "todo" ? "in_progress" : task.status === "in_progress" ? "done" : "todo";

  return (
    <li className="flex items-start gap-2 rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-2">
      <button
        onClick={() => onChangeStatus(next)}
        className={clsx(
          "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border text-[11px] transition-colors",
          task.status === "done"
            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : task.status === "in_progress"
              ? "border-blue-500/40 bg-blue-500/15 text-blue-300"
              : "border-slate-600 text-slate-500 hover:border-slate-400"
        )}
        aria-label={`Mark task ${next}`}
        title={`Move to ${next}`}
      >
        {task.status === "done" ? "✓" : task.status === "in_progress" ? "·" : ""}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            "text-sm",
            task.status === "done" ? "text-slate-500 line-through" : "text-slate-100"
          )}
        >
          {task.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
          <span
            className={clsx(
              "inline-flex items-center rounded px-1.5 py-0.5 ring-1",
              TASK_STATUS_BADGE[task.status]
            )}
          >
            {task.status.replace("_", " ")}
          </span>
          {task.assignee && <span>@{task.assignee}</span>}
          <span suppressHydrationWarning>
            {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>
    </li>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function CaseWorkspace({ caseId }: { caseId: string }) {
  const [activeTab, setActiveTab] = useUrlTab(VALID_TABS, "overview");
  const { data, error, isLoading, mutate } = useSWR<Case>(
    ["case", caseId],
    () => casesApi.get(caseId),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  // `buildDemoCase(caseId)` takes its id from the route param, so an ungated
  // fallback does not merely show sample data — it presents an invented
  // title, assignee, four alert ids and a five-event timeline *as the case
  // the analyst opened*. Outside the hosted demo a failed load reads as a
  // failed load.
  const useFallback = !!error && canUseDemoData();
  const caseRecord: Case | undefined = useMemo(() => {
    if (data) return data;
    if (useFallback) return buildDemoCase(caseId);
    return undefined;
  }, [data, useFallback, caseId]);

  // ─── Investigation state ───────────────────────────────────────────────────
  const [fetchedTimeline, setFetchedTimeline] = useState<CaseTimelineEvent[]>([]);

  const [investigating, setInvestigating] = useState(false);
  const [investigationRunId, setInvestigationRunId] = useState<string | null>(null);
  const [investigationStatus, setInvestigationStatus] = useState<string>("idle");
  const [investigationData, setInvestigationData] = useState<Record<string, unknown> | null>(null);
  const [reportMd, setReportMd] = useState<string>("");
  const [pushingJira, setPushingJira] = useState(false);
  const { data: externalRefs, mutate: mutateExternalRefs } = useSWR<CaseExternalRef[]>(
    caseId ? `case-external-refs:${caseId}` : null,
    () => casesApi.listExternalRefs(caseId),
    { revalidateOnFocus: false }
  );
  const jiraRefs = useMemo(
    () => (Array.isArray(externalRefs) ? externalRefs.filter((r) => r.vendor === "jira") : []),
    [externalRefs]
  );

  const handlePushToJira = useCallback(async () => {
    if (!caseRecord || pushingJira) return;
    setPushingJira(true);
    try {
      const results = await casesApi.pushToItsm(caseRecord.id);
      const ok = results.find((r) => r.status === "ok");
      const err = results.find((r) => r.status !== "ok");
      if (ok) {
        toast.success(`Created Jira issue ${ok.external_id ?? ""}`.trim());
        await mutateExternalRefs();
      } else {
        toast.error(err?.error || "Failed to push case to Jira");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create Jira issue");
    } finally {
      setPushingJira(false);
    }
  }, [caseRecord, pushingJira, mutateExternalRefs]);
  const [liveSteps, setLiveSteps] = useState<
    Array<{ kind: string; agent: string; summary: string; ts: string }>
  >([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [confirmingRerun, setConfirmingRerun] = useState(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopPolling();
      closeWs();
    },
    [stopPolling, closeWs]
  );

  // The case detail payload carries no timeline; the dedicated
  // /cases/{id}/timeline endpoint synthesises opened/status/investigation
  // events. Fetch it so the Overview timeline is never blank by silence.
  useEffect(() => {
    let cancelled = false;
    casesApi
      .getTimeline(caseId)
      .then((res) => {
        if (!cancelled && Array.isArray(res?.events)) setFetchedTimeline(res.events);
      })
      .catch(() => {
        /* overview falls back to inline timeline */
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  /** Connect to the realtime service WebSocket for this run_id */
  const connectWs = useCallback(
    (runId: string) => {
      closeWs();
      // Mint a short-lived ticket and attach it as `?token=` before opening the
      // socket (Issue #239). The realtime service rejects tokenless upgrades and
      // derives the tenant from the verified claim, so we no longer send a
      // client-chosen `tenant_id`. On failure (signed-out / ticketing not
      // configured) we silently fall back to the polling loop already running.
      void (async () => {
        let token: string;
        try {
          ({ token } = await realtimeApi.ticket());
        } catch {
          // Could not authenticate — polling fallback covers live updates.
          return;
        }
        const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
        // The Next.js dev server proxies /ws → realtime service on :8086.
        // In production, nginx handles the proxy.
        const wsUrl = `${wsProto}://${window.location.host}/ws/agents?token=${encodeURIComponent(token)}`;
        try {
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;
          ws.onmessage = (evt) => {
            try {
              const msg = JSON.parse(evt.data as string) as Record<string, unknown>;
              const msgRunId = msg.run_id as string | undefined;
              // Only process events for this run
              if (msgRunId && msgRunId !== runId) return;

              if (msg.type === "agent.event") {
                const kind = (msg.kind ?? "") as string;
                const agent = (msg.agent ?? "") as string;
                const summary = (msg.summary ?? "") as string;
                const ts = (msg.timestamp ?? new Date().toISOString()) as string;

                setLiveSteps((prev) => [...prev, { kind, agent, summary, ts }]);

                if (kind === "completed") {
                  setInvestigationStatus("completed");
                  setInvestigating(false);
                  toast.success("Investigation complete — report ready");
                  // Fetch the Markdown report
                  apiFetch(`/api/v1/cases/${caseId}/investigations/${runId}/report.md`)
                    .then((r) => (r.ok ? r.text() : ""))
                    .then((md) => {
                      if (md) setReportMd(md);
                    })
                    .catch(() => {
                      /* best-effort */
                    });
                  // Also fetch full data
                  casesApi
                    .getInvestigation(caseId, runId)
                    .then((inv) => setInvestigationData(inv as Record<string, unknown>))
                    .catch(() => {
                      /* best-effort */
                    });
                  closeWs();
                } else if (kind === "error") {
                  setInvestigationStatus("failed");
                  setInvestigating(false);
                  toast.error(`Investigation failed: ${summary}`);
                  closeWs();
                }
              }
            } catch {
              /* ignore parse errors */
            }
          };
          ws.onerror = () => {
            // Fall back to polling if WebSocket fails
            ws.close();
            wsRef.current = null;
          };
        } catch {
          // WebSocket not available — polling fallback is already running
        }
      })();
    },
    [caseId, closeWs]
  );

  // [TODO-BACKEND: reject or return the existing run when one is running for the case]
  // [TODO-BACKEND: flush audit_log events during run_recon, not after it]
  const attachRunTracking = useCallback(
    (runId: string) => {
      stopPolling();
      // Connect via WebSocket for live updates (falls back to polling on error)
      connectWs(runId);

      // Polling as a reliable fallback / data sync
      pollRef.current = setInterval(async () => {
        try {
          const inv = await casesApi.getInvestigation(caseId, runId);
          setInvestigationData(inv as Record<string, unknown>);
          setInvestigationStatus(inv.status);
          if (inv.status === "completed" || inv.status === "failed") {
            stopPolling();
            closeWs();
            setInvestigating(false);
            if (inv.status === "completed") {
              toast.success("Investigation complete — report ready");
              try {
                const resp = await apiFetch(
                  `/api/v1/cases/${caseId}/investigations/${runId}/report.md`
                );
                if (resp.ok) setReportMd(await resp.text());
              } catch {
                /* best-effort */
              }
            } else {
              toast.error(`Investigation failed: ${inv.error ?? "unknown error"}`);
            }
          }
        } catch {
          // swallow transient errors
        }
      }, 5000);
    },
    [caseId, closeWs, connectWs, stopPolling]
  );

  // Restore the latest running or terminal run on mount — run state lives only
  // in memory, so a refresh or handoff from alert detail left the workspace
  // idle even though a run was active or completed server-side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch(`/api/v1/cases/${caseId}/investigations`);
        if (!resp.ok || cancelled) return;
        const body = (await resp.json()) as { runs?: Array<Record<string, unknown>> };
        const runs = body.runs ?? [];
        /* [HIDDEN-UI UX-1 also handle running runs on mount]
        const latest = runs.find(
          (r) =>
            typeof r?.run_id === "string" && (r.status === "completed" || r.status === "failed")
        );
        */
        const running = runs.find(
          (r) => typeof r?.run_id === "string" && r.status === "running"
        );
        if (running) {
          const runId = String(running.run_id);
          let skip = false;
          setInvestigationRunId((prev) => {
            if (prev) skip = true;
            return prev ?? runId;
          });
          if (skip || cancelled) return;
          setInvestigating(true);
          setInvestigationStatus("running");
          attachRunTracking(runId);
          return;
        }
        const latest = runs.find(
          (r) =>
            typeof r?.run_id === "string" && (r.status === "completed" || r.status === "failed")
        );
        if (!latest || cancelled) return;
        const runId = String(latest.run_id);
        let skip = false;
        setInvestigationRunId((prev) => {
          if (prev) skip = true;
          return prev ?? runId;
        });
        if (skip) return;
        setInvestigationStatus(String(latest.status ?? "completed"));
        const inv = (await casesApi.getInvestigation(caseId, runId)) as Record<string, unknown>;
        if (cancelled) return;
        setInvestigationData(inv);
        setInvestigationStatus(String(inv.status ?? latest.status ?? "completed"));
        if (inv.status === "completed") {
          const rep = await apiFetch(`/api/v1/cases/${caseId}/investigations/${runId}/report.md`);
          if (!cancelled && rep.ok) setReportMd(await rep.text());
        }
      } catch {
        /* best-effort restore; tab falls back to its idle prompt */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, attachRunTracking]);

  // [HIDDEN-UI UX-1 moved connectWs above mount-restore useEffect to reuse attachRunTracking]
  // const connectWs = useCallback(...)

  const startInvestigation = useCallback(async () => {
    if (!caseRecord || investigating) return;
    setConfirmingRerun(false);
    setInvestigating(true);
    setInvestigationStatus("starting");
    setLiveSteps([]);
    setActiveTab("investigation");
    try {
      const result = await casesApi.investigate(caseId, caseRecord.description ?? caseRecord.title);
      setInvestigationRunId(result.run_id);
      setInvestigationStatus("running");
      toast.success("Agent investigation started");

      attachRunTracking(result.run_id);

      // [HIDDEN-UI UX-1 reuse shared attachRunTracking helper]
      // connectWs(result.run_id);
      // pollRef.current = setInterval(async () => {
      //   try {
      //     const inv = await casesApi.getInvestigation(caseId, result.run_id);
      //     setInvestigationData(inv as Record<string, unknown>);
      //     setInvestigationStatus(inv.status);
      //     if (inv.status === "completed" || inv.status === "failed") {
      //       stopPolling();
      //       setInvestigating(false);
      //       if (inv.status === "completed") {
      //         toast.success("Investigation complete — report ready");
      //         try {
      //           const resp = await apiFetch(
      //             `/api/v1/cases/${caseId}/investigations/${result.run_id}/report.md`
      //           );
      //           if (resp.ok) setReportMd(await resp.text());
      //         } catch {
      //           // best-effort
      //         }
      //       } else {
      //         toast.error(`Investigation failed: ${inv.error ?? "unknown error"}`);
      //       }
      //     }
      //   } catch {
      //     // swallow transient errors
      //   }
      // }, 5000);
    } catch (e: unknown) {
      // An investigation that could not start did not reach a verdict. This
      // branch used to answer a failed request with `status: 'completed'`
      // plus invented IOCs, a root cause at 0.88 confidence drawn as a
      // progress bar, three containment actions and an agent audit log —
      // structured panels that carried no caveat of their own, behind a toast
      // that is gone by the time anyone reads them. An analyst cannot tell
      // that verdict apart from one the agents actually produced.
      const message = e instanceof Error ? e.message : "Could not reach the investigation service";
      setInvestigationStatus("failed");
      setInvestigationData({ status: "failed", error: message });
      setReportMd("");
      setInvestigating(false);
      toast.error(`Investigation could not start: ${message}`);
    }
  }, [caseRecord, caseId, investigating, attachRunTracking, setActiveTab]);

  // ─── Local mutations (optimistic) ──────────────────────────────────────────

  const [newComment, setNewComment] = useState("");
  const [newTask, setNewTask] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);
  // WS-D2 — track summary-download state so the button can show "Generating…"
  // and we can surface failures via toast without burying them in the console.
  const [summaryDownloading, setSummaryDownloading] = useState(false);

  const downloadSummary = useCallback(async () => {
    if (!caseRecord || summaryDownloading) return;
    setSummaryDownloading(true);
    try {
      await casesApi.openAutoSummaryHtml(caseRecord.id || caseId);
      toast.success("Summary opened — use Print → Save as PDF to archive");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Backend offline";
      toast.error(`Summary unavailable: ${message}`);
    } finally {
      setSummaryDownloading(false);
    }
  }, [caseRecord, caseId, summaryDownloading]);

  const updateStatus = async (status: CaseStatus) => {
    if (!caseRecord) return;
    const previous = caseRecord.status;
    setStatusUpdating(true);
    void mutate({ ...caseRecord, status }, { revalidate: false });
    try {
      // Backwards moves are refused by the forward-only PATCH ladder (422);
      // route them through the explicit reopen endpoint instead.
      const LADDER = [
        "new",
        "triaged",
        "investigating",
        "contained",
        "resolved",
        "closed",
      ] as const;
      if (
        LADDER.indexOf(status as (typeof LADDER)[number]) <
        LADDER.indexOf(previous as (typeof LADDER)[number])
      ) {
        await casesApi.reopen(caseRecord.id, {
          reason: `Reopened to ${STATUS_LABEL[status]} from analyst console`,
          status: status === "new" || status === "triaged" ? status : "investigating",
        });
        toast.success(`Case reopened — ${STATUS_LABEL[status]}`);
      } else {
        await casesApi.update(caseRecord.id, { status });
        toast.success(`Status set to ${STATUS_LABEL[status]}`);
      }
    } catch (e: unknown) {
      // The optimistic mutation has to come back off. Leaving it applied
      // showed a status the database does not have, on the one screen an
      // analyst uses to decide whether an incident is still open.
      void mutate({ ...caseRecord, status: previous }, { revalidate: false });
      const message = e instanceof Error ? e.message : "the case service rejected the write";
      toast.error(`Status unchanged — ${message}`);
    } finally {
      setStatusUpdating(false);
    }
  };

  const addComment = async () => {
    const trimmed = newComment.trim();
    if (!caseRecord || !trimmed) return;
    const optimistic: CaseTimelineEvent = {
      id: `tl-tmp-${Date.now()}`,
      type: "comment",
      timestamp: new Date().toISOString(),
      title: "Comment",
      description: trimmed,
      actor: "you",
    };
    void mutate(
      { ...caseRecord, timeline: [...(caseRecord.timeline ?? []), optimistic] },
      { revalidate: false }
    );
    setNewComment("");
    try {
      await casesApi.addComment(caseRecord.id, trimmed);
      toast.success("Comment added");
    } catch {
      toast("Saved locally (writes disabled in demo)");
    }
  };

  const addTask = async () => {
    const trimmed = newTask.trim();
    if (!caseRecord || !trimmed) return;
    const optimistic: CaseTask = {
      id: `task-tmp-${Date.now()}`,
      title: trimmed,
      status: "todo",
      createdAt: new Date().toISOString(),
    };
    void mutate(
      { ...caseRecord, tasks: [...(caseRecord.tasks ?? []), optimistic] },
      { revalidate: false }
    );
    setNewTask("");
    try {
      await casesApi.addTask(caseRecord.id, optimistic);
      toast.success("Task added");
    } catch {
      toast("Saved locally (writes disabled in demo)");
    }
  };

  const updateTaskStatus = async (taskId: string, status: CaseTask["status"]) => {
    if (!caseRecord) return;
    const tasks = (caseRecord.tasks ?? []).map((t) => (t.id === taskId ? { ...t, status } : t));
    void mutate({ ...caseRecord, tasks }, { revalidate: false });
    try {
      await casesApi.updateTask(caseRecord.id, taskId, { status });
    } catch {
      // already optimistically applied; nothing to do
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-2/3 rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 w-full rounded-lg" />
          <Skeleton className="h-96 w-full rounded-lg lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (!caseRecord) {
    return (
      <ErrorState
        title="Couldn't load case"
        error={error}
        onRetry={() => void mutate()}
        // [HIDDEN-UI NAV-6 /cases route hidden]
        // action={
        //   <Link
        //     href="/cases"
        //     className="rounded-md border border-slate-700/70 bg-slate-800/50 px-3 py-1.5 text-sm font-medium text-slate-200 hover:border-slate-600"
        //   >
        //     Back to cases
        //   </Link>
        // }
      />
    );
  }

  const sortedTimeline = [
    ...new Map([...fetchedTimeline, ...(caseRecord.timeline ?? [])].map((e) => [e.id, e])).values(),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const tasks = caseRecord.tasks ?? [];
  const tasksDone = tasks.filter((t) => t.status === "done").length;
  const tasksProgress = tasks.length === 0 ? 0 : Math.round((tasksDone / tasks.length) * 100);

  return (
    <div className="space-y-5">
      {/* Breadcrumb + demo banner */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          {/* [HIDDEN-UI NAV-6 /cases route hidden] */}
          {/* <Link href="/cases" className="text-slate-500 hover:text-slate-300">
            Cases
          </Link> */}
          {/* [HIDDEN-UI UX-1 make first breadcrumb segment a Link to /alerts]
          <span className="text-slate-500">Cases</span>
          */}
          <Link href="/alerts" className="text-fg-muted hover:text-fg-primary transition-colors">
            Cases
          </Link>
          <span className="text-slate-600">/</span>
          <span className="font-mono text-slate-400">{caseRecord.id}</span>
        </div>
        {useFallback && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-amber-500/30">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Demo data — writes disabled
          </span>
        )}
      </div>

      {/* Header */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1",
                  SEVERITY_BADGE[caseRecord.severity]
                )}
              >
                {caseRecord.severity}
              </span>
              <StatusPill status={caseRecord.status} />
              {caseRecord.tags?.map((t) => (
                <span
                  key={t}
                  className="rounded bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300"
                >
                  #{t}
                </span>
              ))}
            </div>
            <h1 className="mt-2 text-xl font-semibold text-white">{caseRecord.title}</h1>
            {caseRecord.description && (
              <p className="mt-2 max-w-3xl text-sm text-slate-400">{caseRecord.description}</p>
            )}
            {caseRecord.mitre && caseRecord.mitre.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500">MITRE ATT&CK:</span>
                {caseRecord.mitre.map((m) => (
                  <MitreChip key={m} id={m} />
                ))}
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Named for what changing it does. Without this a screen
                reader announces "open" with no indication that choosing
                another value transitions the case -- and this control
                writes, so an unlabelled one is a state change somebody
                cannot see they are making. */}
            <select
              aria-label="Change case status"
              value={caseRecord.status}
              onChange={(e) => void updateStatus(e.target.value as CaseStatus)}
              disabled={statusUpdating}
              className="rounded-md border border-slate-700/70 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 focus:border-emerald-500/40 focus:outline-none"
            >
              {/*
                  The three it used to offer -- open, in_progress, pending --
                  are refused by the API, so every status change from this
                  control failed validation.
                */}
              {(
                [
                  "new",
                  "triaged",
                  "investigating",
                  "contained",
                  "resolved",
                  "closed",
                ] as CaseStatus[]
              ).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {/* [HIDDEN-UI UX-1 tri-state investigate button with rerun confirm]
            <button
              onClick={() => void startInvestigation()}
              disabled={investigating}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                investigating
                  ? "cursor-not-allowed border-slate-700/40 bg-slate-800/40 text-slate-500"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
              )}
            >
              {investigating && (
                <span className="h-3 w-3 animate-spin rounded-full border border-emerald-500/30 border-t-emerald-400" />
              )}
              {investigating ? "Investigating…" : "Investigate with agent"}
            </button>
            */}
            {(() => {
              const isRunActive =
                investigating ||
                investigationStatus === "running" ||
                investigationStatus === "starting";
              const hasTerminalRun =
                !isRunActive &&
                (investigationStatus === "completed" || investigationStatus === "failed");

              if (isRunActive) {
                return (
                  <button
                    type="button"
                    disabled
                    className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-surface-border bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-fg-muted"
                  >
                    <span className="h-3 w-3 animate-spin rounded-full border border-surface-border border-t-fg-muted" />
                    Investigation in progress
                  </button>
                );
              }

              if (hasTerminalRun) {
                if (confirmingRerun) {
                  return (
                    <div className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-card px-2.5 py-1">
                      <span className="text-xs text-fg-muted">This starts a new run.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingRerun(false);
                          void startInvestigation();
                        }}
                        className="rounded-md border border-surface-border bg-surface-elevated px-2 py-0.5 text-xs font-semibold text-fg-primary transition-colors hover:border-surface-border-strong hover:bg-surface-hover"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingRerun(false)}
                        className="rounded-md px-2 py-0.5 text-xs text-fg-muted transition-colors hover:text-fg-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  );
                }

                return (
                  <button
                    type="button"
                    onClick={() => setConfirmingRerun(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-semibold text-fg-primary transition-colors hover:border-surface-border-strong hover:bg-surface-hover"
                  >
                    Run again
                  </button>
                );
              }

              return (
                <button
                  type="button"
                  onClick={() => void startInvestigation()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-tone-success/40 bg-pill-success-bg px-3 py-1.5 text-xs font-semibold text-tone-success transition-colors hover:bg-surface-hover"
                >
                  Investigate with agent
                </button>
              );
            })()}
            {/*
              WS-D2 — deterministic, analyst-ready snapshot of the entire case
              (lifecycle, MITRE coverage, observables, evidence, timeline,
              recommendations). Backed by `GET /cases/{id}/summary?format=html`
              which renders a self-contained, print-ready HTML document the
              analyst can save as PDF for compliance / handoff. Available on
              every case so analysts can grab a snapshot any time, but the
              backend also auto-emits a system breadcrumb when status flips to
              resolved/closed.
            */}
            <button
              onClick={() => void downloadSummary()}
              disabled={summaryDownloading || !caseRecord}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                summaryDownloading || !caseRecord
                  ? "cursor-not-allowed border-slate-700/40 bg-slate-800/40 text-slate-500"
                  : "border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20"
              )}
              title="Open a print-ready case summary (HTML → Save as PDF)"
            >
              {summaryDownloading && (
                <span className="h-3 w-3 animate-spin rounded-full border border-indigo-500/30 border-t-indigo-400" />
              )}
              {summaryDownloading ? "Generating…" : "Summary"}
            </button>
            {jiraRefs.map((ref) =>
              ref.external_url ? (
                <a
                  key={ref.id}
                  href={ref.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 transition-colors"
                  title={ref.external_status ? `Jira status: ${ref.external_status}` : "Open Jira issue"}
                >
                  <span>Jira: {ref.external_id}</span>
                  {ref.external_status && (
                    <span className="text-caption opacity-80">· {ref.external_status}</span>
                  )}
                </a>
              ) : (
                <span
                  key={ref.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-fg-primary"
                >
                  Jira: {ref.external_id}
                </span>
              )
            )}
            {jiraRefs.length === 0 && (
              <button
                onClick={() => void handlePushToJira()}
                disabled={pushingJira || !caseRecord}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                  pushingJira || !caseRecord
                    ? "cursor-not-allowed border-surface-border bg-surface-subtle text-fg-muted"
                    : "border-surface-border bg-surface-card text-fg-primary hover:border-border-strong"
                )}
                title="Create a Jira issue from this case"
              >
                {pushingJira ? "Creating Jira…" : "Create Jira Issue"}
              </button>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-800/60 pt-4 text-xs text-slate-400 sm:grid-cols-4">
          <Meta label="Assignee" value={caseRecord.assignee?.split("@")[0] ?? "—"} />
          <Meta
            label="Created"
            value={format(new Date(caseRecord.createdAt), "MMM d, HH:mm")}
            suppressHydrationWarning
          />
          <Meta
            label="Updated"
            value={formatDistanceToNow(new Date(caseRecord.updatedAt), {
              addSuffix: true,
            })}
            suppressHydrationWarning
          />
          <Meta
            label="SLA"
            value={
              caseRecord.dueAt ? `${formatDistanceToNow(new Date(caseRecord.dueAt))} left` : "—"
            }
            suppressHydrationWarning
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-800/70 text-xs">
        {VALID_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={clsx(
              "relative px-3 py-2 font-medium capitalize transition-colors",
              activeTab === tab ? "text-emerald-300" : "text-slate-500 hover:text-slate-300"
            )}
          >
            {tab === "investigation" && investigating && (
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            )}
            {tab === "ledger" ? (
              <span className="inline-flex items-center gap-1">
                Ledger
                <span
                  className="rounded bg-emerald-500/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30"
                  title="Auditable agent decision log — every prompt, tool call, and decision is durably stored and replayable forever"
                >
                  audit
                </span>
              </span>
            ) : tab === "attack-path" ? (
              <span className="inline-flex items-center gap-1">
                Attack path
                <span
                  className="rounded bg-orange-500/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-orange-300 ring-1 ring-orange-500/30"
                  title="Reconstructed attack graph from the Attack-Path Investigation Agent"
                >
                  graph
                </span>
              </span>
            ) : tab === "attack-chain" ? (
              <span className="inline-flex items-center gap-1">
                Attack chain
                <span
                  className="rounded bg-rose-500/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-rose-500/30"
                  title="Ranked temporal timeline of related alerts that form the attack chain"
                >
                  timeline
                </span>
              </span>
            ) : (
              tab
            )}
            {activeTab === tab && (
              <span className="absolute inset-x-0 bottom-0 h-px bg-emerald-400" />
            )}
          </button>
        ))}
      </div>

      {/* Investigation tab */}
      {activeTab === "investigation" && (
        <InvestigationPanel
          caseId={caseRecord.id || caseId}
          status={investigationStatus}
          data={investigationData}
          liveSteps={liveSteps}
          runId={investigationRunId}
          onViewReport={() => setActiveTab("report")}
          onViewLedger={() => setActiveTab("ledger")}
        />
      )}

      {/* Attack path tab — reconstructed graph for this case.
          We use the URL `caseId` prop rather than `caseRecord.id` because some
          backend variants return the case body without an `id` field; the URL
          is the canonical identifier here. */}
      {activeTab === "attack-path" && <AttackPathPanel caseId={caseRecord.id || caseId} />}

      {/* Attack-chain tab — ranked temporal timeline of related alerts */}
      {activeTab === "attack-chain" && <AttackChainPanel caseId={caseRecord.id || caseId} />}

      {/* Ledger tab — persistent, replayable agent decision log */}
      {activeTab === "ledger" && (
        <InvestigationLedger
          caseId={caseRecord.id || caseId}
          activeRunId={investigationRunId}
          onSelectRun={(rid) => setInvestigationRunId(rid)}
        />
      )}

      {/* Report tab */}
      {activeTab === "report" && (
        <ReportPanel
          markdown={reportMd}
          caseId={caseRecord.id || caseId}
          runId={investigationRunId ?? ""}
        />
      )}

      {/* Overview: Three-pane layout */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {/*
          Ambient Copilot — case-scoped contextual AI. We pass a compact
          snapshot of the case (no embedded alert blobs or full timeline) so the
          LLM has grounding without ballooning token usage. Backed by
          `services/agents` `/api/v1/contextual` endpoints.
        */}
          <ContextualActions
            page="cases"
            entityId={caseRecord.id}
            caseId={caseRecord.id}
            entity={{
              title: caseRecord.title,
              description: caseRecord.description,
              severity: caseRecord.severity,
              status: caseRecord.status,
              assignee: caseRecord.assignee,
              mitre: caseRecord.mitre,
              tags: caseRecord.tags,
              alert_ids: caseRecord.alertIds,
              alert_count: caseRecord.alertCount,
              created_at: caseRecord.createdAt,
              updated_at: caseRecord.updatedAt,
              due_at: caseRecord.dueAt,
            }}
            eyebrow={/* [HIDDEN-UI THEME-7 prior label: Ask AiSOC about this case] */ 'Ask ClopsSOC about this case'}
          />

          {/* Depth 9.4 — one action opens a Slack or Teams channel for this case
              and mirrors its timeline into it. Above the three columns because
              it is an action on the case, not a facet of it. */}
          <WarRoomPanel caseId={caseId} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Left: Linked alerts + IOCs */}
            {/* Two <aside> landmarks sit side by side here. Unnamed they
            are indistinguishable in a landmark list, which is the one
            place a screen-reader user navigates this page from. */}
            <aside aria-label="Linked alerts" className="lg:col-span-3 space-y-4">
              <Panel title={`Linked alerts (${caseRecord.alertIds?.length ?? 0})`}>
                {(caseRecord.alertIds ?? []).length === 0 ? (
                  <EmptyState
                    title="No alerts linked"
                    description="Link alerts from the alerts feed."
                  />
                ) : (
                  <ul className="space-y-1.5">
                    {(caseRecord.alertIds ?? []).map((id) => (
                      <li key={id}>
                        <Link
                          href={`/alerts?focus=${encodeURIComponent(id)}`}
                          className="flex items-center justify-between rounded-md border border-slate-800/80 bg-slate-900/40 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800/40"
                        >
                          <span className="font-mono">{id}</span>
                          <span className="text-[10px] uppercase tracking-wide text-slate-500">
                            open
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Tasks">
                <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${tasksProgress}%` }}
                    />
                  </div>
                  <span>
                    {tasksDone}/{tasks.length}
                  </span>
                </div>
                {tasks.length === 0 ? (
                  <EmptyState title="No tasks yet" description="Add the first one below." />
                ) : (
                  <ul className="space-y-1.5">
                    {tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onChangeStatus={(s) => void updateTaskStatus(t.id, s)}
                      />
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addTask();
                    }}
                    placeholder="Add task and press ↵"
                    className="flex-1 rounded-md border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:border-emerald-500/40 focus:outline-none"
                  />
                  <button
                    onClick={() => void addTask()}
                    className="rounded-md bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                    disabled={!newTask.trim()}
                  >
                    Add
                  </button>
                </div>
              </Panel>
            </aside>

            {/* Center: Timeline */}
            <section className="lg:col-span-6">
              <Panel
                title="Timeline"
                actions={
                  <span className="text-[11px] text-slate-500">{sortedTimeline.length} events</span>
                }
              >
                {sortedTimeline.length === 0 ? (
                  <EmptyState
                    title="Quiet so far"
                    description="Activity, comments, and agent runs will appear here."
                  />
                ) : (
                  <ol className="relative space-y-3 before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-px before:bg-slate-800/80">
                    {sortedTimeline.map((e) => (
                      <TimelineItem key={e.id} event={e} />
                    ))}
                  </ol>
                )}
              </Panel>
            </section>

            {/* Right: Notes / activity composer */}
            <aside aria-label="Notes and comments" className="lg:col-span-3 space-y-4">
              <Panel title="Notes & comments">
                <div className="space-y-2">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    rows={4}
                    placeholder="Drop your findings, IOCs, or next steps…"
                    className="w-full resize-none rounded-md border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:border-emerald-500/40 focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setNewComment("")}
                      className="rounded-md border border-slate-700/70 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => void addComment()}
                      disabled={!newComment.trim()}
                      className="rounded-md bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                    >
                      Post
                    </button>
                  </div>
                </div>
              </Panel>

              <Panel title="Resolution">
                <textarea
                  defaultValue={caseRecord.resolution ?? ""}
                  rows={5}
                  placeholder="Final summary, root cause, remediation…"
                  className="w-full resize-none rounded-md border border-slate-700/70 bg-slate-900/40 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:border-emerald-500/40 focus:outline-none"
                />
              </Panel>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Investigation panel ──────────────────────────────────────────────────────

type LiveStep = { seq?: number; kind: string; agent: string; summary: string; ts: string };

function InvestigationPanel({
  caseId,
  status,
  data,
  liveSteps,
  runId,
  onViewReport,
  onViewLedger,
}: {
  caseId?: string;
  status: string;
  data: Record<string, unknown> | null;
  liveSteps: LiveStep[];
  runId?: string | null;
  onViewReport: () => void;
  onViewLedger?: () => void;
}) {
  const [showAllIocs, setShowAllIocs] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [requestingKey, setRequestingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId || status !== "completed") return;
    let cancelled = false;
    responderApi
      .listApprovals({ case_id: caseId, status: "" })
      .then((res) => {
        if (!cancelled && Array.isArray(res?.items)) setApprovals(res.items);
      })
      .catch(() => {
        /* best-effort: action cards remain submittable even if approvals list fails */
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, status]);

  if (status === "idle" || status === "starting") {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-surface-border bg-surface-card py-16 text-center">
        <p className="text-sm font-medium text-fg-primary">Agent investigation</p>
        <p className="mt-1 max-w-md text-xs text-fg-muted">
          Use &ldquo;Investigate with agent&rdquo; in the header to run the recon, forensic, and
          responder agents on this case.
        </p>
      </div>
    );
  }

  if (status === "running") {
    return (
      <div className="rounded-xl border border-surface-border bg-surface-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* [HIDDEN-UI UX-2 show runId and step count in running InvestigationPanel (RD7)]
          <div className="flex items-center gap-3">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-300">Investigation in progress…</p>
              <p className="text-xs text-slate-500">
                Agents are working. Steps appear below in real-time.
              </p>
            </div>
          </div>
          */}
          <div className="flex items-center gap-3">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-accent/30 border-t-accent shrink-0" />
            <div>
              <p className="text-sm font-medium text-fg-primary">Investigation in progress…</p>
              <p className="text-xs text-fg-muted">
                Agents are working. Steps appear below in real-time.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {runId && (
              <span className="rounded-control border border-surface-border bg-surface-subtle px-2 py-0.5 font-mono text-fg-secondary">
                run {runId.slice(0, 8)}
              </span>
            )}
            <span className="rounded-control border border-surface-border bg-surface-subtle px-2 py-0.5 text-fg-secondary">
              {liveSteps.length} {liveSteps.length === 1 ? "step" : "steps"} recorded
            </span>
          </div>
        </div>
        {liveSteps.length > 0 && <LiveStepsFeed steps={liveSteps} />}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="rounded-xl border border-red-800/40 bg-red-900/10 p-5">
        <p className="text-sm font-semibold text-red-300">Investigation failed</p>
        <p className="mt-1 text-xs text-slate-400">
          {String((data as { error?: string })?.error ?? "Unknown error")}
        </p>
        {liveSteps.length > 0 && (
          <div className="mt-3">
            <LiveStepsFeed steps={liveSteps} />
          </div>
        )}
      </div>
    );
  }

  // completed
  const recon = data?.recon as Record<string, unknown> | undefined;
  const forensic = data?.forensic as Record<string, unknown> | undefined;
  const responder = data?.responder as Record<string, unknown> | undefined;
  const auditLog =
    liveSteps.length > 0
      ? liveSteps
      : ((data?.audit_log as Array<{ seq?: number; kind: string; agent: string; summary: string }>) ?? []);

  const findPhaseSeq = (agentPrefix: string, kind: string): number | null => {
    const match = [...auditLog]
      .reverse()
      .find((s) => typeof s.seq === "number" && s.kind === kind && s.agent.toLowerCase().startsWith(agentPrefix));
    return typeof match?.seq === "number" ? match.seq : null;
  };
  const findEvidenceSeq = (ref: string): number | null => {
    const needle = ref.toLowerCase();
    const match = auditLog.find(
      (s) => typeof s.seq === "number" && s.kind === "evidence_cited" && s.summary.toLowerCase().includes(needle),
    );
    return typeof match?.seq === "number" ? match.seq : null;
  };

  const reconSeq = findPhaseSeq("recon", "recon") ?? findPhaseSeq("recon", "llm_response");
  const forensicSeq = findPhaseSeq("forensic", "forensic") ?? findPhaseSeq("forensic", "llm_response");
  const responderSeq = findPhaseSeq("responder", "responder") ?? findPhaseSeq("responder", "llm_response");

  const iocs = Array.isArray(recon?.iocs) ? (recon.iocs as Array<{ type?: string; value?: string } | string>) : [];
  const visibleIocs = showAllIocs ? iocs : iocs.slice(0, 5);
  const attackSurface = (recon?.attack_surface && typeof recon.attack_surface === "object"
    ? recon.attack_surface
    : null) as { affected_systems?: unknown; data_at_risk?: unknown } | null;
  const threatActors = Array.isArray(recon?.threat_actors) ? (recon.threat_actors as unknown[]).map(String) : [];
  const relatedIncidents = Array.isArray(recon?.related_incidents)
    ? (recon.related_incidents as unknown[]).map(String)
    : [];

  const timeline = Array.isArray(forensic?.timeline)
    ? (forensic.timeline as Array<{ ts?: string; event?: string; src?: string }>)
    : [];
  const artefacts = Array.isArray(forensic?.artefacts) ? (forensic.artefacts as unknown[]).map(String) : [];
  const forensicConfidencePct =
    typeof forensic?.confidence === "number" ? `${Math.round(forensic.confidence * 100)}%` : "not measured";
  const groundednessPct =
    typeof forensic?.groundedness === "number" ? `${Math.round(forensic.groundedness * 100)}%` : "not measured";

  const recActions = Array.isArray(responder?.recommended_actions)
    ? (responder.recommended_actions as Array<unknown>)
    : [];
  const containmentSteps = Array.isArray(responder?.containment_steps)
    ? (responder.containment_steps as unknown[]).map(String)
    : [];
  const eradicationSteps = Array.isArray(responder?.eradication_steps)
    ? (responder.eradication_steps as unknown[]).map(String)
    : [];
  const recoverySteps = Array.isArray(responder?.recovery_steps)
    ? (responder.recovery_steps as unknown[]).map(String)
    : [];
  const effortHours =
    typeof responder?.estimated_effort_hours === "number" ? `${responder.estimated_effort_hours}h` : "not measured";
  const isDryRun = responder?.dry_run !== false;

  /* [HIDDEN-UI ALERTS-3 truncated 5-IOC / 4-action / slate-900 cards replaced with full semantic-token findings] */
  /* [HIDDEN-UI CASE-INV-2 equal lg:grid-cols-3 narrow columns replaced with Executive Verdict Strip + 7/5 Evidence/Response workbench] */
  return (
    <div className="space-y-4">
      {/* Executive Verdict Strip */}
      <div className="rounded-container border border-surface-border bg-surface-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-pill-success-bg px-3 py-1 text-caption font-semibold text-tone-success">
              Investigation complete
            </span>
            {responder?.risk_level != null && (
              <span
                className={clsx(
                  "inline-flex rounded-pill px-2.5 py-0.5 text-caption font-semibold uppercase",
                  responder.risk_level === "high"
                    ? "bg-severity-bg-high text-severity-ink-high"
                    : responder.risk_level === "medium"
                      ? "bg-severity-bg-medium text-severity-ink-medium"
                      : "bg-pill-success-bg text-tone-success"
                )}
              >
                {String(responder.risk_level)} risk
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="rounded-control border border-surface-border bg-surface-elevated px-3 py-1.5 text-caption">
                <span className="text-fg-muted mr-1.5">Confidence</span>
                <span className="font-mono font-semibold text-fg-primary">{forensicConfidencePct}</span>
              </div>
              <div className="rounded-control border border-surface-border bg-surface-elevated px-3 py-1.5 text-caption">
                <span className="text-fg-muted mr-1.5">Groundedness</span>
                <span className="font-mono font-semibold text-fg-primary">{groundednessPct}</span>
              </div>
              <span className="font-mono text-caption text-fg-muted">Est. effort: {effortHours}</span>
            </div>
            <button
              type="button"
              onClick={onViewReport}
              className="rounded-control border border-surface-border bg-surface-elevated px-3 py-1.5 text-caption font-medium text-fg-primary hover:bg-surface-hover transition-colors"
            >
              View full report
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-surface-border pt-4 md:grid-cols-12">
          <div className="md:col-span-7 space-y-1">
            <p className="text-eyebrow font-semibold uppercase tracking-wider text-fg-muted">
              Root cause hypothesis
            </p>
            <p className="text-body font-medium leading-relaxed text-fg-primary break-words">
              {forensic?.root_cause_hypothesis ? String(forensic.root_cause_hypothesis) : "not measured"}
            </p>
          </div>
          <div className="md:col-span-5 space-y-1 md:border-l md:border-surface-border md:pl-4">
            <p className="text-eyebrow font-semibold uppercase tracking-wider text-fg-muted">
              Blast radius
            </p>
            <p className="text-body leading-relaxed text-fg-secondary break-words">
              {forensic?.blast_radius ? String(forensic.blast_radius) : "not measured"}
            </p>
          </div>
        </div>
      </div>

      {/* 7 / 5 Asymmetric Investigation Workbench */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
        {/* Left 7 cols — Evidence & Analysis (Recon + Forensic) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Recon */}
          <div className="rounded-container border border-surface-border bg-surface-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-eyebrow font-semibold uppercase tracking-wider text-accent">Recon</h4>
              {reconSeq !== null && onViewLedger && (
                <button
                  type="button"
                  onClick={onViewLedger}
                  className="font-mono text-caption text-accent hover:underline"
                  title="Inspect Recon step in Ledger"
                >
                  ledger #{reconSeq}
                </button>
              )}
            </div>

            {recon?.summary != null && (
              <p className="text-body leading-relaxed text-fg-secondary break-words">{String(recon.summary)}</p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-control border border-surface-border bg-surface-elevated p-3 space-y-2">
                <p className="text-caption font-semibold text-fg-muted">IOCs ({iocs.length}):</p>
                {iocs.length === 0 ? (
                  <p className="text-caption text-fg-muted">None extracted</p>
                ) : (
                  <>
                    <ul className="space-y-1.5">
                      {visibleIocs.map((rawIoc, idx) => {
                        const iocType = typeof rawIoc === "string" ? "ioc" : String(rawIoc.type ?? "ioc");
                        const iocVal = typeof rawIoc === "string" ? rawIoc : String(rawIoc.value ?? "");
                        const evSeq = findEvidenceSeq(iocVal);
                        return (
                          <li key={`${iocVal}-${idx}`} className="flex items-center justify-between gap-2 text-caption font-mono text-fg-primary">
                            <span className="break-all">
                              <span className="text-fg-muted">[{iocType}]</span> {iocVal}
                            </span>
                            {evSeq !== null && onViewLedger && (
                              <button
                                type="button"
                                onClick={onViewLedger}
                                className="shrink-0 text-caption text-accent hover:underline"
                              >
                                #{evSeq}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {iocs.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setShowAllIocs((v) => !v)}
                        className="mt-1 text-caption font-medium text-accent hover:underline"
                      >
                        {showAllIocs ? "Show fewer" : `Show all ${iocs.length}`}
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-control border border-surface-border bg-surface-elevated p-3 space-y-2">
                <p className="text-caption font-semibold text-fg-muted">MITRE ATT&amp;CK</p>
                {Array.isArray(recon?.mitre_techniques) && recon.mitre_techniques.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(recon.mitre_techniques as string[]).map((t) => {
                      const evSeq = findEvidenceSeq(t);
                      return (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-control bg-severity-bg-high px-2 py-0.5 text-caption font-mono text-severity-ink-high"
                        >
                          {t}
                          {evSeq !== null && onViewLedger && (
                            <button
                              type="button"
                              onClick={onViewLedger}
                              className="underline opacity-80 hover:opacity-100"
                            >
                              #{evSeq}
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-caption text-fg-muted">None mapped</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 border-t border-surface-border pt-3 text-caption sm:grid-cols-3">
              <div>
                <span className="block text-fg-muted">Threat actors</span>
                <span className="text-fg-secondary break-words">
                  {threatActors.length > 0 ? threatActors.join(", ") : "not measured"}
                </span>
              </div>
              <div>
                <span className="block text-fg-muted">Related incidents</span>
                <span className="text-fg-secondary break-words">
                  {relatedIncidents.length > 0 ? relatedIncidents.join(", ") : "none"}
                </span>
              </div>
              <div>
                <span className="block text-fg-muted">Attack surface</span>
                <span className="text-fg-secondary break-words">
                  {attackSurface
                    ? [
                        Array.isArray(attackSurface.affected_systems) && attackSurface.affected_systems.length > 0
                          ? (attackSurface.affected_systems as unknown[]).map(String).join(", ")
                          : null,
                        attackSurface.data_at_risk ? String(attackSurface.data_at_risk) : null,
                      ]
                        .filter(Boolean)
                        .join(" — ") || "not measured"
                    : "not measured"}
                </span>
              </div>
            </div>
          </div>

          {/* Forensic */}
          <div className="rounded-container border border-surface-border bg-surface-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-eyebrow font-semibold uppercase tracking-wider text-tone-purple">Forensic</h4>
              {forensicSeq !== null && onViewLedger && (
                <button
                  type="button"
                  onClick={onViewLedger}
                  className="font-mono text-caption text-accent hover:underline"
                  title="Inspect Forensic step in Ledger"
                >
                  ledger #{forensicSeq}
                </button>
              )}
            </div>

            {forensic?.summary != null && (
              <p className="text-body leading-relaxed text-fg-secondary break-words">{String(forensic.summary)}</p>
            )}

            <div className="space-y-1.5">
              <p className="text-caption font-semibold text-fg-muted">Artefacts ({artefacts.length}):</p>
              {artefacts.length === 0 ? (
                <p className="text-caption text-fg-muted">not measured</p>
              ) : (
                <ul className="space-y-1">
                  {artefacts.map((art, i) => (
                    <li
                      key={`${art}-${i}`}
                      className="rounded-control border border-surface-border bg-surface-elevated px-2.5 py-1.5 text-caption font-mono text-fg-primary break-all"
                    >
                      {art}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-caption font-semibold text-fg-muted">Timeline ({timeline.length}):</p>
              {timeline.length === 0 ? (
                <p className="text-caption text-fg-muted">not measured</p>
              ) : (
                <ul className="space-y-1.5">
                  {timeline.map((ev, i) => (
                    <li
                      key={i}
                      className="rounded-control border border-surface-border bg-surface-elevated px-3 py-2 text-caption space-y-0.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-fg-muted">{ev.ts ?? "—"}</span>
                        {ev.src && <span className="font-mono text-accent">[{ev.src}]</span>}
                      </div>
                      <p className="text-fg-primary break-words">{ev.event ?? ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Right 5 cols — Response Plan */}
        <div className="lg:col-span-5 rounded-container border border-surface-border bg-surface-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-eyebrow font-semibold uppercase tracking-wider text-tone-warning">Response</h4>
            <div className="flex items-center gap-2">
              <span className="rounded-control bg-surface-elevated px-2 py-0.5 text-caption font-mono text-fg-muted border border-surface-border">
                {isDryRun ? "dry-run" : "live"}
              </span>
              {responderSeq !== null && onViewLedger && (
                <button
                  type="button"
                  onClick={onViewLedger}
                  className="font-mono text-caption text-accent hover:underline"
                  title="Inspect Responder step in Ledger"
                >
                  ledger #{responderSeq}
                </button>
              )}
            </div>
          </div>

          {recActions.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-control bg-pill-warning-bg px-3 py-1.5 text-caption font-medium text-tone-warning">
              <span>Suggested - not executed</span>
              <span className="font-mono">{recActions.length} action{recActions.length === 1 ? "" : "s"}</span>
            </div>
          )}

          {responder?.summary != null && (
            <p className="text-body leading-relaxed text-fg-secondary break-words">{String(responder.summary)}</p>
          )}

          {recActions.length > 0 && (
            <ul className="space-y-3">
              {recActions.map((raw, i) => {
                const a = (raw ?? {}) as Record<string, unknown>;
                const text = typeof raw === "string" ? raw : String(a.action ?? "");
                const prio = typeof a.priority === "number" ? a.priority : null;
                const risk = a.risk != null ? String(a.risk) : null;
                const actionConf =
                  typeof a.confidence === "number"
                    ? `${Math.round(a.confidence * 100)}%`
                    : forensicConfidencePct;
                const actionKey = `${i}:${text}`;
                const existingApproval = approvals.find(
                  (ap) => ap.title === text.slice(0, 200) || ap.action?.action === text,
                );
                const dispatchState =
                  existingApproval?.action &&
                  typeof existingApproval.action === "object" &&
                  typeof (existingApproval.action as Record<string, unknown>).dispatch === "object"
                    ? String(
                        ((existingApproval.action as Record<string, unknown>).dispatch as Record<string, unknown>)
                          ?.state ?? "",
                      )
                    : "";
                return (
                  <li key={i} className="rounded-control border border-surface-border bg-surface-elevated p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        {prio != null && (
                          <span className="rounded-control bg-pill-warning-bg px-1.5 py-0.5 text-caption font-mono font-semibold text-tone-warning">
                            P{prio}
                          </span>
                        )}
                        {risk != null && risk.toLowerCase() !== "low" && (
                          <span className="rounded-control bg-severity-bg-high px-1.5 py-0.5 text-caption font-semibold uppercase text-severity-ink-high">
                            {risk}
                          </span>
                        )}
                      </div>
                      <span className="text-caption font-mono text-fg-muted">
                        conf: {actionConf}
                      </span>
                    </div>
                    <p className="text-body font-medium text-fg-primary leading-snug break-words">
                      {text}
                    </p>
                    {a.rationale != null && String(a.rationale).length > 0 && (
                      <p className="text-caption leading-relaxed text-fg-muted break-words">{String(a.rationale)}</p>
                    )}
                    {caseId && (
                      <div className="pt-1 flex items-center gap-2">
                        {existingApproval ? (
                          <span className="inline-flex items-center rounded-control bg-pill-info-bg px-2 py-0.5 text-caption font-medium text-accent">
                            Approval: {dispatchState === "executed" ? "executed" : existingApproval.status}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={requestingKey === actionKey}
                            onClick={async () => {
                              setRequestingKey(actionKey);
                              try {
                                const created = await responderApi.createApproval({
                                  case_id: caseId,
                                  run_id: runId ?? undefined,
                                  title: text.slice(0, 200),
                                  summary: a.rationale ? String(a.rationale) : text,
                                  risk_level:
                                    risk === "critical" || risk === "high" || risk === "low"
                                      ? risk
                                      : "medium",
                                  action: {
                                    action: text,
                                    action_type: a.action_type ?? undefined,
                                    target: a.target ?? undefined,
                                    dry_run: responder?.dry_run ?? true,
                                  },
                                  requested_by: "analyst",
                                });
                                setApprovals((prev) => [created, ...prev]);
                                toast.success("Approval requested");
                              } catch (err) {
                                toast.error(
                                  err instanceof Error ? err.message : "Failed to request approval",
                                );
                              } finally {
                                setRequestingKey(null);
                              }
                            }}
                            className="rounded-control border border-surface-border bg-surface-card px-2.5 py-1 text-caption font-medium text-accent hover:bg-surface-hover disabled:opacity-50 transition-colors"
                          >
                            {requestingKey === actionKey ? "Requesting…" : "Request Approval"}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-3 border-t border-surface-border pt-3">
            {[
              { label: "Containment", steps: containmentSteps },
              { label: "Eradication", steps: eradicationSteps },
              { label: "Recovery", steps: recoverySteps },
            ].map(({ label, steps }) => (
              <div key={label} className="text-caption space-y-1">
                <p className="font-semibold text-fg-muted">{label} steps:</p>
                {steps.length === 0 ? (
                  <p className="text-fg-muted">not measured</p>
                ) : (
                  <ul className="list-disc pl-4 space-y-1 text-fg-secondary">
                    {steps.map((s, idx) => (
                      <li key={idx} className="break-words">{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {auditLog.length > 0 && (
        <details className="rounded-container border border-surface-border bg-surface-card">
          <summary className="cursor-pointer px-4 py-2 text-xs text-fg-muted hover:text-fg-primary">
            Agent audit log ({auditLog.length} steps)
          </summary>
          <AuditLogPreview log={auditLog} />
        </details>
      )}
    </div>
  );
}

// ─── Attack path panel ────────────────────────────────────────────────────────

/**
 * AttackPathPanel renders the case-scoped attack-path graph reconstructed by
 * the Attack-Path Investigation Agent. Cases without graph entities (404 from
 * the backend) fall back to an explanatory empty state so the analyst knows
 * the agent is wired up but simply has no graph context yet.
 */
function AttackPathPanel({ caseId }: { caseId: string }) {
  // Guard: when caseId is falsy (router not yet hydrated, fallback path mid-build,
  // backend response without an id field) we render the empty state instead of
  // firing /api/v1/graph/attack-path/undefined which 500s and pollutes the UI.
  const hasCaseId = Boolean(caseId);
  const { data, error, isLoading } = useSWR<CaseAttackPath | null>(
    hasCaseId ? `case:${caseId}:attack-path` : null,
    () => graphApi.getCaseAttackPath(caseId, { maxDepth: 4 }),
    { revalidateOnFocus: false }
  );

  if (!hasCaseId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/60 bg-slate-900/30 py-16 text-center">
        <p className="text-sm font-medium text-slate-300">Loading case context…</p>
        <p className="mt-1 max-w-md text-xs text-slate-500">
          The attack-path graph appears once the case is loaded.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load attack path"
        description={error instanceof Error ? error.message : "Unknown error"}
      />
    );
  }

  if (!data || data.nodeCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/60 bg-slate-900/30 py-16 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/10 ring-1 ring-orange-500/30">
          <svg
            className="h-5 w-5 text-orange-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-300">No attack path yet</p>
        <p className="mt-1 max-w-md text-xs text-slate-500">
          The Attack-Path Investigation Agent reconstructs lateral movement and blast radius from
          linked alerts and graph entities. Run an investigation or link more alerts to surface a
          path here.
        </p>
      </div>
    );
  }

  // Bucket nodes by entity type so the panel reads as &ldquo;hosts /
  // identities / processes&rdquo; rather than an undifferentiated soup.
  const nodesByType = data.nodes.reduce<Record<string, CaseAttackPath["nodes"]>>((acc, node) => {
    const type = (node.properties?.type as string) ?? node.label ?? "entity";
    (acc[type] ||= []).push(node);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-slate-200">Reconstructed attack path</h3>
          <p className="text-xs text-slate-500">
            {data.nodeCount} node{data.nodeCount === 1 ? "" : "s"} · {data.edgeCount} edge
            {data.edgeCount === 1 ? "" : "s"} · depth ≤ 4
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-medium text-orange-300 ring-1 ring-orange-500/30">
          attack path
        </span>
      </div>

      {/* Entities grouped by type — keeps the panel scannable even when the
          backend returns dense graphs (10s of nodes is normal). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Object.entries(nodesByType).map(([type, nodes]) => (
          <div key={type} className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {type} ({nodes.length})
            </h4>
            <ul className="space-y-1.5">
              {nodes.slice(0, 8).map((node) => (
                <li key={node.id} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-orange-400/60 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-slate-300">{node.label || node.id}</p>
                    {typeof node.properties?.risk_score === "number" && (
                      <p className="text-[10px] text-slate-500">
                        risk score: {(node.properties.risk_score as number).toFixed(2)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
              {nodes.length > 8 && (
                <li className="text-[10px] italic text-slate-500">+{nodes.length - 8} more</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      {/* Edges — show the relationship verbs because that's what differentiates
          a benign topology snapshot from an actual attack chain. */}
      {data.edges.length > 0 && (
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Relationships
          </h4>
          <ul className="space-y-1">
            {data.edges.slice(0, 12).map((edge, i) => (
              <li
                key={`${edge.source}-${edge.target}-${i}`}
                className="flex items-center gap-2 text-[11px] font-mono"
              >
                <span className="truncate text-slate-300">{edge.source}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-orange-300">
                  {edge.type}
                </span>
                <span className="truncate text-slate-300">{edge.target}</span>
              </li>
            ))}
            {data.edges.length > 12 && (
              <li className="text-[10px] italic text-slate-500">
                +{data.edges.length - 12} more relationships
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Attack chain panel ───────────────────────────────────────────────────────
//
// Renders the ranked temporal timeline of related alerts (the "attack chain")
// computed by services/api/app/services/attack_chain.py. The backend's BFS
// expands from the seed alert through the case's linked alerts, ranks each
// link by recency + shared-entity overlap + MITRE tactic co-occurrence, and
// hands us back a deterministic timeline plus the entity graph that connects
// the alerts. We render this as a vertical timeline (most-recent first by
// distance) with severity bands, score, and the entities each step shares
// with its predecessor — that's the part an analyst actually reads to decide
// "yes, this is one campaign, not three independent things."

const CHAIN_SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  high: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  medium: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  low: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  info: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};

function severityChipClass(severity: string): string {
  return CHAIN_SEVERITY_STYLES[severity?.toLowerCase()] ?? CHAIN_SEVERITY_STYLES.info;
}

const CHAIN_WINDOWS: ReadonlyArray<{ value: AttackChainWindow; label: string }> = [
  { value: "1h", label: "1 h" },
  { value: "6h", label: "6 h" },
  { value: "24h", label: "24 h" },
  { value: "72h", label: "72 h" },
  { value: "7d", label: "7 d" },
  { value: "30d", label: "30 d" },
];

const CHAIN_WINDOW_VALUES: ReadonlySet<AttackChainWindow> = new Set(
  CHAIN_WINDOWS.map((w) => w.value)
);

function isAttackChainWindow(value: string | null | undefined): value is AttackChainWindow {
  return typeof value === "string" && CHAIN_WINDOW_VALUES.has(value as AttackChainWindow);
}

// Default lookback for first-time loads. Picked to be wide enough that a
// case with linked alerts from a typical investigation horizon (the day
// before, an active shift) renders chain links instead of the empty state
// on first paint; analysts who want a tighter view narrow with the
// selector, and the choice is persisted on the URL via `?window=…`.
const DEFAULT_CHAIN_WINDOW: AttackChainWindow = "24h";

function AttackChainPanel({ caseId }: { caseId: string }) {
  // Mirror AttackPathPanel's guard: caseId can be empty during the brief window
  // between route hydration and the case fetch resolving. Calling the API with
  // `undefined` returns a 5xx and confuses analysts during the demo flow.
  const hasCaseId = Boolean(caseId);

  // Honor `?window=…` so a deep-link like
  // `/cases/INC-001?tab=attack-chain&window=24h` lands the analyst on
  // the same lookback the linker chose. Only the initial value is read
  // from search params; subsequent user selections write back through
  // `history.replaceState` (see `handleWindowChange`) so the choice
  // survives reload without coupling this panel to the next/navigation
  // router instance (which can be undefined in unit tests).
  const searchParams = useSearchParams();
  const initialWindow: AttackChainWindow = useMemo(() => {
    const raw = searchParams?.get("window") ?? null;
    return isAttackChainWindow(raw) ? raw : DEFAULT_CHAIN_WINDOW;
  }, [searchParams]);
  const [windowParam, setWindowParam] = useState<AttackChainWindow>(initialWindow);

  const handleWindowChange = useCallback((next: AttackChainWindow) => {
    setWindowParam(next);
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("window", next);
      window.history.replaceState({}, "", url.toString());
    } catch {
      // Best-effort URL sync; a malformed location shouldn't break the
      // panel. The state update above is the source of truth either way.
    }
  }, []);

  const { data, error, isLoading } = useSWR<AttackChainTimeline | null>(
    hasCaseId ? ["case:attack-chain", caseId, windowParam] : null,
    () => casesApi.getAttackChain(caseId, { window: windowParam }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  if (!hasCaseId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/60 bg-slate-900/30 py-16 text-center">
        <p className="text-sm font-medium text-slate-300">Loading case context…</p>
        <p className="mt-1 max-w-md text-xs text-slate-500">
          The attack-chain timeline appears once the case is loaded.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load attack chain"
        description={error instanceof Error ? error.message : "Unknown error"}
      />
    );
  }

  // The backend returns a structurally-valid object with `seed_alert_id: null`
  // and an empty chain when the case has no linked alerts yet. casesApi
  // collapses that to `null` so the empty state here is unambiguous.
  if (!data || data.chain.length === 0) {
    return (
      <div className="space-y-3">
        <WindowSelector value={windowParam} onChange={handleWindowChange} />
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/60 bg-slate-900/30 py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 ring-1 ring-rose-500/30">
            <svg
              className="h-5 w-5 text-rose-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-300">No attack chain yet</p>
          <p className="mt-1 max-w-md text-xs text-slate-500">
            An attack chain forms once two or more alerts in the {windowParam} window share entities
            or MITRE techniques. Link more alerts to the case or widen the window.
          </p>
        </div>
      </div>
    );
  }

  // Pre-compute confidence band so we can present "high" vs "exploratory"
  // distinctly — analysts treat a 0.4 chain very differently from a 0.85 chain.
  const confidencePct = Math.round(data.confidence * 100);
  const confidenceBand =
    data.confidence >= 0.75 ? "high" : data.confidence >= 0.5 ? "medium" : "low";
  const confidenceClass =
    confidenceBand === "high"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : confidenceBand === "medium"
        ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
        : "bg-slate-500/15 text-slate-300 ring-slate-500/30";

  const nodeCount = data.entityGraph.nodes.length;
  const edgeCount = data.entityGraph.edges.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-fg-primary">Reconstructed attack chain</h3>
          <p className="text-xs text-fg-muted">
            {data.chain.length} link{data.chain.length === 1 ? "" : "s"} · {nodeCount} entit
            {nodeCount === 1 ? "y" : "ies"} · {edgeCount} edge{edgeCount === 1 ? "" : "s"} · window{" "}
            {data.window}
          </p>
          {data.chainSignature && (
            <p className="mt-0.5 font-mono text-[10px] text-fg-muted truncate">
              signature: {data.chainSignature}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1",
              confidenceClass
            )}
            title="Confidence is derived from average link score and chain length"
          >
            confidence {confidencePct}%
          </span>
          <WindowSelector value={windowParam} onChange={handleWindowChange} />
        </div>
      </div>

      {/* Vertical timeline. Steps are already sorted by event_time on the
          backend (oldest → newest); we render in that order so the analyst
          reads the chain the same way the campaign actually unfolded. */}
      <ol className="relative space-y-3 border-l border-surface-border pl-5">
        {data.chain.map((link, index) => {
          const sevClass = severityChipClass(link.severity);
          const isFirst = index === 0;
          const dtMinutes = Math.round(link.dtSeconds / 60);
          const dtLabel = isFirst
            ? "seed"
            : dtMinutes <= 0
              ? `+${Math.max(1, Math.round(link.dtSeconds))}s`
              : dtMinutes < 60
                ? `+${dtMinutes}m`
                : `+${(dtMinutes / 60).toFixed(1)}h`;
          return (
            <li key={link.alertId} className="relative">
              {/* Dot anchored to the spine */}
              <span
                className={clsx(
                  "absolute -left-[26px] top-2 inline-block h-2.5 w-2.5 rounded-full ring-2 ring-surface-card",
                  isFirst ? "bg-rose-400" : "bg-fg-muted"
                )}
              />
              <div className="rounded-container border border-surface-border bg-surface-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={clsx(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
                          sevClass
                        )}
                      >
                        {link.severity}
                      </span>
                      {isFirst && (
                        <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-500 ring-1 ring-rose-500/30">
                          seed
                        </span>
                      )}
                      {link.connectorType && (
                        <span className="inline-flex items-center rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-fg-secondary border border-surface-border">
                          {link.connectorType}
                        </span>
                      )}
                      <span
                        className="text-[10px] font-mono text-fg-muted"
                        title="time since previous link"
                      >
                        Δt {dtLabel}
                      </span>
                    </div>
                    <p
                      className="mt-1.5 text-sm font-medium text-fg-primary truncate"
                      title={link.title}
                    >
                      {link.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-fg-muted">
                      {(() => {
                        try {
                          return `${format(new Date(link.eventTime), "MMM d, HH:mm:ss")} · ${formatDistanceToNow(new Date(link.eventTime), { addSuffix: true })}`;
                        } catch {
                          return link.eventTime;
                        }
                      })()}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-control bg-surface-elevated px-2 py-0.5 text-[10px] font-mono text-fg-primary border border-surface-border">
                      score {link.score.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-fg-muted">distance {link.distance}</span>
                  </div>
                </div>

                {/* Shared entities — the "why is this link in the chain"
                    explanation. Empty for the seed because there's no
                    predecessor to share with. */}
                {link.sharedEntities.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {link.sharedEntities.slice(0, 6).map((entity, i) => (
                      <span
                        key={`${entity.kind ?? "entity"}-${entity.value ?? i}`}
                        className="inline-flex items-center gap-1 rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] font-mono text-fg-primary border border-surface-border"
                        title={`Shared with previous link: ${entity.kind ?? ""}`}
                      >
                        <span className="text-fg-muted">{entity.kind}</span>
                        <span>{entity.value}</span>
                      </span>
                    ))}
                    {link.sharedEntities.length > 6 && (
                      <span className="text-[10px] italic text-fg-muted">
                        +{link.sharedEntities.length - 6} more
                      </span>
                    )}
                  </div>
                )}

                {/* MITRE techniques — gives the chain ATT&CK colour even when
                    titles are vague. Surface up to 4 to keep cards compact. */}
                {link.mitreTechniques.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {link.mitreTechniques.slice(0, 4).map((tech) => (
                      <span
                        key={tech}
                        className="inline-flex items-center rounded bg-pill-purple-bg px-1.5 py-0.5 text-[10px] font-mono text-tone-purple"
                      >
                        {tech}
                      </span>
                    ))}
                    {link.mitreTechniques.length > 4 && (
                      <span className="text-[10px] italic text-fg-muted">
                        +{link.mitreTechniques.length - 4} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Entity graph summary. The case's attack-path tab renders the full
          graph; here we just call out the entities that actually appear in
          the chain itself so the analyst can scan them at a glance. */}
      {data.entityGraph.nodes.length > 0 && (
        <div className="rounded-container border border-surface-border bg-surface-card p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Entities in chain ({data.entityGraph.nodes.length})
            </h4>
            <span className="text-[10px] text-fg-muted">
              {data.entityGraph.edges.length} connection
              {data.entityGraph.edges.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {data.entityGraph.nodes.slice(0, 24).map((node) => (
              <li
                key={node.id}
                className="inline-flex items-center gap-1 rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] font-mono text-fg-primary border border-surface-border"
                title={node.label ?? node.id}
              >
                <span className="text-fg-muted">{node.kind}</span>
                <span className="truncate max-w-[160px]">{node.label ?? node.id}</span>
              </li>
            ))}
            {data.entityGraph.nodes.length > 24 && (
              <li className="text-[10px] italic text-fg-muted self-center">
                +{data.entityGraph.nodes.length - 24} more
              </li>
            )}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-fg-muted">
        Chain computed at{" "}
        {(() => {
          try {
            return format(new Date(data.generatedAt), "MMM d, HH:mm:ss");
          } catch {
            return data.generatedAt;
          }
        })()}{" "}
        · seed alert <span className="font-mono">{data.seedAlertId}</span>
      </p>
    </div>
  );
}

function WindowSelector({
  value,
  onChange,
}: {
  value: AttackChainWindow;
  onChange: (next: AttackChainWindow) => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border border-slate-800/80 bg-slate-900/40 p-0.5"
      role="group"
      aria-label="Attack chain time window"
    >
      {CHAIN_WINDOWS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            "rounded px-2 py-1 text-[11px] font-medium transition",
            value === opt.value
              ? "bg-slate-800 text-slate-100 ring-1 ring-slate-700/60"
              : "text-slate-400 hover:text-slate-200"
          )}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function AuditLogPreview({
  log,
}: {
  log: Array<{ kind: string; agent: string; summary: string }>;
}) {
  return (
    <ul className="p-4 space-y-1.5">
      {log.map((entry, i) => (
        <li key={i} className="flex items-start gap-2 text-[11px]">
          <span className="font-mono text-slate-500">[{entry.kind}]</span>
          <span className="font-semibold text-slate-400">{entry.agent}:</span>
          <span className="text-slate-400">{entry.summary}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Live steps feed (real-time WebSocket updates) ────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  recon: "recon",
  forensic: "forensic",
  responder: "responder",
  report: "report",
  completed: "done",
  error: "error",
};

function LiveStepsFeed({ steps }: { steps: LiveStep[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/60">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Live agent steps
        </span>
        <span className="text-[10px] text-slate-600">{steps.length} events</span>
      </div>
      <ul className="max-h-56 overflow-y-auto divide-y divide-slate-800/40">
        {steps.map((step, i) => {
          const label = AGENT_LABELS[step.kind] ?? step.kind;
          return (
            <li key={i} className="flex items-start gap-2.5 px-3 py-2">
              <span className="shrink-0 mt-0.5 rounded border border-slate-700/60 bg-slate-900 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                {label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-300">{step.agent}</span>
                  <span className="text-[10px] text-slate-600 font-mono">[{step.kind}]</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{step.summary}</p>
              </div>
              <span
                className="shrink-0 text-[9px] text-slate-600 font-mono mt-0.5"
                suppressHydrationWarning
              >
                {new Date(step.ts).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </li>
          );
        })}
      </ul>
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Report panel ─────────────────────────────────────────────────────────────

function ReportPanel({
  markdown,
  caseId,
  runId,
}: {
  markdown: string;
  caseId: string;
  runId: string;
}) {
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handleDownloadPdf = async () => {
    if (!runId) return;
    setPdfDownloading(true);
    setPdfError(null);
    try {
      await casesApi.downloadReportPdf(caseId, runId);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "PDF download failed");
    } finally {
      setPdfDownloading(false);
    }
  };

  if (!markdown) {
    return (
      <div className="flex flex-col items-center justify-center rounded-container border border-dashed border-surface-border bg-surface-card py-16 text-center">
        <p className="text-sm font-medium text-fg-primary">No report yet</p>
        <p className="mt-1 text-xs text-fg-muted">Run an investigation to generate a report.</p>
      </div>
    );
  }

  return (
    <div className="rounded-container border border-surface-border bg-surface-card">
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-primary">
          Incident Report
        </h2>
        <div className="flex items-center gap-3">
          {/* Download Markdown */}
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([markdown], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "incident-report.md";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="text-[11px] text-fg-muted hover:text-fg-primary"
          >
            Download .md
          </button>
          {/* Download PDF */}
          {runId && (
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfDownloading}
              className={clsx(
                "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                pdfDownloading
                  ? "cursor-not-allowed text-fg-muted"
                  : "bg-pill-info-bg text-accent hover:opacity-80"
              )}
            >
              {pdfDownloading ? (
                <>
                  <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  Generating…
                </>
              ) : (
                <>Download PDF</>
              )}
            </button>
          )}
        </div>
      </div>
      {pdfError && (
        <div className="border-b border-surface-border bg-severity-bg-high px-4 py-2 text-[11px] text-severity-ink-high">
          PDF error: {pdfError}
        </div>
      )}
      {/* [HIDDEN-UI ALERTS-3 replaced raw <pre> markdown dump with SafeMarkdown]
      <pre className="overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-relaxed text-slate-300">
        {markdown}
      </pre>
      */}
      <div className="p-5">
        <SafeMarkdown source={markdown} />
      </div>
    </div>
  );
}

// ─── Tiny presentational helpers ──────────────────────────────────────────────

function Meta({
  label,
  value,
  suppressHydrationWarning: shw,
}: {
  label: string;
  value: string;
  suppressHydrationWarning?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-200" suppressHydrationWarning={shw}>
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-2">
        {/* `h2`, not `h3`. The case title above is the page's `h1` and a
            panel is its direct child, so `h3` skipped a level -- which is
            what a screen-reader user navigating by heading reads as a
            missing section. The size is a class, not the tag. */}
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
