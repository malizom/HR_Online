// People and the organogram. Admin adds staff; staff edit their own details. Doc 02 §4.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withFirm, type Tx } from "@/lib/db";
import { UserError } from "@/lib/storage";
import type { Person } from "@/db/schema";
import { audit } from "../audit";
import { enqueue } from "../notifications";
import { startWorkflow } from "../workflow/engine";
import type { Ctx } from "../identity/actor";

export const displayName = (p: Pick<Person, "firstName" | "lastName" | "preferredName">) =>
  `${p.preferredName || p.firstName} ${p.lastName}`.trim();

export function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) throw new UserError("Please enter a first name and a surname.");
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

const ROLES = ["admin", "manager", "staff", "viewer"] as const;

const AddStaff = z.object({
  name: z.string().trim().min(3),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES).default("staff"),
  reportsToId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  departmentId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  isFeeEarner: z.coerce.boolean().optional(),
});

export async function addStaff(ctx: Ctx, raw: unknown, portalUrl: string) {
  if (ctx.person.role !== "admin") throw new UserError("Not allowed.", 403);
  const input = AddStaff.safeParse(raw);
  if (!input.success) throw new UserError("A full name and a valid sign-in email are required.");
  const { firstName, lastName } = splitName(input.data.name);
  return withFirm(ctx.firm.id, async tx => {
    const [exists] = await tx.select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.workEmail, input.data.email));
    if (exists) throw new UserError("Someone with that email already exists.");
    if (input.data.reportsToId) await assertPerson(tx, input.data.reportsToId);
    const [p] = await tx.insert(schema.people).values({
      firmId: ctx.firm.id, firstName, lastName, workEmail: input.data.email, role: input.data.role,
      reportsToId: input.data.reportsToId ?? null, departmentId: input.data.departmentId ?? null,
      isFeeEarner: !!input.data.isFeeEarner, onboardingStatus: "invited", createdBy: ctx.person.id,
    }).returning();
    await tx.insert(schema.onboardingChecklists).values({ firmId: ctx.firm.id, personId: p.id, invitedAt: new Date(), createdBy: ctx.person.id });
    await startWorkflow(tx, ctx.actor, "onboarding", "person", p.id);
    await audit(tx, ctx.actor, "person.add", "person", p.id, { role: p.role, reportsToId: p.reportsToId });
    await enqueue(tx, { firmId: ctx.firm.id, recipientId: p.id, templateKey: "onboarding.invite", channels: ["email"],
      payload: { person: firstName, firm: ctx.firm.displayName, link: portalUrl }, dedupeKey: `invite:${p.id}` });
    return p;
  });
}

const Profile = z.object({
  name: z.string().trim().min(3),
  phone: z.string().trim().max(30).optional().default(""),
  title: z.string().trim().min(2),
  department: z.string().trim().optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  admitted: z.boolean().default(false),
});

export async function updateOwnProfile(ctx: Ctx, raw: unknown) {
  if (ctx.person.role === "viewer") throw new UserError("Calendar viewers cannot make changes.", 403);
  const r = Profile.safeParse(raw);
  if (!r.success) throw new UserError(r.error.issues.some(i => i.path[0] === "start") ? "Employment start date is required." : "Full name and job title are required.");
  const { firstName, lastName } = splitName(r.data.name);
  await withFirm(ctx.firm.id, async tx => {
    let departmentId = ctx.person.departmentId;
    if (r.data.department) {
      const [d] = await tx.select().from(schema.departments).where(eq(schema.departments.name, r.data.department));
      if (d) departmentId = d.id;
    }
    await tx.update(schema.people).set({
      firstName, lastName, phone: r.data.phone || null, jobTitle: r.data.title, departmentId, startDate: r.data.start,
      isAdmittedAttorney: r.data.admitted, onboardingStatus: ctx.person.onboardingStatus === "invited" ? "draft" : ctx.person.onboardingStatus,
      updatedAt: new Date(),
    }).where(eq(schema.people.id, ctx.person.id));
    await audit(tx, ctx.actor, "person.profile", "person", ctx.person.id, { jobTitle: r.data.title, departmentId, startDate: r.data.start });
  });
}

async function assertPerson(tx: Tx, id: string) {
  const [p] = await tx.select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.id, id));
  if (!p) throw new UserError("The selected manager does not exist.");
}

export async function listDepartments(tx: Tx) {
  return tx.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments)
    .where(eq(schema.departments.isActive, true)).orderBy(asc(schema.departments.name));
}

export async function listPeople(tx: Tx, scope: { all: boolean; ids?: string[] }) {
  const rows = await tx.select({ p: schema.people, dept: schema.departments.name }).from(schema.people)
    .leftJoin(schema.departments, eq(schema.departments.id, schema.people.departmentId))
    .where(and(eq(schema.people.status, "active")))
    .orderBy(asc(schema.people.firstName), asc(schema.people.lastName));
  return scope.all ? rows : rows.filter(r => scope.ids?.includes(r.p.id));
}
