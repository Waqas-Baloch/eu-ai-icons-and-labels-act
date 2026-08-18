/**
 * Who may use the app, and when they must pay.
 *
 * The trial is ours, not Shopify's: a merchant gets TRIAL_DAYS of the full app
 * from the moment they install, with no subscription and no card. Shopify's own
 * `trialDays` is therefore 0 in the billing config — leaving it at 7 as well
 * would hand out fourteen free days, seven of them invisible to us.
 *
 * Kept free of Prisma and Shopify imports so the rules can be tested directly.
 */

export const TRIAL_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Paths that stay reachable after the trial ends and without a subscription.
 *
 * The audit trail and its export are here deliberately. The plan page promises
 * the record belongs to the merchant and can be exported at any time, and it is
 * their evidence of what was disclosed while the app was live. Withholding that
 * to force a payment would be indefensible for a compliance tool — and useless
 * as leverage, since the labels already on their storefront keep rendering
 * regardless (the theme extension reads product metafields, which persist).
 */
const ALWAYS_ALLOWED = [
  "/app/terms",
  "/app/billing",
  "/app/audit",
  "/app/audit-export",
];

export type AccessState =
  /** Inside the free week. Full access, nothing owed yet. */
  | "trial"
  /** Paying, or inside a Shopify-side trial on a subscription. */
  | "subscribed"
  /** Free week over, no subscription. Read-only on their own records. */
  | "locked";

/** When a shop installed at `installedAt` runs out of free days. */
export function trialEndFrom(installedAt: Date): Date {
  return new Date(installedAt.getTime() + TRIAL_DAYS * MS_PER_DAY);
}

/**
 * Whole days left, rounded up, floored at zero.
 *
 * Rounded up so a merchant with six hours left is told "1 day left" rather than
 * "0 days left" while the app still works — the count is what the UI shows, and
 * it must never read as expired before the gate actually closes.
 */
export function trialDaysRemaining(
  trialEndsAt: Date | null | undefined,
  now: Date,
): number {
  if (!trialEndsAt) return 0;
  const remaining = trialEndsAt.getTime() - now.getTime();
  return remaining <= 0 ? 0 : Math.ceil(remaining / MS_PER_DAY);
}

export function accessState(params: {
  trialEndsAt: Date | null | undefined;
  hasActivePayment: boolean;
  now: Date;
}): AccessState {
  if (params.hasActivePayment) return "subscribed";
  if (trialDaysRemaining(params.trialEndsAt, params.now) > 0) return "trial";
  return "locked";
}

/** Whether a locked shop may still open this path. */
export function isAlwaysAllowed(pathname: string): boolean {
  const normalised =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return ALWAYS_ALLOWED.includes(normalised);
}

/**
 * Days of Shopify-side trial to attach when the merchant subscribes.
 *
 * Passing the days still left on our own trial means subscribing early costs a
 * merchant nothing: whenever they approve, the first charge still falls at the
 * end of the same free week they were promised. Subscribing after it has
 * expired bills immediately.
 */
export function shopifyTrialDaysFor(
  trialEndsAt: Date | null | undefined,
  now: Date,
): number {
  return trialDaysRemaining(trialEndsAt, now);
}
