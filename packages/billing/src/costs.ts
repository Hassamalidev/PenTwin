import { PLANS, type PlanId } from '@pentwin/shared';
import type { Pool } from 'pg';

export interface CostRates {
  /** What one second of export compute costs, in US dollars. */
  dollarsPerComputeSecond: number;
  /** What storing and serving one megabyte of output costs, in US dollars. */
  dollarsPerOutputMegabyte: number;
}

/**
 * Rough defaults for a small always-on container (about $7 a month, one core) and
 * object storage with egress. ESTIMATES: replace with real numbers from the hosting
 * bills once deployed.
 */
export const DEFAULT_RATES: CostRates = {
  dollarsPerComputeSecond: 7 / (30 * 24 * 3600),
  dollarsPerOutputMegabyte: 0.0001,
};

/** The most an exported page should cost to produce. */
export const COST_PER_PAGE_LIMIT = 0.01;

export interface PlanCost {
  plan: PlanId;
  exports: number;
  pages: number;
  chargedPages: number;
  computeSeconds: number;
  cost: number;
  costPerPage: number;
  /** Monthly price minus the cost of a subscriber who uses the whole allowance. */
  marginAtFullUse: number;
  overLimit: boolean;
}

export interface CostReport {
  /** Covers completed exports of the last 30 days. */
  plans: PlanCost[];
  costPerPage: number;
  /** Human-readable alerts; empty when costs are within the limit. */
  alerts: string[];
}

/**
 * The cost dashboard's numbers: cost per page and margin per plan, from compute time
 * and output size alone. No document content is stored or read.
 */
export async function costReport(
  pool: Pool,
  rates: CostRates = DEFAULT_RATES,
): Promise<CostReport> {
  const { rows } = await pool.query(`select * from public.export_costs`);
  const plans = rows.map((row): PlanCost => {
    const plan = PLANS[row.plan as PlanId];
    const computeSeconds = Number(row.compute_ms) / 1000;
    const cost =
      computeSeconds * rates.dollarsPerComputeSecond +
      (Number(row.output_bytes) / 1_048_576) * rates.dollarsPerOutputMegabyte;
    const costPerPage = row.pages > 0 ? cost / row.pages : 0;
    return {
      plan: plan.id,
      exports: row.exports,
      pages: row.pages,
      chargedPages: row.charged_pages,
      computeSeconds,
      cost,
      costPerPage,
      marginAtFullUse: plan.price.month - costPerPage * plan.monthlyPages,
      overLimit: costPerPage > COST_PER_PAGE_LIMIT,
    };
  });
  const pages = plans.reduce((sum, p) => sum + p.pages, 0);
  const cost = plans.reduce((sum, p) => sum + p.cost, 0);
  return {
    plans,
    costPerPage: pages > 0 ? cost / pages : 0,
    alerts: plans
      .filter((p) => p.overLimit)
      .map(
        (p) =>
          `Cost per page on the ${p.plan} plan is $${p.costPerPage.toFixed(4)}, ` +
          `above the $${COST_PER_PAGE_LIMIT.toFixed(2)} limit.`,
      ),
  };
}
