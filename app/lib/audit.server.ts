/**
 * Database-backed audit chain.
 *
 * The pure hashing logic lives in compliance/audit.ts; this module is the thin
 * persistence layer around it. Appends are serialised per shop so two
 * concurrent writers cannot both claim the same `seq` and fork the chain.
 */

import prisma from "~/db.server";
import {
  buildEntry,
  chainHead,
  exportCsv,
  verifyChain,
  type AuditInput,
  type AuditRecord,
  type ChainVerification,
} from "./compliance/audit";

/**
 * Per-shop append locks.
 *
 * Appending is read-then-write, so two requests interleaving would read the
 * same tail and mint duplicate `seq` values. The unique index on
 * (shopDomain, seq) would reject the loser, but chaining the promises here
 * means we serialise rather than fail. This is per-process: a multi-instance
 * deployment relies on the unique index plus the retry below.
 */
const appendLocks = new Map<string, Promise<unknown>>();

function withShopLock<T>(shopDomain: string, task: () => Promise<T>): Promise<T> {
  const previous = appendLocks.get(shopDomain) ?? Promise.resolve();
  const next = previous.then(task, task);
  // Keep the chain going but never let a rejection poison later appends.
  appendLocks.set(
    shopDomain,
    next.catch(() => undefined),
  );
  return next;
}

/** Appends one entry to a shop's chain and returns it. */
export async function appendAudit(
  shopDomain: string,
  input: AuditInput,
): Promise<AuditRecord> {
  return withShopLock(shopDomain, async () => {
    // Two attempts: if another process won the race for this seq, re-read the
    // tail and rebuild against the new head rather than failing the request.
    for (let attempt = 0; attempt < 2; attempt++) {
      const previous = await prisma.auditEntry.findFirst({
        where: { shopDomain },
        orderBy: { seq: "desc" },
        select: { seq: true, hash: true },
      });

      const entry = buildEntry(previous, input);

      try {
        await prisma.auditEntry.create({
          data: {
            shopDomain,
            seq: entry.seq,
            prevHash: entry.prevHash,
            hash: entry.hash,
            action: entry.action,
            actor: entry.actor,
            subject: entry.subject,
            payload: entry.payload,
            createdAt: entry.createdAt,
          },
        });
        return entry;
      } catch (error) {
        const isSeqCollision =
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002";
        if (!isSeqCollision || attempt === 1) throw error;
      }
    }
    throw new Error("Could not append audit entry after retry");
  });
}

/** Loads a shop's chain in sequence order. */
export async function loadChain(
  shopDomain: string,
  options: { limit?: number; offset?: number } = {},
): Promise<AuditRecord[]> {
  const rows = await prisma.auditEntry.findMany({
    where: { shopDomain },
    orderBy: { seq: "asc" },
    skip: options.offset,
    take: options.limit,
  });

  return rows.map((row) => ({
    seq: row.seq,
    prevHash: row.prevHash,
    hash: row.hash,
    action: row.action,
    actor: row.actor,
    subject: row.subject,
    payload: row.payload,
    createdAt: row.createdAt,
  }));
}

/**
 * Verifies the whole chain. Loads every entry deliberately — a partial slice
 * cannot prove integrity, since the point is to detect a deletion anywhere.
 */
export async function verifyShopChain(shopDomain: string): Promise<ChainVerification> {
  return verifyChain(await loadChain(shopDomain));
}

/** The head hash, which fixes the entire history in a single value. */
export async function shopChainHead(shopDomain: string): Promise<string> {
  return chainHead(await loadChain(shopDomain));
}

/** Renders the chain as CSV for an enforcement request. */
export async function exportShopChainCsv(shopDomain: string): Promise<string> {
  return exportCsv(await loadChain(shopDomain));
}

/** Entries concerning one product or image. */
export async function auditForSubject(
  shopDomain: string,
  subject: string,
): Promise<AuditRecord[]> {
  const rows = await prisma.auditEntry.findMany({
    where: { shopDomain, subject },
    orderBy: { seq: "asc" },
  });
  return rows.map((row) => ({
    seq: row.seq,
    prevHash: row.prevHash,
    hash: row.hash,
    action: row.action,
    actor: row.actor,
    subject: row.subject,
    payload: row.payload,
    createdAt: row.createdAt,
  }));
}
