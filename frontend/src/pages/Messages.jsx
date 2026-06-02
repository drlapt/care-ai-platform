import { useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { Send, Search, MessageSquare } from "lucide-react";
import { listThreads, getThread, sendMessage, listPatients } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function Messages() {
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const scrollRef = useRef(null);

  const reloadThreads = async () => {
    try { setThreads(await listThreads()); } catch { /* ignore */ }
  };

  useEffect(() => {
    reloadThreads();
    listPatients().then(setPatients).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    getThread(selected).then((m) => {
      setMessages(m);
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, 50);
      reloadThreads();
    });
  }, [selected]);

  // Merge threads with all patients (doctor view) to allow starting a new thread
  const allRows = useMemo(() => {
    if (user?.role === "patient") return threads;
    const map = new Map();
    for (const p of patients) {
      map.set(p.id, { patient_id: p.id, patient_name: p.personal_info?.name, last_message: "", last_at: "", unread: 0 });
    }
    for (const t of threads) map.set(t.patient_id, t);
    return Array.from(map.values()).sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
  }, [threads, patients, user]);

  const filtered = allRows.filter((t) => (t.patient_name || "").toLowerCase().includes(q.toLowerCase()));

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim() || !selected) return;
    const body = input.trim();
    setInput("");
    try {
      await sendMessage(selected, body);
      const m = await getThread(selected);
      setMessages(m);
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, 30);
      reloadThreads();
    } catch {
      toast.error("Failed to send");
    }
  };

  const selectedName = allRows.find((t) => t.patient_id === selected)?.patient_name;

  return (
    <div className="flex flex-col gap-5 animate-fade-up h-full" data-testid="messages-page">
      <header>
        <div className="text-sm font-medium mb-2" style={{ color: "#6B7595" }}>Secure in-app messaging</div>
        <h1 className="font-display font-extrabold text-[40px] leading-none" style={{ color: "#0F1836" }}>Messages</h1>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-5 flex-1 min-h-[560px]">
        {/* Thread list */}
        <aside className="glass-card flex flex-col" style={{ padding: 14 }} data-testid="thread-list">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#6B7595" }} />
            <input className="form-input pl-10 text-sm" placeholder="Search conversations…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="thread-search" />
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
            {filtered.length === 0 && <div className="text-sm text-center py-8" style={{ color: "#6B7595" }}>No conversations</div>}
            {filtered.map((t) => {
              const active = selected === t.patient_id;
              return (
                <button key={t.patient_id} onClick={() => setSelected(t.patient_id)} className={`text-left p-3 rounded-2xl transition ${active ? "bg-white shadow-sm" : "hover:bg-white/60"}`} data-testid={`thread-${t.patient_id}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-semibold flex items-center justify-center shrink-0 text-sm">
                      {(t.patient_name || "?").split(" ").map(n => n[0]).slice(0,2).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-[14px] truncate" style={{ color: "#0F1836" }}>{t.patient_name}</div>
                        {t.unread > 0 && <span className="badge text-[10px]" style={{ padding: "2px 8px" }}>{t.unread}</span>}
                      </div>
                      <div className="text-[12px] truncate" style={{ color: "#6B7595" }}>{t.last_message || "No messages yet"}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Thread view */}
        <section className="glass-card flex flex-col" data-testid="thread-view">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#5B7CFA]/10 flex items-center justify-center mb-4"><MessageSquare size={28} className="text-[#5B7CFA]" /></div>
              <div className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Select a conversation</div>
              <div className="text-sm mt-1" style={{ color: "#6B7595" }}>Choose a patient from the list to view messages.</div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 pb-4 border-b border-white/60">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-semibold flex items-center justify-center text-sm">
                  {(selectedName || "?").split(" ").map(n => n[0]).slice(0,2).join("")}
                </div>
                <div>
                  <div className="font-semibold text-[15px]" style={{ color: "#0F1836" }}>{selectedName}</div>
                  <div className="text-[11px]" style={{ color: "#6B7595" }}>{messages.length} messages</div>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 flex flex-col gap-3" data-testid="messages-list">
                {messages.length === 0 && <div className="text-sm text-center py-8" style={{ color: "#6B7595" }}>No messages yet — say hi 👋</div>}
                {messages.map((m) => {
                  const mine = m.sender === (user?.role);
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] px-4 py-2.5 text-[13.5px] ${mine ? "rounded-[18px] rounded-br-md text-white" : "rounded-[18px] rounded-bl-md"}`}
                        style={mine ? { background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" } : { background: "rgba(255,255,255,0.85)", color: "#0F1836", border: "1px solid rgba(91,124,250,0.12)" }}
                      >
                        {!mine && <div className="text-[10px] font-semibold mb-0.5" style={{ color: "#5B7CFA" }}>{m.sender_name}</div>}
                        <div>{m.text}</div>
                        <div className={`text-[10px] mt-1 ${mine ? "text-white/70" : ""}`} style={!mine ? { color: "#6B7595" } : undefined}>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <form onSubmit={send} className="flex items-center gap-2 pt-3 border-t border-white/60">
                <input className="form-input flex-1" placeholder="Type a message…" value={input} onChange={(e) => setInput(e.target.value)} data-testid="message-input" />
                <button type="submit" className="btn-primary p-3 !rounded-2xl" data-testid="send-btn"><Send size={16} /></button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
