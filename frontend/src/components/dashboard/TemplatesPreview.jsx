import { FileText, Sparkles, Lock } from "lucide-react";

const SAMPLES = [
  { name: "Fever",           subtitle: "PCM 500 · ORS · Rest 3d", icon: "🌡️" },
  { name: "Diabetes Rx",     subtitle: "Metformin · HbA1c · Diet", icon: "🩺" },
  { name: "Gastritis",       subtitle: "Pantoprazole · Bland diet", icon: "🩹" },
];

export default function TemplatesPreview() {
  return (
    <section
      className="glass-card flex flex-col gap-3 relative overflow-hidden"
      data-testid="templates-preview"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(124,77,255,0.12)" }}>
            <FileText size={16} className="text-[#7C4DFF]" />
          </div>
          <div>
            <h3 className="font-display font-bold text-[18px] inline-flex items-center gap-2" style={{ color: "#0F1836" }}>
              Templates
            </h3>
            <div className="text-[11.5px]" style={{ color: "#6B7595" }}>One-click presets · Phase 2</div>
          </div>
        </div>
        <span
          className="badge inline-flex items-center gap-1"
          style={{ background: "rgba(124,77,255,0.12)", color: "#7C4DFF", borderColor: "rgba(124,77,255,0.2)" }}
        >
          <Sparkles size={10} /> Soon
        </span>
      </header>

      <div className="flex flex-col gap-2 opacity-70 pointer-events-none">
        {SAMPLES.map((s) => (
          <div key={s.name} className="glass-soft p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-white/60">{s.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13.5px]" style={{ color: "#0F1836" }}>{s.name}</div>
              <div className="text-[11.5px] truncate" style={{ color: "#6B7595" }}>{s.subtitle}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl p-3 flex items-start gap-2 mt-1" style={{ background: "linear-gradient(135deg, rgba(91,124,250,0.10), rgba(124,77,255,0.10))" }}>
        <Lock size={14} className="text-[#7C4DFF] mt-0.5 shrink-0" />
        <div>
          <div className="text-[12px] font-bold" style={{ color: "#3F2F7A" }}>Coming in Phase 2</div>
          <div className="text-[11.5px]" style={{ color: "#2A3558" }}>
            Reusable Rx + test packs that learn your prescribing style.
          </div>
        </div>
      </div>
    </section>
  );
}
