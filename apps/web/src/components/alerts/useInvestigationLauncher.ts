'use client';

import { useState } from 'react';
import { casesApi, type Alert } from '@/lib/api';
import { alertSeverityToCaseSeverity } from './CreateCaseModal';

/** One label for every Investigate control, so the alert page and the rail never disagree. */
export function investigateLabel(isRunning: boolean, hasCase: boolean) {
  if (isRunning) return 'Starting investigation…';
  return hasCase ? 'View investigation' : 'Investigate';
}

// Investigations are owned by a case, not by a bare alert: the agent writes
// its prompts, tool calls and rationale into that case's ledger, and the case
// workspace is where they are rendered and replayed. So promote the alert to
// a case, launch the real run, and hand the analyst to the surface that can
// actually show it.
//
// This previously called `POST /api/v1/agents/investigate`, a route that
// exists on no backend. The 404 was caught and the catch block rendered a
// hardcoded "Advanced Persistent Threat - High Confidence" verdict naming a
// specific IP, a specific C2 domain and three pending response actions, with
// status 'completed' and no disclaimer. A security product must never invent
// a finding about a customer's environment.
export function useInvestigationLauncher({
  alertId,
  alertTitle,
  alertSeverity,
  caseId,
  tab,
  note,
  navigate,
}: {
  alertId?: string;
  alertTitle?: string;
  alertSeverity?: Alert['severity'];
  caseId?: string;
  /** Case tab to land on. */
  tab: 'ledger' | 'investigation';
  /** Why the run was started; the API prepends it to the evidence it assembles. */
  note: string;
  navigate: (href: string) => void;
}) {
  const [isRunning, setIsRunning] = useState(false);
  // Scoped to the alert it belongs to, so a surface that switches alerts
  // (the rail) never shows one alert's failure on another.
  const [failure, setFailure] = useState<{ alertId: string; message: string } | null>(null);

  const startInvestigation = async () => {
    if (!alertId || isRunning) return;
    setIsRunning(true);
    setFailure(null);
    try {
      // [TODO-BACKEND: link existing case to alert]
      if (caseId) {
        navigate(`/cases/${caseId}?tab=${tab}`);
        return;
      }
      // `alertIds` is the part that matters. The API reads it to load the
      // alerts' real `raw_event` payloads and sends those to the agent as
      // `raw_alert`; it used to forward only the string below, so the
      // forensic agent reasoned over a restated headline while auto-triage --
      // the same agent, the other entry point -- got the whole event.
      const createdCase = await casesApi.create({
        title: alertTitle ? `Investigation — ${alertTitle}` : `Investigation — alert ${alertId}`,
        description: alertTitle ? `Opened from alert: ${alertTitle}` : `Opened from alert ${alertId}`,
        alertIds: [alertId],
        // Omitting this let the server default to `medium`, so a critical
        // alert opened a medium case. The same mapping the promotion modal
        // uses, because cases have no `info` tier.
        severity: alertSeverity ? alertSeverityToCaseSeverity(alertSeverity) : undefined,
      });
      await casesApi.investigate(createdCase.id, note);
      navigate(`/cases/${createdCase.id}?tab=${tab}`);
    } catch (err) {
      setFailure({
        alertId,
        message:
          err instanceof Error
            ? err.message
            : 'Could not start the investigation. Check that the agents service is reachable.',
      });
      setIsRunning(false);
    }
  };

  const error = failure && failure.alertId === alertId ? failure.message : null;
  return { startInvestigation, isRunning, error };
}

export type InvestigationLauncher = ReturnType<typeof useInvestigationLauncher>;
