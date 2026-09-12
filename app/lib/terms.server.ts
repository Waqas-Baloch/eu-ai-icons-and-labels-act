import { redirect } from "@remix-run/node";

import prisma from "~/db.server";
import { TERMS_VERSION } from "~/lib/terms";
import { embeddedPath } from "~/lib/embedded-redirect.server";

/**
 * When the merchant has to accept the terms.
 *
 * Not on the way in. The gate used to sit in the layout loader, so the terms
 * were the first thing a merchant saw — before the app had shown them a single
 * product, let alone anything worth agreeing to. The only organic install this
 * app has had did exactly that: arrived, met a legal wall, and left without
 * scanning anything.
 *
 * So the app is now free to explore. What the terms actually govern is
 * publishing a disclosure to a live storefront — who is answerable for it —
 * and that is where the gate belongs: at the moment the merchant first puts a
 * label on their own products.
 *
 * Until then nothing this app decides reaches the merchant's products. The
 * scan assesses and stores, and publishing is held back; accepting releases it
 * (see app/routes/app.terms.tsx).
 */

export async function hasAcceptedTerms(shopDomain: string): Promise<boolean> {
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    select: { termsVersion: true },
  });
  return shop?.termsVersion === TERMS_VERSION;
}

/**
 * Stops a publish by a merchant who has not accepted the current terms.
 *
 * Redirects rather than erroring: the merchant is mid-task, so send them to the
 * terms and carry where they were, so accepting puts them back rather than
 * stranding them somewhere else in the app.
 */
export async function requireTermsAccepted(
  shopDomain: string,
  request: Request,
): Promise<void> {
  if (await hasAcceptedTerms(shopDomain)) return;

  const from = new URL(request.url).pathname;
  throw redirect(
    embeddedPath(request.url, `/app/terms?return=${encodeURIComponent(from)}`),
  );
}
