// Vercel serverless function: CV scan (no external AI / no API key).
// HR triggers this for a candidate. It reads the actual uploaded CV from the
// private 'job-applications' bucket (service-role), extracts the text (PDF via
// pdf-parse, DOCX via mammoth), and checks whether the CV genuinely evidences
// the job's required skills / experience / education — rather than trusting the
// applicant's self-reported form answers. The verdict is written back onto the
// candidate row (shown, ranked, in Recruitment). Server-only: uses the
// service-role key, which never reaches the browser.
//
// Requires these env vars (Vercel project settings + .env.local for `vercel dev`):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "@supabase/supabase-js";
// Import the lib file directly — pdf-parse's index.js has a debug block that
// references `module.parent` (undefined under ESM). v1 does text extraction in
// pure JS (no canvas), which the serverless runtime needs.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";

const EDU_LABEL = { none: "No formal requirement", certificate: "Certificate", diploma: "Diploma", degree: "Degree", masters: "Master's" };
const EDU_RANK = { none: 0, certificate: 1, diploma: 2, degree: 3, masters: 4 };

// Detect the highest education level mentioned in the CV text.
function detectEducation(text) {
  if (/\b(ph\.?d|doctorate|dphil)\b/.test(text)) return { rank: 4, label: "PhD" };
  if (/\b(master'?s|msc|m\.sc|mba|m\.a\b|postgraduate|post-graduate)\b/.test(text)) return { rank: 4, label: "Master's" };
  if (/\b(bachelor'?s|bsc|b\.sc|b\.a\b|\bba\b|degree|undergraduate|honours|honors)\b/.test(text)) return { rank: 3, label: "Degree" };
  if (/\bdiploma\b/.test(text)) return { rank: 2, label: "Diploma" };
  if (/\b(certificate|certification|certified)\b/.test(text)) return { rank: 1, label: "Certificate" };
  return { rank: 0, label: null };
}

// Best-guess "years of experience" from phrases like "5 years" / "5+ yrs".
function detectYears(text) {
  let max = null;
  const re = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) { const n = parseInt(m[1], 10); if (!Number.isNaN(n) && (max === null || n > max)) max = n; }
  return max;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: "Server not configured" });

  // 1) authenticate the caller and confirm they have HR access
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const caller = createClient(url, anon, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await caller.auth.getUser(token);
  if (whoErr || !who?.user?.email) return res.status(401).json({ error: "Invalid session" });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: perm } = await admin
    .from("user_permissions").select("level").eq("email", who.user.email).eq("module", "hr").maybeSingle();
  if (!perm || perm.level < 1) return res.status(403).json({ error: "You don't have HR access" });

  // 2) load the candidate + the posting's criteria
  const { candidateId } = req.body || {};
  if (!candidateId) return res.status(400).json({ error: "candidateId is required" });
  const { data: cand, error: candErr } = await admin
    .from("candidates")
    .select("id, name, cv_path, recruitment_reqs(req_skills, min_years, min_education)")
    .eq("id", candidateId).maybeSingle();
  if (candErr || !cand) return res.status(404).json({ error: "Candidate not found" });
  if (!cand.cv_path) return res.status(400).json({ error: "This candidate has no CV to scan" });

  const job = cand.recruitment_reqs || {};
  const ext = (cand.cv_path.split(".").pop() || "").toLowerCase();

  // 3) download the CV and extract its text
  const { data: blob, error: dlErr } = await admin.storage.from("job-applications").download(cand.cv_path);
  if (dlErr || !blob) return res.status(400).json({ error: "Couldn't read the CV file" });
  const buf = Buffer.from(await blob.arrayBuffer());

  let raw = "";
  try {
    if (ext === "pdf") {
      raw = (await pdfParse(buf)).text || "";
    } else if (ext === "docx") {
      raw = (await mammoth.extractRawText({ buffer: buf })).value || "";
    } else if (ext === "txt") {
      raw = buf.toString("utf8");
    } else if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      return res.status(400).json({ error: "Image CVs can't be text-scanned — open the CV to review, or ask for a PDF." });
    } else {
      return res.status(400).json({ error: "CV must be a PDF, DOCX or TXT to scan (got ." + ext + ")" });
    }
  } catch (e) {
    return res.status(400).json({ error: "Couldn't read the CV text: " + (e.message || "parse failed") });
  }

  const text = raw.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, " ").replace(/\s+/g, " ").trim();
  if (text.length < 25) {
    return res.status(400).json({ error: "Couldn't extract text from this CV (it may be a scanned image) — open it to review manually." });
  }
  const lower = text.toLowerCase();

  // 4) score the CV against the job criteria
  const reqSkills = (Array.isArray(job.req_skills) ? job.req_skills : []).map((s) => String(s).trim()).filter(Boolean);
  const minYears = Number(job.min_years || 0);
  const minEdu = job.min_education || "none";
  const reqRank = EDU_RANK[minEdu] ?? 0;

  const skillChecks = reqSkills.map((s) => ({ skill: s, evidenced: lower.includes(s.toLowerCase()) }));
  const evidenced = skillChecks.filter((s) => s.evidenced).length;
  const ratio = reqSkills.length ? evidenced / reqSkills.length : 1;

  const years = detectYears(lower);
  const yearsOk = minYears <= 0 ? true : years !== null && years >= minYears;
  const edu = detectEducation(lower);
  const eduOk = reqRank === 0 ? true : edu.rank >= reqRank;

  const score = ratio * 0.6 + (yearsOk ? 0.25 : 0) + (eduOk ? 0.15 : 0);
  const verdict = score >= 0.75 ? "strong" : score < 0.4 ? "weak" : "possible";

  const requirements = [];
  for (const s of skillChecks) requirements.push({ requirement: s.skill, evidenced: s.evidenced, note: s.evidenced ? "Mentioned in the CV" : "Not found in the CV text" });
  if (minYears > 0) requirements.push({ requirement: `${minYears}+ years experience`, evidenced: yearsOk, note: years !== null ? `CV mentions ~${years} year(s)` : "No explicit years found in the CV" });
  if (reqRank > 0) requirements.push({ requirement: `${EDU_LABEL[minEdu]} or higher`, evidenced: eduOk, note: edu.rank ? `Detected: ${edu.label}` : "No education level detected in the CV" });

  const concerns = [];
  for (const s of skillChecks) if (!s.evidenced) concerns.push(`"${s.skill}" not evidenced`);
  if (!yearsOk) concerns.push(years !== null ? `Experience (~${years}y) below the ${minYears}y minimum` : "Experience not evidenced in the CV");
  if (!eduOk) concerns.push("Required education level not evidenced");

  const summary =
    (reqSkills.length ? `CV evidences ${evidenced}/${reqSkills.length} required skill${reqSkills.length === 1 ? "" : "s"}` : "No specific skills required") +
    (years !== null ? `, ~${years} yrs experience` : ", experience not stated") +
    (edu.rank ? `, ${edu.label}` : ", no education level detected") + ".";

  // 5) persist the verdict on the candidate
  const { error: upErr } = await admin.from("candidates").update({
    ai_verdict: verdict, ai_summary: summary, ai_checked: requirements, ai_concerns: concerns, ai_screened_at: new Date().toISOString(),
  }).eq("id", candidateId);
  if (upErr) return res.status(500).json({ error: "Couldn't save the result: " + upErr.message });

  return res.status(200).json({ ok: true, verdict, summary });
}
