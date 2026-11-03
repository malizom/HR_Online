// Permission matrix (doc 03 §7): who can see and do what. Blocking in CI.
import { describe, expect, it } from "vitest";
import { can, navFor, type Action, type Who } from "@/modules/permissions";

const admin: Who = { id: "a", role: "admin", isManager: false };
const manager: Who = { id: "m", role: "manager", isManager: true };
const staff: Who = { id: "s", role: "staff", isManager: false };
const viewer: Who = { id: "v", role: "viewer", isManager: false };

describe("permission matrix", () => {
  const cases: [Who, Action, Record<string, string>, boolean][] = [
    [viewer, "calendar.view", {}, true],
    [viewer, "leave.request", {}, false],
    [viewer, "leave.view", { personId: "s" }, false],
    [staff, "leave.request", {}, true],
    [staff, "leave.view", { personId: "s" }, true],
    [staff, "leave.view", { personId: "x", managerId: "m" }, false],
    [manager, "leave.view", { personId: "s", managerId: "m" }, true],
    [manager, "leave.view", { personId: "x", managerId: "other" }, false],
    [manager, "leave.view_reason", { personId: "s", managerId: "m" }, true],
    [manager, "profile.view_sensitive", { personId: "s", managerId: "m" }, false],
    [staff, "profile.view_sensitive", { personId: "s" }, true],
    [admin, "profile.view_sensitive", { personId: "s" }, true],
    [manager, "people.manage", {}, false],
    [manager, "settings.manage", {}, false],
    [manager, "reports.team", {}, true],
    [manager, "reports.firm", {}, false],
    [staff, "reports.team", {}, false],
    [manager, "delegation.manage_own", {}, true],
    [manager, "delegation.manage_any", {}, false],
    [admin, "payroll.export", {}, true],
    [admin, "audit.view", {}, true],
    [staff, "audit.view", {}, false],
    [admin, "leave.request_on_behalf", {}, true],
    [manager, "leave.request_on_behalf", {}, false],
  ];
  it.each(cases)("%#: %o %s %o → %s", (who, action, about, expected) => {
    expect(can(who, action, about)).toBe(expected);
  });
});

describe("navigation follows permissions", () => {
  it("viewer sees only the calendar; staff no admin pages; admin sees settings and audit", () => {
    expect(navFor({ ...viewer, onboardingComplete: true })).toEqual(["Team calendar"]);
    const s = navFor({ ...staff, onboardingComplete: true });
    expect(s).not.toContain("Approvals");
    expect(s).not.toContain("People");
    expect(s).not.toContain("Onboarding");
    expect(navFor({ ...manager, onboardingComplete: true })).toContain("Approvals");
    expect(navFor({ ...admin, onboardingComplete: false })).toEqual(expect.arrayContaining(["People", "Settings", "Audit", "Reports", "Onboarding"]));
  });
});
