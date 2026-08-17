import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

/**
 * The review queue used to be its own page listing loose images. It is now the
 * "Needs review" filter on the products list, so merchants have one place to
 * work rather than two views of the same data.
 *
 * Kept as a redirect because the old path is linked from earlier notification
 * copy and from bookmarks.
 */
export const loader = async (_args: LoaderFunctionArgs) => {
  throw redirect("/app?filter=review");
};
