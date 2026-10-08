'use client';

import { PLANS, TOP_UP, type BillingInterval, type PlanId } from '@pentwin/shared';
import { useState } from 'react';

const ORDER: PlanId[] = ['free', 'student', 'pro'];

const money = (amount: number): string =>
  Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

/** The plan cards with a monthly / yearly switch. Every number comes from the plan config. */
export function PricingCards() {
  const [interval, setInterval] = useState<BillingInterval>('month');
  const yearlySaving = Math.round(
    (1 - PLANS.student.price.year / (PLANS.student.price.month * 12)) * 100,
  );

  return (
    <div>
      <div
        className="row"
        role="group"
        aria-label="Billing period"
        style={{ marginBottom: '1rem' }}
      >
        <button
          type="button"
          className={interval === 'month' ? 'primary' : undefined}
          aria-pressed={interval === 'month'}
          onClick={() => setInterval('month')}
        >
          Monthly
        </button>
        <button
          type="button"
          className={interval === 'year' ? 'primary' : undefined}
          aria-pressed={interval === 'year'}
          data-testid="yearly"
          onClick={() => setInterval('year')}
        >
          Yearly (save {yearlySaving}%)
        </button>
      </div>

      <div className="grid">
        {ORDER.map((id) => {
          const plan = PLANS[id];
          const price = plan.price[interval];
          return (
            <div
              key={id}
              className={`card${id === 'student' ? ' featured' : ''}`}
              data-testid={`plan-${id}`}
            >
              <h2>
                {plan.name} {id === 'student' && <span className="badge">For students</span>}
              </h2>
              <p className="price" data-testid={`price-${id}`}>
                {price === 0 ? 'Free' : money(price)}
                {price > 0 && <small> / {interval === 'month' ? 'month' : 'year'}</small>}
              </p>
              {price > 0 && interval === 'year' && (
                <p className="muted" style={{ margin: 0 }}>
                  {money(price / 12)} a month, billed yearly
                </p>
              )}
              <ul className="checks">
                <li>{plan.monthlyPages} pages every month</li>
                <li>
                  {plan.maxProfiles} handwriting {plan.maxProfiles === 1 ? 'profile' : 'profiles'}
                </li>
                <li>{plan.watermark ? 'Watermark on exported pages' : 'No watermark'}</li>
                <li>
                  {plan.basicOptionsOnly
                    ? 'Ballpoint pens'
                    : 'All pens, handwritten page header, realism settings'}
                </li>
                <li>Free, unlimited previews</li>
              </ul>
              <a className={`button${id === 'student' ? ' primary' : ''}`} href="/editor">
                {id === 'free' ? 'Start free' : 'Try it free first'}
              </a>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ marginTop: '1rem' }}>
        Need more in a busy month? Add {TOP_UP.pages} pages for {money(TOP_UP.price)}. Top-up pages
        never expire. Prices are in US dollars.
      </p>
    </div>
  );
}
