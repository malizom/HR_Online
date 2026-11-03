"use client";
// Home (doc 06 S2–S4), My profile (S11) and the team calendar (S10).
import { useId, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { BalanceCards } from "./Leave";
import { Badge, days, longDate, range, shortDate, type CalEntry, type HrData, type Post } from "./shared";

export function Home({ data, go }: { data: HrData; go: (page: string) => void }) {
  const { me, dashboard: d, team } = data;
  const today = data.today;
  const mine = data.leave.filter(l => l.owner === me.id);
  const next = mine.filter(l => ["approved", "pending_approval", "awaiting_cover"].includes(l.state) && l.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
  const coverAsks = data.leave.filter(l => l.actions.includes("accept_cover"));
  const handovers = mine.filter(l => l.actions.includes("confirm_handover"));
  const toAck = data.acknowledgements.filter(a => !a.acknowledgedAt);
  const tasks: [string, string][] = [
    ...toAck.map(a => [`Read and acknowledge your ${a.title.toLowerCase()}`, "My profile"] as [string, string]),
    ...coverAsks.map(l => [`${l.name} asked you to cover ${range(l.start, l.end)}`, "My leave"] as [string, string]),
    ...handovers.map(l => [`Confirm your handover to ${l.cover?.name} before ${longDate(l.start)}`, "My leave"] as [string, string]),
    ...(!data.emergencyContact ? [["Add an emergency contact", "My profile"] as [string, string]] : []),
    ...(me.status !== "Complete" ? [["Finish your onboarding", "Onboarding"] as [string, string]] : []),
  ];
  const tile = (label: string, value: number | string, page?: string, alert = false) => (
    <button className={"tile" + (alert ? " alert" : "")} key={label} onClick={() => page && go(page)} disabled={!page}><small>{label}</small><b>{value}</b></button>
  );
  return (<>
    {d && (<>
      <h2>Firm today</h2>
      <div className="tiles">
        {tile("Headcount", d.headcount, "People")}
        {tile("Away today", d.awayToday, "Team calendar")}
        {tile("Away this week", d.awayWeek, "Team calendar")}
        {tile("Leave awaiting decision", d.pendingApprovals, "Approvals", d.oldestPendingDays >= 3)}
        {tile("Onboarding to review", d.onboardingInReview, "People", d.onboardingInReview > 0)}
        {tile("Documents to review", d.documentsToReview, "Documents to review", d.documentsToReview > 0)}
        {tile("Handovers unconfirmed (7 days)", d.handoversUnconfirmed, "Approvals", d.handoversUnconfirmed > 0)}
        {tile("Email failures (7 days)", d.emailFailures, undefined, d.emailFailures > 0)}
      </div>
      {d.oldestPendingDays >= 3 && <div className="warn">The oldest leave request has waited {d.oldestPendingDays} days. Approvers get a reminder at 3 working days; HR is told at 5.</div>}
      {d.jobs?.length > 0 && <p className="muted-inline">Nightly jobs: {d.jobs.slice(0, 4).map((j: any) => `${j.key} ${j.status}`).join(" · ")}</p>}
    </>)}
    {team && me.role !== "admin" && (
      <div className="tiles">
        {tile("Approvals waiting", team.approvalsWaiting, "Approvals", team.oldestDays >= 3)}
        {tile("Team away this week", team.teamAwayThisWeek, "Team calendar")}
        {tile("Direct reports", team.teamSize)}
      </div>
    )}
    <h2>Your leave</h2>
    <BalanceCards balances={data.balances} />
    <div className="columns">
      <section className="card">
        <h3>Next leave</h3>
        {next ? <p><b>{next.type}</b> · {range(next.start, next.end)} · {days(next.days)} <Badge s={next.status} /></p> : <p>Nothing booked. <a onClick={() => go("My leave")}>Request leave</a></p>}
      </section>
      <section className="card">
        <h3>To do</h3>
        {tasks.length === 0 && <p>You’re all caught up.</p>}
        {tasks.map(([t, page]) => <div className="listrow" key={t}><span className="grow">{t}</span><button onClick={() => go(page)}>Open</button></div>)}
      </section>
    </div>
  </>);
}

export function Profile({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const { me } = data;
  const c = data.emergencyContact;
  return (<>
    <div className="columns">
      <section className="card">
        <h2>{me.name}</h2>
        <dl className="kv">
          <dt>Email</dt><dd>{me.email}</dd>
          <dt>Job title</dt><dd>{me.title || "—"}</dd>
          <dt>Department</dt><dd>{me.department || "—"}</dd>
          <dt>Reports to</dt><dd>{data.colleagues.find(x => x.id === me.reportsToId)?.name ?? "—"}</dd>
          <dt>Start date</dt><dd>{longDate(me.start)}</dd>
          <dt>Employee no.</dt><dd>{me.employeeNo || "—"}</dd>
        </dl>
        <p className="muted-inline">To change employment details, ask HR. Your personal details are edited in onboarding.</p>
        <a className="badge" href="/api/hr?view=myinfo"><Download size={13} /> Download my information (POPIA)</a>
      </section>
      <section className="card">
        <h3>Emergency contact</h3>
        <form onSubmit={async e => { e.preventDefault(); await post({ action: "contact", ...Object.fromEntries(new FormData(e.currentTarget)) }); }}>
          <label>Name<input name="name" required defaultValue={c?.name} /></label>
          <label>Relationship<input name="relationship" required defaultValue={c?.relationship} /></label>
          <label>Phone<input name="phone" type="tel" required defaultValue={c?.phone} /></label>
          <div className="formfooter"><span>Visible to you and HR.</span><button className="primary" disabled={busy}>Save contact</button></div>
        </form>
      </section>
    </div>
    <div className="card spaced">
      <h2>Documents to acknowledge</h2>
      {data.acknowledgements.length === 0 && <p>Nothing issued yet.</p>}
      {data.acknowledgements.map(a => (
        <div key={a.id} style={{ marginBottom: 18 }}>
          <div className="sectiontitle"><h3>{a.title}</h3><Badge s={a.acknowledgedAt ? "Acknowledged" : "Not acknowledged"} /></div>
          <div className="particulars">{a.text}</div>
          {a.acknowledgedAt ? <p className="muted-inline">Acknowledged {new Date(a.acknowledgedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}.</p>
            : <div className="formfooter"><span>Issued {shortDate(a.issuedAt)}. Acknowledging records that you received and read it.</span>
                <button className="primary" disabled={busy} onClick={() => post({ action: "acknowledge", id: a.id })}>I have read and received this</button></div>}
        </div>
      ))}
    </div>
  </>);
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function LeaveCalendar({ entries, today, holidays, closures }: { entries: CalEntry[]; today: string; holidays: { date: string; name: string }[]; closures: { name: string; start: string; end: string }[] }) {
  const id = useId();
  const t = new Date(`${today}T00:00:00Z`);
  const [view, setView] = useState({ year: t.getUTCFullYear(), month: t.getUTCMonth() });
  const first = new Date(Date.UTC(view.year, view.month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const label = new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const shift = (n: number) => { const d = new Date(Date.UTC(view.year, view.month + n, 1)); setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() }); };
  const hol = new Map(holidays.map(h => [h.date, h.name]));
  return (
    <section className="mvr-calendar card" aria-labelledby={id}>
      <div className="mvr-calendar-header">
        <div><h2 id={id} aria-live="polite">{label}</h2><p>Approved team leave, public holidays and firm closures</p></div>
        <div className="mvr-calendar-controls">
          <button type="button" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={17} /></button>
          <button type="button" onClick={() => setView({ year: t.getUTCFullYear(), month: t.getUTCMonth() })}>Today</button>
          <button type="button" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={17} /></button>
        </div>
      </div>
      <div className="mvr-calendar-scroll" tabIndex={0} aria-label="Monthly leave calendar; scroll horizontally on small screens">
        <table className="mvr-calendar-table" aria-label={`Team leave in ${label}`}>
          <thead><tr>{DAYS.map(d => <th scope="col" key={d}>{d}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: weeks }, (_, w) => (
              <tr key={w}>
                {Array.from({ length: 7 }, (_, d) => {
                  const date = new Date(Date.UTC(view.year, view.month, w * 7 + d - offset + 1));
                  const key = iso(date);
                  const outside = date.getUTCMonth() !== view.month;
                  const onLeave = entries.filter(e => e.start <= key && e.end >= key).sort((a, b) => a.name.localeCompare(b.name));
                  const closure = closures.find(c => c.start <= key && c.end >= key);
                  return (
                    <td key={key} className={`${outside ? "mvr-calendar-outside" : ""} ${d > 4 ? "mvr-calendar-weekend" : ""} ${hol.has(key) ? "cal-holiday" : ""} ${closure ? "cal-closure" : ""}`}>
                      <time dateTime={key} aria-current={key === today ? "date" : undefined} className={key === today ? "mvr-calendar-today" : ""}>{date.getUTCDate()}</time>
                      {hol.has(key) && <span className="cal-tag">{hol.get(key)}</span>}
                      {closure && <span className="cal-tag closure">{closure.name}</span>}
                      {onLeave.length > 0 && <ul>{onLeave.map(e => <li key={e.id} title={`${e.name} · ${e.start} to ${e.end}`}><span aria-hidden="true" />{e.name}</li>)}</ul>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mvr-calendar-key"><span aria-hidden="true" /> On leave <small>Dates are inclusive. Leave types and reasons are hidden.</small></div>
    </section>
  );
}

export function TeamCalendar({ data }: { data: HrData }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const cal = data.calendar, today = data.today;
  const awayNow = cal.filter(e => e.start <= today && e.end >= today);
  const upcoming = cal.filter(e => e.start > today).sort((a, b) => a.start.localeCompare(b.start));
  return (<>
    <div className="stats">
      <div className="card"><small>ON LEAVE TODAY</small><h2>{awayNow.length}</h2></div>
      <div className="card"><small>COMING UP</small><h2>{upcoming.length}</h2></div>
      <div className="card"><small>VISIBILITY</small><h3>Approved leave only</h3><p>Leave types and reasons stay private.</p></div>
    </div>
    <LeaveCalendar entries={cal} today={today} holidays={data.holidays} closures={data.closures} />
    <div className="card">
      <div className="sectiontitle">
        <h2>Team availability</h2>
        <select aria-label="Filter leave" value={filter} onChange={e => setFilter(e.target.value)}>{["All", "Away now", "Upcoming"].map(o => <option key={o}>{o}</option>)}</select>
      </div>
      <input className="search" placeholder="Search a team member…" value={search} onChange={e => setSearch(e.target.value)} />
      {(filter === "Away now" ? awayNow : filter === "Upcoming" ? upcoming : [...awayNow, ...upcoming]).filter(e => e.name.toLowerCase().includes(search.toLowerCase())).map(e => (
        <div className="listrow" key={e.id}><div className="avatar">{e.name[0]}</div><b className="grow">{e.name}</b><span>{range(e.start, e.end)}</span><Badge s={e.start <= today ? "Away now" : "Upcoming"} /></div>
      ))}
      {cal.length === 0 && <div className="empty"><CalendarDays size={35} /><h3>A clear calendar, for now.</h3><p>Approved leave will appear here.</p></div>}
    </div>
  </>);
}
