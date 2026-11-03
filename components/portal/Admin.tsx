"use client";
// HR screens (doc 06 S12–S16): people directory + organogram + person file + imports, document review, reports + payroll export, settings, audit.
import { Fragment, useEffect, useState } from "react";
import { Download, FolderCheck, Upload, X } from "lucide-react";
import { Delegation } from "./Leave";
import { EmployeeProfile, PayrollChanges } from "./Hr";
import { Badge, KIND_LABEL, days, download, longDate, nameOf, range, shortDate, type HrData, type Person, type Post } from "./shared";

const get = async (q: string) => { const r = await fetch(`/api/hr?${q}`); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };
const PATTERNS: [string, number[]][] = [["Mon–Fri", [1, 2, 3, 4, 5]], ["Mon–Thu", [1, 2, 3, 4]], ["Mon–Wed", [1, 2, 3]], ["Tue–Fri", [2, 3, 4, 5]]];

function Organogram({ people, open }: { people: Person[]; open: (id: string) => void }) {
  const kids = (id: string | null) => people.filter(p => (p.reportsToId ?? null) === id || (id === null && p.reportsToId && !people.some(x => x.id === p.reportsToId)));
  const render = (id: string | null, depth: number): React.ReactNode => {
    const list = kids(id);
    if (!list.length || depth > 12) return null;
    return <ul className={"tree" + (id === null ? " root" : "")}>{list.map(p => (
      <li key={p.id}><button className="node" onClick={() => open(p.id)}><b>{p.name}</b><small>{p.title}</small>{p.role === "admin" && <Badge s="HR" />}</button>{render(p.id, depth + 1)}</li>
    ))}</ul>;
  };
  return <>{render(null, 0)}</>;
}

function PersonPanel({ id, data, post, busy, close, embedded }: { id: string; data: HrData; post: Post; busy: boolean; close: () => void; embedded?: boolean }) {
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState("");
  const p = data.people.find(x => x.id === id)!;
  const load = () => get(`view=person&id=${id}`).then(setF).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (body: Record<string, unknown>) => { if (await post(body)) load(); };
  return (
    <div className={embedded ? "hrfile" : "panel"} role={embedded ? undefined : "dialog"} aria-label={`Person file: ${p?.name}`}>
      {!embedded && <div className="sectiontitle"><h2>{p?.name}</h2><button aria-label="Close" onClick={close}><X size={16} /></button></div>}
      {err && <div className="error">{err}</div>}
      {!f ? <p>Loading…</p> : (<>
        <dl className="kv">
          <dt>Email</dt><dd>{f.email}</dd><dt>Title</dt><dd>{f.title ?? "—"}</dd><dt>Employment</dt><dd>{f.employmentType.replace("_", " ")} · {f.employmentStatus.replace("_", " ")}</dd>
          <dt>Start date</dt><dd>{longDate(f.startDate)}</dd>{f.lastWorkingDay && (<><dt>Last working day</dt><dd>{longDate(f.lastWorkingDay)}</dd></>)}
          {f.payoutDays != null && (<><dt>Annual leave payout</dt><dd>{f.payoutDays} days (BCEA s40)</dd></>)}
          <dt>Emergency contact</dt><dd>{f.contacts[0] ? `${f.contacts[0].name} (${f.contacts[0].relationship}) ${f.contacts[0].phone}` : "—"}</dd>
        </dl>

        <div className="card">
          <h3>Employment and organogram</h3>
          <form onSubmit={async e => {
            e.preventDefault(); const fd = new FormData(e.currentTarget);
            await act({ action: "person", id, changes: {
              reportsToId: fd.get("reportsToId") || null, departmentId: fd.get("departmentId") || null, role: fd.get("role"), employeeNo: fd.get("employeeNo") || null,
              employmentType: fd.get("employmentType"), isFeeEarner: fd.get("isFeeEarner") === "on", workPattern: JSON.parse(String(fd.get("pattern"))),
              ...(fd.get("startDate") ? { startDate: fd.get("startDate") } : {}) } });
          }}>
            <div className="formgrid">
              <label>Reports to<select name="reportsToId" defaultValue={p.reportsToId ?? ""}><option value="">— top of organogram —</option>{data.people.filter(x => x.id !== id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label>Department<select name="departmentId" defaultValue={p.departmentId ?? ""}><option value="">—</option>{data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label>Access role<select name="role" defaultValue={p.role}>{["staff", "manager", "viewer", "admin"].map(r => <option key={r}>{r}</option>)}</select></label>
              <label>Employee no.<input name="employeeNo" defaultValue={f.employeeNo ?? ""} /></label>
              <label>Employment type<select name="employmentType" defaultValue={f.employmentType}>{["permanent", "fixed_term", "candidate_attorney", "contractor", "part_time"].map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select></label>
              <label>Work pattern<select name="pattern" defaultValue={JSON.stringify(f.workPattern ?? [1, 2, 3, 4, 5])}>{PATTERNS.map(([l, v]) => <option key={l} value={JSON.stringify(v)}>{l}</option>)}</select></label>
              <label>Start date<input type="date" name="startDate" defaultValue={f.startDate ?? ""} /></label>
            </div>
            <label className="check"><input type="checkbox" name="isFeeEarner" defaultChecked={f.isFeeEarner} /> Fee-earner (arranges matter cover for leave)</label>
            <div className="formfooter"><span>Approvals follow “reports to”.</span><button className="primary" disabled={busy}>Save</button></div>
          </form>
        </div>

        <div className="card">
          <h3>Leave balances</h3>
          <table className="grid"><thead><tr><th>Type</th><th className="num">Available</th><th className="num">Taken</th><th className="num">By cycle end</th></tr></thead>
            <tbody>{f.balances.map((b: any) => <tr key={b.code}><td>{b.label}</td><td className="num">{b.available}</td><td className="num">{b.taken}</td><td className="num">{b.projected}</td></tr>)}</tbody></table>
          {f.balances[0] && <details><summary>Annual leave statement</summary><table className="grid"><tbody>{f.balances[0].statement.map((l: any, i: number) => <tr key={i}><td>{shortDate(l.date)}</td><td>{KIND_LABEL[l.kind] ?? l.kind}</td><td className="num">{Number(l.days).toFixed(2)}</td></tr>)}</tbody></table></details>}
        </div>

        <div className="card">
          <h3>Written particulars</h3>
          {f.acknowledgements.map((a: any) => <div className="listrow" key={a.id}><span className="grow">{a.title} · issued {shortDate(a.issuedAt)}</span><Badge s={a.acknowledgedAt ? "Acknowledged" : "Not acknowledged"} /></div>)}
          <button disabled={busy} onClick={() => act({ action: "particulars", id })}>{f.acknowledgements.length ? "Re-issue (after a change)" : "Issue written particulars"}</button>
        </div>

        <div className="card">
          <h3>Onboarding and exit</h3>
          {p.status === "In review" && <button className="primary" disabled={busy} onClick={() => act({ action: "onboard", id })}>Complete onboarding</button>}{" "}
          <form className="inline" onSubmit={e => { e.preventDefault(); act({ action: "notice", id, lastWorkingDay: new FormData(e.currentTarget).get("lastWorkingDay") }); }}>
            <label>Last working day<input type="date" name="lastWorkingDay" required defaultValue={f.lastWorkingDay ?? ""} /></label>
            <button disabled={busy || id === data.me.id}>Set notice</button>
          </form>
          <p className="muted-inline">The day after, access ends, future leave is cancelled and returned, and open approvals move to the next approver.</p>
        </div>

        {f.audit.length > 0 && <div className="card"><h3>Recent activity</h3>{f.audit.map((e: any, i: number) => <div className="listrow" key={i}><small>{new Date(e.at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}</small><span className="grow">{e.action}</span><small>{nameOf(data.people, e.actorId)}</small></div>)}</div>}
      </>)}
    </div>
  );
}

function Imports({ post, busy }: { post: Post; busy: boolean }) {
  const [kind, setKind] = useState<"staff" | "balances">("staff");
  const [csv, setCsv] = useState("");
  const [rep, setRep] = useState<any>(null);
  const tmpl = kind === "staff"
    ? "employee_no,first_name,last_name,work_email,job_title,department,reports_to_email,role,employment_type,is_fee_earner,is_admitted_attorney,start_date,work_pattern\n"
    : "employee_no,leave_code,as_at_date,available_days\n";
  const run = async (apply: boolean) => { const r = await post({ action: "import", kind, csv, apply }, { reload: apply }); if (r && !r.error) setRep(r); };
  return (
    <div className="card spaced">
      <h2>Import at go-live</h2>
      <p className="muted">Validate first; nothing is written until the file has no errors. Staff first, then opening balances.</p>
      <div className="tabs">{(["staff", "balances"] as const).map(k => <button key={k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setRep(null); setCsv(""); }}>{k === "staff" ? "Staff list" : "Opening balances"}</button>)}</div>
      <div className="inline">
        <label className="upload"><Upload size={16} /> Choose CSV<input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (file) { setCsv(await file.text()); setRep(null); } e.target.value = ""; }} /></label>
        <button onClick={() => download(`${kind}-template.csv`, tmpl)}><Download size={15} /> Template</button>
        <button disabled={busy || !csv} onClick={() => run(false)}>Validate</button>
        <button className="primary" disabled={busy || !rep || rep.errors.length > 0 || rep.applied} onClick={() => run(true)}>Apply {rep?.rows ?? ""} rows</button>
      </div>
      {csv && <p className="muted-inline">{csv.trim().split("\n").length - 1} rows loaded.</p>}
      {rep && (rep.errors.length ? <div className="warn"><b>{rep.errors.length} errors — fix and validate again:</b><ul>{rep.errors.slice(0, 50).map((e: any, i: number) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul></div>
        : <p className="okline">{rep.applied ? `Applied ${rep.applied} rows.` : `All ${rep.rows} rows are valid.`}</p>)}
    </div>
  );
}

export function People({ data, post, busy, openAdd }: { data: HrData; post: Post; busy: boolean; openAdd: () => void }) {
  const [tab, setTab] = useState("Directory");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const list = data.people.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) && (!dept || p.departmentId === dept));
  return (<>
    <div className="tabs">{["Directory", "Organogram", "Import"].map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}<button className="primary" onClick={openAdd}>Add staff member</button></div>
    {open && (<>
      <div className="inline"><button onClick={() => setOpen(null)}>← Back to people</button></div>
      <EmployeeProfile id={open} data={data} post={post} busy={busy} hrFile={<PersonPanel id={open} data={data} post={post} busy={busy} close={() => setOpen(null)} embedded />} />
    </>)}
    {!open && tab === "Directory" && (
      <div className="card">
        <div className="inline"><input className="search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
          <select aria-label="Department" value={dept} onChange={e => setDept(e.target.value)}><option value="">All departments</option>{data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        {list.map(p => (
          <div className="listrow" key={p.id}>
            <div className="avatar">{p.name[0]}</div>
            <div className="grow"><b>{p.name}</b> {p.employeeNo && <small>{p.employeeNo}</small>}<p>{p.title || "Awaiting details"}{p.department ? ` · ${p.department}` : ""} · {p.role}{p.isFeeEarner ? " · fee-earner" : ""}</p>
              <small>{p.reportsToId ? `Reports to ${nameOf(data.people, p.reportsToId)}` : "Top of organogram"}</small></div>
            {p.employmentStatus === "on_notice" && <Badge s="On notice" />}<Badge s={p.status} />
            <button onClick={() => setOpen(p.id)}>Open file</button>
          </div>
        ))}
      </div>
    )}
    {!open && tab === "Organogram" && <div className="card"><p className="muted">Leave goes to the person each member reports to. Click a name to open their file.</p><Organogram people={data.people} open={setOpen} /></div>}
    {!open && tab === "Import" && <Imports post={post} busy={busy} />}
  </>);
}

export function DocumentReview({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const docs = data.documents.filter(d => d.status !== "Superseded");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const pending = docs.filter(d => d.status === "Pending");
  return (
    <div className="card">
      <h2>Staff document review</h2>
      <p className="muted">Check clarity and completeness. A rejection needs a reason — the person is emailed what to fix.</p>
      {pending.length === 0 && <div className="empty"><FolderCheck size={35} /><h3>No documents awaiting review</h3><p>Staff uploads will appear here.</p></div>}
      {[...pending, ...docs.filter(d => d.status !== "Pending")].map(d => (
        <div className="listrow" key={d.id}>
          <div className="grow"><b>{d.category} · {data.people.find(p => p.owner === d.owner)?.name || d.owner}</b><p><a href={"/api/hr?file=" + d.id}>{d.name}</a></p>{d.reason && <small>Rejected: {d.reason}</small>}</div>
          <Badge s={d.status} />
          {d.status === "Pending" && (<>
            <button disabled={busy} onClick={() => post({ action: "document", id: d.id, status: "Verified" })}>Verify</button>
            <input placeholder="Reason to reject" aria-label="Rejection reason" value={reasons[d.id] ?? ""} onChange={e => setReasons({ ...reasons, [d.id]: e.target.value })} />
            <button disabled={busy || !reasons[d.id]?.trim()} onClick={() => post({ action: "document", id: d.id, status: "Rejected", reason: reasons[d.id] })}>Reject</button>
          </>)}
        </div>
      ))}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function Reports({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const year0 = Number(data.today.slice(0, 4));
  const [year, setYear] = useState(year0);
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { get(`view=reports&year=${year}`).then(setR).catch(e => setErr(e.message)); }, [year]);
  const types: string[] = r ? [...new Set<string>(r.byMonth.map((x: any) => x.type))] : [];
  const cell = (t: string, m: number) => r.byMonth.find((x: any) => x.type === t && x.month === m)?.days ?? 0;
  const toCsv = (rows: any[]) => [Object.keys(rows[0] ?? {}).join(","), ...rows.map(o => Object.values(o).join(","))].join("\n");
  const monthStart = `${data.today.slice(0, 7)}-01`;
  return (<>
    {err && <div className="error">{err}</div>}
    <div className="inline"><label>Year<select value={year} onChange={e => setYear(Number(e.target.value))}>{[year0 - 1, year0, year0 + 1].map(y => <option key={y}>{y}</option>)}</select></label>
      {r && <span className="muted-inline">{r.scope === "firm" ? "Whole firm" : "Your direct reports"}</span>}</div>
    {r && (<>
      <div className="card spaced">
        <div className="sectiontitle"><h2>Leave taken by month (working days)</h2><button onClick={() => download(`leave-by-month-${year}.csv`, toCsv(r.byMonth))}><Download size={14} /> CSV</button></div>
        <div className="tablewrap"><table className="grid"><thead><tr><th>Type</th>{MONTHS.map(m => <th key={m} className="num">{m}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{types.map(t => <tr key={t}><td>{t}</td>{MONTHS.map((_, i) => <td key={i} className="num">{cell(t, i + 1) || ""}</td>)}<td className="num"><b>{MONTHS.reduce((s, _, i) => s + cell(t, i + 1), 0)}</b></td></tr>)}
            {types.length === 0 && <tr><td colSpan={14}>No approved leave in {year}.</td></tr>}</tbody></table></div>
      </div>
      <div className="card spaced">
        <div className="sectiontitle"><h2>Balances today</h2><button onClick={() => download(`balances-${data.today}.csv`, toCsv(r.balances.map(({ personId, ...x }: any) => x)))}><Download size={14} /> CSV</button></div>
        <div className="tablewrap"><table className="grid"><thead><tr><th>Person</th><th className="num">Annual now</th><th className="num">Annual by cycle end</th><th className="num">Sick</th><th className="num">Family</th></tr></thead>
          <tbody>{r.balances.map((b: any) => <tr key={b.personId}><td>{b.name}</td><td className="num">{b.annual ?? "—"}</td><td className="num">{b.annualProjected ?? "—"}</td><td className="num">{b.sick ?? "—"}</td><td className="num">{b.family ?? "—"}</td></tr>)}</tbody></table></div>
      </div>
      {r.scope === "firm" && <div className="columns">
        <div className="card"><h3>Headcount by department</h3>{r.headcount.map((h: any) => <div className="listrow" key={h.department}><span className="grow">{h.department}</span><b>{h.count}</b></div>)}</div>
        <div className="card"><h3>Onboarding</h3>{r.onboarding.map((o: any) => <div className="listrow" key={o.status}><span className="grow">{o.status.replace("_", " ")}</span><b>{o.count}</b></div>)}</div>
      </div>}
    </>)}
    {data.can.payroll && (
      <div className="card spaced">
        <h2>Payroll leave export (Sage)</h2>
        <p className="muted">One row per approved request in the period, keyed on employee number. Leave cancelled after approval appears as a negative row.</p>
        <form className="inline" onSubmit={async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.currentTarget)); const res = await post({ action: "payroll", ...fd }, { reload: false }); if (res?.csv) download(res.fileName, res.csv); }}>
          <label>From<input type="date" name="from" required defaultValue={monthStart} /></label>
          <label>To<input type="date" name="to" required defaultValue={data.today} /></label>
          <button className="primary" disabled={busy}><Download size={15} /> Export CSV</button>
        </form>
      </div>
    )}
    {data.can.payroll && <PayrollChanges post={post} busy={busy} today={data.today} />}
  </>);
}

export function Settings({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const s = data.settings;
  const [tab, setTab] = useState("Leave policies");
  const [impact, setImpact] = useState<any[] | null>(null);
  const [closure, setClosure] = useState({ name: "December shutdown", start: "", end: "", type: "annual" });
  const [editing, setEditing] = useState<string | null>(null);
  if (!s) return null;
  const top = data.people.filter(p => !p.reportsToId);
  return (<>
    <div className="tabs">{["Leave policies", "Holidays & closures", "Approval routes", "Delegations", "Branding"].map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>

    {tab === "Leave policies" && (
      <div className="card">
        <h2>Leave policies</h2>
        <p className="muted">A change is a new version from a date. Requests made earlier keep the version they were made under.</p>
        <div className="tablewrap"><table className="grid">
          <thead><tr><th>Type</th><th>Version</th><th>From</th><th className="num">Entitlement</th><th>Accrual</th><th className="num">Carry cap</th><th className="num">Notice</th><th /></tr></thead>
          <tbody>{s.policies.map((p: any) => (<Fragment key={p.id}>
            <tr><td>{p.type}</td><td>v{p.version}{p.effectiveTo ? ` (until ${shortDate(p.effectiveTo)})` : ""}</td><td>{shortDate(p.effectiveFrom)}</td><td className="num">{p.entitlement}{p.cycleKind === "three_year" ? " / 36 mo" : ""}</td>
              <td>{p.accrualMethod}{p.minServiceMonths ? `, after ${p.minServiceMonths} mo` : ""}</td><td className="num">{p.carryOverCap ?? "—"}{p.carryOverExpiryMonths ? ` / ${p.carryOverExpiryMonths} mo` : ""}</td><td className="num">{p.minNoticeDays ?? "—"}</td>
              <td>{!p.effectiveTo && <button onClick={() => setEditing(editing === p.id ? null : p.id)}>Change</button>}</td></tr>
            {editing === p.id && <tr key={p.id + "e"}><td colSpan={8}>
              <form className="inline" onSubmit={async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.currentTarget));
                if (await post({ action: "policy", policyId: p.id, ...fd, carryOverCap: fd.carryOverCap === "" ? null : fd.carryOverCap, minNoticeDays: fd.minNoticeDays === "" ? null : fd.minNoticeDays })) setEditing(null); }}>
                <label>From<input type="date" name="effectiveFrom" required /></label>
                <label>Entitlement<input type="number" step="0.5" name="entitlement" defaultValue={p.entitlement} required /></label>
                <label>Carry cap<input type="number" step="0.5" name="carryOverCap" defaultValue={p.carryOverCap ?? ""} /></label>
                <label>Notice (working days)<input type="number" name="minNoticeDays" defaultValue={p.minNoticeDays ?? ""} /></label>
                <button className="primary" disabled={busy}>Save as v{p.version + 1}</button>
              </form></td></tr>}
          </Fragment>))}</tbody>
        </table></div>
      </div>
    )}

    {tab === "Holidays & closures" && (<>
      <div className="card">
        <h2>Firm closure</h2>
        <p className="muted">Deducts the working days in the period from each person’s balance (one ledger line each). Preview first.</p>
        <div className="inline">
          <label>Name<input value={closure.name} onChange={e => setClosure({ ...closure, name: e.target.value })} /></label>
          <label>From<input type="date" value={closure.start} onChange={e => { setClosure({ ...closure, start: e.target.value }); setImpact(null); }} /></label>
          <label>To<input type="date" value={closure.end} onChange={e => { setClosure({ ...closure, end: e.target.value }); setImpact(null); }} /></label>
          <button disabled={busy || !closure.start || !closure.end} onClick={async () => { const r = await post({ action: "closure-preview", ...closure }, { reload: false }); if (Array.isArray(r)) setImpact(r); }}>Preview impact</button>
          <button className="primary" disabled={busy || !impact} onClick={async () => { const r = await post({ action: "closure", ...closure }); if (r) setImpact(null); }}>Apply closure</button>
        </div>
        {impact && <table className="grid"><tbody>{impact.map(i => <tr key={i.personId}><td>{i.name}</td><td className="num">{days(i.days)}</td></tr>)}</tbody></table>}
        {s.closures.map((c: any) => <div className="listrow" key={c.id}><span className="grow">{c.name} · {range(c.start, c.end)} · {c.type}</span><Badge s={c.applied ? "Applied" : "Draft"} /></div>)}
      </div>
      <div className="card spaced">
        <h2>Public holidays</h2>
        <p className="muted">National holidays are built in (a Sunday holiday moves to Monday). Add firm-specific days here.</p>
        <form className="inline" onSubmit={e => { e.preventDefault(); post({ action: "holiday", ...Object.fromEntries(new FormData(e.currentTarget)) }); }}>
          <label>Date<input type="date" name="date" required /></label><label>Name<input name="name" required /></label><button disabled={busy}>Add holiday</button>
        </form>
        <table className="grid"><tbody>{s.holidays.map((h: any) => <tr key={h.id}><td>{longDate(h.observedDate)}</td><td>{h.name}{h.date !== h.observedDate ? ` (falls on ${shortDate(h.date)})` : ""}</td><td>{h.firmOnly ? "Firm" : "National"}</td></tr>)}</tbody></table>
      </div>
    </>)}

    {tab === "Approval routes" && (
      <div className="card">
        <h2>Who approves people at the top of the organogram</h2>
        <p className="muted">Everyone else is approved by the person they report to. Anyone without a route falls back to HR.</p>
        {top.map(p => {
          const r = s.routes.find((x: any) => x.personId === p.id);
          return (
            <form className="listrow" key={p.id} onSubmit={e => { e.preventDefault(); post({ action: "route", personId: p.id, approverId: new FormData(e.currentTarget).get("approverId") }); }}>
              <b className="grow">{p.name}<small> {p.title}</small></b>
              <select name="approverId" defaultValue={r?.approverId ?? ""} aria-label={`Approver for ${p.name}`}><option value="" disabled>HR fallback</option>{data.people.filter(x => x.id !== p.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <button disabled={busy}>Save</button>
            </form>
          );
        })}
      </div>
    )}

    {tab === "Delegations" && <Delegation data={data} post={post} busy={busy} />}

    {tab === "Branding" && s.branding && (
      <div className="card">
        <h2>Branding</h2>
        <form onSubmit={e => { e.preventDefault(); post({ action: "branding", ...Object.fromEntries(new FormData(e.currentTarget)) }); }}>
          <div className="formgrid">
            <label>Firm name shown<input name="brandName" defaultValue={s.branding.brandName} required /></label>
            <label>Primary colour<input type="color" name="primaryColour" defaultValue={s.branding.primaryColour} /></label>
            <label>Accent colour<input type="color" name="accentColour" defaultValue={s.branding.accentColour} /></label>
          </div>
          <div className="formfooter"><span>Layout does not change; only name and colours.</span><button className="primary" disabled={busy}>Save branding</button></div>
        </form>
      </div>
    )}
  </>);
}

export function Audit({ data }: { data: HrData }) {
  const [f, setF] = useState({ personId: "", action: "", from: "", to: "" });
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { get(`view=audit&${new URLSearchParams(f)}`).then(setRows).catch(e => setErr(e.message)); }, [f]);
  return (
    <div className="card">
      <h2>Audit trail</h2>
      <p className="muted">Every change, who made it and when. Sensitive values are masked.</p>
      <div className="inline">
        <label>Person<select value={f.personId} onChange={e => setF({ ...f, personId: e.target.value })}><option value="">Anyone</option>{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Action<select value={f.action} onChange={e => setF({ ...f, action: e.target.value })}><option value="">All</option>{["leave", "leave_request", "coverage", "person", "document", "onboarding", "ack", "policy", "closure", "delegation", "export", "import", "settings"].map(a => <option key={a}>{a}</option>)}</select></label>
        <label>From<input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></label>
        <label>To<input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></label>
        <button onClick={() => download(`audit-${data.today}.csv`, ["at,actor,action,subject", ...rows.map(r => `${r.at},${r.actor},${r.action},${r.subjectType}`)].join("\n"))}><Download size={14} /> CSV</button>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="tablewrap"><table className="grid"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Subject</th><th>Detail</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{new Date(r.at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}</td><td>{r.actor}</td><td>{r.action}</td><td>{r.subjectType}</td><td><small>{r.diff ? JSON.stringify(r.diff).slice(0, 120) : ""}</small></td></tr>)}</tbody></table></div>
    </div>
  );
}
