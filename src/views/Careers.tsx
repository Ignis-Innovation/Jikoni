// Public careers page — no login. Lists the jobs HR has published and lets
// anyone apply with a CV. Applications are auto-scored server-side (apply_to_job)
// and land, ranked, back in the HR Recruitment tab. Uses the shared anon
// Supabase client; access is governed entirely by RLS + the anon RPC grants.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { BrandMark } from "../components/icons";
import { educationLevels, educationLabel, employmentLabel } from "../data";

interface PublicJob {
  ref: string; roleTitle: string; dept: string | null; location: string | null;
  employmentType: string; description: string | null; reqSkills: string[];
  minYears: number; minEducation: string; closesAt: string | null;
}

/* ---- tiny inline icons (keep the page self-contained) ---- */
const IPin = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>;
const IBrief = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" /></svg>;
const IDept = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M6 21V7l6-4 6 4v14M10 9h.01M14 9h.01M10 13h.01M14 13h.01M10 17h.01M14 17h.01" /></svg>;
const IClock = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const IArrow = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const IUpload = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>;
const ICheck = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>;

const closesLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function Careers() {
  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(
    new URLSearchParams(window.location.search).get("job")
  );

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("list_public_jobs");
      if (error) { setErr(error.message); setJobs([]); return; }
      setJobs((data ?? []) as PublicJob[]);
    })();
  }, []);

  const selected = useMemo(() => jobs?.find((j) => j.ref === selectedRef) ?? null, [jobs, selectedRef]);

  function pick(ref: string | null) {
    setSelectedRef(ref);
    const url = ref ? `${window.location.pathname}?job=${ref}` : window.location.pathname;
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="careers">
      <header className="crs-nav">
        <div className="mark"><BrandMark /></div>
        <div>
          <div className="n">Jikoni</div>
          <div className="s">Careers</div>
        </div>
        <div className="spacer" />
        <span className="live"><span className="dot" /> We're hiring</span>
      </header>

      {!selected && (
        <section className="crs-hero">
          <span className="crs-eyebrow">◍ Join the team</span>
          <h1>Build clean-energy access <em>across Kenya</em></h1>
          <p>We're a team of operators, engineers and field leaders bringing clean cooking to millions. Find your role below.</p>
        </section>
      )}

      <main className="crs-wrap">
        {err && <div className="crs-empty" style={{ color: "var(--red)" }}>Couldn't load roles: {err}</div>}
        {!jobs && !err && <div className="crs-empty">Loading open roles…</div>}
        {jobs && jobs.length === 0 && !err && (
          <div className="crs-empty">No open roles right now — please check back soon.</div>
        )}

        {selected ? (
          <JobDetail job={selected} onBack={() => pick(null)} />
        ) : jobs && jobs.length > 0 ? (
          <>
            <div className="crs-sec-h">
              <h2>Open roles</h2>
              <span className="count">{jobs.length} position{jobs.length === 1 ? "" : "s"}</span>
            </div>
            <div className="crs-grid">
              {jobs.map((j) => (
                <button key={j.ref} className="crs-card" onClick={() => pick(j.ref)}>
                  <div className="crs-card-top">
                    <h3>{j.roleTitle}</h3>
                    <span className="ref">{j.ref}</span>
                  </div>
                  <div className="crs-meta">
                    {j.dept && <span className="crs-chip"><IDept />{j.dept}</span>}
                    {j.location && <span className="crs-chip"><IPin />{j.location}</span>}
                    <span className="crs-chip"><IBrief />{employmentLabel(j.employmentType)}</span>
                    {j.closesAt && <span className="crs-chip"><IClock />Closes {closesLabel(j.closesAt)}</span>}
                  </div>
                  {j.description && <div className="crs-desc">{j.description}</div>}
                  {j.reqSkills.length > 0 && (
                    <div className="crs-skills">
                      {j.reqSkills.slice(0, 5).map((s) => <span key={s} className="crs-skill">{s}</span>)}
                      {j.reqSkills.length > 5 && <span className="crs-skill">+{j.reqSkills.length - 5}</span>}
                    </div>
                  )}
                  <span className="crs-cta">View &amp; apply <IArrow /></span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </main>

      <footer className="crs-foot">© {new Date().getFullYear()} Jikoni · Clean cooking for Kenya · Every application is reviewed by our team.</footer>
    </div>
  );
}

function JobDetail({ job, onBack }: { job: PublicJob; onBack: () => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", years: "0", skills: "", education: "diploma" });
  const [cv, setCv] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.name.trim()) { setErr("Please enter your name."); return; }
    if (!f.email.trim()) { setErr("Please enter your email."); return; }
    setBusy(true);
    try {
      let cvPath: string | null = null;
      if (cv) {
        const safe = cv.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${job.ref}/${crypto.randomUUID()}-${safe}`;
        const up = await supabase.storage.from("job-applications").upload(path, cv, { upsert: false });
        if (up.error) throw up.error;
        cvPath = up.data.path;
      }
      const skills = f.skills.split(",").map((s) => s.trim()).filter(Boolean);
      const { error } = await supabase.rpc("apply_to_job", {
        p_req_ref: job.ref, p_name: f.name.trim(), p_email: f.email.trim(), p_phone: f.phone.trim() || null,
        p_years: Number(f.years) || 0, p_skills: skills, p_education: f.education, p_cv_path: cvPath,
      });
      if (error) throw error;
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setErr(e.message || "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="crs-success">
        <div className="crs-check"><ICheck /></div>
        <h2>Application received</h2>
        <p>Thanks, {f.name.split(" ")[0]}. Your application for <strong>{job.roleTitle}</strong> is in — our team will be in touch if you're shortlisted.</p>
        <button className="btn" onClick={onBack}>← Back to open roles</button>
      </div>
    );
  }

  const criteria = [
    job.reqSkills.length ? job.reqSkills.join(", ") : null,
    job.minYears > 0 ? `${job.minYears}+ years' experience` : null,
    job.minEducation !== "none" ? educationLabel(job.minEducation) : null,
  ].filter(Boolean);

  return (
    <div className="crs-detail">
      <div className="crs-main">
        <button className="crs-back" onClick={onBack}>← All roles</button>
        <h1>{job.roleTitle}</h1>
        <div className="crs-meta">
          {job.dept && <span className="crs-chip"><IDept />{job.dept}</span>}
          {job.location && <span className="crs-chip"><IPin />{job.location}</span>}
          <span className="crs-chip"><IBrief />{employmentLabel(job.employmentType)}</span>
          {job.closesAt && <span className="crs-chip"><IClock />Closes {closesLabel(job.closesAt)}</span>}
        </div>
        {job.description && <p className="lead">{job.description}</p>}
        {criteria.length > 0 && (
          <>
            <div className="crs-block-h">What we're looking for</div>
            {job.reqSkills.length > 0 && (
              <div className="crs-skills" style={{ marginBottom: 10 }}>
                {job.reqSkills.map((s) => <span key={s} className="crs-skill">{s}</span>)}
              </div>
            )}
            <div style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
              {[
                job.minYears > 0 ? `${job.minYears}+ years' relevant experience` : null,
                job.minEducation !== "none" ? `${educationLabel(job.minEducation)} or higher` : null,
              ].filter(Boolean).join(" · ") || "Open to all backgrounds — tell us why you're a fit."}
            </div>
          </>
        )}
      </div>

      <aside className="crs-apply">
        <div className="crs-apply-h">Apply for this role</div>
        <div className="crs-apply-sub">Takes about 2 minutes.</div>
        <form className="crs-form" onSubmit={submit}>
          <div><label className="crs-label">Full name</label><input className="field" value={f.name} onChange={set("name")} placeholder="Your name" /></div>
          <div><label className="crs-label">Email</label><input className="field" type="email" value={f.email} onChange={set("email")} placeholder="you@example.com" /></div>
          <div className="row2">
            <div><label className="crs-label">Phone</label><input className="field" value={f.phone} onChange={set("phone")} placeholder="07…" /></div>
            <div><label className="crs-label">Experience <small>yrs</small></label><input className="field" type="number" min={0} value={f.years} onChange={set("years")} /></div>
          </div>
          <div><label className="crs-label">Your skills <small>· comma-separated</small></label>
            <input className="field" value={f.skills} onChange={set("skills")} placeholder="Data collection, Excel, Community engagement" /></div>
          <div><label className="crs-label">Highest education</label>
            <select className="field" value={f.education} onChange={set("education")}>
              {educationLevels.filter((e) => e.value !== "none").map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
              <option value="none">Other</option>
            </select>
          </div>
          <div>
            <label className="crs-label">CV / résumé</label>
            <label className="crs-file">
              <IUpload />
              <span>{cv ? <span className="fname">{cv.name}</span> : "Upload PDF, doc or image"}</span>
              <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(e) => setCv(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {err && <div className="crs-err">{err}</div>}
          <button className="btn primary crs-submit" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button>
        </form>
      </aside>
    </div>
  );
}
