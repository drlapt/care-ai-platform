import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Phone, Mail, ShieldAlert, Pill, Activity, Stethoscope, FileText, Clock, ChevronRight, Bell } from "lucide-react";
import { getPatient } from "@/lib/api";

export default function PatientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState(null);

  useEffect(() => {
    getPatient(id).then(setP).catch(() => setP(null));
  }, [id]);

  if (!p) {
    return <div className="glass-card animate-fade-up" data-testid="loading-profile">Loading patient…</div>;
  }

  const pi = p.personal_info || {};
  const mh = p.medical_history || {};

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="patient-profile-page">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm font-medium w-fit" style={{ color: "#6B7595" }} data-testid="back-btn">
        <ArrowLeft size={16} /> Back
      </button>

      {/* Identity card */}
      <div className="glass-card flex flex-col md:flex-row gap-6 items-start md:items-center" data-testid="patient-identity">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-display font-bold text-2xl flex items-center justify-center shrink-0">
          {(pi.name || "?").split(" ").map(n => n[0]).slice(0,2).join("")}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-[30px] leading-tight" style={{ color: "#0F1836" }}>{pi.name}</h1>
          <div className="text-sm mt-1" style={{ color: "#6B7595" }}>{pi.age}y · {pi.gender} · Patient ID {p.id?.slice(0,8)}</div>
          <div className="flex flex-wrap gap-3 mt-3">
            <span className="glass-pill px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5" style={{ color: "#2A3558" }}><Phone size={12} /> {pi.phone}</span>
            {pi.email && <span className="glass-pill px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5" style={{ color: "#2A3558" }}><Mail size={12} /> {pi.email}</span>}
            <span className="badge">{p.profile_completeness}% profile complete</span>
          </div>
        </div>
        <Link to={`/patients/${p.id}/alerts`} className="btn-ghost inline-flex items-center gap-2 shrink-0" data-testid="alert-history-btn">
          <Bell size={15} /> Alert history
        </Link>
        <Link to={`/patients/${p.id}/consultation`} className="btn-primary inline-flex items-center gap-2 shrink-0" data-testid="start-consultation-btn">
          <Stethoscope size={16} /> Start Consultation
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Medical history */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Section title="Chief Complaint" icon={Activity} testid="section-complaint">
            <p className="text-[15px] leading-relaxed" style={{ color: "#2A3558" }}>{mh.chief_complaint || "—"}</p>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Section title="Current Conditions" icon={Activity} testid="section-conditions">
              <List items={mh.current_conditions} render={(c) => typeof c === "string" ? c : c.condition || JSON.stringify(c)} empty="None recorded" />
            </Section>
            <Section title="Allergies" icon={ShieldAlert} testid="section-allergies" danger>
              <List items={mh.allergies} render={(a) => String(a)} empty="No known allergies" />
            </Section>
            <Section title="Medications" icon={Pill} testid="section-medications">
              <List items={mh.medications} render={(m) => (m?.name ? `${m.name}${m.frequency ? " · " + m.frequency : ""}` : String(m))} empty="None" />
            </Section>
            <Section title="Family History" icon={FileText} testid="section-family">
              <List items={mh.family_history} render={(f) => String(f)} empty="Not collected" />
            </Section>
          </div>

          <Section title="Consultation History" icon={Stethoscope} testid="section-consultations">
            {(p.consultations || []).length === 0 ? (
              <div className="text-sm" style={{ color: "#6B7595" }}>No consultations yet. Start one above.</div>
            ) : (
              <div className="flex flex-col gap-3">
                {p.consultations.slice().reverse().map((c) => (
                  <Link
                    key={c.id}
                    to={`/consultations/${c.id}`}
                    className="glass-soft p-4 flex items-start gap-4 hover:bg-white/80 transition"
                    data-testid={`consultation-row-${c.id}`}
                  >
                    <div className="w-11 h-11 rounded-2xl bg-[#5B7CFA]/15 flex items-center justify-center shrink-0">
                      <Stethoscope size={18} className="text-[#5B7CFA]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[15px] truncate" style={{ color: "#0F1836" }}>{c.extracted_data?.assessment || c.extracted_data?.chief_complaint || "Consultation"}</div>
                      <div className="text-xs mt-0.5" style={{ color: "#6B7595" }}>{new Date(c.date).toLocaleString()}</div>
                      {c.contradictions_found?.length > 0 && (
                        <span className="badge badge-danger mt-2 inline-flex"><ShieldAlert size={11} /> {c.contradictions_found.length} flag(s)</span>
                      )}
                    </div>
                    <ChevronRight size={18} style={{ color: "#5B7CFA" }} />
                  </Link>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Right: Timeline */}
        <div>
          <Section title="Timeline" icon={Clock} testid="section-timeline">
            <div className="relative flex flex-col gap-5 pl-5">
              <div className="absolute left-[7px] top-2 bottom-2 w-[2px] bg-[#5B7CFA]/20" />
              {(p.timeline || []).slice().reverse().map((t, i) => (
                <div key={i} className="relative">
                  <div className="absolute -left-5 top-1 w-4 h-4 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] border-2 border-white" />
                  <div className="text-[13px] font-semibold" style={{ color: "#0F1836" }}>{t.summary}</div>
                  <div className="text-xs" style={{ color: "#6B7595" }}>{new Date(t.date).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children, testid, danger }) {
  return (
    <div className="glass-card" data-testid={testid}>
      <div className="flex items-center gap-2.5 mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${danger ? "bg-[#E85A5A]/12" : "bg-[#5B7CFA]/12"}`}>
          <Icon size={16} className={danger ? "text-[#E85A5A]" : "text-[#5B7CFA]"} />
        </div>
        <h3 className="font-display font-bold text-[17px]" style={{ color: "#0F1836" }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function List({ items, render, empty }) {
  if (!items || items.length === 0) return <div className="text-sm" style={{ color: "#6B7595" }}>{empty}</div>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it, i) => (
        <li key={i} className="glass-soft px-3 py-2 text-[14px]" style={{ color: "#2A3558" }}>{render(it)}</li>
      ))}
    </ul>
  );
}
