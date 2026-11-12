'use client';

/**
 * Desktop console login.
 *
 * Email + password against ``POST /api/v1/auth/login`` for the open-source
 * console. The mobile responder PWA at ``/responder/login`` uses passkeys; this
 * page is the desktop counterpart and the link target from the responder login
 * footer ("Sign in on desktop").
 *
 * Demo credentials live in `services/api/app/api/v1/dev_auth.py`:
 *   demo@example.com / aisoc-demo
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useOptionalTheme } from '@/components/theme/ThemeProvider';
import { Button } from '@/components/ui/Button';
import {
  API_BASE,
  authApi,
  isMfaChallenge,
  mfaApi,
  onboardingApi,
  type MfaChallenge,
  type MfaEnrollment,
} from '@/lib/api';
import { isDemoMode } from '@/lib/demoMode';

type Phase = 'idle' | 'pending' | 'success' | 'error';

export const dynamic = 'force-dynamic';

// Supplied by the build, never written here. Next inlines NEXT_PUBLIC_* into
// the client bundle wherever they are referenced, so a literal in this module
// would put a working login pair into every image the project ships —
// including one built with demo mode off for somebody's own deployment.
// Gating the *render* on isDemoMode() hides the panel; it does not remove the
// strings. Only the demo build passes these.
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_AUTOLOGIN_EMAIL?.trim() ?? '';
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_AUTOLOGIN_PASSWORD?.trim() ?? '';
const HAS_DEMO_CREDENTIALS = Boolean(DEMO_EMAIL && DEMO_PASSWORD);

/**
 * Sanitize the ``?next=`` redirect target so a crafted link can't be used to
 * bounce an authenticated user to an attacker-controlled host.
 *
 * Only same-origin relative paths are allowed. Anything that looks like an
 * absolute URL (``http://``, ``//evil.com``), a JS scheme, or a path that
 * doesn't start with a single ``/`` is replaced with the dashboard default.
 */
function sanitizeNext(raw: string | null | undefined): string {
  const fallback = '/dashboard';
  if (!raw) return fallback;
  // Reject protocol-relative URLs (//evil.com) and backslash variants
  // (some browsers normalize \\ to //).
  if (raw.startsWith('//') || raw.startsWith('\\\\')) return fallback;
  // Require a single leading slash. This rejects ``http://...``,
  // ``javascript:...``, ``data:...``, ``mailto:...``, and bare paths
  // like ``dashboard`` (which would resolve relative to the current URL).
  if (!raw.startsWith('/')) return fallback;
  // Reject ``/\evil.com`` style tricks.
  if (raw.startsWith('/\\')) return fallback;
  return raw;
}

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = sanitizeNext(search?.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sso, setSso] = useState<{ sso_enabled: boolean; provider: string; login_label: string; local_login_enabled: boolean } | null>(null);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [code, setCode] = useState('');
  const [enrolment, setEnrolment] = useState<MfaEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // An SSO round-trip lands here with the session in the fragment; consume
  // it before the stored-token redirect below can read a still-empty store.
  const [handoffPending] = useState(() =>
    typeof window !== 'undefined' && window.location.hash.includes('access_token='),
  );
  useEffect(() => {
    if (!handoffPending) return;
    authApi.completeSsoHandoff().then((ok) => {
      if (ok) router.replace(next);
      else setError('The SSO sign-in could not be completed. Try again or sign in with your password.');
    });
  }, [handoffPending, next, router]);

  useEffect(() => {
    if (authApi.isAuthenticated()) {
      router.replace(next);
    }
  }, [next, router]);

  useEffect(() => {
    let alive = true;
    authApi.ssoStatus().then((s) => {
      if (alive) setSso(s);
    });
    return () => {
      alive = false;
    };
  }, []);

/**
 * Where to send someone after they sign in.
 *
 * A tenant with nothing connected and no alerts used to land on
 * `/dashboard`: every tile zero and nothing saying what to do next. They
 * go to the setup wizard instead.
 *
 * Only when the caller did not ask for somewhere specific. An expired
 * session that bounced someone off `/alerts` should return them to
 * `/alerts`, not to a wizard they have seen before.
 *
 * Never throws. Failing to work out where to land is not a reason to
 * fail a sign-in that already succeeded.
 */
async function landingRoute(requested: string): Promise<string> {
  if (requested && requested !== '/dashboard') return requested;
  try {
    const status = await onboardingApi.status();
    return status.first_run ? '/onboarding' : requested || '/dashboard';
  } catch {
    return requested || '/dashboard';
  }
}

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (phase === 'pending') return;
    setPhase('pending');
    setError(null);

    try {
      const result = await authApi.login(email.trim(), password);
      // The password was right and no session was issued: this account, or
      // this tenant, requires a second factor.
      if (isMfaChallenge(result)) {
        setChallenge(result);
        setPhase('idle');
        return;
      }
      setPhase('success');
      router.replace(await landingRoute(next));
    } catch (err) {
      console.error('[login] failed', err);
      setPhase('error');
      const message = err instanceof Error ? err.message : 'Login failed.';
      // Map the common 401 to something a human understands.
      if (/401|incorrect/i.test(message)) {
        setError('Email or password incorrect.');
      } else {
        setError(message);
      }
    }
  };

  const beginEnrolment = async () => {
    if (!challenge || phase === 'pending') return;
    setPhase('pending');
    setError(null);
    try {
      setEnrolment(await mfaApi.enrollBegin(challenge.mfa_token));
      setPhase('idle');
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Could not start enrolment.');
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge || phase === 'pending') return;
    setPhase('pending');
    setError(null);
    try {
      // Enrolling and verifying are different endpoints. The first
      // confirms a secret the user has just scanned and signs them in; the
      // second completes a sign-in against a factor they already hold.
      if (enrolment) {
        const confirmed = await mfaApi.enrollConfirm(code.trim(), challenge.mfa_token);
        setRecoveryCodes(confirmed.recovery_codes);
        if (confirmed.access_token) {
          await authApi.adoptSession(confirmed.access_token, confirmed.refresh_token ?? '');
        }
        setPhase('success');
        return;
      }
      await authApi.completeMfa(challenge.mfa_token, code.trim());
      setPhase('success');
      router.replace(await landingRoute(next));
    } catch (err) {
      setPhase('error');
      const message = err instanceof Error ? err.message : 'Verification failed.';
      // A challenge is short-lived, and "that code is not valid" is the
      // wrong thing to tell someone whose five minutes ran out.
      setError(
        /expired/i.test(message)
          ? 'That sign-in attempt expired. Enter your password again.'
          : 'That code is not valid. Check your authenticator, or use a recovery code.',
      );
    }
  };

  const useDemo = () => {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
  };

  const themeCtx = useOptionalTheme();
  const isLight = themeCtx?.resolved === 'light';
  const fallbackLogo = isLight ? '/brand/logo-light.png' : '/brand/logo-dark.png';

  return (
    <div className="min-h-screen bg-surface-base text-fg-primary antialiased flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-container border border-surface-border bg-surface-card p-8 shadow-overlay">
          {/* Brand */}
          <div className="flex flex-col items-center text-center mb-8">
            <Link
              href="/"
              className="mb-5 inline-flex items-center justify-center rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Back to ClopsSOC home"
            >
              {/* [HIDDEN-UI THEME-5 replaced indigo shield icon with ClopsSOC fallback mark] */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fallbackLogo}
                alt="ClopsSOC"
                className="h-9 w-auto max-w-44 object-contain"
              />
            </Link>
            <h1 className="text-page-title font-semibold tracking-tight text-fg-primary">
              Sign in to ClopsSOC
            </h1>
            <p className="text-body text-fg-muted mt-1.5 leading-relaxed">
              Sign in with your tenant&rsquo;s security operations account.
            </p>
          </div>

          {/* Demo banner — demo mode only, and only when the build supplied
              credentials. These are seeded by a public demo and exist nowhere
              else, so on a self-hosted deployment this rendered a "Use demo"
              button that fails and told the operator's own users to sign in
              with an account on somebody else's instance. */}
          {isDemoMode() && HAS_DEMO_CREDENTIALS && (
          <div className="mb-6 rounded-control border border-accent/30 bg-accent-subtle px-4 py-3 text-control">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-accent">Public demo</p>
                <p className="text-xs text-fg-muted mt-0.5">
                  <code className="text-fg-secondary">{DEMO_EMAIL}</code> /{' '}
                  <code className="text-fg-secondary">{DEMO_PASSWORD}</code>
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={useDemo}
                className="shrink-0"
              >
                Use demo
              </Button>
            </div>
          </div>
          )}

          {/* Second factor. Replaces the password form rather than sitting
              beside it: the password has already been accepted, and leaving
              it on screen invites someone to retype it instead of reading
              their authenticator. */}
          {challenge ? (
            <form onSubmit={submitCode} className="space-y-4" noValidate data-testid="mfa-challenge">
              <div className="rounded-control border border-surface-border bg-surface-elevated px-4 py-3 text-body text-fg-secondary">
                {challenge.mfa_enrollment_required
                  ? 'Your organisation requires a second factor and this account has not set one up yet. Finish setting it up to sign in.'
                  : 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.'}
              </div>

              {/* Enrolment happens here rather than behind a link to
                  /settings/mfa: this user has a correct password and no
                  session, so every authenticated route would bounce them
                  straight back to this page. */}
              {challenge.mfa_enrollment_required && !enrolment ? (
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={beginEnrolment}
                  disabled={phase === 'pending'}
                  loading={phase === 'pending'}
                  className="w-full"
                >
                  {phase === 'pending' ? 'Preparing…' : 'Set up two-factor authentication'}
                </Button>
              ) : (
                <>
                  {enrolment ? (
                    <div className="rounded-control border border-surface-border bg-surface-elevated px-4 py-3 space-y-2">
                      <p className="text-xs text-fg-muted">
                        Add this key to your authenticator app, then enter the code it shows.
                      </p>
                      <code className="block break-all rounded-control bg-surface-subtle px-3 py-2 text-xs tracking-wider text-accent">
                        {enrolment.secret}
                      </code>
                      <a
                        href={enrolment.otpauth_uri}
                        className="inline-block text-xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
                      >
                        Open in your authenticator app
                      </a>
                    </div>
                  ) : null}

                  {recoveryCodes ? (
                    <div className="rounded-control border border-tone-warning/40 bg-pill-warning-bg px-4 py-3 space-y-2">
                      <p className="text-xs font-medium text-tone-warning">
                        Save these recovery codes. They are shown once.
                      </p>
                      <ul className="grid grid-cols-2 gap-1 font-mono text-caption text-fg-primary">
                        {recoveryCodes.map((rc) => (
                          <li key={rc}>{rc}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <label className="block">
                    <span className="block text-caption font-medium uppercase tracking-wider text-fg-muted mb-2">
                      Verification code
                    </span>
                    <input
                      type="text"
                      // `one-time-code` is what lets a phone offer the code
                      // from the notification shade; without it the user
                      // switches apps and loses the page on iOS.
                      autoComplete="one-time-code"
                      inputMode="text"
                      autoCapitalize="characters"
                      spellCheck={false}
                      autoFocus
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={phase === 'pending'}
                      required
                      className="w-full bg-surface-elevated border border-surface-border rounded-control px-4 py-3 text-body tracking-widest text-fg-primary placeholder:tracking-normal placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:opacity-60"
                    />
                  </label>
                  {/* Navigating automatically would take the recovery
                      codes off the screen the moment they appeared, and
                      they are shown exactly once. */}
                  {recoveryCodes ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      onClick={async () => router.replace(await landingRoute(next))}
                      className="w-full"
                    >
                      I have saved my recovery codes — continue
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      disabled={phase === 'pending' || !code}
                      loading={phase === 'pending'}
                      className="w-full"
                    >
                      {phase === 'pending' ? 'Verifying…' : enrolment ? 'Confirm' : 'Verify'}
                    </Button>
                  )}
                </>
              )}

              {error ? (
                <div
                  role="alert"
                  className="rounded-control border border-severity-critical-ink/40 bg-severity-critical-bg px-3 py-2.5 text-xs text-severity-critical-ink"
                >
                  {error}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setChallenge(null);
                  setCode('');
                  setError(null);
                  setPassword('');
                  setEnrolment(null);
                  setRecoveryCodes(null);
                }}
                className="w-full text-xs text-fg-muted hover:text-fg-primary underline-offset-2 hover:underline"
              >
                Start over
              </button>
            </form>
          ) : (
          <>
          {/* Form */}
          {sso?.sso_enabled && (
            <div className="mb-4">
              <a
                href={`${API_BASE}/auth/${sso.provider === 'saml' ? 'saml/login' : 'oidc/login'}?redirect=${encodeURIComponent(next)}`}
                className="w-full inline-flex items-center justify-center gap-2 rounded-control border border-surface-border-strong bg-surface-elevated px-4 py-2.5 text-body font-semibold text-fg-primary hover:bg-surface-hover transition"
                data-testid="sso-login-button"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 12.75v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                {sso.login_label || 'Continue with SSO'}
              </a>
              {sso.local_login_enabled ? (
                <div className="my-4 flex items-center gap-3 text-caption uppercase tracking-widest text-fg-subtle">
                  <span className="h-px flex-1 bg-surface-border" />
                  or
                  <span className="h-px flex-1 bg-surface-border" />
                </div>
              ) : null}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4" noValidate>
            <label className="block">
              <span className="block text-caption font-medium uppercase tracking-wider text-fg-muted mb-2">
                Email
              </span>
              <input
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={phase === 'pending'}
                required
                className="w-full bg-surface-elevated border border-surface-border rounded-control px-4 py-3 text-body text-fg-primary placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:opacity-60"
              />
            </label>

            <label className="block">
              <span className="block text-caption font-medium uppercase tracking-wider text-fg-muted mb-2">
                Password
              </span>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={phase === 'pending'}
                required
                className="w-full bg-surface-elevated border border-surface-border rounded-control px-4 py-3 text-body text-fg-primary placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:opacity-60"
              />
            </label>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={phase === 'pending' || !email || !password}
              loading={phase === 'pending'}
              className="w-full"
            >
              {phase === 'pending' ? 'Signing in…' : 'Sign in'}
            </Button>

            {error ? (
              <div
                role="alert"
                className="rounded-control border border-severity-critical-ink/40 bg-severity-critical-bg px-3 py-2.5 text-xs text-severity-critical-ink"
              >
                {error}
              </div>
            ) : null}
          </form>
          </>
          )}

          {/* Footer hints */}
          <div className="mt-6 pt-5 border-t border-surface-border space-y-2.5 text-center">
            <p className="text-xs text-fg-muted">
              On a phone?{' '}
              <Link
                href="/responder/login"
                className="text-accent hover:text-accent-hover underline-offset-2 hover:underline"
              >
                Use the responder PWA
              </Link>{' '}
              with passkeys.
            </p>
            <p className="text-caption text-fg-subtle">
              <Link
                href="/"
                className="hover:text-fg-secondary underline-offset-2 hover:underline"
              >
                ← Back to home
              </Link>
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 pb-4 pt-2 text-center">
        <p className="text-eyebrow text-fg-subtle uppercase tracking-widest">
          ClopsSOC · Security Operations Console · MIT-licensed
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
