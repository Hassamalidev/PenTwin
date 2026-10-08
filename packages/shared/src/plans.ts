export type PlanId = 'free' | 'student' | 'pro';
export type BillingInterval = 'month' | 'year';

export interface Plan {
  id: PlanId;
  name: string;
  /** Pages included each month. They lapse at the end of the credit period. */
  monthlyPages: number;
  /** Handwriting profiles the user may keep. */
  maxProfiles: number;
  /** Exports carry a watermark. */
  watermark: boolean;
  /** Only the basic pens and writing styles are available. */
  basicOptionsOnly: boolean;
  /**
   * Price in US dollars. PLACEHOLDERS: not validated with users yet (see
   * docs/user-interviews.md). Every price in the product is read from here.
   */
  price: Record<BillingInterval, number>;
}

/**
 * The one place plans and prices are defined for the app. The entitlements (pages,
 * profiles, watermark) are also seeded into the database, which is what actually
 * enforces them; a test checks the two agree.
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPages: 5,
    maxProfiles: 1,
    watermark: true,
    basicOptionsOnly: true,
    price: { month: 0, year: 0 },
  },
  student: {
    id: 'student',
    name: 'Student',
    monthlyPages: 150,
    maxProfiles: 3,
    watermark: false,
    basicOptionsOnly: false,
    price: { month: 4, year: 40 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPages: 500,
    maxProfiles: 10,
    watermark: false,
    basicOptionsOnly: false,
    price: { month: 9, year: 90 },
  },
};

/** A one-off pack of pages that do not lapse. Price is a placeholder. */
export const TOP_UP = { pages: 100, price: 3 } as const;

/** Pages given to both people when an invited friend joins. */
export const REFERRAL_BONUS_PAGES = 20;
