// People portal UI — shell, navigation and onboarding. Screens live in components/portal/* (design doc 06).
// Visual language ported from v1; navigation comes from the server's permission model (modules/permissions).

"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight, BarChart3, CalendarDays, Check, CheckSquare, ChevronRight, Clock, FolderCheck, History, LayoutDashboard,
  Scale, Settings as SettingsIcon, ShieldCheck, Upload, UserRound, UserRoundPlus, Users,
} from "lucide-react";
import { Badge, type HrData } from "./portal/shared";
import { Approvals, MyLeave } from "./portal/Leave";
import { Home, Profile, TeamCalendar } from "./portal/Home";
import { Audit, DocumentReview, People, Reports, Settings } from "./portal/Admin";

const ICONS: Record<string, any> = {
  Home: LayoutDashboard, Onboarding: UserRoundPlus, "My leave": Clock, Approvals: CheckSquare, "Team calendar": CalendarDays,
  "My profile": UserRound, People: Users, "Documents to review": FolderCheck, Reports: BarChart3, Settings: SettingsIcon, Audit: History,
};
const SUBTITLE: Record<string, string> = {
  Home: "Your people, at a glance.", "My leave": "Balances, requests and cover — all in one place.", Approvals: "Everything you need to decide, on one card.",
  "Team calendar": "Plan with confidence. See who’s away and what’s coming up.", "My profile": "Your details, emergency contact and documents to acknowledge.",
  People: "Directory, organogram and each person’s file.", "Documents to review": "Verify or return staff documents.", Reports: "Leave, balances, headcount and the payroll export.",
  Settings: "Policies, holidays, closures, approval routes and branding.", Audit: "Who did what, and when.",
};

export default function PeoplePortal() {
  const [data, setData] = useState<HrData | null>(null);
  const [page, setPage] = useState("Home");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    const r = await fetch("/api/hr"); const j = await r.json();
    if (!r.ok) { setError(j.error); return; }
    setData(j);
    setPage(p => (j.nav.includes(p) ? p : j.me.status !== "Complete" && j.nav.includes("Onboarding") ? "Onboarding" : j.nav[0]));
  }
  useEffect(() => { load().catch(() => setError("Unable to connect. Please reload.")); }, []);

  /** POST an action. `reload: false` = quiet call (previews): returns { error } instead of showing a banner and does not refresh. */
  async function post(body: FormData | Record<string, unknown>, opts: { reload?: boolean } = {}) {
    const quiet = opts.reload === false;
    if (!quiet) { setBusy(true); setError(""); }
    try {
      const r = await fetch("/api/hr", {
        method: "POST",
        headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) { if (quiet) return { error: j.error }; throw new Error(j.error); }
      if (!quiet) await load();
      return j.ok === true && Object.keys(j).length === 1 ? true : j;
    } catch (e: any) { setError(e.message); window.scrollTo({ top: 0, behavior: "smooth" }); return false; }
    finally { if (!quiet) setBusy(false); }
  }

  const me = data?.me;
  const isAdmin = me?.role === "admin";
  const canApprove = isAdmin || !!me?.isManager;
  const isViewer = me?.role === "viewer";
  const docs = data?.documents || [];
  const myDocs = docs.filter(d => d.owner === me?.id);
  const categories: [string, string, string][] = (data?.categories ?? []).filter(c => c.appliesWhen !== "admitted" || me?.admitted).map(c => [c.code, c.label, c.description]);
  const required = categories;
  const ready = required.filter(c => myDocs.some(d => d.category === c[0] && d.status !== "Rejected")).length;
  const nav: [string, any][] = (data?.nav ?? []).map(n => [n, ICONS[n] ?? LayoutDashboard]);
  const approvalsWaiting = data?.leave.filter(l => l.actions.includes("approve")).length ?? 0;
  const firmName = data?.firm.name ?? "People portal";
  const badge = (s: string) => <Badge s={s} />;
  const field = (name: string, label: string, type = "text", def = "", req = false) => (
    <label>{label}<input name={name} type={type} defaultValue={def} required={req} /></label>
  );

  return (
    <div className="shell">
      {data && <style>{`.primary{background:${data.firm.primary};border-color:${data.firm.primary}}.brand{color:${data.firm.primary}}`}</style>}
      {/* ---------- Sidebar ---------- */}
      <aside>
        <div className="brand"><Scale size={31} /><div>{firmName.split(" ")[0].toUpperCase()}<span>{firmName.split(" ").slice(1).join(" ").toUpperCase()}</span></div></div>
        <div className="workspace">PEOPLE &amp; CULTURE</div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button key={name} className={page === name ? "active" : ""} onClick={() => { setPage(name); setError(""); }}>
              <Icon size={18} />{name}{name === "Onboarding" && me?.status !== "Complete" && <span className="dot" />}{name === "Approvals" && approvalsWaiting > 0 && <span className="badge amber">{approvalsWaiting}</span>}
            </button>
          ))}
        </nav>
        <div className="asidebottom"><ShieldCheck size={22} /><b>A place for your people.</b><p>One home for every step of your journey at {firmName.split(" ")[0]}.</p></div>
        <div className="account">
          <div className="avatar">{me?.name?.slice(0, 1) || "M"}</div>
          <div><b>{me?.name || "MVR team"}</b><small>{me?.role === "admin" ? "HR administrator" : me?.isManager ? "Manager" : me?.role === "viewer" ? "Calendar viewer" : "Staff"}</small>
            <small><a href="/api/auth/signout">Sign out</a></small></div>
        </div>
      </aside>

      <section className="main">
        <header>
          <span>Workspace <ChevronRight size={14} /> <b>{page}</b></span>
          <div><span className="private"><ShieldCheck size={14} /> Private workspace</span><div className="avatar small">M</div></div>
        </header>

        <main>
          <div className="eyebrow">{firmName.toUpperCase()} / PEOPLE PORTAL</div>
          <div className="title">
            <div>
              <h1>{page === "Onboarding" ? "A great start begins here." : page === "Home" ? `Good day, ${me?.name.split(" ")[0] ?? ""}.` : page}</h1>
              <p>{page === "Onboarding" ? `Welcome to ${firmName}. Let’s get you settled in and ready for what’s next.` : SUBTITLE[page] ?? ""}</p>
            </div>
          </div>

          {data?.demo && <div className="warn">Demo environment — names are from the firm’s public team page; every leave record, document and figure is invented. <a href="/api/auth/signout">Switch person</a></div>}
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
                          <select name="department" defaultValue={me.department || data.departments[0]?.name}>{data.departments.map(d => <option key={d.id}>{d.name}</option>)}</select>
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
                    {["Personal & employment details", ...required.map(c => c[1])].map((item, i) => (
                      <div className="checklist" key={item}>
                        <span className={i === 0 ? (me.title ? "done" : "") : (myDocs.some(d => d.category === required[i - 1]?.[0] && d.status !== "Rejected") ? "done" : "")}><Check size={12} /></span>{item}
                      </div>
                    ))}
                  </div>
                  <div className="note">
                    <b>A note on your documents</b>
                    <p>All staff submit the core documents{data.categories.some(c => c.appliesWhen === "admitted") ? ". Already admitted attorneys also submit their LPC registration." : "."}</p>
                    <small>Only you and HR can access your staff documents.</small>
                  </div>
                </section>
              </div>
            </>)}

            {page === "Home" && <Home data={data} go={setPage} />}
            {page === "My leave" && <MyLeave data={data} post={post} busy={busy} />}
            {page === "Approvals" && <Approvals data={data} post={post} busy={busy} />}
            {page === "Team calendar" && <TeamCalendar data={data} />}
            {page === "My profile" && <Profile data={data} post={post} busy={busy} />}
            {page === "People" && <People data={data} post={post} busy={busy} openAdd={() => setShowAdd(true)} />}
            {page === "Documents to review" && <DocumentReview data={data} post={post} busy={busy} />}
            {page === "Reports" && <Reports data={data} post={post} busy={busy} />}
            {page === "Settings" && <Settings data={data} post={post} busy={busy} />}
            {page === "Audit" && <Audit data={data} />}
          </>) : (
            <div className="card"><h2>Welcome to the people portal</h2><p>{error ? "Sign in with your authorised account to continue." : "Loading your workspace…"}</p></div>
          )}

          <footer>{firmName.toUpperCase()} <span>People first. Every step of the way.</span></footer>
        </main>
      </section>

      {/* ---------- ADD STAFF MODAL ---------- */}
      {showAdd && (
        <div className="overlay">
          <div className="card modal">
            <h2>Add a staff member</h2>
            <p>Creates their onboarding profile and emails them an invitation to sign in.</p>
            <form onSubmit={async e => {
              e.preventDefault();
              if (await post({ action: "add", ...Object.fromEntries(new FormData(e.currentTarget)) })) setShowAdd(false);
            }}>
              {field("name", "Full name", "text", "", true)}
              {field("email", "Sign-in email", "email", "", true)}
              <label>Reports to (organogram)
                <select name="reportsToId" defaultValue="">
                  <option value="">— top of organogram —</option>
                  {data?.people.map(p => <option key={p.id} value={p.id}>{p.name}{p.title ? ` — ${p.title}` : ""}</option>)}
                </select>
              </label>
              <label>Department
                <select name="departmentId" defaultValue="">
                  <option value="">—</option>
                  {data?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label>Access role
                <select name="role" defaultValue="staff">
                  <option value="staff">Staff — own onboarding and leave</option>
                  <option value="manager">Manager — approves leave for their reports</option>
                  <option value="viewer">Calendar viewer — team availability only</option>
                  <option value="admin">HR administrator — all staff records</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" name="isFeeEarner" value="true" /> Fee-earner (must arrange matter cover for leave)</label>
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
