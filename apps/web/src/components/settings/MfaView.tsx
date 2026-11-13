"use client";

/**
 * Two-factor authentication: your own factor, and the tenant policy.
 *
 * Fix pass 4.2. The console had no second factor at all — passkeys existed
 * on the mobile responder only, so the surface an analyst works from all
 * day was single-factor and no administrator could change that.
 *
 * Enrolling from a *sign-in challenge* is not done here. A user whose
 * tenant has just started requiring a factor holds a correct password and
 * no session, so every authenticated route bounces them to `/login` — and
 * that is where their enrolment lives.
 */

import { useCallback, useEffect, useState } from "react";
import { mfaApi, passkeyApi, type MfaEnrollment, type MfaStatus } from "@/lib/api";
import { createPasskey, isWebAuthnSupported } from "@/lib/responder/webauthn";

type Phase = "idle" | "pending";

/** The roles a policy may name.
 *
 * `admin` and `platform_admin` are absent deliberately: both carry the
 * wildcard permission, neither is assignable through any tenant-scoped
 * route, and offering them here would suggest a tenant administrator can
 * reach them.
 */
const POLICY_ROLES = ["tenant_admin", "infosec", "soc_analyst", "threat_hunter", "viewer"] as const;

export function MfaView() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<MfaEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await mfaApi.status());
      setLoadError(null);
    } catch (err) {
      // An honest failure, not a zeroed card: "not enrolled" and "we could
      // not find out" are different answers and only one of them is safe
      // to act on.
      setStatus(null);
      setLoadError(err instanceof Error ? err.message : "Could not read your MFA status.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const begin = async () => {
    setPhase("pending");
    setError(null);
    try {
      setEnrolment(await mfaApi.enrollBegin());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start enrolment.");
    } finally {
      setPhase("idle");
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setPhase("pending");
    setError(null);
    try {
      const confirmed = await mfaApi.enrollConfirm(code.trim());
      setRecoveryCodes(confirmed.recovery_codes);
      setEnrolment(null);
      setCode("");
      await refresh();
    } catch {
      setError("That code is not valid. Check that your phone’s clock is correct.");
    } finally {
      setPhase("idle");
    }
  };

  const disable = async (event: React.FormEvent) => {
    event.preventDefault();
    setPhase("pending");
    setError(null);
    try {
      await mfaApi.disable(code.trim());
      setCode("");
      setRecoveryCodes(null);
      await refresh();
    } catch {
      setError("That code is not valid, so the factor was not removed.");
    } finally {
      setPhase("idle");
    }
  };

  const addSecurityKey = async () => {
    setPhase("pending");
    setError(null);
    try {
      const begin = await passkeyApi.registerBegin("Console security key");
      const attestation = await createPasskey(begin.publicKey as never);
      await passkeyApi.registerFinish(
        begin.challenge,
        attestation as unknown as Record<string, unknown>
      );
      await refresh();
    } catch (err) {
      // The browser's own refusal is the useful message here: "the
      // operation was aborted" means the user dismissed the prompt, and
      // telling them "enrolment failed" instead sends them to support
      // for something they did on purpose.
      setError(err instanceof Error ? err.message : "That security key could not be registered.");
    } finally {
      setPhase("idle");
    }
  };

  const setPolicy = async (requireTotp: boolean, requireForRoles: string[]) => {
    setPolicyError(null);
    try {
      await mfaApi.setPolicy(requireTotp, requireForRoles);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setPolicyError(
        /403/.test(message)
          ? "Changing the tenant policy needs the settings:write permission."
          : "Could not change the tenant policy."
      );
    }
  };

  const toggleRole = async (role: string) => {
    const current = status?.require_for_roles ?? [];
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    await setPolicy(status?.tenant_requires_totp ?? false, next);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="rounded-container border border-surface-border bg-surface-card p-5 space-y-4">
        <header>
          <h2 className="text-card-title font-semibold text-fg-primary">Two-factor authentication</h2>
          <p className="text-body text-fg-muted mt-1">
            A time-based code from an authenticator app, in addition to your password.
          </p>
        </header>

        {loadError ? (
          <p role="alert" className="text-body text-tone-danger">
            {loadError}
          </p>
        ) : status === null ? (
          <p className="text-body text-fg-muted">Checking…</p>
        ) : (
          <>
            <p className="text-body text-fg-secondary">
              {status.enrolled
                ? `Enrolled. ${status.recovery_codes_remaining} recovery code${status.recovery_codes_remaining === 1 ? "" : "s"} left.`
                : "Not enrolled."}
              {status.tenant_requires_totp ? " Your organisation requires it." : ""}
            </p>

            {!status.enrolled && !enrolment ? (
              <button
                type="button"
                onClick={begin}
                disabled={phase === "pending"}
                className="rounded-control bg-btn-grad hover:brightness-105 px-4 py-2 text-control font-semibold text-white transition disabled:opacity-50"
              >
                Set up
              </button>
            ) : null}

            {enrolment ? (
              <form onSubmit={confirm} className="space-y-3">
                <p className="text-xs text-fg-muted">
                  Add this key to your authenticator app, then enter the code it shows.
                </p>
                <code className="block break-all rounded-control bg-surface-elevated border border-surface-border px-3 py-2 text-xs tracking-wider text-accent">
                  {enrolment.secret}
                </code>
                <a
                  href={enrolment.otpauth_uri}
                  className="inline-block text-xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
                >
                  Open in your authenticator app
                </a>
                <input
                  type="text"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded-control border border-surface-border bg-surface-elevated px-3 py-2 text-body text-fg-primary focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={phase === "pending" || !code}
                  className="rounded-control bg-btn-grad hover:brightness-105 px-4 py-2 text-control font-semibold text-white transition disabled:opacity-50"
                >
                  Confirm
                </button>
              </form>
            ) : null}

            {recoveryCodes ? (
              <div className="rounded-control border border-tone-warning/40 bg-pill-warning-bg px-4 py-3 space-y-2">
                <p className="text-xs font-medium text-tone-warning">
                  Save these recovery codes. They are shown once and each works once.
                </p>
                <ul className="grid grid-cols-2 gap-1 font-mono text-caption text-fg-primary">
                  {recoveryCodes.map((rc) => (
                    <li key={rc}>{rc}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {status.enrolled && !enrolment ? (
              <form onSubmit={disable} className="space-y-2 border-t border-surface-border pt-4">
                <p className="text-xs text-fg-muted">
                  Removing your factor needs a current code, so a stolen session cannot strip the
                  thing protecting it.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoComplete="one-time-code"
                    placeholder="Code or recovery code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="flex-1 rounded-control border border-surface-border bg-surface-elevated px-3 py-2 text-body text-fg-primary focus:border-accent focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={phase === "pending" || !code}
                    className="rounded-control border border-severity-critical-ink/40 bg-severity-critical-bg px-4 py-2 text-control font-medium text-severity-critical-ink transition hover:brightness-110 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </form>
            ) : null}

            {error ? (
              <p role="alert" className="text-body text-tone-danger">
                {error}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="rounded-container border border-surface-border bg-surface-card p-5 space-y-3">
        <header>
          <h2 className="text-card-title font-semibold text-fg-primary">Security key or passkey</h2>
          <p className="text-body text-fg-muted mt-1">
            A hardware key, or the fingerprint or face unlock built into this device. It counts as
            your second factor on its own, so you do not also need an authenticator app.
          </p>
        </header>
        {status === null ? (
          <p className="text-body text-fg-muted">Checking…</p>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={addSecurityKey}
              disabled={phase === "pending" || !isWebAuthnSupported()}
              className="rounded-control border border-surface-border bg-surface-elevated px-4 py-2 text-control font-medium text-fg-primary transition hover:bg-surface-hover disabled:opacity-50"
            >
              Add a security key
            </button>
            <span className="text-xs text-fg-muted">
              {!isWebAuthnSupported()
                ? "This browser does not support security keys."
                : status.has_webauthn
                  ? "One or more registered."
                  : "None registered."}
            </span>
          </div>
        )}
      </section>

      <section className="rounded-container border border-surface-border bg-surface-card p-5 space-y-3">
        <header>
          <h2 className="text-card-title font-semibold text-fg-primary">Require it across this tenant</h2>
          <p className="text-body text-fg-muted mt-1">
            Everyone signs in with a second factor. Members who have not enrolled are asked to set
            one up at their next sign-in rather than being locked out.
          </p>
        </header>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setPolicy(!(status?.tenant_requires_totp ?? false), status?.require_for_roles ?? [])
            }
            disabled={status === null}
            className="rounded-control border border-surface-border bg-surface-elevated px-4 py-2 text-control font-medium text-fg-primary transition hover:bg-surface-hover disabled:opacity-50"
          >
            {status?.tenant_requires_totp ? "Stop requiring" : "Require for everyone"}
          </button>
          <span className="text-xs text-fg-muted">
            {status?.tenant_requires_totp ? "Currently required" : "Currently optional"}
          </span>
        </div>
        <div className="pt-2 border-t border-surface-border space-y-2">
          <h3 className="text-body font-medium text-fg-primary">Or require it of particular roles</h3>
          <p className="text-xs text-fg-muted">
            Useful when the people who can change things should carry a second factor and the people
            who can only read need not. Requiring it of everyone above covers every role, whatever
            is selected here.
          </p>
          <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
            {POLICY_ROLES.map((role) => {
              const on = (status?.require_for_roles ?? []).includes(role);
              return (
                <li key={role}>
                  <button
                    type="button"
                    onClick={() => toggleRole(role)}
                    disabled={status === null}
                    aria-pressed={on}
                    className={`rounded-control border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                      on
                        ? "border-tone-success/40 bg-pill-success-bg text-tone-success"
                        : "border-surface-border bg-surface-elevated text-fg-secondary hover:bg-surface-hover"
                    }`}
                  >
                    {role.replace(/_/g, " ")}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {policyError ? (
          <p role="alert" className="text-body text-tone-danger">
            {policyError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
