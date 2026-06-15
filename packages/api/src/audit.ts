import { createHash } from "node:crypto";

import { desc, eq } from "@agentscope/db";
import type { db as defaultDb } from "@agentscope/db/client";
import { AuditLog } from "@agentscope/db/schema";

export async function writeAuditLog(input: {
  db: typeof defaultDb;
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const previous = await input.db.query.AuditLog.findFirst({
    where: eq(AuditLog.organizationId, input.organizationId),
    orderBy: desc(AuditLog.sequence),
  });
  const sequence = (previous?.sequence ?? 0) + 1;
  const payload = input.payload ?? {};
  const payloadHash = hashAuditPayload({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    payload,
    sequence,
    previousHash: previous?.payloadHash ?? null,
  });

  await input.db.insert(AuditLog).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    payload,
    sequence,
    payloadHash,
    previousHash: previous?.payloadHash ?? null,
  });
}

function hashAuditPayload(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
