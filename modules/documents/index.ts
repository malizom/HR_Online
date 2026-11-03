// Staff documents: upload, HR review, download (doc 02 §4). Downloads and S-class reads are access-logged.
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { schema, withFirm, type Tx } from "@/lib/db";
import { getBytes, putDocument, UserError } from "@/lib/storage";
import { audit, logAccess } from "../audit";
import type { Ctx } from "../identity/actor";

export async function listCategories(tx: Tx) {
  return tx.select().from(schema.documentCategories).orderBy(asc(schema.documentCategories.sort));
}

export async function uploadDocument(ctx: Ctx, file: File, categoryCode: string) {
  if (ctx.person.role === "viewer") throw new UserError("Calendar viewers cannot make changes.", 403);
  const stored = await putDocument(ctx.firm.id, ctx.person.id, file);
  return withFirm(ctx.firm.id, async tx => {
    const [cat] = await tx.select().from(schema.documentCategories).where(eq(schema.documentCategories.code, categoryCode));
    if (!cat) throw new UserError("Unknown document category.");
    if (cat.appliesWhen === "admitted" && !ctx.person.isAdmittedAttorney) throw new UserError(`${cat.label} applies to admitted attorneys only.`);
    if (!cat.acceptedMime.includes(stored.mime)) throw new UserError("That file type is not accepted for this document.");
    const [doc] = await tx.insert(schema.documents).values({
      firmId: ctx.firm.id, personId: ctx.person.id, categoryId: cat.id, fileName: file.name.slice(0, 200),
      mime: stored.mime, sizeBytes: stored.size, blobPath: stored.blobPath, sha256: stored.sha256, createdBy: ctx.person.id,
    }).returning();
    // A new upload supersedes earlier non-verified uploads in the same category.
    await tx.update(schema.documents).set({ status: "superseded", supersededById: doc.id, updatedAt: new Date() }).where(and(
      eq(schema.documents.personId, ctx.person.id), eq(schema.documents.categoryId, cat.id), ne(schema.documents.id, doc.id), eq(schema.documents.status, "rejected")));
    await audit(tx, ctx.actor, "document.upload", "document", doc.id, { category: cat.code });
    return doc;
  });
}

export async function reviewDocument(ctx: Ctx, documentId: string, status: "verified" | "rejected", reason?: string) {
  if (ctx.person.role !== "admin") throw new UserError("Not allowed.", 403);
  await withFirm(ctx.firm.id, async tx => {
    const [d] = await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId));
    if (!d) throw new UserError("Document not found.", 404);
    if (d.status === "superseded") throw new UserError("This document has been replaced by a newer upload.");
    await tx.update(schema.documents).set({ status, reviewedBy: ctx.person.id, reviewedAt: new Date(), rejectionReason: status === "rejected" ? (reason ?? null) : null, updatedAt: new Date() })
      .where(eq(schema.documents.id, d.id));
    await audit(tx, ctx.actor, `document.${status}`, "document", d.id);
  });
}

export async function downloadDocument(ctx: Ctx, documentId: string) {
  const doc = await withFirm(ctx.firm.id, async tx => {
    const [d] = await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId));
    if (!d) throw new UserError("Document not found.", 404);
    if (d.personId !== ctx.person.id && ctx.person.role !== "admin") throw new UserError("Not allowed.", 403);
    await logAccess(tx, ctx.actor, "document", d.id, "download");
    return d;
  });
  return { doc, bytes: await getBytes(ctx.firm.id, doc.blobPath) };
}

export async function listDocuments(tx: Tx, scope: { all: boolean; personId: string }) {
  const q = tx.select({ d: schema.documents, code: schema.documentCategories.code }).from(schema.documents)
    .innerJoin(schema.documentCategories, eq(schema.documentCategories.id, schema.documents.categoryId))
    .where(scope.all ? ne(schema.documents.status, "superseded") : and(eq(schema.documents.personId, scope.personId), ne(schema.documents.status, "superseded")))
    .orderBy(desc(schema.documents.createdAt));
  return q;
}
