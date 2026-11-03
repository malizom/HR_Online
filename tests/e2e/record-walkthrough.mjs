// Records a captioned walkthrough of the demo firm, one segment per role, for live demos and sharing.
// Requires: fresh seed (npm run db:reset) and a dev server with DEMO_FIRMS=demo DEMO_ACCESS_CODE=<code> DEV_LOGIN=false.
// Usage: node tests/e2e/record-walkthrough.mjs <access-code> <out-dir>
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://demo.localhost:3000";
const CODE = process.argv[2];
const OUT = process.argv[3] ?? "/tmp/walkthrough";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const segments = [];

const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date()) + "T00:00:00Z");
const monday = n => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + 7 * n - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const plus = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// A leave window that contains a public holiday: the week of 16 December if it is ahead, else 10 weeks out.
const holidayWeek = (() => { const y = today.getUTCFullYear(); const d = new Date(Date.UTC(y, 11, 16)); const wk = new Date(d); wk.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return wk > new Date(today.getTime() + 14 * 864e5) ? wk.toISOString().slice(0, 10) : monday(10); })();

async function caption(page, title, text, ms = 3500) {
  await page.evaluate(([t, x]) => {
    let el = document.getElementById("__cap");
    if (!el) { el = document.createElement("div"); el.id = "__cap"; document.body.appendChild(el);
      el.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;max-width:min(860px,92vw);background:rgba(24,63,50,.94);color:#fff;padding:12px 18px;border-radius:10px;font:14px/1.45 'DM Sans',Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none"; }
    el.innerHTML = `<b style="display:block;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;opacity:.75;margin-bottom:2px">${t}</b>${x}`;
  }, [title, text]);
  await page.waitForTimeout(ms);
}
const hide = page => page.evaluate(() => document.getElementById("__cap")?.remove());

let order = 0;
async function segment(name, viewport, fn) {
  order++;
  if (process.env.ONLY && process.env.ONLY !== name) return;
  const ctx = await browser.newContext({ viewport, recordVideo: { dir: `${OUT}/raw`, size: viewport }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try { await fn(page); } catch (e) { console.error(`segment ${name} failed:`, e.message.split("\n")[0]); await page.screenshot({ path: `${OUT}/${name}-error.png` }); }
  const video = page.video();
  await ctx.close();
  const path = `${OUT}/${String(order).padStart(2, "0")}-${name}.webm`;
  await video.saveAs(path);
  segments.push(path);
  console.log("recorded", path);
}

async function signInAs(page, name, showPicker = false) {
  await page.goto(`${BASE}/signin`);
  await page.waitForSelector(".persona");
  if (showPicker) {
    await caption(page, "Demo sign-in", "Names come from MVR’s public team page; every leave record, document and figure is invented. In production, staff sign in with their MVR Microsoft 365 account.", 6000);
  }
  await page.fill('input[name="code"]', CODE);
  await page.click(`.persona:has-text("${name}")`);
  await page.waitForSelector("nav button", { timeout: 90000 });
  await page.waitForTimeout(800);
}
const nav = async (page, label) => { await page.click(`nav button:has-text("${label}")`); await page.waitForTimeout(900); };
const scrollTo = async (page, selector) => { await page.locator(selector).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(500); };

const desk = { width: 1280, height: 800 };

// 1 — HR administrator
await segment("tamlyn-hr", desk, async page => {
  await signInAs(page, "Tamlyn Hulley", true);
  await caption(page, "Tamlyn Hulley · HR administrator", "Her home page shows the firm today: who is away, what is waiting for a decision, onboarding and documents to review.", 5500);
  await nav(page, "People");
  await caption(page, "People", "The staff directory. Leave is approved by whoever each person reports to — there is no separate approver role.", 4500);
  await page.click('.tabs button:has-text("Organogram")'); await page.waitForTimeout(700);
  await caption(page, "Organogram", "Matodzi at the top, the executives below, associates and candidate attorneys under their executive. Changing a reporting line changes who approves.", 5500);
  await page.click('.tabs button:has-text("Directory")');
  await page.click('.listrow:has-text("Ivan Phahle") button:has-text("Open file")'); await page.waitForSelector(".panel h3");
  await caption(page, "Person file", "Employment details, reporting line, fee-earner flag, leave balances with a full statement, written particulars and exit.", 5000);
  await page.locator(".panel").evaluate(el => el.scrollBy({ top: 700, behavior: "smooth" })); await page.waitForTimeout(1500);
  await page.click('.panel button[aria-label="Close"]');
  await nav(page, "Settings");
  await caption(page, "Leave policies", "BCEA defaults: 15 days annual accrued monthly, 30 days sick per 36 months, 3 days family responsibility. A change is a new version from a date — no code.", 6000);
  await page.click('.tabs button:has-text("Holidays & closures")');
  const d = page.locator('.card:has-text("Firm closure") input[type="date"]');
  await d.nth(0).fill(`${today.getUTCFullYear()}-12-24`); await d.nth(1).fill(`${today.getUTCFullYear() + 1}-01-01`);
  await page.click('button:has-text("Preview impact")'); await page.waitForTimeout(1500);
  await caption(page, "December shutdown", "Preview shows the working days each person would lose — public holidays and weekends are excluded automatically. Nothing is deducted until HR applies it.", 6000);
  await nav(page, "Reports");
  await page.waitForSelector("text=Balances today");
  await caption(page, "Reports", "Leave by month and type, balances for everyone, headcount — and the payroll leave export for Sage, keyed on employee number.", 5000);
  await scrollTo(page, "text=Payroll leave export");
  await caption(page, "Sage export", "One CSV per pay period. Leave cancelled after approval comes through as a negative line so payroll can reverse it.", 4500);
});

// 2 — Associate requests leave with matter cover
await segment("ivan-request", desk, async page => {
  await signInAs(page, "Ivan Phahle");
  await nav(page, "My leave");
  await caption(page, "Ivan Phahle · Associate", "Balances show what he has earned so far and what he will have by the end of his leave cycle. Each card opens a line-by-line statement.", 5000);
  await page.click('.balance:has-text("Annual") summary'); await page.waitForTimeout(1200);
  await page.click('.balance:has-text("Annual") summary');
  await page.fill('input[type="date"] >> nth=0', holidayWeek);
  await page.fill('input[type="date"] >> nth=1', plus(holidayWeek, 4));
  await page.waitForSelector(".preview .total"); await page.click(".preview details summary");
  await scrollTo(page, ".preview");
  await caption(page, "Live preview", "Before he submits, he sees the working days, any public holiday excluded, and his balance before and after. Over-balance requests are refused with the shortfall offered as unpaid.", 6500);
  await scrollTo(page, "text=Matter cover while you are away");
  await caption(page, "Matter cover", "Fee-earners must arrange cover first. He picks a colleague and lists court dates and deadlines that fall inside his leave.", 4500);
  await page.selectOption('select:has(option:text("Choose a colleague…"))', { label: "Muano Ramurunzi — Dispute Resolution" });
  await page.click('button:has-text("Add a matter item")');
  await page.fill('input[aria-label="Matter reference"]', "LIT/2026/104");
  await page.fill('input[aria-label="When"]', `${plus(holidayWeek, 1)}T09:30`);
  await page.fill('input[aria-label="Location"]', "Johannesburg High Court");
  await page.waitForTimeout(800);
  await page.click('button:has-text("Submit request")');
  await page.waitForSelector("text=Request sent");
  await scrollTo(page, ".approval:has-text('Awaiting cover')");
  await caption(page, "Submitted", "The request goes to Muano first. Only once he accepts does it reach Ivan’s manager, Robyn. The days are held so they can’t be booked twice.", 5500);
});

// 3 — Candidate attorney accepts cover
await segment("muano-cover", desk, async page => {
  await signInAs(page, "Muano Ramurunzi");
  await nav(page, "My leave");
  await scrollTo(page, ".approval:has-text('LIT/2026/104')");
  await caption(page, "Muano Ramurunzi · Candidate Attorney", "He sees exactly what he is covering: the matter, the court date and where. He can accept, or decline with a reason so Ivan can ask someone else.", 5500);
  await page.locator(".approval:has-text('LIT/2026/104') button:has-text('Accept cover')").click();
  await page.waitForTimeout(1500);
  await caption(page, "Cover accepted", "The request now moves to Robyn for approval.", 3000);
});

// 4 — Executive approves
await segment("robyn-approve", desk, async page => {
  await signInAs(page, "Robyn Adams");
  await caption(page, "Robyn Adams · Executive: Dispute Resolution", "Her home page shows approvals waiting and who in her team is away this week.", 4000);
  await nav(page, "Approvals");
  await caption(page, "One card, one decision", "Dates, working days, balance after, whether others in the team are away, cover accepted, matters handed over — everything needed to decide, on a phone if need be.", 6500);
  await scrollTo(page, ".approval:has-text('Sick'):has-text('Sarah')");
  await caption(page, "Sick-note rule (BCEA s23)", "Three consecutive sick days need a medical certificate before approval. The manager sees ‘received’ — never the certificate itself; only HR can open it. (Sarah is a fictional staff member.)", 6500);
  await scrollTo(page, ".approval:has-text('LIT/2026/104')");
  await page.locator(".approval:has-text('LIT/2026/104') button:has-text('Approve')").click();
  await page.waitForTimeout(1500);
  await scrollTo(page, "text=Delegate approvals");
  await caption(page, "Approved — and delegation", "Ivan and Muano are notified and the leave appears on the team calendar. Going away? Robyn can hand her approvals to a colleague for a date range.", 6000);
});

// 5 — Requester confirms handover
await segment("ivan-handover", desk, async page => {
  await signInAs(page, "Ivan Phahle");
  await nav(page, "My leave");
  await caption(page, "Before he goes", "Two working days before his leave, Ivan is reminded to confirm the handover. His balance has dropped by the approved days.", 5000);
  await scrollTo(page, "button:has-text('Confirm handover to Muano')");
  await page.click("button:has-text('Confirm handover to Muano')"); await page.waitForTimeout(1500);
  await caption(page, "Handover confirmed", "Muano then confirms receipt. Approvers see any unconfirmed handovers on their dashboard. Cancelling approved leave returns the days automatically.", 5500);
});

// 6 — Phone view
await segment("phone", { width: 390, height: 844 }, async page => {
  await signInAs(page, "Matodzi Ratshimbilani");
  await caption(page, "On a phone", "Most requests and approvals will happen on a phone. Matodzi, at the top of the organogram, is approved by HR through an explicit route.", 5000);
  await nav(page, "My leave");
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 900); await page.waitForTimeout(2000);
});

// 7 — Calendar viewer
await segment("naledi-calendar", desk, async page => {
  await signInAs(page, "Naledi Reception");
  await caption(page, "Reception · calendar only", "Reception sees who is away and when — public holidays and closures shaded — but never leave types or reasons. (Naledi is fictional.)", 6000);
  await page.click('button[aria-label="Next month"]'); await page.waitForTimeout(2500);
});

// 8 — HR closes the loop
await segment("tamlyn-close", desk, async page => {
  await signInAs(page, "Tamlyn Hulley");
  await nav(page, "Approvals");
  await scrollTo(page, ".approval:has-text('Matodzi')");
  await caption(page, "Approving the MD", "Nobody approves their own leave. The MD’s requests come to HR.", 4000);
  await page.locator(".approval:has-text('Matodzi') button:has-text('Approve')").first().click(); await page.waitForTimeout(1200);
  await nav(page, "Audit");
  await caption(page, "Audit trail", "Every action — who, what, when — is recorded and cannot be edited. Personal information stays in South Africa and staff can download their own data (POPIA).", 6500);
  await hide(page);
  await page.waitForTimeout(800);
});

await browser.close();
fs.writeFileSync(`${OUT}/segments.txt`, segments.map(s => `file '${s}'`).join("\n") + "\n");
console.log("done", segments.length);
