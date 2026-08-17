import type { ActionFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  const current = payload.current as string[];

  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { scope: current.toString() },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Scopes updated for ${shop} (${topic}): ${current.join(", ")}`);
  return new Response();
};
