// End-to-end smoke through the real UI on the seeded demo firm (doc 09 will grow this into the UAT script).
// Requires: dev server on :3000 with DEV_LOGIN=true and the demo seed. Usage: npm run test:e2e
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://demo.localhost:3000";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };
const browser = await chromium.launch();

async function as(email) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signin`);
  await page.fill('input[name="email"]', email);
  await page.click('button:has-text("Sign in (dev)")');
  await page.waitForSelector("text=PEOPLE PORTAL", { timeout: 30000 });
  return page;
}
const nav = (page, label) => page.click(`nav button:has-text("${label}")`);
const pdf = { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") };

try {
  // 1. Unknown host resolves to no workspace (tenant resolution by host).
  {
    const p = await (await browser.newContext()).newPage();
    await p.goto(BASE.replace("demo.localhost", "nobody.localhost"));
    check("unknown host shows 'No workspace here'", await p.isVisible("text=No workspace here"));
  }

  // 2. HR admin onboards herself (sole-admin bootstrap) and adds a new starter into the organogram.
  const hr = await as("hr@demo.test");
  await hr.fill('input[name="title"]', "Office Manager");
  await hr.fill('input[name="start"]', "2024-01-15");
  await hr.click('button:has-text("Save & continue")');
  await hr.waitForSelector("text=Your required documents");
  await hr.setInputFiles('input[aria-label="Upload Full personal CV"]', pdf);
  await hr.waitForSelector("a:has-text('cv.pdf')");
  await hr.click('button:has-text("Continue")');
  await hr.click('button:has-text("Submit onboarding for review")');
  await hr.waitForSelector(".badge:has-text('In review')");
  await nav(hr, "Staff directory");
  await hr.click('button:has-text("Complete onboarding")');
  await hr.waitForTimeout(800);
  check("admin completes onboarding", (await hr.locator(".listrow:has-text('hr@demo.test') .badge").textContent()) === "Complete");

  await hr.click('button:has-text("Add staff member")');
  await hr.fill('.modal input[name="name"]', "Zola Newhire");
  await hr.fill('.modal input[name="email"]', "zola.newhire@demo.test");
  await hr.selectOption('.modal select[name="reportsToId"]', { label: "Lindiwe Litigator — Director: Litigation" });
  await hr.click('.modal button:has-text("Add staff member")');
  await hr.waitForSelector(".listrow:has-text('Zola Newhire')");
  check("new starter added under Lindiwe", (await hr.locator(".listrow:has-text('Zola Newhire') small").textContent()).includes("reports to Lindiwe Litigator"));

  await nav(hr, "Document review");
  await hr.click('.listrow:has-text("cv.pdf") button:has-text("Verify")');
  await hr.waitForSelector(".badge.green:has-text('Verified')");
  check("HR verifies a document", true);

  // 3. Ayanda (reports to Lindiwe) requests leave; it routes to Lindiwe, not to Johan, not to herself.
  const ay = await as("ayanda.associate@demo.test");
  await nav(ay, "Leave requests");
  await ay.selectOption('select[name="type"]', "annual");
  await ay.fill('input[name="start"]', "2027-03-01");
  await ay.fill('input[name="end"]', "2027-03-05");
  await ay.click('button:has-text("Submit request")');
  await ay.waitForSelector(".listrow:has-text('Pending')");
  check("requester cannot approve own leave", (await ay.locator('.listrow button:has-text("Approve")').count()) === 0);

  const jo = await as("johan.conveyancer@demo.test");
  await nav(jo, "Leave requests");
  check("another manager cannot see or approve it", (await jo.locator(".listrow:has-text('Ayanda')").count()) === 0);

  const li = await as("lindiwe.litigator@demo.test");
  await nav(li, "Leave requests");
  check("manager sees the 'you approve for N people' note", await li.isVisible("text=who report to you"));
  await li.click('.listrow:has-text("Ayanda") button:has-text("Approve")');
  await li.waitForSelector(".listrow:has-text('Ayanda') .badge.green:has-text('Approved')");
  check("manager approves direct report", true);

  // 4. Director (top of tree) routes to HR admin via the explicit route.
  const md = await as("mpho.director@demo.test");
  await nav(md, "Leave requests");
  await md.selectOption('select[name="type"]', "annual");
  await md.fill('input[name="start"]', "2027-04-05");
  await md.fill('input[name="end"]', "2027-04-09");
  await md.click('button:has-text("Submit request")');
  await md.waitForSelector(".listrow:has-text('Pending')");
  await hr.reload(); await hr.waitForSelector("text=PEOPLE PORTAL");
  await nav(hr, "Leave requests");
  await hr.click('.listrow:has-text("Mpho") button:has-text("Approve")');
  await hr.waitForSelector(".listrow:has-text('Mpho') .badge.green:has-text('Approved')");
  check("director's leave routed to and approved by HR admin", true);

  // 5. Calendar viewer sees availability only.
  const vw = await as("naledi.reception@demo.test");
  await vw.waitForSelector("text=Approved team leave");
  const navItems = await vw.locator("nav button").allTextContents();
  check("viewer sees only the team calendar", navItems.length === 1 && navItems[0].includes("Team calendar"), navItems.join(","));
  await vw.click('button[aria-label="Next month"]');
  await vw.selectOption('select[aria-label="Filter leave"]', "All");
  const names = await vw.locator(".listrow b.grow").allTextContents();
  check("calendar lists approved leave", names.some(n => n.includes("Ayanda")) && names.some(n => n.includes("Mpho")), names.join(", "));
  await vw.screenshot({ path: "tests/e2e/calendar.png", fullPage: true });
} catch (e) {
  check("run completed without error", false, e.message);
} finally {
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
