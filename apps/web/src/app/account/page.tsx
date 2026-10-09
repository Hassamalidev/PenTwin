'use client';

import {
  PLANS,
  REFERRAL_BONUS_PAGES,
  TOP_UP,
  type BillingInterval,
  type PlanId,
} from '@pentwin/shared';
import { useCallback, useEffect, useState } from 'react';
import { FeedbackForm } from '../../components/FeedbackForm';
import { track } from '../../lib/analytics';
import {
  clearPendingConsent,
  currentSession,
  pendingConsent,
  signOut,
  type Session,
} from '../../lib/auth';
import { loadBank, saveBank, type StoredBank } from '../../lib/bank';
import {
  checkoutConfigured,
  CheckoutProblem,
  openCheckout,
  type CheckoutInfo,
} from '../../lib/checkout';
import { downloadBytes } from '../../lib/photo';
import { callWorker, WorkerProblem } from '../../lib/worker';

/** What the worker's `GET /me` returns; see `AccountSummary` in packages/billing. */
interface Account {
  userId: string;
  plan: PlanId;
  planName: string;
  billingInterval: BillingInterval | null;
  planStatus: 'active' | 'past_due' | 'cancelled';
  cancelAtPeriodEnd: boolean;
  paidUntil: string | null;
  activated: boolean;
  monthlyPages: number;
  monthlyUsed: number;
  monthlyLeft: number;
  extraPages: number;
  totalPages: number;
  creditsResetOn: string;
  watermark: boolean;
  maxProfiles: number;
  referralCode: string;
}
interface LedgerEntry {
  amount: number;
  reason: string;
  at: string;
}
interface Profile {
  id: string;
  name: string;
  createdAt: string;
}

const DELETE_WORDS = 'delete my account';
const DEVICE = 'pentwin.device.v1';

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** A random name for this browser, so the same device cannot collect free pages twice. */
const deviceId = (): string => {
  let id = localStorage.getItem(DEVICE);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE, id);
  }
  return id;
};

const messageOf = (caught: unknown): string =>
  caught instanceof WorkerProblem || caught instanceof CheckoutProblem
    ? caught.message
    : 'That did not work. Please try again.';

/** The signed-in user's plan, pages, handwriting and data. */
export default function AccountPage() {
  const [session, setSession] = useState<Session>();
  const [account, setAccount] = useState<Account>();
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [checkout, setCheckout] = useState<CheckoutInfo>();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [referral, setReferral] = useState('');
  const [profileName, setProfileName] = useState('My handwriting');
  const [ownHandwriting, setOwnHandwriting] = useState(false);
  const [deleteWords, setDeleteWords] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const me = await callWorker<{ account: Account; ledger: LedgerEntry[] }>('/me', {
      auth: true,
    });
    setAccount(me.account);
    setLedger(me.ledger);
    const [saved, plans] = await Promise.all([
      callWorker<{ profiles: Profile[] }>('/profiles', { auth: true }),
      callWorker<{ checkout?: CheckoutInfo }>('/plans'),
    ]);
    setProfiles(saved.profiles);
    setCheckout(plans.checkout);
  }, []);

  useEffect(() => {
    const current = currentSession();
    if (!current) {
      window.location.replace('/signin?next=/account');
      return;
    }
    setSession(current);
    void (async () => {
      try {
        // Free pages are given once the email address is confirmed; ask every visit,
        // it does nothing the second time. A refusal here is shown by the page below.
        await callWorker('/me/activate', {
          method: 'POST',
          auth: true,
          body: { device: deviceId() },
        }).catch(() => undefined);
        const version = pendingConsent();
        if (version) {
          for (const kind of ['terms', 'privacy']) {
            await callWorker('/me/consents', {
              method: 'POST',
              auth: true,
              body: { kind, version, granted: true },
            });
          }
          clearPendingConsent();
        }
        await load();
      } catch (caught) {
        if (caught instanceof WorkerProblem && caught.status === 401) {
          await signOut();
          window.location.replace('/signin?next=/account');
          return;
        }
        setError(messageOf(caught));
      }
    })();
  }, [load]);

  /** Runs one action, showing what went wrong or what happened. */
  const act = async (action: () => Promise<string | void>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await action();
      if (result) setNotice(result);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const buy = (priceId: string | undefined, plan?: PlanId): Promise<void> =>
    act(async () => {
      if (!priceId || !checkout || !session) throw new WorkerProblem(PAYMENTS_OFF, 0);
      await openCheckout(
        checkout,
        priceId,
        { userId: account?.userId ?? session.userId, email: session.email },
        () => {
          if (plan) track('paid', { plan: plan as 'student' | 'pro', interval });
          // The pages arrive with the payment notification, a moment after paying.
          setTimeout(() => void load().catch(() => undefined), 4000);
        },
      );
    });

  if (!session) return <p className="muted">One moment...</p>;
  if (!account) {
    return error ? (
      <p className="error" role="alert" data-testid="account-error">
        {error}
      </p>
    ) : (
      <p className="muted">Loading your account...</p>
    );
  }

  const paid = account.plan !== 'free';
  const upgrades = (['student', 'pro'] as const).filter(
    (plan) => PLANS[plan].monthlyPages > account.monthlyPages,
  );
  const canPay = checkoutConfigured && checkout !== undefined;
  const used = Math.min(account.monthlyUsed, account.monthlyPages);

  return (
    <div className="section" data-testid="account">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Your account</h1>
        <button
          type="button"
          onClick={() => void signOut().then(() => window.location.assign('/'))}
          data-testid="sign-out"
        >
          Sign out
        </button>
      </div>
      <p className="muted" data-testid="account-email">
        {session.email}
      </p>

      {error && (
        <p className="error" role="alert" data-testid="account-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status" data-testid="account-notice">
          {notice}
        </p>
      )}

      <section className="card" data-testid="plan-card">
        <h2>
          {account.planName} plan{' '}
          {account.watermark && <span className="badge">Watermark on exports</span>}
        </h2>
        {!account.activated ? (
          <>
            <p data-testid="not-activated">
              Please confirm your email address: open the link in the email we sent you. Your free
              pages are added as soon as you have.
            </p>
            <button type="button" disabled={busy} onClick={() => window.location.reload()}>
              I have confirmed it
            </button>
          </>
        ) : (
          <>
            <p data-testid="usage">
              <strong>
                {used} / {account.monthlyPages} pages
              </strong>{' '}
              used this month
            </p>
            <progress
              max={account.monthlyPages}
              value={used}
              aria-label="Pages used this month"
              style={{ width: '100%' }}
            />
            <p>
              <span data-testid="pages-left">
                {account.totalPages} {account.totalPages === 1 ? 'page' : 'pages'} left
              </span>
              {account.extraPages > 0 && (
                <span className="muted">
                  {' '}
                  ({account.monthlyLeft} from your plan and {account.extraPages} extra that never
                  expire)
                </span>
              )}
              . <span data-testid="reset">Your pages reset on {day(account.creditsResetOn)}.</span>
            </p>
          </>
        )}
        {paid && account.paidUntil && (
          <p data-testid="renewal">
            {account.planStatus === 'past_due'
              ? 'Your last payment did not go through. Please update your card to keep your plan.'
              : account.cancelAtPeriodEnd
                ? `Cancelled: you keep ${account.planName} until ${day(account.paidUntil)}, then move to the free plan.`
                : `Renews on ${day(account.paidUntil)} (${account.billingInterval === 'year' ? 'yearly' : 'monthly'}).`}
          </p>
        )}
        {paid && (
          <button
            type="button"
            disabled={busy}
            data-testid="manage"
            onClick={() =>
              void act(async () => {
                const { url } = await callWorker<{ url: string }>('/me/portal', {
                  method: 'POST',
                  auth: true,
                });
                window.location.assign(url);
              })
            }
          >
            Change card, see invoices or cancel
          </button>
        )}
      </section>

      <section className="card" data-testid="upgrade-card">
        <h2>More pages</h2>
        {!canPay && <p data-testid="payments-off">{PAYMENTS_OFF}</p>}
        {upgrades.length > 0 && (
          <>
            <div className="row" role="group" aria-label="Billing period">
              <button
                type="button"
                className={interval === 'month' ? 'primary small' : 'small'}
                onClick={() => setInterval('month')}
              >
                Monthly
              </button>
              <button
                type="button"
                className={interval === 'year' ? 'primary small' : 'small'}
                onClick={() => setInterval('year')}
              >
                Yearly
              </button>
            </div>
            <div className="row">
              {upgrades.map((plan) => (
                <button
                  key={plan}
                  type="button"
                  className="primary"
                  disabled={busy || !canPay || !checkout?.prices.plans[plan]?.[interval]}
                  data-testid={`buy-${plan}`}
                  onClick={() => void buy(checkout?.prices.plans[plan]?.[interval], plan)}
                >
                  {PLANS[plan].name}: {PLANS[plan].monthlyPages} pages a month, $
                  {PLANS[plan].price[interval]} / {interval}
                </button>
              ))}
            </div>
          </>
        )}
        <p>
          <button
            type="button"
            disabled={busy || !canPay || !checkout?.prices.topUp}
            data-testid="buy-top-up"
            onClick={() => void buy(checkout?.prices.topUp)}
          >
            {TOP_UP.pages} extra pages for ${TOP_UP.price}
          </button>{' '}
          <span className="muted">Extra pages never expire.</span>
        </p>
      </section>

      <section className="card" data-testid="referral-card">
        <h2>Invite a friend</h2>
        <p>
          Your code is <strong data-testid="referral-code">{account.referralCode}</strong>. When a
          friend enters it, you each get {REFERRAL_BONUS_PAGES} pages.
        </p>
        <div className="row">
          <label style={{ margin: 0 }}>
            Have a code?{' '}
            <input
              type="text"
              value={referral}
              maxLength={40}
              onChange={(event) => setReferral(event.target.value)}
              data-testid="referral-input"
            />
          </label>
          <button
            type="button"
            disabled={busy || referral.trim() === ''}
            data-testid="referral-redeem"
            onClick={() =>
              void act(async () => {
                await callWorker('/referrals/redeem', {
                  method: 'POST',
                  auth: true,
                  body: { code: referral.trim() },
                }).catch((caught: unknown) => {
                  if (caught instanceof WorkerProblem && caught.status === 409) {
                    throw new WorkerProblem('That code cannot be used on this account.', 409);
                  }
                  throw caught;
                });
                await load();
                return `${REFERRAL_BONUS_PAGES} pages added. Thank you!`;
              })
            }
          >
            Use code
          </button>
        </div>
      </section>

      <section className="card" data-testid="profiles-card">
        <h2>Your handwriting</h2>
        <p className="muted">
          Saved to your account so you can use it on another device. {profiles.length} of{' '}
          {account.maxProfiles} used.
        </p>
        {profiles.length > 0 && (
          <ul className="summary">
            {profiles.map((profile) => (
              <li key={profile.id} data-testid="profile">
                <strong>{profile.name}</strong>{' '}
                <span className="muted">saved {day(profile.createdAt)}</span>{' '}
                <button
                  type="button"
                  className="small"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const { bank } = await callWorker<{ bank: StoredBank }>(
                        `/profiles/${profile.id}`,
                        { auth: true },
                      );
                      saveBank(bank);
                      return `"${profile.name}" is now the handwriting on this device.`;
                    })
                  }
                >
                  Use on this device
                </button>{' '}
                <button
                  type="button"
                  className="small"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await callWorker(`/profiles/${profile.id}`, {
                        method: 'DELETE',
                        auth: true,
                      });
                      await load();
                      return `"${profile.name}" was deleted from your account.`;
                    })
                  }
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="field">
          <label>
            Name
            <input
              type="text"
              value={profileName}
              maxLength={80}
              onChange={(event) => setProfileName(event.target.value)}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={ownHandwriting}
            onChange={(event) => setOwnHandwriting(event.target.checked)}
            data-testid="own-handwriting"
          />{' '}
          This is my own handwriting.
        </label>
        <p>
          <button
            type="button"
            disabled={busy || !ownHandwriting || profileName.trim() === ''}
            data-testid="save-profile"
            onClick={() =>
              void act(async () => {
                const local = await loadBank();
                if (local.isDemo) {
                  throw new WorkerProblem(
                    'There is no handwriting of your own on this device yet. Make it first under "My handwriting".',
                    0,
                  );
                }
                await callWorker('/profiles', {
                  method: 'POST',
                  auth: true,
                  body: { name: profileName.trim(), bank: local.stored, ownHandwriting: true },
                });
                await load();
                return 'Saved to your account.';
              })
            }
          >
            Save the handwriting on this device
          </button>
        </p>
      </section>

      {ledger.length > 0 && (
        <section className="card" data-testid="ledger-card">
          <h2>Recent activity</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th>Pages</th>
                </tr>
              </thead>
              <tbody>
                {ledger.slice(0, 12).map((entry, index) => (
                  <tr key={`${entry.at}-${index}`}>
                    <td>{day(entry.at)}</td>
                    <td>{entry.reason}</td>
                    <td>{entry.amount > 0 ? `+${entry.amount}` : entry.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card" data-testid="feedback-card">
        <FeedbackForm context={{ screen: 'account' }} />
      </section>

      <section className="card" data-testid="data-card">
        <h2>Your data</h2>
        <p>
          <button
            type="button"
            disabled={busy}
            data-testid="download-data"
            onClick={() =>
              void act(async () => {
                const data = await callWorker<unknown>('/me/data', { auth: true });
                downloadBytes(
                  new TextEncoder().encode(JSON.stringify(data, null, 2)),
                  'my-data.json',
                  'application/json',
                );
              })
            }
          >
            Download everything we hold about you
          </button>
        </p>
        <h3>Delete your account</h3>
        <p>
          This removes your account, your saved handwriting, your pages and your history for good.
          It cannot be undone.
          {paid && !account.cancelAtPeriodEnd && ' Please cancel your subscription first.'}
        </p>
        <div className="row">
          <label style={{ margin: 0 }}>
            Type <strong>{DELETE_WORDS}</strong> to confirm{' '}
            <input
              type="text"
              value={deleteWords}
              onChange={(event) => setDeleteWords(event.target.value)}
              data-testid="delete-words"
            />
          </label>
          <button
            type="button"
            disabled={busy || deleteWords.trim().toLowerCase() !== DELETE_WORDS}
            data-testid="delete-account"
            onClick={() =>
              void act(async () => {
                await callWorker('/me', {
                  method: 'DELETE',
                  auth: true,
                  body: { confirm: DELETE_WORDS },
                });
                await signOut();
                window.location.assign('/?account=deleted');
              })
            }
          >
            Delete my account
          </button>
        </div>
      </section>
    </div>
  );
}

const PAYMENTS_OFF =
  'Payments are not switched on yet, so plans and extra pages cannot be bought at the moment.';
