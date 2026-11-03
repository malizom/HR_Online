"use client";
// Leave screens (doc 06 S2, S6–S9, S17): balance cards, request with live preview and cover, my leave, cover requests, approvals, delegation.
import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, Upload } from "lucide-react";
import { Badge, KIND_LABEL, days, nameOf, range, shortDate, type Balance, type HrData, type Leave, type Post } from "./shared";

/** 10 → "10", 3.25 → "3.25", 6.5 → "6.5". */
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export function BalanceCards({ balances }: { balances: Balance[] }) {
  if (!balances.length) return null;
  return (
    <div className="balances">
      {balances.map(b => (
        <div className="balance" key={b.code}>
          <small>{b.label}</small>
          <div className="big">{num(b.available)}</div>
          <div className="sub">days available now{b.reserved > 0 ? ` · ${days(b.reserved)} pending` : ""}</div>
          {b.code === "annual" && <div className="sub">{num(b.projected)} by {shortDate(b.cycleEnd)}</div>}
          {b.carriedExpires && <div className="sub">Includes {b.carriedIn} carried · use by {shortDate(b.carriedExpires)}</div>}
          <details>
            <summary>Statement</summary>
            <table className="grid"><tbody>
              {b.statement.map((l, i) => <tr key={i}><td>{shortDate(l.date)}</td><td>{KIND_LABEL[l.kind] ?? l.kind}{l.reason && l.reason !== "Accrual" ? <small> · {l.reason}</small> : null}</td><td className="num">{l.days > 0 ? "+" : ""}{Number(l.days).toFixed(2)}</td></tr>)}
              {b.statement.length === 0 && <tr><td colSpan={3}>No entries yet this cycle.</td></tr>}
            </tbody></table>
            <small>Cycle {shortDate(b.cycleStart)} – {shortDate(b.cycleEnd)}</small>
          </details>
        </div>
      ))}
    </div>
  );
}

type PreviewT = {
  total: number; unit: string; start: string; end: string; days: { date: string; label: string; fraction: number; excluded?: string; reason?: string }[];
  balance: { before: number; after: number; projected: number; cycleEnd: string } | null;
  validation: { ok: boolean; error?: string; warnings: string[]; certificateRequired: boolean };
  coverRequired: boolean; clashCount: number; type: { label: string; category: string };
};
const emptyItem = () => ({ matterRef: "", itemType: "court_date", due: "", location: "" });

export function RequestLeave({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const me = data.me;
  const [f, setF] = useState({ type: data.leaveTypes[0]?.code ?? "annual", start: "", end: "", startHalf: "", endHalf: "", months: "4", extraDays: "0", note: "", reason: "", personId: "", coverPersonId: "" });
  const [items, setItems] = useState<ReturnType<typeof emptyItem>[]>([]);
  const [p, setP] = useState<PreviewT | null>(null);
  const [perr, setPerr] = useState("");
  const [done, setDone] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const type = data.leaveTypes.find(t => t.code === f.type);
  const parental = type?.category === "parental";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const body = () => ({
    type: f.type, start: f.start, ...(parental ? { months: f.months, extraDays: f.extraDays } : { end: f.end || f.start }),
    startHalf: f.startHalf || null, endHalf: f.endHalf || null, personId: f.personId || undefined,
  });

  useEffect(() => {
    clearTimeout(timer.current);
    if (!f.start) { setP(null); return; }
    timer.current = setTimeout(async () => {
      const r = await post({ action: "preview", ...body() }, { reload: false });
      if (r?.error) { setPerr(r.error); setP(null); } else { setPerr(""); setP(r); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [f.type, f.start, f.end, f.startHalf, f.endHalf, f.months, f.extraDays, f.personId]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjectIsMe = !f.personId || f.personId === me.id;
  const onboarded = me.status === "Complete" || !subjectIsMe;
  const coverChoices = data.colleagues.filter(c => c.id !== f.personId);

  return (
    <div className="card">
      <div className="sectiontitle"><h2>Request time away</h2>{subjectIsMe && <Badge s={me.status === "Complete" ? "Onboarding complete" : "Onboarding required"} />}</div>
      <form onSubmit={async e => {
        e.preventDefault();
        const ok = await post({ action: "leave", ...body(), note: f.note, reason: f.reason, coverPersonId: p?.coverRequired ? f.coverPersonId : undefined,
          coverItems: p?.coverRequired ? items.filter(i => i.matterRef && i.due) : undefined });
        if (ok) { setDone(`Request sent${p?.coverRequired ? ` — ${nameOf(data.colleagues, f.coverPersonId)} has been asked to cover first` : ""}.`);
          setF({ ...f, start: "", end: "", startHalf: "", endHalf: "", note: "", reason: "", coverPersonId: "" }); setItems([]); setP(null); }
      }}>
        <div className="formgrid">
          {data.can.onBehalf && (
            <label>For
              <select value={f.personId} onChange={set("personId")}>
                <option value="">Myself</option>
                {data.colleagues.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label>Leave type<select value={f.type} onChange={set("type")}>{data.leaveTypes.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}</select></label>
          <label>From<input type="date" required value={f.start} onChange={set("start")} /></label>
          {parental ? (<>
            <label>Months<input type="number" min={0} max={6} value={f.months} onChange={set("months")} /></label>
            <label>Plus days<input type="number" min={0} max={31} value={f.extraDays} onChange={set("extraDays")} /></label>
          </>) : (<>
            <label>To<input type="date" value={f.end} min={f.start} onChange={set("end")} /></label>
            {type?.allowsHalfDay && <label>First day<select value={f.startHalf} onChange={set("startHalf")}><option value="">Full day</option><option value="pm">Afternoon only</option></select></label>}
            {type?.allowsHalfDay && <label>Last day<select value={f.endHalf} onChange={set("endHalf")}><option value="">Full day</option><option value="am">Morning only</option></select></label>}
          </>)}
          <label>Note for your approver<input value={f.note} onChange={set("note")} maxLength={500} /></label>
          {["sick", "family_responsibility", "special"].includes(type?.category ?? "") &&
            <label>Private reason <small>(approver{type?.category !== "special" ? " is not shown this — HR only" : " and HR"})</small><input value={f.reason} onChange={set("reason")} maxLength={500} /></label>}
        </div>

        {perr && <div className="warn">{perr}</div>}
        {p && (
          <div className="preview" aria-live="polite">
            <div className="total">{p.total} {p.unit}</div>
            <small>{range(p.start, p.end)}</small>
            {p.balance && <p className="okline">{p.type.label}: {p.balance.before} available now → <b>{p.balance.after}</b> after this request · {p.balance.projected} by {shortDate(p.balance.cycleEnd)}</p>}
            {p.validation.ok ? <p className="okline"><Check size={14} /> Ready to submit</p> : <div className="warn"><b>Can’t submit:</b> {p.validation.error}</div>}
            {p.validation.warnings.map(w => <div className="warn" key={w}>{w}</div>)}
            {p.days.length > 0 && p.days.length <= 62 && (
              <details><summary>Day by day</summary><ul>
                {p.days.map(d => <li key={d.date} className={d.fraction === 0 ? "excluded" : ""}>{d.label} — {d.fraction === 0 ? d.reason : d.fraction === 1 ? "1 day" : "½ day"}</li>)}
              </ul></details>
            )}
          </div>
        )}

        {p?.coverRequired && (
          <div className="card coveritems" style={{ background: "#fbfcfb" }}>
            <h3>Matter cover while you are away</h3>
            <p className="muted">Fee-earners arrange cover before the request goes to the approver. Your colleague accepts first.</p>
            <label>Covering colleague
              <select required value={f.coverPersonId} onChange={set("coverPersonId")}>
                <option value="">Choose a colleague…</option>
                {coverChoices.map(c => <option key={c.id} value={c.id}>{c.name}{c.department ? ` — ${c.department}` : ""}{c.isFeeEarner ? "" : " (support)"}</option>)}
              </select>
            </label>
            <p className="muted-inline">Court dates, deadlines and consultations inside your leave:</p>
            {items.map((it, i) => (
              <div className="row" key={i}>
                <input placeholder="Matter ref" aria-label="Matter reference" value={it.matterRef} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, matterRef: e.target.value } : x))} />
                <select aria-label="Item type" value={it.itemType} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, itemType: e.target.value } : x))}>
                  <option value="court_date">Court date</option><option value="filing_deadline">Filing deadline</option><option value="consultation">Consultation</option><option value="other">Other</option>
                </select>
                <input type="datetime-local" aria-label="When" value={it.due} min={`${p.start}T00:00`} max={`${p.end}T23:59`} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, due: e.target.value } : x))} />
                <input placeholder="Location / notes" aria-label="Location" value={it.location} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, location: e.target.value } : x))} />
                <button type="button" aria-label="Remove item" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setItems([...items, emptyItem()])}><Plus size={15} /> Add a matter item</button>
          </div>
        )}

        <div className="formfooter">
          <span>{done || "Requests go to the person you report to. Self-approval is disabled."}</span>
          <button disabled={busy || !onboarded || !p?.validation.ok || (p.coverRequired && !f.coverPersonId)} className="primary">Submit request</button>
        </div>
      </form>
    </div>
  );
}

function CommentAction({ label, onSubmit, busy, required = true, placeholder }: { label: string; onSubmit: (c: string) => void; busy: boolean; required?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState("");
  if (!open) return <button disabled={busy} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="inline">
      <input autoFocus placeholder={placeholder ?? "Reason (required)"} aria-label={`${label} reason`} value={c} onChange={e => setC(e.target.value)} />
      <button disabled={busy || (required && !c.trim())} onClick={() => { onSubmit(c); setOpen(false); setC(""); }}>Confirm {label.toLowerCase()}</button>
      <button onClick={() => setOpen(false)}>Back</button>
    </span>
  );
}

const statusOf = (l: Leave) => l.certificateRequired && l.state === "pending_approval" ? "Certificate needed" : l.status;

export function MyLeave({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const me = data.me;
  const mine = data.leave.filter(l => l.owner === me.id);
  const coverForMe = data.leave.filter(l => l.cover?.personId === me.id && l.owner !== me.id && ["awaiting_cover", "approved", "pending_approval"].includes(l.state));
  const [renominate, setRenominate] = useState<Record<string, string>>({});
  return (<>
    <BalanceCards balances={data.balances} />
    <RequestLeave data={data} post={post} busy={busy} />

    {coverForMe.length > 0 && (
      <div className="card spaced">
        <h2>Cover requests for you</h2>
        {coverForMe.map(l => (
          <div className="approval" key={l.id}>
            <b>{l.name} · {l.type}</b> <Badge s={l.state === "awaiting_cover" ? "Awaiting cover" : l.cover?.received ? "Handed over" : l.status} />
            <div className="meta"><span>{range(l.start, l.end)}</span><span>{days(l.days)}</span>{l.requestNo && <span>{l.requestNo}</span>}</div>
            {l.cover!.items.length > 0 && <table className="grid"><tbody>{l.cover!.items.map((i, k) => <tr key={k}><td>{i.matterRef}</td><td>{i.itemType.replace("_", " ")}</td><td>{new Date(i.due).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" })}</td><td>{i.location}</td></tr>)}</tbody></table>}
            <div className="actions">
              {l.actions.includes("accept_cover") && <button className="primary" disabled={busy} onClick={() => post({ action: "decision", id: l.id, status: "accept_cover" })}>Accept cover</button>}
              {l.actions.includes("decline_cover") && <CommentAction label="Decline" busy={busy} onSubmit={c => post({ action: "decision", id: l.id, status: "decline_cover", comment: c })} />}
              {l.actions.includes("confirm_receipt") && <button className="primary" disabled={busy} onClick={() => post({ action: "handover", id: l.id })}>Confirm I have received the handover</button>}
              {l.state === "approved" && !l.cover!.handoverConfirmed && <span className="muted-inline">Waiting for {l.name.split(" ")[0]} to confirm the handover.</span>}
            </div>
          </div>
        ))}
      </div>
    )}

    <div className="card spaced">
      <h2>Your requests</h2>
      {mine.length === 0 && <p className="empty">No leave requests yet.</p>}
      {mine.map(l => (
        <div className="approval" key={l.id}>
          <b>{l.type}</b> <small>{l.requestNo}</small> <Badge s={statusOf(l)} />
          <div className="meta"><span>{range(l.start, l.end)}</span><span>{days(l.days)}</span>{l.cover && <span>Cover: {l.cover.name}{l.cover.handoverConfirmed ? " · handed over" : ""}</span>}</div>
          {l.note && <p className="muted-inline">{l.note}</p>}
          <div className="actions">
            {l.actions.includes("confirm_handover") && <button className="primary" disabled={busy} onClick={() => post({ action: "handover", id: l.id })}>Confirm handover to {l.cover?.name.split(" ")[0]}</button>}
            {l.actions.includes("renominate") && (<span className="inline">
              <select aria-label="New covering colleague" value={renominate[l.id] ?? ""} onChange={e => setRenominate({ ...renominate, [l.id]: e.target.value })}>
                <option value="">Choose another colleague…</option>
                {data.colleagues.filter(c => c.id !== l.cover?.personId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button disabled={busy || !renominate[l.id]} onClick={() => post({ action: "decision", id: l.id, status: "renominate", coverPersonId: renominate[l.id] })}>Ask them</button>
            </span>)}
            {l.typeCode === "sick" && ["pending_approval", "approved"].includes(l.state) && (l.certificateRequired || l.certificateReceived) && (
              l.certificateDocumentId ? <a href={"/api/hr?file=" + l.certificateDocumentId}>Medical certificate ✓</a> :
              <label className="upload"><Upload size={15} /> Upload medical certificate
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="Upload medical certificate" disabled={busy}
                  onChange={e => { const file = e.target.files?.[0]; if (file) { const fd = new FormData(); fd.set("file", file); fd.set("leaveRequestId", l.id); post(fd); } e.target.value = ""; }} /></label>)}
            {l.actions.includes("cancel") && <button disabled={busy} onClick={() => post({ action: "decision", id: l.id, status: "cancel" })}>Cancel request</button>}
          </div>
        </div>
      ))}
    </div>
  </>);
}

export function Approvals({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const me = data.me;
  const queue = data.leave.filter(l => l.actions.includes("approve")).sort((a, b) => a.start.localeCompare(b.start));
  const waitingCover = data.leave.filter(l => l.state === "awaiting_cover" && l.owner !== me.id);
  const decided = data.leave.filter(l => ["approved", "declined"].includes(l.state) && l.owner !== me.id).slice(0, 15);
  const [sel, setSel] = useState<string[]>([]);
  const bulkable = queue.filter(l => !l.certificateRequired);
  const isAdmin = me.role === "admin";
  return (<>
    <div className="card">
      <div className="sectiontitle">
        <h2>Waiting for your decision</h2>
        {bulkable.length > 1 && <button disabled={busy || !sel.length} onClick={async () => { for (const [i, id] of sel.entries()) await post({ action: "decision", id, status: "approve" }, { reload: i === sel.length - 1 }); setSel([]); }}>Approve selected ({sel.length})</button>}
      </div>
      {!isAdmin && <p className="muted">You approve leave for the {me.directReports} {me.directReports === 1 ? "person" : "people"} who report to you{data.delegations.some(d => d.delegateId === me.id) ? ", plus anyone delegated to you" : ""}.</p>}
      {queue.length === 0 && <div className="empty"><Check size={30} /><h3>Nothing waiting.</h3><p>New requests appear here and in your email.</p></div>}
      {queue.map(l => (
        <div className="approval" key={l.id}>
          {bulkable.includes(l) && queue.length > 1 && <input className="pick" type="checkbox" aria-label={`Select ${l.name}`} checked={sel.includes(l.id)} onChange={e => setSel(e.target.checked ? [...sel, l.id] : sel.filter(x => x !== l.id))} />}{" "}
          <b>{l.name} · {l.type}</b> <small>{l.requestNo}</small> <Badge s={statusOf(l)} />
          <div className="meta">
            <span>{range(l.start, l.end)}</span><span>{days(l.days)}</span>
            {l.balanceAfter != null && <span>Balance after: {l.balanceAfter}</span>}
            <span>{l.clashCount ? `${l.clashCount} others in the team away` : "No team clash"}</span>
            {l.cover && <span>Cover: {l.cover.name} ✓ accepted</span>}
            {l.certificateReceived && <span>Medical certificate received{isAdmin && l.certificateDocumentId && <> · <a href={"/api/hr?file=" + l.certificateDocumentId}>open</a></>}</span>}
          </div>
          {l.note && <p className="muted-inline">Note: {l.note}</p>}
          {l.reason && <p className="muted-inline">Reason: {l.reason}</p>}
          {l.cover && l.cover.items.length > 0 && <p className="muted-inline">{l.cover.items.length} matter item{l.cover.items.length > 1 ? "s" : ""} handed to {l.cover.name}: {l.cover.items.map(i => i.matterRef).join(", ")}</p>}
          {l.certificateRequired && <div className="warn">A medical certificate is required before approval (BCEA s23).</div>}
          <div className="actions">
            <button className="primary" disabled={busy || (l.certificateRequired && !isAdmin)} onClick={() => post({ action: "decision", id: l.id, status: "approve", waiveCertificate: l.certificateRequired && isAdmin })}>
              {l.certificateRequired && isAdmin ? "Approve (certificate seen)" : "Approve"}</button>
            <CommentAction label="Decline" busy={busy} onSubmit={c => post({ action: "decision", id: l.id, status: "decline", comment: c })} />
            {isAdmin && l.actions.includes("cancel") && <button disabled={busy} onClick={() => post({ action: "decision", id: l.id, status: "cancel" })}>Cancel</button>}
          </div>
        </div>
      ))}
    </div>

    {waitingCover.length > 0 && (
      <div className="card spaced">
        <h2>Waiting for cover</h2>
        <p className="muted">These reach you once the covering colleague accepts.</p>
        {waitingCover.map(l => <div className="listrow" key={l.id}><div className="grow"><b>{l.name} · {l.type}</b><p>{range(l.start, l.end)} · asked {l.cover?.name}</p></div><Badge s="Awaiting cover" /></div>)}
      </div>
    )}

    <Delegation data={data} post={post} busy={busy} />

    {decided.length > 0 && (
      <div className="card spaced">
        <h2>Recently decided</h2>
        {decided.map(l => <div className="listrow" key={l.id}><div className="grow"><b>{l.name} · {l.type}</b><p>{range(l.start, l.end)} · {days(l.days)}</p></div><Badge s={l.status} /></div>)}
      </div>
    )}
  </>);
}

export function Delegation({ data, post, busy }: { data: HrData; post: Post; busy: boolean }) {
  const me = data.me;
  const all = [...data.colleagues.map(c => ({ id: c.id, name: c.name })), { id: me.id, name: me.name }];
  return (
    <div className="card spaced">
      <h2>Delegate approvals</h2>
      <p className="muted">Going away? Hand your approvals to a colleague for a date range. They act on your behalf and it is recorded that way.</p>
      {data.delegations.map(d => (
        <div className="listrow" key={d.id}>
          <div className="grow"><b>{nameOf(all, d.delegatorId)} → {nameOf(all, d.delegateId)}</b><p>{range(d.start, d.end)}</p></div>
          {(d.delegatorId === me.id || me.role === "admin") && <button disabled={busy} onClick={() => post({ action: "revoke-delegation", id: d.id })}>End delegation</button>}
        </div>
      ))}
      <form className="inline" onSubmit={async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.currentTarget)); if (await post({ action: "delegate", ...fd, delegatorId: fd.delegatorId || undefined })) e.currentTarget?.reset(); }}>
        {me.role === "admin" && <label>Approver<select name="delegatorId" defaultValue=""><option value="">Me</option>{data.colleagues.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label>Delegate to<select name="delegateId" required defaultValue=""><option value="" disabled>Choose…</option>{data.colleagues.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>From<input type="date" name="start" required /></label>
        <label>To<input type="date" name="end" required /></label>
        <button disabled={busy}>Delegate</button>
      </form>
    </div>
  );
}

