// Coverage, routing, delegation, workflow engine, notifications. Design doc 02 §6.
import {
  boolean, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { createdOnly, firmId, id, stamps } from "./_common";
import { firms } from "./platform";
import { people } from "./org";
import { leaveRequests } from "./leave";

const firmFk = (t: { firmId: any }) => foreignKey({ columns: [t.firmId], foreignColumns: [firms.id] });

export const coverageItemType = pgEnum("coverage_item_type", ["court_date", "filing_deadline", "consultation", "other"]);
export const routeScope = pgEnum("route_scope", ["person", "department", "employment_type", "role"]);
export const approverKind = pgEnum("approver_kind", ["reports_to", "person", "role"]);
export const notificationChannel = pgEnum("notification_channel", ["email", "in_app"]);
export const notificationStatus = pgEnum("notification_status", ["queued", "sent", "failed", "cancelled", "read"]);

export const coverageRequests = pgTable("coverage_requests", {
  id: id(),
  firmId: firmId(),
  leaveRequestId: uuid("leave_request_id").notNull().references(() => leaveRequests.id),
  requesterId: uuid("requester_id").notNull().references(() => people.id),
  coveringPersonId: uuid("covering_person_id").notNull().references(() => people.id),
  workflowInstanceId: uuid("workflow_instance_id"),
  handoverDueAt: timestamp("handover_due_at", { withTimezone: true }),
  handoverConfirmedAt: timestamp("handover_confirmed_at", { withTimezone: true }),
  handoverConfirmedBy: uuid("handover_confirmed_by"),
  receivedConfirmedAt: timestamp("received_confirmed_at", { withTimezone: true }),
  notes: text("notes"),
  ...stamps,
}, t => [index("coverage_requests_covering_idx").on(t.firmId, t.coveringPersonId), firmFk(t)]);

export const coverageItems = pgTable("coverage_items", {
  id: id(),
  firmId: firmId(),
  coverageRequestId: uuid("coverage_request_id").notNull().references(() => coverageRequests.id),
  matterRef: text("matter_ref").notNull(),
  clientName: text("client_name"),
  itemType: coverageItemType("item_type").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  location: text("location"),
  notes: text("notes"),
  checklist: jsonb("checklist_json").$type<Record<string, boolean>>().notNull().default({}),
  isHandedOver: boolean("is_handed_over").notNull().default(false),
  handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
  ...stamps,
}, t => [index("coverage_items_request_idx").on(t.firmId, t.coverageRequestId), firmFk(t)]);

/** Exceptions to the organogram only (e.g. who approves a director). Default routing is reports_to. */
export const approvalRoutes = pgTable("approval_routes", {
  id: id(),
  firmId: firmId(),
  subjectType: text("subject_type").notNull(),
  scope: routeScope("scope").notNull(),
  scopeValue: text("scope_value").notNull(),
  approverKind: approverKind("approver_kind").notNull(),
  approverValue: text("approver_value"),
  priority: integer("priority").notNull().default(0),
  isFallback: boolean("is_fallback").notNull().default(false),
  ...stamps,
}, t => [index("approval_routes_firm_idx").on(t.firmId, t.subjectType), firmFk(t)]);

export const delegations = pgTable("delegations", {
  id: id(),
  firmId: firmId(),
  delegatorId: uuid("delegator_id").notNull().references(() => people.id),
  delegateId: uuid("delegate_id").notNull().references(() => people.id),
  subjectTypes: text("subject_types").array().notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...stamps,
}, t => [index("delegations_delegator_idx").on(t.firmId, t.delegatorId), firmFk(t)]);

export const workflowDefinitions = pgTable("workflow_definitions", {
  id: id(),
  firmId: firmId(),
  key: text("key").notNull(),
  version: integer("version").notNull(),
  definition: jsonb("definition_json").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...stamps,
}, t => [uniqueIndex("workflow_definitions_key_version_uq").on(t.firmId, t.key, t.version), firmFk(t)]);

export const workflowInstances = pgTable("workflow_instances", {
  id: id(),
  firmId: firmId(),
  definitionKey: text("definition_key").notNull(),
  definitionVersion: integer("definition_version").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  state: text("state").notNull(),
  assigneeId: uuid("assignee_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  context: jsonb("context_json").notNull().default({}),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...stamps,
}, t => [
  index("workflow_instances_assignee_idx").on(t.firmId, t.assigneeId, t.state),
  uniqueIndex("workflow_instances_subject_uq").on(t.firmId, t.subjectType, t.subjectId),
  firmFk(t),
]);

export const workflowSteps = pgTable("workflow_steps", {
  id: id(),
  firmId: firmId(),
  instanceId: uuid("instance_id").notNull().references(() => workflowInstances.id),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  action: text("action").notNull(),
  actorId: uuid("actor_id"),
  onBehalfOfId: uuid("on_behalf_of_id"),
  comment: text("comment"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("workflow_steps_instance_idx").on(t.firmId, t.instanceId), firmFk(t)]);

export const notificationTemplates = pgTable("notification_templates", {
  id: id(),
  firmId: firmId(),
  key: text("key").notNull(),
  channel: notificationChannel("channel").notNull(),
  locale: text("locale").notNull().default("en-ZA"),
  subject: text("subject").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  version: integer("version").notNull().default(1),
  ...stamps,
}, t => [uniqueIndex("notification_templates_uq").on(t.firmId, t.key, t.channel, t.locale), firmFk(t)]);

export const notifications = pgTable("notifications", {
  id: id(),
  firmId: firmId(),
  recipientId: uuid("recipient_id").notNull().references(() => people.id),
  templateKey: text("template_key").notNull(),
  channel: notificationChannel("channel").notNull(),
  payload: jsonb("payload_json").notNull().default({}),
  sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  status: notificationStatus("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  dedupeKey: text("dedupe_key").notNull(),
  ...createdOnly,
}, t => [
  uniqueIndex("notifications_dedupe_uq").on(t.firmId, t.dedupeKey),
  index("notifications_due_idx").on(t.status, t.sendAfter),
  index("notifications_recipient_idx").on(t.firmId, t.recipientId, t.status),
  firmFk(t),
]);
