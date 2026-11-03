// MVR Attorneys | People & Leave — portal UI (ported from v1, no ChatGPT dependency)
// Reconstructed (de-minified, 1:1 behaviour) from page-BAgstXEu.js at
// https://firm-people-hr-leave.malizo-magangane.chatgpt.site
// The server route /api/hr (GET data, POST actions, ?file= download) is not
// retrievable from the browser; its contract is documented in README.md.

"use client";
import { useEffect, useId, useState } from "react";
import {
  ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock,
  FolderCheck, LayoutDashboard, Plus, Scale, ShieldCheck, Upload,
  UserRoundPlus, Users,
} from "lucide-react";

type Role = "admin" | "approver" | "staff" | "viewer";
type Person = {
  id: string; owner: string; name: string; email: string; role: Role;
  status: "Draft" | "In review" | "Complete"; admitted: boolean;
  phone?: string; title?: string; department?: string; start?: string;
};
type Doc = { id: string; owner: string; category: string; name: string; status: "Pending" | "Verified" | "Rejected" };
type Leave = {
  id: string; owner: string; name: string; type: string; start: string; end: string;
  note?: string; status: "Pending" | "Approved" | "Declined" | "Cancelled";
};
type CalEntry = { id: string; name: string; start: string; end: string };
type HrData = { me: Person; people: Person[]; documents: Doc[]; leave: Leave[]; calendar: CalEntry[]; today: string };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

/* ---------- Team leave calendar (month grid, Monday-first, en-ZA) ---------- */
function LeaveCalendar({ entries, today }: { entries: CalEntry[]; today: string }) {
  const id = useId();
  const t = parse(today);
  const [view, setView] = useState({ year: t.getUTCFullYear(), month: t.getUTCMonth() });
  const first = new Date(Date.UTC(view.year, view.month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const label = new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(view.year, view.month + n, 1));
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  };
  return (
    <section className="mvr-calendar card" aria-labelledby={id}>
      <div className="mvr-calendar-header">
        <div><h2 id={id} aria-live="polite">{label}</h2><p>Approved team leave</p></div>
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
                  return (
                    <td key={key} className={`${outside ? "mvr-calendar-outside" : ""} ${d > 4 ? "mvr-calendar-weekend" : ""}`}>
                      <time dateTime={key} aria-current={key === today ? "date" : undefined} className={key === today ? "mvr-calendar-today" : ""}>{date.getUTCDate()}</time>
                      {onLeave.length > 0 && (
                        <ul>{onLeave.map(e => <li key={e.id} title={`${e.name} · ${e.start} to ${e.end}`}><span aria-hidden="true" />{e.name}</li>)}</ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mvr-calendar-key"><span aria-hidden="true" /> On leave <small>Dates are inclusive. Personal leave reasons are hidden.</small></div>
    </section>
  );
}

/* ---------- Required document categories ---------- */
const DOC_CATEGORIES: [string, string, string][] = [
  ["CV", "Full personal CV", "Your complete professional history."],
  ["ID", "Identity document", "A clear, legible copy of your ID."],
  ["Banking", "Proof of banking details", "Bank confirmation or proof of account."],
  ["Qualifications", "Qualifications & admission", "All qualifications, including admission documents."],
  ["LPC", "LPC registration", "Required for already admitted attorneys."],
];

const DEPARTMENTS = ["Legal", "Litigation", "Conveyancing", "Commercial", "Finance", "Administration", "Support"];
const LEAVE_TYPES = ["Annual", "Sick", "Family responsibility", "Unpaid", "Other"];

export default function PeoplePortal() {
  const [data, setData] = useState<HrData | null>(null);
  const [page, setPage] = useState("Onboarding");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");

  async function load() {
    const r = await fetch("/api/hr"); const j = await r.json();
    if (!r.ok) { setError(j.error); return; }
    setData(j);
    if (j.me.role === "viewer") setPage("Team calendar");
  }
  useEffect(() => { load().catch(() => setError("Unable to connect. Please reload.")); }, []);

  async function post(body: FormData | Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/hr", {
        method: "POST",
        headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await load(); return true;
    } catch (e: any) { setError(e.message); return false; }
    finally { setBusy(false); }
  }

  const me = data?.me;
  const isAdmin = me?.role === "admin";
  const canApprove = isAdmin || me?.role === "approver";
  const isViewer = me?.role === "viewer";
  const docs = data?.documents || [];
  const myDocs = docs.filter(d => d.owner === me?.id);
  const required = DOC_CATEGORIES.filter(c => c[0] !== "LPC" || me?.admitted);
  const ready = required.filter(c => myDocs.some(d => d.category === c[0] && d.status !== "Rejected")).length;
  const cal = data?.calendar || [];
  const today = data?.today || iso(new Date());
  const awayNow = cal.filter(e => e.start <= today && e.end >= today);
  const upcoming = cal.filter(e => e.start > today).sort((a, b) => a.start.localeCompare(b.start));

  const nav: [string, any][] = isViewer
    ? [["Team calendar", CalendarDays]]
    : [["Overview", LayoutDashboard], ["Onboarding", UserRoundPlus], ["Leave requests", Clock], ["Team calendar", CalendarDays],
       ...(isAdmin ? ([["Staff directory", Users], ["Document review", FolderCheck]] as [string, any][]) : [])];

  const badge = (s: string) => (
    <span className={"badge " + (["Verified", "Approved", "Complete"].includes(s) ? "green" : ["Rejected", "Declined"].includes(s) ? "red" : "")}>{s}</span>
  );
  const field = (name: string, label: string, type = "text", def = "", req = false) => (
    <label>{label}<input name={name} type={type} defaultValue={def} required={req} /></label>
  );

  return (
    <div className="shell">
      {/* ---------- Sidebar ---------- */}
      <aside>
        <div className="brand"><Scale size={31} /><div>MVR<span>ATTORNEYS</span></div></div>
        <div className="workspace">PEOPLE &amp; CULTURE</div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button key={name} className={page === name ? "active" : ""} onClick={() => { setPage(name); setError(""); }}>
              <Icon size={18} />{name}{name === "Onboarding" && <span className="dot" />}
            </button>
          ))}
        </nav>
        <div className="asidebottom"><ShieldCheck size={22} /><b>A place for your people.</b><p>One home for every step of your journey at MVR.</p></div>
        <div className="account">
          <div className="avatar">{me?.name?.slice(0, 1) || "M"}</div>
          <div><b>{me?.name || "MVR team"}</b><small>{me?.role === "admin" ? "HR administrator" : me?.role || "Staff portal"}</small>
            <small><a href="/api/auth/signout">Sign out</a></small></div>
        </div>
      </aside>

      <section className="main">
        <header>
          <span>Workspace <ChevronRight size={14} /> <b>{page}</b></span>
          <div><span className="private"><ShieldCheck size={14} /> Private workspace</span><div className="avatar small">M</div></div>
        </header>

        <main>
          <div className="eyebrow">MVR ATTORNEYS / PEOPLE PORTAL</div>
          <div className="title">
            <div>
              <h1>{page === "Onboarding" ? "A great start begins here." : page === "Overview" ? "Your people, at a glance." : page}</h1>
              <p>{page === "Onboarding" ? "Welcome to MVR. Let’s get you settled in and ready for what’s next."
                 : page === "Team calendar" ? "Plan with confidence. See who’s away and what’s coming up."
                 : "Keep your team connected, organised and ready."}</p>
            </div>
            {isAdmin && page === "Staff directory" && (
              <button className="primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Add staff member</button>
            )}
          </div>

          {error && (
            <div role="alert" className="error">{error}{!data && <a href="/signin"> Sign in</a>}</div>
          )}

          {data && me ? (<>
            {/* ---------- ONBOARDING (3-step wizard) ---------- */}
            {page === "Onboarding" && (<>
              <div className="welcome">
                <div>
                  <div className="eyebrow">YOUR NEXT CHAPTER</div>
                  <h2>Welcome to the team.</h2>
                  <p>A few details today. A smoother journey ahead.</p>
                  <span>{badge(me.status)} <span className="subtle"> Your information is visible to you and HR.</span></span>
                </div>
                <div className="progresscircle"><b>{Math.round(ready / required.length * 100)}%</b><small>documents ready</small></div>
              </div>

              <div className="steps">
                {["Your details", "Your documents", "HR review"].map((s, i) => (
                  <button key={s} className={step === i + 1 ? "selected" : ""} onClick={() => setStep(i + 1)}>
                    <span>{i + 1}</span>
                    <div><b>{s}</b><small>{["Tell us about yourself", "Build your staff file", "Ready for a fresh start"][i]}</small></div>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>

              <div className="columns">
                <section className="card">
                  {step === 1 ? (<>
                    <div className="sectiontitle"><h2>Your personal &amp; employment details</h2><span>STEP 01 / 03</span></div>
                    <p className="muted">Check your details before moving on to your documents.</p>
                    <form key={me.id} onSubmit={async e => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      if (await post({ action: "profile", ...Object.fromEntries(fd), admitted: fd.get("admitted") === "on" })) setStep(2);
                    }}>
                      <div className="formgrid">
                        {field("name", "Full name", "text", me.name, true)}
                        {field("phone", "Contact number", "tel", me.phone)}
                        {field("title", "Job title", "text", me.title, true)}
                        <label>Department
                          <select name="department" defaultValue={me.department || "Legal"}>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select>
                        </label>
                        {field("start", "Employment start date", "date", me.start, true)}
                        <label>Email address<input value={me.email} disabled readOnly /></label>
                      </div>
                      <label className="check"><input type="checkbox" name="admitted" defaultChecked={me.admitted} /> I am an admitted attorney</label>
                      <div className="formfooter">
                        <span>All staff levels complete onboarding.</span>
                        <button disabled={busy || isViewer} className="primary">Save &amp; continue <ChevronRight size={16} /></button>
                      </div>
                    </form>
                  </>) : step === 2 ? (<>
                    <div className="sectiontitle"><h2>Your required documents</h2><span>{ready} OF {required.length} READY</span></div>
                    <p className="muted">Upload clear copies. PDF, JPG or PNG · Up to 10 MB each.</p>
                    {required.map(([cat, label, desc]) => (
                      <div className="docrow" key={cat}>
                        <div className="docicon"><FolderCheck size={21} /></div>
                        <div className="grow">
                          <b>{label}</b><p>{desc}</p>
                          {myDocs.filter(d => d.category === cat).map(d => (
                            <div className="file" key={d.id}><a href={"/api/hr?file=" + d.id}>{d.name}</a>{badge(d.status)}</div>
                          ))}
                        </div>
                        <label className="upload"><Upload size={16} /> Upload
                          <input aria-label={"Upload " + label} type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy || isViewer}
                            onChange={ev => {
                              const f = ev.target.files?.[0];
                              if (f) { const fd = new FormData(); fd.set("file", f); fd.set("category", cat); post(fd); }
                              ev.target.value = "";
                            }} />
                        </label>
                      </div>
                    ))}
                    <div className="formfooter">
                      <span>Keep originals available for HR verification.</span>
                      <button className="primary" onClick={() => setStep(3)}>Continue <ChevronRight size={16} /></button>
                    </div>
                  </>) : (<>
                    <h2>Ready for HR review</h2>
                    <p>HR will check your details and verify each required document before completing your onboarding.</p>
                    <div className="reviewsummary"><Check /> {ready} of {required.length} document categories submitted</div>
                    <p>{badge(me.status)}</p>
                    <button className="primary" disabled={busy || ["In review", "Complete"].includes(me.status) || isViewer}
                      onClick={() => post({ action: "submit" })}>Submit onboarding for review <ArrowUpRight size={16} /></button>
                  </>)}
                </section>

                <section className="rightcol">
                  <div className="card">
                    <div className="miniicon"><ShieldCheck size={22} /></div>
                    <h3>Your onboarding checklist</h3>
                    {["Personal & employment details", "Full personal CV", "Clear copy of ID", "Proof of banking details", "Qualifications & admission", ...(me.admitted ? ["LPC registration"] : [])].map((item, i) => (
                      <div className="checklist" key={item}>
                        <span className={i === 0 ? (me.title ? "done" : "") : (myDocs.some(d => d.category === required[i - 1]?.[0] && d.status !== "Rejected") ? "done" : "")}><Check size={12} /></span>{item}
                      </div>
                    ))}
                  </div>
                  <div className="note">
                    <b>A note on your documents</b>
                    <p>All staff submit the core documents. Already admitted attorneys also submit their LPC registration.</p>
                    <small>Only you and HR can access your staff documents.</small>
                  </div>
                </section>
              </div>
            </>)}

            {/* ---------- OVERVIEW ---------- */}
            {page === "Overview" && (<>
              <div className="stats">
                {([[awayNow.length, "On leave today"], [upcoming.length, "Upcoming leave"], [data.leave.filter(l => l.status === "Pending").length, "Pending requests"], [me.status, "Your onboarding"]] as [any, string][]).map(([v, l]) => (
                  <div className="card" key={l}><small>{l}</small><h2>{v}</h2></div>
                ))}
              </div>
              <div className="card">
                <h2>Start with a complete staff file</h2>
                <p>Complete your onboarding before submitting leave requests.</p>
                <button className="primary" onClick={() => setPage("Onboarding")}>Continue onboarding <ArrowUpRight size={16} /></button>
              </div>
            </>)}

            {/* ---------- TEAM CALENDAR ---------- */}
            {page === "Team calendar" && (<>
              <div className="stats">
                <div className="card"><small>ON LEAVE TODAY</small><h2>{awayNow.length}</h2></div>
                <div className="card"><small>COMING UP</small><h2>{upcoming.length}</h2></div>
                <div className="card"><small>VISIBILITY</small><h3>Approved leave only</h3><p>Leave reasons stay private.</p></div>
              </div>
              <LeaveCalendar entries={cal} today={today} />
              <div className="card">
                <div className="sectiontitle">
                  <h2>Team availability</h2>
                  <select aria-label="Filter leave" value={filter} onChange={e => setFilter(e.target.value)}>{["All", "Away now", "Upcoming"].map(o => <option key={o}>{o}</option>)}</select>
                </div>
                <input className="search" placeholder="Search a team member…" value={search} onChange={e => setSearch(e.target.value)} />
                {(filter === "Away now" ? awayNow : filter === "Upcoming" ? upcoming : [...awayNow, ...upcoming])
                  .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
                  .map(e => (
                    <div className="listrow" key={e.id}>
                      <div className="avatar">{e.name[0]}</div><b className="grow">{e.name}</b>
                      <span>{e.start} → {e.end}</span>{badge(e.start <= today ? "Away now" : "Upcoming")}
                    </div>
                  ))}
                {cal.length === 0 && (
                  <div className="empty"><CalendarDays size={35} /><h3>A clear calendar, for now.</h3><p>Approved leave will appear here for authorised viewers.</p></div>
                )}
              </div>
            </>)}

            {/* ---------- LEAVE REQUESTS ---------- */}
            {page === "Leave requests" && (<>
              <div className="card">
                <div className="sectiontitle"><h2>Request time away</h2>{badge(me.status === "Complete" ? "Onboarding complete" : "Onboarding required")}</div>
                <form onSubmit={async e => {
                  e.preventDefault(); const f = e.currentTarget;
                  if (await post({ action: "leave", ...Object.fromEntries(new FormData(f)) })) f.reset();
                }}>
                  <div className="formgrid">
                    <label>Leave type<select name="type">{LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
                    {field("start", "From", "date", "", true)}
                    {field("end", "To", "date", "", true)}
                    {field("note", "Note for your approver")}
                  </div>
                  <div className="formfooter">
                    <span>Requests go to an authorised approver. Self-approval is disabled.</span>
                    <button disabled={busy || me.status !== "Complete" || isViewer} className="primary">Submit request</button>
                  </div>
                </form>
              </div>
              <div className="card spaced">
                <h2>{canApprove ? "Leave approvals & requests" : "Your requests"}</h2>
                {data.leave.length === 0 && <p className="empty">No leave requests yet.</p>}
                {data.leave.map(l => (
                  <div className="listrow" key={l.id}>
                    <div className="grow"><b>{l.name} · {l.type}</b><p>{l.start} → {l.end}</p>{l.note && <small>{l.note}</small>}</div>
                    {badge(l.status)}
                    {l.status === "Pending" && canApprove && l.owner !== me.id && (<>
                      <button disabled={busy} onClick={() => post({ action: "decision", id: l.id, status: "Approved" })}>Approve</button>
                      <button disabled={busy} onClick={() => post({ action: "decision", id: l.id, status: "Declined" })}>Decline</button>
                    </>)}
                    {l.owner === me.id && ["Pending", "Approved"].includes(l.status) && (
                      <button disabled={busy} onClick={() => post({ action: "decision", id: l.id, status: "Cancelled" })}>Cancel</button>
                    )}
                  </div>
                ))}
              </div>
            </>)}

            {/* ---------- STAFF DIRECTORY (admin) ---------- */}
            {page === "Staff directory" && isAdmin && (
              <div className="card">
                <h2>Your team</h2>
                <p className="muted">Add staff using the email they use to sign in. Site access must also be granted before they can enter.</p>
                {data.people.map(p => (
                  <div className="listrow" key={p.id}>
                    <div className="avatar">{p.name[0]}</div>
                    <div className="grow"><b>{p.name}</b><p>{p.email} · {p.role}</p><small>{p.title || "Awaiting employment details"}</small></div>
                    {badge(p.status)}
                    {p.status === "In review" && <button disabled={busy} onClick={() => post({ action: "onboard", id: p.id })}>Complete onboarding</button>}
                  </div>
                ))}
              </div>
            )}

            {/* ---------- DOCUMENT REVIEW (admin) ---------- */}
            {page === "Document review" && isAdmin && (
              <div className="card">
                <h2>Staff document review</h2>
                <p className="muted">Check clarity and completeness before verifying. Rejected documents need to be uploaded again.</p>
                {docs.length === 0 && <div className="empty"><FolderCheck size={35} /><h3>No documents awaiting review</h3><p>Staff uploads will appear here.</p></div>}
                {docs.map(d => (
                  <div className="listrow" key={d.id}>
                    <div className="grow"><b>{d.category} · {data.people.find(p => p.owner === d.owner)?.name || d.owner}</b><p><a href={"/api/hr?file=" + d.id}>{d.name}</a></p></div>
                    {badge(d.status)}
                    <button disabled={busy} onClick={() => post({ action: "document", id: d.id, status: "Verified" })}>Verify</button>
                    <button disabled={busy} onClick={() => post({ action: "document", id: d.id, status: "Rejected" })}>Reject</button>
                  </div>
                ))}
              </div>
            )}
          </>) : (
            <div className="card"><h2>Welcome to the MVR people portal</h2><p>{error ? "Sign in with your authorised account to continue." : "Loading your workspace…"}</p></div>
          )}

          <footer>MVR ATTORNEYS <span>People first. Every step of the way.</span></footer>
        </main>
      </section>

      {/* ---------- ADD STAFF MODAL ---------- */}
      {showAdd && (
        <div className="overlay">
          <div className="card modal">
            <h2>Add a staff member</h2>
            <p>Create their onboarding profile. No invitation email is sent.</p>
            <form onSubmit={async e => {
              e.preventDefault();
              if (await post({ action: "add", ...Object.fromEntries(new FormData(e.currentTarget)) })) setShowAdd(false);
            }}>
              {field("name", "Full name", "text", "", true)}
              {field("email", "Sign-in email", "email", "", true)}
              <label>Access role
                <select name="role">
                  <option value="staff">Staff — own onboarding and leave</option>
                  <option value="approver">Leave approver — review team leave</option>
                  <option value="viewer">Calendar viewer — team availability only</option>
                  <option value="admin">HR administrator — all staff records</option>
                </select>
              </label>
              {error && <p className="error">{error}</p>}
              <div className="formfooter">
                <button type="button" onClick={() => setShowAdd(false)}>Cancel</button>
                <button className="primary" disabled={busy}>Add staff member</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
