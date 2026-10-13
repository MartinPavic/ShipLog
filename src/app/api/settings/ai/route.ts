import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { aiCredentials } from "@/db/schema";
import { getAiCredential } from "@/lib/ai/access";
import { ApiError, handle, parseBody } from "@/lib/api";
import { encrypt, last4 } from "@/lib/crypto";
import { getOwner, requireAdmin } from "@/lib/owner";
import { aiSettingsSchema } from "@/lib/validation";

export const GET = handle(async () => {
  const owner = await getOwner();
  const credential = await getAiCredential(owner.ownerId);
  return NextResponse.json({
    configured: Boolean(credential),
    provider: credential?.provider ?? null,
    last4: credential?.last4 ?? null,
    model: credential?.model ?? null,
  });
});

// Partial update: omitted fields keep their stored value; the key is never returned.
export const PUT = handle(async (req: Request) => {
  const owner = await requireAdmin();
  const body = await parseBody(req, aiSettingsSchema);
  const db = getDb();
  const existing = await getAiCredential(owner.ownerId);
  const sameProvider = existing?.provider === body.provider;

  if (!body.apiKey && !sameProvider) {
    throw new ApiError(400, "Enter an API key to set up this provider.", "VALIDATION");
  }

  const model = body.model ?? (sameProvider ? existing.model : null);
  await db.transaction(async (tx) => {
    // One active credential per owner.
    await tx
      .delete(aiCredentials)
      .where(and(eq(aiCredentials.ownerId, owner.ownerId), ne(aiCredentials.provider, body.provider)));

    if (body.apiKey) {
      const values = { encryptedKey: encrypt(body.apiKey), last4: last4(body.apiKey), model, updatedAt: new Date() };
      await tx
        .insert(aiCredentials)
        .values({ ownerId: owner.ownerId, provider: body.provider, ...values })
        .onConflictDoUpdate({ target: [aiCredentials.ownerId, aiCredentials.provider], set: values });
    } else {
      await tx
        .update(aiCredentials)
        .set({ model, updatedAt: new Date() })
        .where(and(eq(aiCredentials.ownerId, owner.ownerId), eq(aiCredentials.provider, body.provider)));
    }
  });

  const saved = await getAiCredential(owner.ownerId);
  return NextResponse.json({
    configured: true,
    provider: saved?.provider ?? null,
    last4: saved?.last4 ?? null,
    model: saved?.model ?? null,
  });
});

export const DELETE = handle(async () => {
  const owner = await requireAdmin();
  await getDb().delete(aiCredentials).where(eq(aiCredentials.ownerId, owner.ownerId));
  return NextResponse.json({ success: true });
});
