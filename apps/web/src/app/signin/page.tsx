'use client';

import { BRAND } from '@pentwin/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { track } from '../../lib/analytics';
import {
  authConfigured,
  AuthProblem,
  currentSession,
  googleConfigured,
  googleSignInUrl,
  rememberConsent,
  requestPasswordReset,
  setPassword,
  signIn,
  signUp,
  takeSessionFromAddress,
} from '../../lib/auth';
import { LEGAL_UPDATED } from '../../lib/legal';

type Mode = 'signin' | 'signup' | 'forgot' | 'new-password';

const TITLES: Record<Mode, string> = {
  signin: 'Sign in',
  signup: 'Create your account',
  forgot: 'Reset your password',
  'new-password': 'Choose a new password',
};

/** Where to go once signed in: back to where the person came from, if it is one of ours. */
const destination = (): string => {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return /^\/[a-z0-9/-]*$/i.test(next) ? next : '/account';
};

/**
 * Sign in, create an account, or reset a password. Also the page that email links and
 * Google send people back to.
 */
export default function SignInPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPasswordValue] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    const arrived = takeSessionFromAddress();
    if (arrived.error) {
      setError(arrived.error);
    } else if (arrived.session && arrived.kind === 'recovery') {
      setMode('new-password');
    } else if (arrived.session || currentSession()) {
      window.location.replace(destination());
    }
  }, []);

  const switchTo = (next: Mode): void => {
    setMode(next);
    setError(undefined);
    setNotice(undefined);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        window.location.assign(destination());
      } else if (mode === 'signup') {
        // Recorded on the account as soon as there is a session to record it with.
        rememberConsent(LEGAL_UPDATED);
        const session = await signUp(email.trim(), password);
        track('signup');
        if (session) window.location.assign(destination());
        else {
          setNotice(
            'Almost there: we have sent you an email. Open the link in it to confirm your address, then sign in.',
          );
          setMode('signin');
        }
      } else if (mode === 'forgot') {
        await requestPasswordReset(email.trim());
        setNotice('If there is an account for that address, a reset link is on its way.');
      } else {
        await setPassword(password);
        window.location.assign(destination());
      }
    } catch (caught) {
      setError(
        caught instanceof AuthProblem ? caught.message : 'That did not work. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!authConfigured) {
    return (
      <div className="section" style={{ maxWidth: '30rem' }}>
        <h1>Sign in</h1>
        <p data-testid="auth-off">
          Accounts are not switched on yet. You can still try everything without one: make your
          handwriting, write a document and export it.
        </p>
        <a className="button primary" href="/sample">
          Start with my handwriting
        </a>
      </div>
    );
  }

  const needsEmail = mode !== 'new-password';
  const needsPassword = mode !== 'forgot';

  return (
    <div className="section" style={{ maxWidth: '30rem' }}>
      <h1>{TITLES[mode]}</h1>
      {mode === 'signup' && (
        <p className="muted">
          Free to start: {BRAND.name} gives you a few pages every month to try with your own
          handwriting.
        </p>
      )}

      <form className="card" onSubmit={(event) => void submit(event)} data-testid="auth-form">
        {needsEmail && (
          <div className="field">
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                data-testid="auth-email"
              />
            </label>
          </div>
        )}
        {needsPassword && (
          <div className="field">
            <label>
              {mode === 'new-password' ? 'New password' : 'Password'}
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPasswordValue(event.target.value)}
                data-testid="auth-password"
              />
            </label>
            {mode !== 'signin' && <p className="muted">At least 8 characters.</p>}
          </div>
        )}
        {mode === 'signup' && (
          <label className="check">
            <input
              type="checkbox"
              required
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              data-testid="auth-agree"
            />{' '}
            I agree to the{' '}
            <a href="/legal/terms" target="_blank" rel="noreferrer">
              Terms
            </a>{' '}
            and{' '}
            <a href="/legal/privacy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
            , and I will only use my own handwriting.
          </label>
        )}

        {error && (
          <p className="error" role="alert" data-testid="auth-error">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status" data-testid="auth-notice">
            {notice}
          </p>
        )}

        <div className="row">
          <button type="submit" className="primary" disabled={busy} data-testid="auth-submit">
            {busy
              ? 'One moment...'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send the reset link'
                    : 'Save the new password'}
          </button>
        </div>
      </form>

      {googleConfigured && (mode === 'signin' || mode === 'signup') && (
        <p>
          <a className="button" href={googleSignInUrl()} data-testid="auth-google">
            Continue with Google
          </a>
        </p>
      )}

      <p className="muted">
        {mode === 'signin' ? (
          <>
            New here?{' '}
            <button type="button" className="link" onClick={() => switchTo('signup')}>
              Create an account
            </button>
            {' · '}
            <button type="button" className="link" onClick={() => switchTo('forgot')}>
              Forgot your password?
            </button>
          </>
        ) : (
          mode !== 'new-password' && (
            <>
              Already have an account?{' '}
              <button type="button" className="link" onClick={() => switchTo('signin')}>
                Sign in
              </button>
            </>
          )
        )}
      </p>
    </div>
  );
}
