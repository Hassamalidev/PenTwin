'use client';

import { PLANS, type PlanId } from '@pentwin/shared';
import { useState } from 'react';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8787';

interface PlanCost {
  plan: PlanId;
  exports: number;
  pages: number;
  chargedPages: number;
  computeSeconds: number;
  cost: number;
  costPerPage: number;
  marginAtFullUse: number;
  overLimit: boolean;
}

interface CostReport {
  plans: PlanCost[];
  costPerPage: number;
  alerts: string[];
}

const dollars = (value: number, digits = 2): string => `$${value.toFixed(digits)}`;

/**
 * Cost dashboard for whoever runs the service: what an exported page costs to produce
 * and what is left of each plan's price. It shows compute time and sizes only; no
 * document content exists anywhere in this data.
 */
export default function CostsPage() {
  const [token, setToken] = useState('');
  const [report, setReport] = useState<CostReport>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`${WORKER_URL}/admin/costs`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'Not available: the token is wrong, or the cost report is switched off.'
            : 'The cost report could not be loaded.',
        );
      }
      setReport((await response.json()) as CostReport);
    } catch (caught) {
      setReport(undefined);
      setError(
        caught instanceof TypeError
          ? 'The worker could not be reached.'
          : (caught as Error).message,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel narrow">
      <h1>Cost per page</h1>
      <p className="muted">
        Completed exports of the last 30 days. Costs are estimated from compute time and file size
        at the rates set in the worker.
      </p>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          type="password"
          value={token}
          placeholder="Admin token"
          aria-label="Admin token"
          autoComplete="off"
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="submit" className="primary" disabled={!token || loading}>
          {loading ? 'Loading...' : 'Show report'}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <section data-testid="cost-report">
          {report.alerts.length > 0 ? (
            <div className="notice" role="alert" data-testid="cost-alerts">
              <strong>Cost alert</strong>
              <ul>
                {report.alerts.map((alert) => (
                  <li key={alert}>{alert}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p data-testid="cost-ok">Every plan is under the $0.01 per page limit.</p>
          )}
          <p className="cost" data-testid="cost-overall">
            {dollars(report.costPerPage, 4)} per page overall
          </p>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Exports</th>
                  <th>Pages</th>
                  <th>Compute</th>
                  <th>Cost</th>
                  <th>Per page</th>
                  <th>Price</th>
                  <th>Margin at full use</th>
                </tr>
              </thead>
              <tbody>
                {report.plans.map((row) => (
                  <tr key={row.plan} className={row.overLimit ? 'over-limit' : undefined}>
                    <td>{PLANS[row.plan].name}</td>
                    <td>{row.exports}</td>
                    <td>{row.pages}</td>
                    <td>{row.computeSeconds.toFixed(1)} s</td>
                    <td>{dollars(row.cost, 4)}</td>
                    <td>{dollars(row.costPerPage, 4)}</td>
                    <td>{dollars(PLANS[row.plan].price.month)}</td>
                    <td>{dollars(row.marginAtFullUse)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Margin at full use: the monthly price minus the cost of a subscriber who exports their
            whole allowance. The target is at least $2.
          </p>
        </section>
      )}
    </div>
  );
}
