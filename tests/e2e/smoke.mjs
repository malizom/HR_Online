// End-to-end smoke through the real UI on the seeded demo firm — a subset of the UAT script (doc 09 §3).
// Requires: dev server on :3000 with DEV_LOGIN=true and a fresh demo seed (npm run db:reset). Usage: npm run test:e2e
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://demo.localhost:3000";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const browser = await chromium.launch();

// Dates relative to today so the suite never ages: a Monday N weeks ahead.
const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date()) + "T00:00:00Z");
const monday = n => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + 7 * n - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const plus = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function as(email) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signin`);
  await page.fill('input[name="email"]', email);
  await page.click('button:has-text("Sign in (dev)")');
  await page.waitForSelector("text=PEOPLE PORTAL", { timeout: 30000 });
  await page.waitForSelector("nav button", { timeout: 30000 });
  return page;
}
const nav = async (page, label) => { await page.click(`nav button:has-text("${label}")`); await page.waitForTimeout(300); };
const annualNow = async page => Number((await page.locator(".balance:has-text('Annual') .big").first().textContent()).trim());
const requestLeave = async (page, start, end) => {
  await page.locator("form select").filter({ hasText: "Annual" }).first().selectOption("annual");
  await page.fill('input[type="date"] >> nth=0', start);
  await page.fill('input[type="date"] >> nth=1', end);
  await page.waitForSelector(".preview .total", { timeout: 15000 });
};

try {
  // U17 — unknown host resolves to no workspace (tenant resolution by host).
  {
    const p = await (await browser.newContext()).newPage();
    await p.goto(BASE.replace("demo.localhost", "nobody.localhost"));
    check("unknown host shows 'No workspace here'", await p.isVisible("text=No workspace here"));
  }

  // Admin home dashboard and navigation from the permission model.
  const hr = await as("tamlyn.hulley@demo.test");
  const hrNav = await hr.locator("nav button").allTextContents();
  check("admin navigation includes People, Settings, Audit, Reports", ["People", "Settings", "Audit", "Reports"].every(n => hrNav.some(x => x.includes(n))), hrNav.join(","));
  check("admin dashboard tiles render", await hr.isVisible("text=Leave awaiting decision"));

  // U1 — add a new starter into the organogram.
  await nav(hr, "People");
  await hr.click('button:has-text("Add staff member")');
  await hr.fill('.modal input[name="name"]', "Zola Newhire");
  await hr.fill('.modal input[name="email"]', "zola.newhire@demo.test");
  await hr.selectOption('.modal select[name="reportsToId"]', { label: "Robyn Adams — Executive: Dispute Resolution" });
  await hr.click('.modal button:has-text("Add staff member")');
  await hr.waitForSelector(".listrow:has-text('Zola Newhire')");
  check("new starter added under Robyn", (await hr.locator(".listrow:has-text('Zola Newhire') small").last().textContent()).includes("Reports to Robyn Adams"));

  // U3 — a rejection needs a reason.
  await nav(hr, "Documents to review");
  const row = hr.locator(".listrow:has-text('Thabo-Newstarter-CV.pdf')");
  check("reject is disabled without a reason", await row.locator('button:has-text("Reject")').isDisabled());
  await row.locator('input[aria-label="Rejection reason"]').fill("Please upload a full CV, page 2 is missing");
  await row.locator('button:has-text("Reject")').click();
  await hr.waitForSelector(".listrow:has-text('Thabo-Newstarter-CV.pdf') .badge.red");
  check("HR rejects a document with a reason", true);

  // U4 — non-fee-earner: live preview with balance before/after, then submit.
  const sa = await as("sarah.secretary@demo.test");
  await nav(sa, "My leave");
  const saBefore = await annualNow(sa);
  await requestLeave(sa, monday(9), plus(monday(9), 4));
  const total = Number((await sa.locator(".preview .total").textContent()).split(" ")[0]);
  check("preview counts working days", total >= 3 && total <= 5, `${total}`);
  check("preview shows ready to submit with balance after", await sa.isVisible("text=Ready to submit") && await sa.isVisible("text=after this request"));
  await sa.click('button:has-text("Submit request")');
  await sa.waitForSelector("text=Request sent");
  check("pending days are reserved from the balance", Math.abs(await annualNow(sa) - (saBefore - total)) < 0.01, `${saBefore} → ${await annualNow(sa)}`);

  // U5–U7 — fee-earner must arrange cover; colleague accepts; manager approves.
  const ay = await as("ivan.phahle@demo.test");
  await nav(ay, "My leave");
  const ayBefore = await annualNow(ay);
  await requestLeave(ay, monday(10), plus(monday(10), 1));
  await ay.waitForSelector("text=Matter cover while you are away");
  check("submit is blocked until a covering colleague is chosen", await ay.locator('button:has-text("Submit request")').isDisabled());
  await ay.selectOption('select:has(option:text("Choose a colleague…"))', { label: "Muano Ramurunzi — Dispute Resolution" });
  await ay.click('button:has-text("Add a matter item")');
  await ay.fill('input[aria-label="Matter reference"]', "LIT/2026/077");
  await ay.fill('input[aria-label="When"]', `${monday(10)}T09:30`);
  await ay.click('button:has-text("Submit request")');
  await ay.waitForSelector(".approval:has-text('Awaiting cover')");
  check("request waits for cover first", true);

  const li = await as("robyn.adams@demo.test");
  await nav(li, "Approvals");
  check("manager does not get it before cover is accepted", (await li.locator(`.approval:has-text("Ivan"):has-text("${monday(10).slice(8, 10).replace(/^0/, "")}")`).count()) === 0 || await li.isVisible("text=Waiting for cover"));

  const ka = await as("muano.ramurunzi@demo.test");
  await nav(ka, "My leave");
  await ka.locator(".approval:has-text('LIT/2026/077') button:has-text('Accept cover')").click();
  await ka.waitForTimeout(800);
  check("colleague accepts cover", (await ka.locator(".approval:has-text('LIT/2026/077') button:has-text('Accept cover')").count()) === 0);

  const jo = await as("eduan.kapp@demo.test");
  await nav(jo, "Approvals");
  check("another manager cannot see it", (await jo.locator(".approval:has-text('Ivan Phahle · Annual')").count()) === 0);

  await li.reload(); await li.waitForSelector("nav button");
  await nav(li, "Approvals");
  const card = li.locator(".approval:has-text('LIT/2026/077')");
  check("approval card shows cover and balance after", (await card.textContent()).includes("Cover: Muano") && (await card.textContent()).includes("Balance after"));
  await card.locator('button:has-text("Approve")').click();
  await li.waitForTimeout(800);
  check("manager approves", (await li.locator(".approval:has-text('LIT/2026/077')").count()) === 0);

  // V9 — sick leave needing a certificate cannot be approved by the manager.
  const sick = li.locator(".approval:has-text('Sick'):has-text('Sarah')");
  check("certificate-required sick leave is blocked for the manager", (await sick.count()) > 0 && await sick.locator('button:has-text("Approve")').isDisabled());

  // U11 — no self-approval; Robyn's own leave is with the MD.
  check("own request is not in own approvals", (await li.locator(".approval:has-text('Robyn Adams')").count()) === 0);

  // E14 — cancelling approved leave returns the days.
  await ay.reload(); await ay.waitForSelector("nav button");
  await nav(ay, "My leave");
  check("approved request offers handover confirmation", await ay.isVisible("button:has-text('Confirm handover to Muano')"));
  await ay.locator(".approval:has-text('Approved') button:has-text('Cancel request')").first().click();
  await ay.waitForTimeout(800);
  check("cancel returns the days to the balance", Math.abs(await annualNow(ay) - ayBefore) < 0.01, `${ayBefore} → ${await annualNow(ay)}`);

  // U12 — director routes to HR via the explicit route; HR approves.
  await hr.reload(); await hr.waitForSelector("nav button");
  await nav(hr, "Approvals");
  await hr.locator(".approval:has-text('Matodzi Ratshimbilani') button:has-text('Approve')").first().click();
  await hr.waitForTimeout(800);
  check("director's leave approved by HR via route", (await hr.locator(".approval:has-text('Matodzi Ratshimbilani')").count()) === 0);

  // Reports, payroll export, settings, audit render for HR.
  await nav(hr, "Reports");
  await hr.waitForSelector("text=Leave taken by month");
  check("reports and payroll export render", await hr.isVisible("text=Payroll leave export"));
  await nav(hr, "Settings");
  check("settings shows versioned policies", await hr.isVisible("text=Annual leave") || await hr.isVisible("td:has-text('Annual')"));
  await nav(hr, "Audit");
  await hr.waitForSelector("table.grid tbody tr");
  check("audit trail has entries", (await hr.locator("table.grid tbody tr").count()) > 5);

  // ---------------------------------------------------------------- Full profile (D1–D3) and later releases (R2/R3)
  const api = (page, q) => page.evaluate(async q => { const r = await fetch(`/api/hr?${q}`); return { status: r.status, body: await r.json() }; }, q);
  const sarahId = (await api(hr, "")).body.people.find(p => p.name === "Sarah Secretary").id;
  await nav(hr, "People");
  await hr.locator(".listrow:has-text('Sarah Secretary') button:has-text('Open file')").click();
  await hr.click('.tabs button:has-text("Personal")');
  await hr.waitForSelector("text=Identity, tax and banking");
  check("profile masks the ID number by default", (await hr.locator("dl.kv").last().textContent()).includes("•••") && !(await hr.textContent("main")).includes("8805120123087"));
  await hr.click('button:has-text("Show full numbers")');
  await hr.waitForSelector("text=8805120123087");
  check("HR can reveal the full ID number", true);
  await hr.click('.tabs button:has-text("Employment")');
  check("employment history shows the hire", await hr.isVisible("text=Joined as Legal Secretary"));
  const ivan = await as("ivan.phahle@demo.test");
  check("staff cannot open a colleague's profile", (await api(ivan, `view=profile&id=${sarahId}`)).status === 403);
  const robyn = await as("robyn.adams@demo.test");
  const mgrView = await api(robyn, `view=profile&id=${sarahId}`);
  check("manager sees the profile but no identity or banking details", mgrView.status === 200 && mgrView.body.sensitive === null && mgrView.body.documents.length === 0);

  // Requests: the manager approves overtime (E3).
  await nav(robyn, "Requests");
  await robyn.click('.tabs button:has-text("To action")');
  const ot = robyn.locator(".listrow:has-text('Overtime'):has-text('Sarah Secretary')");
  await ot.locator('button:has-text("Approve")').click();
  await robyn.waitForSelector(".listrow:has-text('Overtime'):has-text('Sarah Secretary') .badge:has-text('Approved')");
  check("manager approves an overtime request", true);

  // Reviews (H2/H3): manager feedback, then the employee sees the rating.
  await nav(robyn, "Performance");
  await robyn.locator("tr:has-text('Ivan Phahle') button:has-text('Open')").click();
  await robyn.fill("#managerFeedback", "Strong year; ready for arbitration work.");
  await robyn.selectOption("#rating", "4");
  await robyn.click('button:has-text("Submit feedback")');
  await robyn.waitForSelector("tr:has-text('Ivan Phahle') .badge:has-text('To acknowledge')");
  await ivan.reload(); await ivan.waitForSelector("nav button");
  await nav(ivan, "Performance");
  await ivan.locator("tr:has-text('Ivan Phahle') button").first().click();
  check("employee sees the manager's feedback after submission", await ivan.isVisible("text=ready for arbitration work"));

  // Letters (M2): a completed employment-letter request opens the generated letter.
  const tumelo = await as("tumelo.mootane@demo.test");
  await nav(tumelo, "Requests");
  await tumelo.locator(".listrow:has-text('Employment letter') button:has-text('Letter')").click();
  await tumelo.waitForSelector(".lettertext");
  check("generated letter confirms employment", (await tumelo.textContent(".lettertext")).includes("This confirms that Tumelo Mootane is employed"));

  // Offboarding (N2): the receiving colleague accepts a matter handover.
  const muano = await as("muano.ramurunzi@demo.test");
  await nav(muano, "Offboarding");
  await muano.locator(".listrow:has-text('Filing diary') button:has-text('Accept')").click();
  await muano.waitForSelector(".listrow:has-text('Filing diary') .badge:has-text('Accepted')");
  check("colleague accepts an offboarding handover", true);

  // Policies (G2/G3): acknowledge the current version.
  await nav(ivan, "Policies");
  const read = ivan.locator(".policy:has-text('Social media policy') button:text-is('Read')");
  if (await read.count()) await read.click();
  await ivan.waitForSelector('button:has-text("I have read and understood this policy"):not([disabled])');
  await ivan.click('button:has-text("I have read and understood this policy")');
  await ivan.waitForSelector(".policy:has-text('Social media policy') .badge:has-text('Acknowledged')");
  check("staff acknowledge a policy", true);

  // Confidential cases (L1): visible to the named officer only.
  await nav(hr, "HR cases");
  check("named officer sees the case", await hr.isVisible("text=grievance"));
  check("a manager cannot list HR cases", (await api(robyn, "view=cases")).status === 403 && !(await robyn.locator("nav button").allTextContents()).some(n => n.includes("HR cases")));

  // Credentials (F1/F2) and payroll changes (K2).
  await nav(hr, "Credentials");
  check("credentials register flags the lapsed FICA training", await hr.isVisible("tr:has-text('Pieter Paralegal') .badge:has-text('Lapsed')"));
  await nav(hr, "Reports");
  await hr.click('.card:has-text("Payroll changes") button:has-text("Show")');
  await hr.waitForSelector(".card:has-text('Payroll changes') table");
  check("payroll changes include reimbursements", (await hr.textContent(".card:has-text('Payroll changes') table")).includes("Reimbursement"));

  // U8 — calendar viewer sees availability only.
  const vw = await as("naledi.reception@demo.test");
  await vw.waitForSelector("text=Approved team leave");
  const navItems = await vw.locator("nav button").allTextContents();
  check("viewer sees only the team calendar and roster", navItems.length === 2 && navItems[0].includes("Team calendar") && navItems[1].includes("Roster"), navItems.join(","));
  check("viewer sees no leave types or reasons", !(await vw.locator("main").textContent()).includes("Year-end break"));
  await vw.screenshot({ path: "tests/e2e/calendar.png", fullPage: true });
  await nav(vw, "Roster");
  await vw.waitForSelector("table.roster");
  check("reception roster shows court attendance", await vw.isVisible("td.cell:has-text('Court')"));
} catch (e) {
  check("run completed without error", false, e.message.split("\n").slice(0, 4).join(" | "));
} finally {
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
