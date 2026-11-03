"use client";
// Full employee profile (D1–D3) and the later-release screens (E–N), each labelled with its planned release in the demo.
import { Fragment, useEffect, useState } from "react";
import { Download, Eye, EyeOff, Printer, X } from "lucide-react";
import { ACTION_LABEL, Badge, Rel, STATE_LABEL, download, get, longDate, range, shortDate, type HrData, type Post } from "./shared";

const st = (s: string) => STATE_LABEL[s] ?? s.replace(/_/g, " ");
const money = (n: unknown) => (n == null ? "—" : `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }) : "—");
const form = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries([...new FormData(e.currentTarget).entries()].filter(([, v]) => v !== "")) as Record<string, string>; };

/** Letters are plain text with **bold**; rendered without HTML injection. */
function Rich({ text }: { text: string }) {
  return <>{text.split("\n").map((line, i) => (
    <Fragment key={i}>{line.split(/(\*\*[^*]+\*\*)/).map((part, j) => part.startsWith("**") ? <b key={j}>{part.slice(2, -2)}</b> : part)}<br /></Fragment>
  ))}</>;
}

export function LetterModal({ id, close }: { id: string; close: () => void }) {
  const [l, setL] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { get(`view=letter&id=${id}`).then(setL).catch(e => setErr(e.message)); }, [id]);
  return (
    <div className="overlay" role="dialog" aria-label="Letter">
      <div className="card modal letter">
        <div className="sectiontitle noprint"><h2>{l?.title ?? "Letter"}</h2><span><button onClick={() => window.print()}><Printer size={15} /> Print / save PDF</button> <button aria-label="Close" onClick={close}><X size={16} /></button></span></div>
        {err && <div className="error">{err}</div>}
        {l ? <div className="lettertext"><Rich text={l.body} /></div> : !err && <p>Loading…</p>}
      </div>
    </div>
  );
}

function Actions({ actions, run, busy, comment }: { actions: string[]; run: (a: string, comment?: string) => void; busy: boolean; comment?: string[] }) {
  return <span className="inline">{actions.map(a => (
    <button key={a} className={["approve", "approve_manager", "complete", "confirm", "mark_paid"].includes(a) ? "primary" : ""} disabled={busy}
      onClick={() => { const c = comment?.includes(a) ? window.prompt("Reason (shared with the person):") ?? undefined : undefined; if (comment?.includes(a) && !c) return; run(a, c); }}>
      {ACTION_LABEL[a] ?? a}</button>
  ))}</span>;
}

// =====================================================================================================================
// Full employee profile (D1, D2, D3)
// =====================================================================================================================

const PROFILE_TABS = ["Overview", "Personal", "Employment", "Leave", "Credentials", "Documents", "Performance", "Assets", "Requests & letters"];

export function EmployeeProfile({ id, data, post, busy, hrFile }: { id: string; data: HrData; post: Post; busy: boolean; hrFile?: React.ReactNode }) {
  const [p, setP] = useState<any>(null);
  const [tab, setTab] = useState("Overview");
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const load = (rv = reveal) => get(`view=profile&id=${id}${rv ? "&reveal=1" : ""}`).then(setP).catch(e => setErr(e.message));
  useEffect(() => { setTab("Overview"); setReveal(false); load(false); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (body: Record<string, unknown>) => { const r = await post(body); if (r) await load(); return r; };
  const isAdmin = data.me.role === "admin", self = id === data.me.id;
  if (err) return <div className="error">{err}</div>;
  if (!p) return <div className="card"><p>Loading profile…</p></div>;
  const tabs = [...PROFILE_TABS, ...(hrFile ? ["HR file"] : [])];
  const expiring = p.credentials.filter((c: any) => ["Lapsed", "Expiring"].includes(c.status));
  return (<>
    <div className="card profilehead">
      <div className="avatar big">{p.name[0]}</div>
      <div className="grow">
        <h2>{p.name}{p.preferredName && p.preferredName !== p.firstName ? <small> (“{p.preferredName}”)</small> : null}</h2>
        <p>{p.title || "—"}{p.department ? ` · ${p.department}` : ""}{p.employeeNo ? ` · ${p.employeeNo}` : ""}</p>
        <small>{p.reportsTo ? `Reports to ${p.reportsTo}` : "Top of organogram"}{p.directReports.length ? ` · ${p.directReports.length} direct report${p.directReports.length > 1 ? "s" : ""}` : ""}</small>
      </div>
      <div className="right">
        <Badge s={p.employmentStatus === "on_notice" ? "On notice" : p.onboardingStatus === "complete" ? "Complete" : "In review"} />
        <small>{p.employmentType.replace("_", " ")}{p.isAdmittedAttorney ? " · admitted attorney" : ""}{p.isFeeEarner ? " · fee-earner" : ""}</small>
      </div>
    </div>
    <div className="tabs">{tabs.map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}{["Credentials", "Performance", "Assets", "Requests & letters"].includes(t) && <Rel r={t === "Assets" ? "R3" : "R2"} />}</button>)}</div>

    {tab === "Overview" && (
      <div className="columns">
        <section className="card">
          <h3>At a glance</h3>
          <dl className="kv">
            <dt>Email</dt><dd>{p.email}</dd><dt>Phone</dt><dd>{p.phone || "—"}</dd>
            <dt>Started</dt><dd>{longDate(p.startDate)}</dd>
            {p.probationEndDate && <><dt>Probation ends</dt><dd>{longDate(p.probationEndDate)}</dd></>}
            {p.contractEndDate && <><dt>Contract ends</dt><dd>{longDate(p.contractEndDate)}</dd></>}
            {p.lastWorkingDay && <><dt>Last working day</dt><dd>{longDate(p.lastWorkingDay)}</dd></>}
            <dt>Works</dt><dd>{(p.workPattern as number[]).map(d => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1]).join(", ")}</dd>
            <dt>Emergency contact</dt><dd>{p.contacts[0] ? `${p.contacts[0].name} (${p.contacts[0].relationship}) ${p.contacts[0].phone}` : "—"}</dd>
          </dl>
          {self && <a className="badge" href="/api/hr?view=myinfo"><Download size={13} /> Download my information (POPIA)</a>}
        </section>
        <section className="card">
          <h3>Leave</h3>
          {p.balances.map((b: any) => <div className="listrow" key={b.code}><span className="grow">{b.label}</span><b>{b.available}</b><small>available</small></div>)}
          {expiring.length > 0 && <><h3>Credentials needing attention</h3>{expiring.map((c: any) => <div className="listrow" key={c.id}><span className="grow">{c.kindLabel}</span><Badge s={c.status} /><small>{shortDate(c.expiresOn)}</small></div>)}</>}
          {p.directReports.length > 0 && <><h3>Direct reports</h3><p>{p.directReports.map((d: any) => d.name).join(", ")}</p></>}
        </section>
      </div>
    )}

    {tab === "Personal" && (
      <div className="columns even">
        <section className="card">
          <h3>Contact details</h3>
          {p.canEditContact ? (
            <form key={p.id + p.phone} onSubmit={e => act({ action: "hr-contact", id, ...form(e) })}>
              <div className="formgrid">
                <label>Preferred name<input name="preferredName" defaultValue={p.preferredName} /></label>
                <label>Mobile<input name="phone" type="tel" defaultValue={p.phone} /></label>
              </div>
              <label>Home address<textarea name="address" rows={2} defaultValue={p.sensitive?.address ?? ""} /></label>
              <h3>Emergency contact</h3>
              <div className="formgrid">
                <label>Name<input name="emergencyName" defaultValue={p.contacts[0]?.name} /></label>
                <label>Relationship<input name="emergencyRelationship" defaultValue={p.contacts[0]?.relationship} /></label>
                <label>Phone<input name="emergencyPhone" type="tel" defaultValue={p.contacts[0]?.phone} /></label>
              </div>
              <div className="formfooter"><span>{self ? "You can keep these up to date yourself." : "Changes are recorded in the audit trail."}</span><button className="primary" disabled={busy}>Save</button></div>
            </form>
          ) : <p className="muted">Contact details are visible to the person and HR only.</p>}
        </section>
        <section className="card">
          <div className="sectiontitle"><h3>Identity, tax and banking</h3>
            {p.canSeePrivate && <button onClick={() => { setReveal(!reveal); load(!reveal); }}>{reveal ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Show full numbers</>}</button>}</div>
          {!p.canSeePrivate ? <p className="muted">Only the person and HR can see this.</p> : (<>
            <dl className="kv">
              <dt>ID number</dt><dd>{p.sensitive.idNumber || "—"}</dd><dt>Passport</dt><dd>{p.sensitive.passportNo || "—"}</dd>
              <dt>Nationality</dt><dd>{p.sensitive.nationality || "—"}</dd>{p.sensitive.permitExpiry && <><dt>Work permit expires</dt><dd>{longDate(p.sensitive.permitExpiry)}</dd></>}
              <dt>Date of birth</dt><dd>{p.sensitive.dateOfBirth ? longDate(p.sensitive.dateOfBirth) : "—"}</dd><dt>Tax number</dt><dd>{p.sensitive.taxNumber || "—"}</dd>
              <dt>Bank</dt><dd>{p.sensitive.bankName ? `${p.sensitive.bankName} · ${p.sensitive.bankAccountType || ""}` : "—"}</dd>
              <dt>Account</dt><dd>{p.sensitive.bankAccount || "—"}{p.sensitive.branchCode ? ` · branch ${p.sensitive.branchCode}` : ""}</dd>
            </dl>
            <p className="muted-inline">Encrypted at rest. Every view is recorded in the access log.{!isAdmin && " To change these, send HR the supporting document."}</p>
            {isAdmin && (
              <details><summary>Update (HR, from a verified document)</summary>
                <form onSubmit={e => act({ action: "hr-sensitive", id, ...form(e) })}>
                  <div className="formgrid">
                    <label>SA ID number<input name="idNumber" inputMode="numeric" /></label><label>Passport<input name="passportNo" /></label>
                    <label>Nationality<input name="nationality" /></label><label>Permit expiry<input name="permitExpiry" type="date" /></label>
                    <label>Date of birth<input name="dateOfBirth" type="date" /></label><label>Tax number<input name="taxNumber" inputMode="numeric" /></label>
                    <label>Bank<input name="bankName" /></label><label>Account type<input name="bankAccountType" placeholder="Cheque / savings" /></label>
                    <label>Account number<input name="bankAccount" inputMode="numeric" /></label><label>Branch code<input name="branchCode" inputMode="numeric" /></label>
                  </div>
                  <div className="formfooter"><span>Blank fields are left unchanged.</span><button className="primary" disabled={busy}>Save</button></div>
                </form>
              </details>
            )}
          </>)}
        </section>
      </div>
    )}

    {tab === "Employment" && (<>
      <div className="card">
        <h3>Employment history</h3>
        {p.history.length === 0 && <p>No changes recorded yet.</p>}
        <ol className="timeline">{p.history.map((h: any, i: number) => <li key={i}><small>{longDate(h.date)}</small><b>{h.kind.replace("_", " ")}</b><span>{h.summary}</span></li>)}</ol>
        {isAdmin && (
          <details><summary>Add a historical entry</summary>
            <form className="inline" onSubmit={e => act({ action: "hr-history", personId: id, ...form(e) })}>
              <label>Date<input name="effectiveDate" type="date" required /></label>
              <label>Type<select name="kind">{["hire", "promotion", "transfer", "title_change", "pattern_change", "type_change", "manager_change", "exit"].map(k => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select></label>
              <label className="grow">Summary<input name="summary" required /></label><button disabled={busy}>Add</button>
            </form>
          </details>
        )}
        <p className="muted-inline">HR changes to title, department, manager, work pattern or employment type are added here automatically.</p>
      </div>
      {isAdmin && !self && (
        <div className="card">
          <h3>Change title (recorded on the history)</h3>
          <form className="inline" onSubmit={e => { const f = form(e); act({ action: "person", id, changes: { jobTitle: f.jobTitle, effectiveDate: f.effectiveDate } }); }}>
            <label className="grow">New title<input name="jobTitle" defaultValue={p.title} required /></label>
            <label>Effective<input name="effectiveDate" type="date" defaultValue={data.today} /></label><button className="primary" disabled={busy}>Save</button>
          </form>
          <p className="muted-inline">Department, manager, pattern and type are changed in the HR file tab.</p>
        </div>
      )}
    </>)}

    {tab === "Leave" && (
      <div className="card">
        <table className="grid"><thead><tr><th>Type</th><th className="num">Available</th><th className="num">Taken</th><th className="num">By cycle end</th></tr></thead>
          <tbody>{p.balances.map((b: any) => <tr key={b.code}><td>{b.label}</td><td className="num">{b.available}</td><td className="num">{b.taken}</td><td className="num">{b.projected}</td></tr>)}</tbody></table>
        <h3>Requests</h3>
        {data.leave.filter(l => l.owner === id).map(l => <div className="listrow" key={l.id}><span className="grow">{l.type} · {range(l.start, l.end)}</span><small>{l.days} d</small><Badge s={l.status} /></div>)}
      </div>
    )}

    {tab === "Credentials" && <ProfileCredentials p={p} data={data} act={act} busy={busy} self={self} />}

    {tab === "Documents" && (
      <div className="card">
        {!p.canSeePrivate ? <p className="muted">Staff documents are visible to the person and HR only.</p> : (<>
          <table className="grid"><thead><tr><th>Category</th><th>File</th><th>Uploaded</th><th>Status</th></tr></thead>
            <tbody>{p.documents.map((d: any) => <tr key={d.id}><td>{d.label}</td><td><a href={`/api/hr?file=${d.id}`}>{d.name}</a></td><td>{shortDate(d.uploaded)}</td><td><Badge s={d.status[0].toUpperCase() + d.status.slice(1)} /></td></tr>)}</tbody></table>
          {self && (
            <div className="inline">
              <span>Add a document:</span>
              {[["CONTRACT", "Signed contract"], ["CERT", "Certificate"], ["Qualifications", "Qualification"]].map(([cat, label]) => (
                <label className="upload" key={cat}>{label}<input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onChange={async ev => {
                  const f = ev.target.files?.[0]; ev.target.value = ""; if (!f) return; const fd = new FormData(); fd.set("file", f); fd.set("category", cat); if (await post(fd)) load();
                }} /></label>
              ))}
            </div>
          )}
          <p className="muted-inline">Contracts, amendments, NDAs and restraints are filed here (G1) <Rel r="R2" />. HR verifies each upload.</p>
        </>)}
      </div>
    )}

    {tab === "Performance" && (
      <div className="card">
        {p.reviews.length === 0 && <p>No reviews yet.</p>}
        {p.reviews.map((r: any) => <div className="listrow" key={r.id}><span className="grow"><b>{r.period}</b> · due {shortDate(r.due)}{r.outcome ? ` · ${r.outcome}` : ""}</span>{r.rating && <small>Rating {r.rating}/5</small>}<Badge s={st(r.state)} /></div>)}
        <p className="muted-inline">Open Performance in the menu to work on a review.</p>
      </div>
    )}

    {tab === "Assets" && (
      <div className="card">
        {p.assets.length === 0 && <p>No equipment issued.</p>}
        {p.assets.map((a: any) => (
          <div className="listrow" key={a.id}><span className="grow"><b>{a.tag}</b> {a.description}</span><small>issued {shortDate(a.assignedAt)}</small>
            {a.returnedAt ? <Badge s="Returned" /> : a.receipt ? <Badge s="Accepted" /> : self ? <button className="primary" disabled={busy} onClick={() => act({ action: "asset", op: "confirm", assignmentId: a.id })}>Confirm receipt</button> : <Badge s="Pending" />}</div>
        ))}
      </div>
    )}

    {tab === "Requests & letters" && (
      <div className="columns">
        <section className="card"><h3>Requests</h3>
          {p.requests.length === 0 && <p>None.</p>}
          {p.requests.map((r: any) => <div className="listrow" key={r.id}><span className="grow">{data.requestKinds[r.kind]} · {r.title}</span><small>{shortDate(r.created)}</small><Badge s={st(r.state)} /></div>)}
        </section>
        <section className="card"><h3>Letters</h3>
          {p.canSeePrivate ? (<>
            {p.letters.length === 0 && <p>None issued.</p>}
            {p.letters.map((l: any) => <div className="listrow" key={l.id}><span className="grow">{l.title}</span><small>{shortDate(l.created)}</small><button onClick={() => setLetter(l.id)}>Open</button></div>)}
            {isAdmin && (
              <form className="inline" onSubmit={async e => { const f = form(e); const r = await act({ action: "letter", personId: id, template: f.template, extra: { purpose: f.purpose ?? "" } }); if (r?.id) setLetter(r.id); }}>
                <select name="template">{["employment_letter", "certificate_of_service"].map(k => <option key={k} value={k}>{data.letterTemplates[k]}</option>)}</select>
                <input name="purpose" placeholder="Purpose (optional)" /><button disabled={busy}>Generate</button>
              </form>
            )}
          </>) : <p className="muted">Visible to the person and HR.</p>}
        </section>
      </div>
    )}

    {tab === "HR file" && hrFile}
    {letter && <LetterModal id={letter} close={() => setLetter(null)} />}
  </>);
}

function ProfileCredentials({ p, data, act, busy, self }: { p: any; data: HrData; act: (b: Record<string, unknown>) => Promise<any>; busy: boolean; self: boolean }) {
  const isAdmin = data.me.role === "admin";
  const kinds = Object.entries(data.credentialKinds).filter(([k]) => isAdmin || ["cpd", "course", "fica_training", "board_exam"].includes(k));
  const year = data.today.slice(0, 4);
  const cpd = p.credentials.filter((c: any) => c.kind === "cpd" && (c.issuedOn ?? "").startsWith(year)).reduce((s: number, c: any) => s + Number(c.hours ?? 0), 0);
  return (
    <div className="card">
      {p.isAdmittedAttorney && <p><b>{cpd}</b> CPD hours recorded in {year}.</p>}
      <table className="grid"><thead><tr><th>Credential</th><th>Reference</th><th>Issued</th><th>Expires</th><th>Status</th><th /></tr></thead>
        <tbody>{p.credentials.map((c: any) => <tr key={c.id}><td>{c.kindLabel}<br /><small>{c.title}{c.hours ? ` · ${c.hours} h` : ""}{c.provider ? ` · ${c.provider}` : ""}</small></td><td>{c.reference || "—"}</td>
          <td>{shortDate(c.issuedOn)}</td><td>{shortDate(c.expiresOn)}</td><td><Badge s={c.status} /></td>
          <td>{c.verified ? <small>Verified</small> : isAdmin ? <button disabled={busy} onClick={() => act({ action: "credential-verify", id: c.id })}>Verify</button> : <small>Awaiting HR</small>}</td></tr>)}</tbody></table>
      {(isAdmin || self) && (
        <details><summary>{isAdmin ? "Record a credential" : "Add CPD, a course or training"}</summary>
          <form onSubmit={e => { const f = form(e); act({ action: "credential", personId: p.id, ...f }); }}>
            <div className="formgrid">
              <label>Type<select name="kind">{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>Title<input name="title" required placeholder="e.g. LSSA ethics webinar" /></label>
              <label>Reference<input name="reference" /></label><label>Provider<input name="provider" /></label>
              <label>Issued / completed<input name="issuedOn" type="date" /></label><label>Expires<input name="expiresOn" type="date" /></label>
              <label>Hours (CPD)<input name="hours" type="number" step="0.5" min="0" /></label>
            </div>
            <div className="formfooter"><span>{isAdmin ? "Recorded as verified." : "HR verifies it against the certificate."}</span><button className="primary" disabled={busy}>Save</button></div>
          </form>
        </details>
      )}
    </div>
  );
}

// =====================================================================================================================
// Requests (E1, E3, I2, K1, M1, G4)
// =====================================================================================================================

const KIND_FIELDS: Record<string, string[]> = {
  work_arrangement: ["mode", "dateFrom", "dateTo", "where"], overtime: ["dateFrom", "hours", "matterRef", "reason"], training: ["course", "provider", "dateFrom", "amount", "reason"],
  expense: ["dateFrom", "amount", "matterRef", "category", "receipt"], employment_letter: ["purpose"], certificate_of_service: ["reason"], uif_forms: ["reason"],
  hr_query: ["subject", "message"], coi_declaration: ["party", "nature", "matterRef"],
};

export function Requests({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const [kind, setKind] = useState("work_arrangement");
  const [tab, setTab] = useState(() => data.requests.some(r => r.owner === data.me.id) || !data.requests.some(r => r.owner !== data.me.id) ? "Mine" : "To action");
  const [letter, setLetter] = useState<string | null>(null);
  const mine = data.requests.filter(r => r.owner === data.me.id);
  const forMe = data.requests.filter(r => r.owner !== data.me.id);
  const f = KIND_FIELDS[kind];
  const list = tab === "Mine" ? mine : forMe;
  const run = (id: string) => (op: string, comment?: string) => post({ action: "request-decision", id, op, comment });
  return (<>
    <div className="columns">
      <section className="card">
        <h2>New request <Rel r="R2" /></h2>
        <label>What do you need?<select value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(data.requestKinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <form key={kind} onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const v = Object.fromEntries([...fd.entries()].filter(([k, x]) => k !== "receipt" && x !== "")) as Record<string, string>;
          const { dateFrom, dateTo, amount, hours, matterRef, ...details } = v;
          let receiptId: string | undefined;
          const file = fd.get("receipt");
          if (file instanceof File && file.size) { const up = new FormData(); up.set("file", file); up.set("category", "RECEIPT"); const r = await post(up, { reload: false }); if (r?.error) return; receiptId = r.id; }
          const title = details.course || details.subject || details.purpose || (kind === "work_arrangement" ? (details.mode === "court" ? "Court attendance" : details.mode === "remote" ? "Remote work" : "Flexi hours") : undefined);
          const res = await post({ action: "request", kind, dateFrom, dateTo, amount, hours, matterRef, title, details });
          if (res?.id && receiptId) await post({ action: "request-receipt", id: res.id, documentId: receiptId });
          if (res) e.currentTarget?.reset?.();
        }}>
          <div className="formgrid">
            {f.includes("mode") && <label>Arrangement<select name="mode"><option value="remote">Work remotely</option><option value="court">At court / client (out of office)</option><option value="flexi">Flexi hours</option></select></label>}
            {f.includes("where") && <label>Where / which court<input name="where" placeholder="e.g. Pretoria High Court" /></label>}
            {f.includes("course") && <label>Course<input name="course" required /></label>}
            {f.includes("provider") && <label>Provider<input name="provider" /></label>}
            {f.includes("subject") && <label>Subject<input name="subject" required /></label>}
            {f.includes("party") && <label>Related party / client<input name="party" required /></label>}
            {f.includes("nature") && <label>Nature of the interest<input name="nature" required /></label>}
            {f.includes("category") && <label>Category<select name="category"><option>Travel (km)</option><option>Court fees</option><option>Parking</option><option>Meals</option><option>Other</option></select></label>}
            {f.includes("dateFrom") && <label>{kind === "expense" ? "Date incurred" : kind === "overtime" ? "Date worked" : "From"}<input name="dateFrom" type="date" required={kind !== "training"} /></label>}
            {f.includes("dateTo") && <label>To<input name="dateTo" type="date" /></label>}
            {f.includes("hours") && <label>Hours<input name="hours" type="number" min="0.5" step="0.5" required /></label>}
            {f.includes("amount") && <label>Amount (R)<input name="amount" type="number" min="0" step="0.01" required={kind === "expense"} /></label>}
            {f.includes("matterRef") && <label>Matter reference<input name="matterRef" /></label>}
            {f.includes("receipt") && <label>Receipt<input name="receipt" type="file" accept=".pdf,.jpg,.jpeg,.png" /></label>}
          </div>
          {f.includes("purpose") && <label>Purpose (shown on the letter)<input name="purpose" placeholder="e.g. Home-loan application" /></label>}
          {f.includes("reason") && <label>Notes<textarea name="reason" rows={2} /></label>}
          {f.includes("message") && <label>Your question<textarea name="message" rows={3} required /></label>}
          <div className="formfooter"><span>{["employment_letter", "certificate_of_service", "uif_forms", "hr_query"].includes(kind) ? "Goes to HR." : kind === "training" ? "Your manager approves, then HR." : "Goes to the person you report to."}</span><button className="primary" disabled={busy}>Submit</button></div>
        </form>
      </section>
      <section className="card">
        <h3>How requests work</h3>
        <p className="muted">Remote/court days, overtime, expenses and conflict-of-interest declarations go to your manager. Training goes to your manager and then HR. Letters, UIF forms and questions go straight to HR — letters are generated on the firm’s letterhead when HR completes them.</p>
        <p className="muted">Approved court and remote days show on reception’s roster.</p>
      </section>
    </div>
    <div className="tabs">{["Mine", ...(forMe.length || data.me.role === "admin" ? ["To action"] : [])].map(t => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t} ({t === "Mine" ? mine.length : forMe.length})</button>)}</div>
    <div className="card">
      {list.length === 0 && <p>Nothing here.</p>}
      {list.map(r => (
        <div className="listrow wrap" key={r.id}>
          <div className="grow">
            <b>{r.kindLabel}</b> · {r.title}{tab !== "Mine" && <> · <b>{r.name}</b></>}
            <p>{r.dateFrom ? range(r.dateFrom, r.dateTo ?? r.dateFrom) : shortDate(r.created)}{r.hours ? ` · ${r.hours} h` : ""}{r.amount ? ` · ${money(r.amount)}` : ""}{r.matterRef ? ` · ${r.matterRef}` : ""}
              {Object.entries(r.details).filter(([k]) => !["mode"].includes(k)).map(([k, v]) => ` · ${v}`).join("")}</p>
            <small>{["approved", "declined", "completed", "paid", "cancelled"].includes(r.state) ? "" : `With ${r.assignee}`}{r.response ? ` · HR: ${r.response}` : ""}</small>
          </div>
          {r.receiptId && <a href={`/api/hr?file=${r.receiptId}`}>Receipt</a>}
          {r.letterId && <button onClick={() => setLetter(r.letterId)}>Letter</button>}
          <Badge s={st(r.state)} />
          <Actions actions={r.actions} busy={busy} run={run(r.id)} comment={["decline"]} />
        </div>
      ))}
    </div>
    {letter && <LetterModal id={letter} close={() => setLetter(null)} />}
  </>);
}

// =====================================================================================================================
// Policies (G2, G3)
// =====================================================================================================================

export function Policies({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const [open, setOpen] = useState<string | null>(data.policies.find(p => !p.acknowledgedAt)?.id ?? null);
  const isAdmin = data.me.role === "admin";
  return (<>
    <div className="card">
      <h2>Firm policies <Rel r="R2" /></h2>
      <p className="muted">Read each policy and acknowledge it. When a policy changes, the new version is issued to everyone again.</p>
      {data.policies.map(p => (
        <div key={p.id} className="policy">
          <div className="listrow">
            <span className="grow"><b>{p.title}</b> · version {p.version} · issued {shortDate(p.issuedAt)}</span>
            {isAdmin && <small>{p.ackCount} of {p.staffCount} acknowledged</small>}
            <Badge s={p.acknowledgedAt ? "Acknowledged" : "Not acknowledged"} />
            <button onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Close" : "Read"}</button>
          </div>
          {open === p.id && (<>
            <div className="particulars"><Rich text={p.text} /></div>
            {p.acknowledgedAt ? <p className="muted-inline">You acknowledged this on {when(p.acknowledgedAt)}.</p>
              : <div className="formfooter"><span>Acknowledging records which version you read, and when.</span><button className="primary" disabled={busy} onClick={() => post({ action: "acknowledge", id: p.id })}>I have read and understood this policy</button></div>}
          </>)}
        </div>
      ))}
    </div>
    {isAdmin && (
      <div className="card">
        <h3>Publish a policy or a new version</h3>
        <form onSubmit={async e => { const f = form(e); if (await post({ action: "policy-publish", ...f })) e.currentTarget?.reset?.(); }}>
          <label>Title (same title = new version)<input name="title" required list="policy-titles" /></label>
          <datalist id="policy-titles">{data.policies.map(p => <option key={p.id} value={p.title} />)}</datalist>
          <label>Text<textarea name="body" rows={8} required /></label>
          <div className="formfooter"><span>Everyone is asked to acknowledge it.</span><button className="primary" disabled={busy}>Publish</button></div>
        </form>
      </div>
    )}
  </>);
}

// =====================================================================================================================
// Performance (H1–H3)
// =====================================================================================================================

export function Performance({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const r = data.reviews.find(x => x.id === open);
  const canStart = data.me.role === "admin" || data.me.isManager;
  const team = data.people.filter(p => p.id !== data.me.id && (data.me.role === "admin" || p.reportsToId === data.me.id));
  return (<>
    <div className="card">
      <h2>Probation and reviews <Rel r="R2" /></h2>
      <table className="grid"><thead><tr><th>Person</th><th>Review</th><th>Reviewer</th><th>Due</th><th>Stage</th><th /></tr></thead>
        <tbody>{data.reviews.map(x => <tr key={x.id} className={x.id === open ? "sel" : ""}><td>{x.name}</td><td>{x.period}</td><td>{x.reviewer || "—"}</td>
          <td className={x.due < data.today && !["locked", "confirmed", "terminated"].includes(x.state) ? "late" : ""}>{shortDate(x.due)}</td><td><Badge s={st(x.state)} /></td>
          <td><button onClick={() => setOpen(x.id === open ? null : x.id)}>{x.actions.length ? "Open" : "View"}</button></td></tr>)}</tbody></table>
      {canStart && team.length > 0 && (
        <form className="inline" onSubmit={e => { const f = form(e); post({ action: "review-start", ...f }); }}>
          <span>Start a review for</span>
          <select name="personId">{team.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select name="kind"><option value="annual">Annual review</option><option value="probation">Probation</option></select>
          <button disabled={busy}>Start</button>
        </form>
      )}
    </div>
    {r && <ReviewCard key={r.id + r.state} r={r} data={data} post={post} busy={busy} openLetter={setLetter} />}
    {letter && <LetterModal id={letter} close={() => setLetter(null)} />}
  </>);
}

function ReviewCard({ r, data, post, busy, openLetter }: { r: any; data: HrData; post: Post; busy: boolean; openLetter: (id: string) => void }) {
  const [goals, setGoals] = useState<{ goal: string; measure: string; training: string }[]>(r.goals?.length ? r.goals : [{ goal: "", measure: "", training: "" }]);
  const editable = r.actions.some((a: string) => ["submit_self", "submit_feedback"].includes(a));
  const run = (action: string, payload: Record<string, unknown> = {}) => post({ ...payload, action: "review", id: r.id, reviewAction: action });
  return (
    <div className="card">
      <div className="sectiontitle"><h2>{r.name} — {r.period}</h2><Badge s={st(r.state)} /></div>
      <p className="muted">{range(r.periodStart, r.periodEnd)} · reviewer {r.reviewer || "—"} · due {longDate(r.due)}{r.outcome ? ` · outcome: ${r.outcome}` : ""}</p>
      {r.kind === "probation" ? (<>
        <h3>Milestones</h3>
        {(r.milestones as any[]).map((m, i) => (
          <label className="check" key={i}><input type="checkbox" checked={m.done} disabled={busy || !(data.me.role === "admin" || r.reviewer === data.me.name) || ["confirmed", "terminated"].includes(r.state)}
            onChange={() => run("milestone", { milestone: i })} /> {m.label} — {shortDate(m.due)}</label>
        ))}
        {r.actions.length > 0 && (
          <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const a = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "confirm";
            run(a, { comment: f.get("comment") || undefined, until: f.get("until") || undefined }); }}>
            <label>Reasons / notes (included in the letter for an extension or ending)<textarea name="comment" rows={3} /></label>
            <label>Extend to<input type="date" name="until" /></label>
            <div className="formfooter"><span>Each decision generates the letter.</span>
              <span className="inline">{r.actions.map((a: string) => <button key={a} value={a} className={a === "confirm" ? "primary" : ""} disabled={busy}>{ACTION_LABEL[a]}</button>)}</span></div>
          </form>
        )}
      </>) : (<>
        <div className="columns">
          <section><h3>Self-assessment</h3>
            {r.actions.includes("submit_self") ? <textarea id="selfAssessment" rows={6} defaultValue={r.selfAssessment} placeholder="What went well, what was hard, what you want to learn next." /> : <p className="particulars">{r.selfAssessment || "Not submitted yet."}</p>}
          </section>
          <section><h3>Manager feedback</h3>
            {r.actions.includes("submit_feedback") ? (<>
              <textarea id="managerFeedback" rows={5} defaultValue={r.managerFeedback} />
              <label>Overall rating<select id="rating" defaultValue={r.rating ?? 3}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {["Below expectations", "Partly meets", "Meets", "Exceeds", "Outstanding"][n - 1]}</option>)}</select></label>
            </>) : <p className="particulars">{r.managerFeedback || (r.state === "self_assessment" || r.state === "manager_review" ? "Shared with the employee once the manager submits it." : "—")}{r.rating ? `\n\nRating: ${r.rating}/5` : ""}</p>}
          </section>
        </div>
        <h3>Goals and development</h3>
        <table className="grid"><thead><tr><th>Goal</th><th>How it is measured</th><th>Training needed</th></tr></thead>
          <tbody>{goals.map((g, i) => <tr key={i}>{(["goal", "measure", "training"] as const).map(k => <td key={k}>{editable
            ? <input aria-label={k} value={g[k]} onChange={e => setGoals(goals.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /> : g[k] || "—"}</td>)}</tr>)}</tbody></table>
        {editable && <button onClick={() => setGoals([...goals, { goal: "", measure: "", training: "" }])}>Add goal</button>}
        <div className="formfooter"><span>{r.state === "employee_ack" ? "Acknowledging locks the review." : ""}</span>
          <Actions actions={r.actions} busy={busy} run={a => {
            const v = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value;
            run(a, { selfAssessment: v("selfAssessment"), managerFeedback: v("managerFeedback"), rating: v("rating"), goals: editable ? goals.filter(g => g.goal.trim().length >= 2) : undefined });
          }} /></div>
      </>)}
      {r.letterId && <button onClick={() => openLetter(r.letterId)}>Open outcome letter</button>}
    </div>
  );
}

// =====================================================================================================================
// Credentials register (F1–F5)
// =====================================================================================================================

export function Credentials({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const [reg, setReg] = useState<any>(null);
  const [filter, setFilter] = useState("Attention");
  const [err, setErr] = useState("");
  const load = () => get("view=credentials").then(setReg).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="error">{err}</div>;
  if (!reg) return <div className="card"><p>Loading…</p></div>;
  const rows = reg.rows.filter((r: any) => filter === "All" || (filter === "Attention" ? ["Lapsed", "Expiring"].includes(r.status) : r.kind === filter));
  return (<>
    <div className="tiles">
      <div className="tile alert"><small>Lapsed</small><b>{reg.summary.lapsed}</b></div>
      <div className="tile"><small>Expiring in 90 days</small><b>{reg.summary.expiring}</b></div>
      <div className="tile"><small>FICA training done</small><b>{reg.fica.filter((f: any) => f.done).length}/{reg.fica.length}</b></div>
    </div>
    <div className="card">
      <div className="sectiontitle"><h2>Credentials register <Rel r="R2" /></h2>
        <select aria-label="Filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="Attention">Needs attention</option><option value="All">All</option>
          {Object.entries(data.credentialKinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <p className="muted">Reminders go to the person and HR at 90, 60, 30 and 7 days before expiry.</p>
      <table className="grid"><thead><tr><th>Person</th><th>Credential</th><th>Reference</th><th>Expires</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((c: any) => <tr key={c.id}><td>{c.person}</td><td>{c.kindLabel}<br /><small>{c.title}</small></td><td>{c.reference || "—"}</td>
          <td>{shortDate(c.expiresOn)}{c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= 90 ? <small> · {c.daysLeft} d</small> : null}</td><td><Badge s={c.status} /></td>
          <td>{!c.verified && <button disabled={busy} onClick={async () => { if (await post({ action: "credential-verify", id: c.id })) load(); }}>Verify</button>}</td></tr>)}</tbody></table>
    </div>
    <div className="columns">
      <section className="card"><h3>CPD hours this year (admitted attorneys)</h3>
        {reg.cpd.map((c: any) => <div className="listrow" key={c.personId}><span className="grow">{c.name}</span><b>{c.hours}</b><small>hours</small></div>)}</section>
      <section className="card"><h3>Candidate attorneys</h3>
        {reg.candidateAttorneys.map((ca: any) => <div key={ca.personId}><b>{ca.name}</b>{ca.items.length === 0 ? <p className="muted">Nothing recorded.</p>
          : ca.items.map((i: any) => <div className="listrow" key={i.id}><span className="grow">{i.title}</span><small>{i.details?.result || i.details?.status || shortDate(i.issuedOn)}</small></div>)}</div>)}
        <h3>FICA / RMCP training</h3>
        <p>{reg.fica.filter((f: any) => !f.done).map((f: any) => f.name).join(", ") || "Everyone is up to date."}</p>
        {reg.fica.some((f: any) => !f.done) && <small className="muted">Not yet trained (above).</small>}
      </section>
    </div>
    <div className="card"><h3>Record a credential for someone</h3>
      <form onSubmit={async e => { const f = form(e); if (await post({ action: "credential", ...f })) load(); }}>
        <div className="formgrid">
          <label>Person<select name="personId">{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Type<select name="kind">{Object.entries(data.credentialKinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Title<input name="title" required /></label><label>Reference<input name="reference" /></label>
          <label>Issued<input name="issuedOn" type="date" /></label><label>Expires<input name="expiresOn" type="date" /></label>
          <label>Hours<input name="hours" type="number" step="0.5" min="0" /></label><label>Provider<input name="provider" /></label>
        </div>
        <div className="formfooter"><span /><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </div>
  </>);
}

// =====================================================================================================================
// Assets (J1, J2)
// =====================================================================================================================

export function Assets({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  return (<>
    <div className="card">
      <h2>Equipment register <Rel r="R3" /></h2>
      <table className="grid"><thead><tr><th>Tag</th><th>Item</th><th>Serial</th><th>With</th><th /></tr></thead>
        <tbody>{data.assets.assets.map(a => <tr key={a.id}><td>{a.tag}</td><td>{a.description}<br /><small>{a.type}</small></td><td>{a.serial || "—"}</td>
          <td>{a.holder ? <>{a.holder} {a.receipt ? <Badge s="Accepted" /> : <Badge s="Pending" />}</> : <small>In store</small>}</td>
          <td>{a.assignmentId ? <button disabled={busy} onClick={() => { const c = window.prompt("Condition on return:", "Good"); if (c != null) post({ action: "asset", op: "return", assignmentId: a.assignmentId, condition: c }); }}>Record return</button>
            : <form className="inline" onSubmit={e => { const f = form(e); post({ action: "asset", op: "assign", assetId: a.id, personId: f.personId, description: a.description }); }}>
                <select name="personId" aria-label="Assign to">{data.people.filter(p => p.status === "Complete").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={busy}>Issue</button></form>}</td></tr>)}</tbody></table>
    </div>
    <div className="card"><h3>Add equipment</h3>
      <form className="inline" onSubmit={e => { const f = form(e); post({ action: "asset", op: "create", ...f }); }}>
        <label>Tag<input name="tag" required placeholder="MVR-LT-020" /></label>
        <label>Type<select name="type">{["laptop", "phone", "access_card", "keys", "software_account", "other"].map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="grow">Description<input name="description" required /></label><label>Serial<input name="serial" /></label><button className="primary" disabled={busy}>Add</button>
      </form>
    </div>
  </>);
}

// =====================================================================================================================
// Offboarding (N1–N3, N5)
// =====================================================================================================================

export function Offboarding({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const [open, setOpen] = useState<string | null>(data.offboardings[0]?.id ?? null);
  const o = data.offboardings.find(x => x.id === open);
  const isAdmin = data.me.role === "admin";
  const cmd = (body: Record<string, unknown>) => post({ action: "offboarding", id: o!.id, ...body });
  return (<>
    <div className="card">
      <h2>Leavers <Rel r="R2" /></h2>
      {data.offboardings.length === 0 && <p>No one is leaving.</p>}
      {data.offboardings.map(x => <div className="listrow" key={x.id}><span className="grow"><b>{x.name}</b> · {x.type.replace("_", " ")} · last day {longDate(x.lastWorkingDay)}</span>
        <div className="bar" aria-label={`${x.progress}% complete`}><span style={{ width: `${x.progress}%` }} /></div><small>{x.progress}%</small><button onClick={() => setOpen(x.id)}>Open</button></div>)}
      {isAdmin && (
        <form className="inline" onSubmit={e => { const f = form(e); post({ action: "offboarding-start", ...f }); }}>
          <span>Start offboarding:</span>
          <select name="personId">{data.people.filter(p => p.id !== data.me.id && p.employmentStatus !== "on_notice").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select name="type">{["resignation", "dismissal", "retrenchment", "contract_end", "retirement", "death", "other"].map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select>
          <label>Notice given<input name="noticeDate" type="date" defaultValue={data.today} required /></label>
          <label>Last day<input name="lastWorkingDay" type="date" required /></label><button disabled={busy}>Start</button>
        </form>
      )}
    </div>
    {o && (
      <div className="columns">
        <section className="card">
          <h3>{o.name} — checklist</h3>
          {o.checklist.map((c: any) => <label className="check" key={c.key}><input type="checkbox" checked={c.done} disabled={busy} onChange={() => cmd({ op: "check", key: c.key })} /> {c.label} <small>({c.owner}{c.doneAt ? ` · ${shortDate(c.doneAt)}` : ""})</small></label>)}
          {isAdmin && <div className="inline"><button disabled={busy} onClick={() => cmd({ op: "certificate" })}>Generate certificate of service</button></div>}
        </section>
        <section className="card">
          <h3>Matter handovers</h3>
          {o.handovers.length === 0 && <p className="muted">None yet.</p>}
          {o.handovers.map((h: any) => <div className="listrow" key={h.index}><span className="grow"><b>{h.matterRef}</b> → {h.to}{h.notes ? <small> · {h.notes}</small> : null}</span>
            {h.accepted ? <Badge s="Accepted" /> : h.toPersonId === data.me.id ? <button className="primary" disabled={busy} onClick={() => cmd({ op: "accept", index: h.index })}>Accept</button> : <Badge s="Pending" />}</div>)}
          <form className="inline" onSubmit={e => { const f = form(e); cmd({ op: "handover", ...f }); }}>
            <input name="matterRef" placeholder="Matter ref" required /><select name="toPersonId">{data.colleagues.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input name="notes" placeholder="Notes" /><button disabled={busy}>Add</button>
          </form>
          <div className="formfooter"><span>{o.signedOff ? "Signed off by the manager." : "Every handover must be accepted first."}</span>
            {!o.signedOff && <button className="primary" disabled={busy || o.handovers.some((h: any) => !h.accepted)} onClick={() => cmd({ op: "sign_off" })}>Manager sign-off</button>}</div>
          <h3>Exit interview</h3>
          {o.exitInterviewDone ? (isAdmin && o.exitInterview ? <dl className="kv">{Object.entries(o.exitInterview).filter(([k]) => k !== "submittedAt").map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>)}</dl> : <p>Completed.</p>)
            : o.personId === data.me.id || isAdmin ? (
              <form onSubmit={e => { const f = form(e); cmd({ op: "exit_interview", answers: f }); }}>
                <label>Main reason for leaving<input name="reason" /></label><label>What should the firm keep doing?<textarea name="keep" rows={2} /></label>
                <label>What should change?<textarea name="change" rows={2} /></label><label>Would you return?<select name="return"><option>Yes</option><option>Maybe</option><option>No</option></select></label>
                <div className="formfooter"><span>Seen by HR only.</span><button disabled={busy}>Submit</button></div>
              </form>) : <p className="muted">Not yet completed.</p>}
        </section>
      </div>
    )}
  </>);
}

// =====================================================================================================================
// HR cases (L1, L2) — named officers only
// =====================================================================================================================

export function Cases({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const [cases, setCases] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const load = () => get("view=cases").then(setCases);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const c = cases?.find(x => x.id === open);
  const cmd = async (body: Record<string, unknown>) => { const r = await post(body, { reload: false }); if (r?.error) return alert(r.error); await load(); if (r?.letterId) setLetter(r.letterId); };
  const admins = data.people.filter(p => p.role === "admin");
  return (<>
    <div className="warn">Confidential. Only the officers named on a case can see it — other HR administrators cannot. Every view is logged. <Rel r="R3" /></div>
    <div className="card">
      <h2>Cases</h2>
      {!cases ? <p>Loading…</p> : cases.length === 0 ? <p>No cases assigned to you.</p> : cases.map(x => (
        <div className="listrow" key={x.id}><span className="grow"><b>{x.caseNo}</b> · {x.kind} · {x.person}<small> · officers: {x.officers.join(", ")}</small></span><Badge s={x.status === "open" ? "Open" : "Complete"} /><button onClick={() => setOpen(x.id)}>Open</button></div>
      ))}
      <details><summary>Open a case</summary>
        <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); cmd({ action: "case", op: "open", personId: fd.get("personId"), kind: fd.get("kind"), summary: fd.get("summary"), officerIds: fd.getAll("officerIds") }); }}>
          <div className="formgrid">
            <label>Employee<select name="personId">{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Type<select name="kind">{["disciplinary", "grievance", "incapacity", "performance"].map(k => <option key={k}>{k}</option>)}</select></label>
          </div>
          <label>Summary<textarea name="summary" rows={2} required /></label>
          <fieldset><legend>Also give access to</legend>{admins.filter(a => a.id !== data.me.id).map(a => <label className="check" key={a.id}><input type="checkbox" name="officerIds" value={a.id} /> {a.name}</label>)}</fieldset>
          <div className="formfooter"><span /><button className="primary" disabled={busy}>Open case</button></div>
        </form>
      </details>
    </div>
    {c && (
      <div className="card">
        <div className="sectiontitle"><h2>{c.caseNo} — {c.person}</h2><span>{c.kind}</span></div>
        <p>{c.summary}</p>
        <ol className="timeline">{c.notes.map((n: any, i: number) => <li key={i}><small>{when(n.at)}</small><b>{n.by}</b><span>{n.text}</span></li>)}</ol>
        {c.status === "open" && (<>
          <form className="inline" onSubmit={e => { const f = form(e); cmd({ action: "case", op: "note", id: c.id, text: f.text }); e.currentTarget.reset(); }}>
            <input className="grow" name="text" placeholder="Add a note (investigation, meeting, evidence received…)" required /><button disabled={busy}>Add note</button>
          </form>
          <form className="inline" onSubmit={e => { const f = form(e); const { template, ...extra } = f; cmd({ action: "case", op: "letter", id: c.id, template, extra }); }}>
            <select name="template">{["hearing_notice", "grievance_acknowledgement", "outcome_letter"].map(k => <option key={k} value={k}>{data.letterTemplates[k]}</option>)}</select>
            <input name="when" placeholder="Date and time" /><input name="where" placeholder="Venue" /><input name="allegations" placeholder="Allegations / finding" />
            <button disabled={busy}>Generate letter</button>
          </form>
          <button disabled={busy} onClick={() => cmd({ action: "case", op: "close", id: c.id })}>Close case</button>
        </>)}
      </div>
    )}
    {letter && <LetterModal id={letter} close={() => setLetter(null)} />}
  </>);
}

// =====================================================================================================================
// Announcements (M3), reminders (M4) and the roster (E4)
// =====================================================================================================================

export function Announcements({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  return (<>
    <div className="card"><h2>Announcements <Rel r="R3" /></h2>
      {data.announcements.map(a => <div className="announcement" key={a.id}><b>{a.pinned ? "📌 " : ""}{a.title}</b><small> · {shortDate(a.published)} · {a.audience}</small><p>{a.body}</p></div>)}
    </div>
    <div className="card"><h3>Post an announcement</h3>
      <form onSubmit={async e => { e.preventDefault(); const fd = new FormData(e.currentTarget); const aud = String(fd.get("audience"));
        await post({ action: "announcement", title: fd.get("title"), body: fd.get("body"), pinned: fd.get("pinned") === "on", expiresOn: fd.get("expiresOn") || undefined,
          audience: aud.startsWith("dept:") ? "department" : "all", audienceValue: aud.startsWith("dept:") ? aud.slice(5) : undefined }); }}>
        <label>Title<input name="title" required /></label><label>Message<textarea name="body" rows={4} required /></label>
        <div className="formgrid"><label>Audience<select name="audience"><option value="all">Everyone</option>{data.departments.map(d => <option key={d.id} value={`dept:${d.id}`}>{d.name}</option>)}</select></label>
          <label>Show until<input name="expiresOn" type="date" /></label></div>
        <label className="check"><input type="checkbox" name="pinned" /> Pin to the top of Home</label>
        <div className="formfooter"><span /><button className="primary" disabled={busy}>Post</button></div>
      </form>
    </div>
  </>);
}

export function HomeExtras({ data, go }: { data: HrData; go: (page: string) => void }) {
  const ann = data.announcements.slice(0, 3);
  if (!ann.length && !data.reminders.length) return null;
  return (
    <div className="columns">
      {ann.length > 0 && <section className="card"><h3>Announcements <Rel r="R3" /></h3>{ann.map(a => <div className="announcement" key={a.id}><b>{a.pinned ? "📌 " : ""}{a.title}</b><p>{a.body}</p></div>)}</section>}
      {data.reminders.length > 0 && <section className="card"><h3>Reminders <Rel r="R3" /></h3>
        {data.reminders.slice(0, 8).map((r, i) => <div className={"listrow rem " + r.level} key={i}><span className="grow">{r.text}</span>{data.nav.includes(r.page) && <button onClick={() => go(r.page)}>Open</button>}</div>)}</section>}
    </div>
  );
}

export function Roster({ data }: { data: HrData }) {
  const [week, setWeek] = useState<string | undefined>();
  const [r, setR] = useState<any>(null);
  useEffect(() => { get(`view=roster${week ? `&week=${week}` : ""}`).then(setR); }, [week]);
  const shift = (n: number) => { const d = new Date(`${r.days[0].date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * n); setWeek(d.toISOString().slice(0, 10)); };
  if (!r) return <div className="card"><p>Loading…</p></div>;
  const cls = (c: string) => c === "Office" ? "in" : c === "Away" ? "away" : c.startsWith("Court") ? "court" : c === "Remote" ? "remote" : "off";
  return (
    <div className="card">
      <div className="sectiontitle"><h2>Who’s in this week <Rel r="R2" /></h2>
        <span className="inline"><button onClick={() => shift(-1)}>Previous</button><button onClick={() => setWeek(undefined)}>This week</button><button onClick={() => shift(1)}>Next</button></span></div>
      <p className="muted">For reception: office, remote, court or away. Reasons for leave are never shown.</p>
      <div style={{ overflowX: "auto" }}><table className="grid roster"><thead><tr><th>Person</th>{r.days.map((d: any) => <th key={d.date}>{d.label.split(" ").slice(0, 3).join(" ")}{d.holiday && <><br /><small>{d.holiday}</small></>}</th>)}</tr></thead>
        <tbody>{r.people.map((p: any) => <tr key={p.id}><td><b>{p.name}</b><br /><small>{p.title}</small></td>{p.cells.map((c: string, i: number) => <td key={i} className={"cell " + cls(c)}>{c}</td>)}</tr>)}</tbody></table></div>
      {data.me.role !== "viewer" && <p className="muted-inline">Court and remote days come from approved requests.</p>}
    </div>
  );
}

export function PayrollChanges({ post, busy, today }: { post: Post; busy: boolean; today: string }) {
  const [rep, setRep] = useState<any>(null);
  // Default: from the start of last month, so the report is useful early in a month too.
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1);
  const first = d.toISOString().slice(0, 10);
  return (
    <div className="card spaced">
      <h2>Payroll changes for the month <Rel r="R2" /></h2>
      <p className="muted">Hires, exits and leave payouts, unpaid leave, approved overtime and expense reimbursements — the list payroll needs each month.</p>
      <form className="inline" onSubmit={async e => { const f = form(e); const r = await post({ action: "payroll-changes", ...f }, { reload: false }); if (r && !r.error) setRep(r); }}>
        <label>From<input name="from" type="date" defaultValue={first} /></label><label>To<input name="to" type="date" defaultValue={today} /></label>
        <button disabled={busy}>Show</button>{rep && <button onClick={e => { e.preventDefault(); download(rep.fileName, rep.csv); }}><Download size={14} /> CSV</button>}
      </form>
      {rep && (rep.lines.length === 0 ? <p>No changes in this period.</p> : <table className="grid"><thead><tr><th>Emp. no.</th><th>Name</th><th>Change</th><th>Detail</th><th className="num">Quantity</th></tr></thead>
        <tbody>{rep.lines.map((l: any, i: number) => <tr key={i}><td>{l.employeeNo}</td><td>{l.name}</td><td>{l.change}</td><td>{l.detail}</td><td className="num">{l.quantity}</td></tr>)}</tbody></table>)}
    </div>
  );
}

