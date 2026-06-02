# Project Care — PRD

## Original Problem Statement
AI-powered, voice-first healthcare platform. Patients talk or type to Care AI in multiple languages. Doctor (Dr. Lahari) reviews AI-generated summaries, patient follow-up chats, and red-flag alerts. Now evolved from Phase 2 into a voice-enabled multi-language medical assistant with clean email/password auth.

## User Choices (current)
- **Auth**: email + password only, no Google/Demo UI. `idrlapt@gmail.com` → doctor; all other emails → patient (auto-creates linked patient record on register).
- **LLM**: GPT-4o via Emergent Universal LLM Key.
- **STT**: Browser Web Speech API (hybrid — client-side, free, low-latency).
- **TTS**: OpenAI `tts-1` via Emergent LLM Key (`voice=nova`), served from `POST /api/tts`.
- **Languages**: English, Hindi, Telugu, Tamil in the 24/7 Follow-up Care AI. AI replies in the patient's selected language; urgency JSON stays in English for the doctor.
- **Messaging/Reminders**: in-app only.
- **Roles**: Doctor / Patient with role-based sidebar and redirects.

## Personas
- **Doctor (Dr. Lahari)**: sees clinic dashboard, patient alerts, follow-up chats, reminders, voice consultations.
- **Patient**: lands on `/portal`, can talk/type to Care AI 24/7, view labs/prescriptions/appointments, track medication reminders.

## Architecture
- **Backend**: FastAPI + MongoDB (motor), emergentintegrations (GPT-4o LLM, Whisper STT, OpenAI TTS).
- **Frontend**: React 19, React Router 7, Tailwind, shadcn/ui, sonner. Glassmorphism system. Web Speech API for STT, `<audio>` playback for OpenAI TTS.

## Implemented

### Phase 1 (21 Apr 2026)
- Smart patient onboarding + live consultation processor + dual summaries + glassmorphism UI.

### Phase 2 (21 Apr 2026)
- Voice capture (MediaRecorder + Web Speech + Whisper upload).
- Emergent Google OAuth + Demo bypass (later removed from UI — see below).
- 7 modules: Appointments, Messages, Pharmacy, Laboratory, Analytics, Patient Portal, Admin.
- Care AI Personality Engine for onboarding + Copilot for doctor + Consultation detail card.

### Phase 3 — 24/7 Care AI (22 Apr 2026)
- Backend: email/password auth with bcrypt, `/api/followup/*`, `/api/followup/alerts`, `/api/reminders` CRUD.
- Frontend: `/login` with sign-in/sign-up/demo tabs, `/followup` + `/followup/:id`, `/reminders`, `/alerts`, dashboard alerts banner, patient portal Follow-up/Reminders CTAs.
- Global rename Dr. Haylie → Dr. Lahari.

### Phase 4 — Voice-first + multi-language (22 Apr 2026)
- Stripped Google OAuth + Demo UI. Email/password only; hardcoded `idrlapt@gmail.com` → doctor, others → patient.
- Registration auto-creates patient record + `linked_patient_id` so `/followup` and `/reminders` work immediately.
- `POST /api/tts` using OpenAI `tts-1` via Emergent key returns `audio/mpeg` bytes.
- Followup chat: language selector (en/hi/te/ta), Web Speech mic input, voice-out toggle (OpenAI TTS playback), stop-speaking control.
- Reminder ownership enforced on create/taken/delete (patients 403 on cross-patient actions).
- Backend tests: 16/16 pass (test_iter6_auth_tts_lang.py). Frontend: 100% review-request assertions pass.

### Phase 5 — Live consultations + WhatsApp + Voice notes (Apr 2026)
- **Per-tab sessionStorage Bearer auth** so doctor + patient can log in side-by-side in one browser.
- **Unified live consultation** (`ConsultationSession.jsx`): patient ↔ Care AI co-pilot ↔ doctor in one thread, file attachments, async prescribing.
- **AI prescriptions** parsed into auto-reminders.
- **Twilio WhatsApp integration**: OTP-verified linking, inbound webhook reuses Care AI brain, mirrors into `followup_chats`, doctor alerts on red-flag urgency.
- **Surgical prompt enhancement** to `INTAKE_SYSTEM` (clinical precision, strict `<INTAKE_READY>` emergency tagging) and `FOLLOWUP_SYSTEM`.

### Phase 6 — WhatsApp Voice Notes (26 Apr 2026, iter-7)
- Inbound voice notes: webhook detects `audio/*` media, downloads with Twilio Basic Auth, transcribes with Whisper-1, feeds transcript to existing follow-up brain.
- Outbound voice replies: TTS mp3 cached in `db.whatsapp_media`, served at public unauthenticated `GET /api/whatsapp/media/{id}.mp3`, dispatched via Twilio outbound media as a follow-up to the TwiML text reply.
- `followup_chats` voice rows include `media_type:"voice"`, `media_url`, `transcript`, `voice_duration`. Doctor /followup UI shows a "Voice note" chip and "Original audio" link (doctor only).
- Tests: `test_whatsapp_voice.py` (3 baseline) + `test_whatsapp_voice_e2e.py` (full E2E). Iteration-7 testing-agent run: backend 21/23 pass (0 failures), frontend 100%.

### Phase 7 — UX Refinements Batch 1 (26 Apr 2026, iter-8)
- **#1 Consult a Doctor**: replaced "Consult Dr. Lahari" with "Consult a Doctor" everywhere. New 4-step modal: Department → Doctor (card with name/specialization/experience/rating/bio) → Date+Slots (booked greyed out) → Reason. Backend: `GET /api/doctors`, `GET /api/doctors/{id}/availability`, `POST /api/appointments` accepts doctor_id+department.
- **#3 Voice fixes**: Shared helper `/app/frontend/src/lib/speech.js` eliminates duplicate transcripts ("I have I have…"), graceful Tamil/Telugu fallback on iOS Safari, single-shot recognition for iOS reliability.
- **#5 Consultation control**: Chat composer locked in `awaiting_doctor` (read-only notice instead). Doctor button renamed "Start consultation". Disabled while patient still in intake. After "End consultation", chat is locked for both sides.
- Iter-8 testing-agent run: backend 11/11, frontend 100%.

### Phase 8 — UX Refinements Batch 2 (26 Apr 2026)
- **#2 Structured intake options + consent gate**: INTAKE_SYSTEM now emits `<OPTIONS>{"multi":bool,"options":[...]}</OPTIONS>` JSON tags after closed-ended questions. Frontend renders chips (single-select submits instantly, multi-select gets a "Send selection" button) plus an "Other" free-text field. New session state `intake_complete` (between intake and awaiting_doctor) — patient must consent via the new `POST /api/consultations/{id}/share` endpoint before the doctor sees the summary. Emergencies bypass consent for safety. Mandatory "anything else?" gate added to the prompt before `<INTAKE_READY>` is emitted.
- **#4 Pending vs Confirmed split + alternate slot**: `Appointments.jsx` now has separate "Pending approval", "Awaiting patient", "Confirmed", and "Past & cancelled" sections. New Suggest-Alternate modal lets the doctor propose `proposed_date`/`proposed_time`/`proposed_reason`; patient sees a banner on `/portal` with "Accept new slot" / "Choose another doctor" actions. PATCH `/api/appointments/{id}` now distinguishes patient (with `patient_action`) and doctor (full edit + propose) flows.
- **#10 AI-suggested Rx draft**: New `POST /api/prescriptions/quick-draft` endpoint pulls patient profile + last 20 follow-up turns + alert context and asks GPT-4o for a 1–4 item conservative draft (allergies/contraindications screened). `QuickPrescribeModal` auto-fetches on open and offers a "Regenerate" button. Doctor can modify/add/delete/approve as before.

### Phase 9 — UX Refinements Batch 3 (26 Apr 2026)
- **#6 Post-consultation automation**: Finalize endpoint now generates the patient-facing Rx explanation in their preferred language, mirrors a structured "Consultation summary" + "Prescription explanation" card into `followup_chats`, and dispatches a fire-and-forget WhatsApp delivery (#7).
- **#7 WhatsApp delivery**: After finalize, if the patient's number is linked, the summary, prescription, and explanation are pushed to WhatsApp in their `whatsapp_language` (translated through GPT-4o when needed).
- **#8 Single chat window**: Consultation summaries now live in `followup_chats` alongside ongoing follow-up + WhatsApp messages — patients see one continuous timeline.
- **#9 Alert triggers polish**: Alerts dashboard already deep-links to `/followup/{patient_id}` (verified). Emergency intake bypass + immediate doctor_alert was wired in Batch 2.
- **#11 Safety / abuse**: New `_quick_safety_check()` intercepts profanity / "kill yourself"-style input BEFORE LLM is invoked (saves budget too). Returns a calm, boundary-setting canned reply. New `SAFETY_RULES` block injected into `FOLLOWUP_SYSTEM` for off-topic redirects + abuse de-escalation. Followup turns store `guardrail: True` flag.
- **#12 Support mode**: New `POST /api/support/chat` endpoint backed by `SUPPORT_SYSTEM` prompt that ONLY answers app-navigation questions (and refuses medical questions, redirecting to /followup). New floating `SupportWidget` (lifebuoy icon, bottom-right) mounted globally for any logged-in user.
- **#13 AI response quality**: New `EMPATHY_RULES` block injected into `FOLLOWUP_SYSTEM` — every reply must reflect the patient's words, name emotions, reference at least one specific detail they shared, skip generic disclaimers in routine cases. Caps replies at 4–6 sentences.
- Tests: `test_batch1_doctors.py` + `test_batch2_e2e.py` + `test_batch3_e2e.py` — all pass with zero regression.

### Phase 23 — WhatsApp privacy gates + per-channel toggles (28 Apr 2026, Phase 1 charter)
- **Goal**: complete the Phase-1 WhatsApp charter — consent-gated, per-channel privacy controls, phone-change resets, never replicate the full app inside WhatsApp.
- **Audit vs charter**: ✅ OTP send/verify already shipped · ✅ inbound webhook already shipped · ✅ outbound Rx delivery already shipped · ❌ per-channel toggles · ❌ phone-change reset · ❌ master-gate on existing delivery — **fixed in this phase**.
- **Backend (`backend/server.py`)**:
  - **Schema** (added to `users` doc): `whatsapp_prefs: {consent, consent_at, send_prescriptions, send_summary, send_reminders, send_alerts, send_reports}` + `whatsapp_verified_at` stamp.
  - **Defaults** via `_default_wa_prefs()`: post-OTP → `send_reports=False`, all others True; charter: "Conditional: Lab reports → only if user allows".
  - **`_wa_can_send(user_doc, channel)`** — single source-of-truth gate: number present + `whatsapp_verified_at` set + `consent=True` + per-channel toggle on. Used everywhere outbound delivery happens.
  - **REST endpoints**: `GET /api/whatsapp/preferences` (status + prefs), `PATCH /api/whatsapp/preferences` (toggle individual channels or revoke `consent` master switch).
  - **`_send_consultation_to_whatsapp`** rewritten to consult `_wa_can_send("send_summary")` and `_wa_can_send("send_prescriptions")` — short-circuits cleanly when either OR both are off.
- **Backend (`backend/whatsapp_router.py`)**:
  - `/whatsapp/connect/start`: when an existing verified user submits a *different* number, immediately `$unset` `whatsapp_number / whatsapp_linked_at / whatsapp_verified_at / whatsapp_prefs` so re-verification + re-consent are mandatory (per charter).
  - `/whatsapp/connect/verify`: on success now stamps `whatsapp_verified_at` AND seeds the default `whatsapp_prefs` so the user is auto-opted-in to the channels they consented to at the gate.
  - `/whatsapp/disconnect`: full reset (number + linked + verified + prefs).
- **Tests** — `backend/tests/test_whatsapp_phase23.py` (4 groups, all green):
  1. `_wa_can_send` unit — covers no-number / unverified / consent-off / per-channel matrix incl. reports default OFF.
  2. `/api/whatsapp/preferences` GET + PATCH + auth gate (PATCH without auth → 401).
  3. Phone-change at `/connect/start` — same number preserves verification; different number wipes verification + prefs. `/disconnect` wipes everything.
  4. Delivery gate (Twilio mocked): both toggles OFF → 0 outbound calls · Rx ON + summary OFF → exactly 1 Rx message (no summary leak) · `consent: false` master switch → 0 calls.
- **All earlier suites still pass**: lifecycle (7) + memory (10) + copilot (11) + whatsapp (5+) = **33+ / 33+** with no regressions.
- **Phase-discipline note**: the doctor-side AI Co-Pilot (Phase 22) and report/image AI (existing) are now correctly classified as **Phase 3** in this brief; they remain shipped but should not be expanded. PDF prescription link, two-way doctor↔patient critical alerts, voice TTS reply on WhatsApp → **deferred to Phase 3 per the new charter**.

### Phase 22 — AI Clinical Co-Pilot for prescriptions (28 Apr 2026)
- **Goal**: behave like a junior doctor + safety system during the prescription workflow — surface gaps, allergy conflicts, dose/interaction issues, and suggestions — without ever auto-finalising.
- **Backend (`backend/server.py`)**:
  - **Knowledge bases**: `DRUG_DOSE_DB` (~30 common drugs with min/max daily-mg envelopes), `DRUG_INTERACTIONS` (15 high-yield pairs incl. warfarin × NSAIDs, atorvastatin × clarithromycin, SSRI × tramadol), `SYMPTOM_MED_HINTS` (15 first-line symptom→med rules).
  - **Helpers**: `_med_key` (normalises "Amoxicillin 500mg" → `amoxicillin`), `_parse_daily_mg` (dose × frequency math incl. BID/TID/QID/q4h/q12h), `_check_dose_warnings`, `_check_interaction_warnings`, `_check_gap_warnings`, `_build_suggestions`. All deterministic — no LLM, so suggestions are consistent across consultations.
  - **New endpoint** `POST /api/prescriptions/copilot/check`: returns `{status: ok|warn|blocking, blocking, allergy_warnings, dose_warnings, interaction_warnings, gap_warnings, suggestions}`. Uses Phase 21 confirmed-only allergies + Phase 22 deterministic checks. Doctor remains in full control — endpoint is read-only.
  - **New endpoint** `POST /api/prescriptions/copilot/voice` (multipart): doctor speaks → reuses existing `_whisper_transcribe_bytes` (Whisper STT) → GPT-4o parses to strict-JSON `items[]` (max 6) with dose, frequency, duration, instructions. Doctor reviews/edits before signing.
- **Frontend (`QuickPrescribeModal.jsx`)** — minimal, non-blocking integration:
  - Header now has 4 action buttons: 🎤 Voice (red pulse while recording → MediaRecorder → upload → Whisper → autofill medication rows) · 🛡 Co-Pilot safety check · ✨ AI re-draft · ✕ Close.
  - **Clinical Co-Pilot panel** appears after a check, color-coded by severity (red blocking / orange warn / green clear). Sections: Allergy conflict (with "Override and issue anyway (audited)" checkbox), Drug interactions, Dose check, Untreated symptoms (with one-click Add), Suggested medications (with one-click Add). Empty state: "No allergy conflicts, no major interactions, doses within range, no untreated symptoms." ✅
  - Submit handler now passes `override_allergy_warning` and surfaces a 409 collision response into the same panel so the doctor can review-then-override without losing their draft.
- **Tests** — `backend/tests/test_clinical_copilot.py` (11 assertions, all green):
  1-2. `_med_key` + `_parse_daily_mg` math (mg/g/mcg, BID/TID/QID/qNh)
  3. Dose warnings: high (paracetamol 6 g/day) + low (amlodipine 1 mg/day) + unknown drug skipped
  4. Interactions: warfarin × ibuprofen (major), atorvastatin × clarithromycin (major), ramipril × ibuprofen (caution), no false positives on paracetamol+ORS
  5. Gap detection: fever + loose stools + vomiting in chief complaint with paracetamol-only Rx → 2 gaps; adding ORS+ondansetron clears them
  6. Suggestions de-dupe vs current Rx
  7-11. End-to-end against `/api/prescriptions/copilot/check`: clean Rx → `ok|warn`, amoxicillin against confirmed penicillin allergy → `blocking`, warfarin+ibuprofen → `blocking`, paracetamol overdose → `dose_high`, empty Rx with "fever and headache" → suggestions list includes paracetamol.
- **Verified UI** via Playwright: Co-Pilot panel rendered with allergy block + override toggle + 4 gap warnings + 4 suggestions, all with one-click Add buttons.
- All earlier suites still pass (lifecycle 7 + memory 10 + copilot 11 = **28/28**).

### Phase 21 — Structured patient memory + multi-profile + clinical decision support (28 Apr 2026)
- **Goal**: capture durable medical facts safely, never auto-store, gate every fact behind explicit patient confirmation, and use only `confirmed` facts for clinical alerts.
- **Backend (`backend/server.py`)**:
  - **Multi-profile** (max 5 per user): patient docs gain `profile_owner_user_id` + `relationship` (`self|family|guest|...`). Auth `register` now stamps these on the auto-created patient. New REST endpoints: `GET /api/profiles`, `POST /api/profiles`, `PATCH /api/profiles/:id`, `DELETE /api/profiles/:id`, `POST /api/profiles/:id/switch` (sets the user's `linked_patient_id`).
  - **Structured memory schema** on each patient doc: `medical_facts[]` ({id, type: allergy|condition|medication|family_history, value, source, confidence: confirmed|inferred|low_confidence, captured_at, confirmed_at, captured_from, ai_quote}) + `pending_facts[]` (same shape minus confidence + status).
  - **Conservative regex extractor** `_extract_pending_facts_from_message` — captures only structural mentions of allergies / chronic conditions / long-term medications / family history. Transient symptoms (fever, headache, vomiting, cough) are explicitly NOT captured.
  - **Confirmation flow** in `/api/followup/message`: pending facts created on detection; AI reply auto-appends "Quick check — should I save this allergy to your profile? Reply yes / no". On the next turn, `_is_affirmative` (broadened to handle "yes please save it" / "go ahead" / "absolutely") → `_promote_pending_facts` (confidence=confirmed) → mirrored into legacy `medical_history.allergies / current_conditions / medications`. `_is_negative` → `_dismiss_pending_facts`. Alerts always win when both a pending alert and a pending fact would consume the same yes/no.
  - **Fact REST endpoints**: `GET /api/profiles/:id/facts`, `POST /api/profiles/:id/facts/confirm`, `POST /api/profiles/:id/facts/dismiss`, `POST /api/profiles/:id/facts` (direct add by doctor), `DELETE /api/profiles/:id/facts/:fact_id`.
  - **Clinical decision support** at prescribe time: `_drug_allergy_collisions(items, patient)` matches medication names against confirmed allergies via name-overlap + class-overlap (penicillin/cephalosporin/sulfa/NSAID class maps). `POST /api/prescriptions/quick` now returns **HTTP 409** with `{error: "allergy_collision", collisions: [...]}` unless the doctor passes `override_allergy_warning=True`.
  - **Confidence layer**: only `confidence=confirmed` facts trigger collision alerts. Inferred / low-confidence facts are stored but never block an Rx.
- **Tests** — `backend/tests/test_patient_memory.py` (10 assertions, all green):
  1. Regex captures allergies/conditions/meds/family history
  2. Transient symptoms NOT captured
  3. Drug collisions detect name-match + class-match, only confirmed counts
  4. Profiles: list, max-5 enforcement (6th = 400), switch active, patch, delete
  5. Followup-message captures allergy as pending + AI asks for confirmation
  6. "yes please save it" promotes → confidence=confirmed + mirrored to medical_history
  7. "no" dismisses + nothing leaks to confirmed
  8. Amoxicillin against confirmed penicillin allergy → 409 with detailed collision payload
  9. `override_allergy_warning=true` bypasses → 200
- **No frontend redesign** (per requirement). Existing `QuickPrescribeModal` and `PatientPortal` will pick up the new fields organically; UI surfacing of the collision alert is a follow-up.

### Phase 20 — Structured clinical prescription + AI guidance (28 Apr 2026)
- **Goal**: turn the existing 1-line async-Rx modal into a complete, presentation-grade clinical prescription with AI safety-net guidance for the doctor.
- **Backend (`backend/server.py`)**:
  - New `InvestigationItem` Pydantic model (`name`, `urgency: routine|urgent|stat`, `reason`).
  - Extended `QuickRxBody` with optional structured fields: `chief_complaint`, `clinical_summary`, `provisional_diagnosis`, `doctor_notes`, `investigations[]`, `advice`, `follow_up`, `red_flags[]` — fully backwards compatible.
  - `quick_prescribe` now blends these into a SOAP-flavoured `doctor_summary` and persists every field on the consultation entry's `extracted_data` (so the existing patient/pharmacy views keep working) plus dedicated `investigations` and `follow_up` columns.
  - **New endpoint** `POST /api/prescriptions/ai-guidance` — Care AI safety-net: takes the doctor's draft (chief complaint, planned diagnosis, planned meds, planned tests) + patient profile + recent follow-up chat → returns `{investigations[], follow_up, missed_symptoms[]}` (max 4 each) for one-click acceptance.
- **Frontend (`QuickPrescribeModal.jsx`)** — full redesign while preserving the existing `quickPrescribeDraft` AI auto-draft on open:
  - Letterhead with patient details (name · age/sex · allergies · conditions) + doctor + timestamp.
  - 11 sectioned blocks (Patient · Chief complaint · Clinical summary · Provisional diagnosis · Medications · Investigations · Doctor notes · Advice · Follow-up · Red flags · Care AI guidance).
  - Investigations repeater with `routine / urgent / STAT` dropdown.
  - Red flags textarea with red-border accent.
  - **Care AI guidance card**: button "Get Care AI suggestions" → 3 grouped sections (Tests to add · Follow-up plan · Missed symptoms / red flags), each with one-click "Add" / "Use" / "Add to red flags" button to inject the suggestion into the corresponding form field. Empty-state messages per section.
  - Footer: "Sign & send Rx" CTA replaces old "Issue prescription".
- **Verified end-to-end**:
  - `POST /prescriptions/quick` with all 9 new fields → 200, all fields persisted on `extracted_data`.
  - `POST /prescriptions/ai-guidance` → 200, returned 2 investigations + 1 follow-up + 4 missed-symptom suggestions.
  - Playwright: opened modal from doctor's Alerts page, all 11 sections rendered, "Get Care AI suggestions" populated all 3 guidance blocks with one-click apply buttons.

### Phase 19 — Zero-friction patient consult flow (28 Apr 2026)
- **Bug**: After booking a slot, patient was bounced back to the portal and had to manually click "Start" on the new appointment to begin AI intake. Two extra clicks + an unnecessary detour.
- **Fix**: `PatientPortal.jsx` now passes a navigation handler to `ConsultNowModal.onBooked(appt)` — on success the patient is redirected straight to `/consult/new?appointment_id={appt.id}`. `ConsultationSession.jsx`'s existing bootstrap (`startIntake(appointmentId)`) auto-loads Care AI's first intake question.
- Updated modal toast: "Slot booked with {Doctor} — starting your intake now…" (replaces the old "Request sent — you'll be notified once confirmed").
- **Verified end-to-end** via Playwright (demo patient `drgapt@gmail.com`):
  Login → "Consult a Doctor" → General → Dr. Lahari → 2026-04-29 09:00 → "Persistent headache for 2 days, mild fever in evenings." → Request consultation → **auto-navigates to `/consult/{sessionId}`** with Care AI intake live ("Hi there! I'm here to help gather some information before you see Dr. Lahari…") and structured age options ready for one-tap answer.

### Phase 18 — Per-patient alert history view (28 Apr 2026)
- **New endpoint** `GET /api/patients/:id/alerts` (doctor-only): returns every alert ever raised for a patient (active + final), with full `events[]` timeline, plus a `counts` object: `{total, active, resolved, high_severity}`.
- **New page** `/patients/:id/alerts` → `PatientAlerts.jsx`:
  - Counts strip (Total · Active · Resolved · High severity), each color-coded.
  - Filter chips: `All`, `Active`, `Resolved`, `High severity`.
  - Per-alert card: urgency badge + lifecycle status pill (Active / Awaiting confirmation / Downgraded / Cleared (correction) / Resolved / Auto-dismissed / Dismissed) + topic + initial→current severity transition + patient quote + AI triage summary + Resolution chip ("Doctor Resolved" / "Symptoms Corrected") + **collapsible Timeline** with every event (icon, color, label, timestamp, urgency transition, actor, quoted note) + "Open chat" button.
  - "Back to patient" link + new "Alert history" entry-point button on `PatientProfile.jsx`.
- **Wired routing** in `App.js` (`/patients/:id/alerts`, doctor-gated).
- **API client** `getPatientAlertHistory(id)` added to `frontend/src/lib/api.js`.
- **Verified end-to-end** via Playwright with 4 seeded fixtures across all 4 statuses (open · downgraded · cleared_by_correction · resolved): counts correct, every filter returned the expected subset, all 4 timelines expanded with correct event labels.

### Phase 17 — Full alert lifecycle + confirmation loop (28 Apr 2026)
- **Goal**: reduce false alerts, give doctor a transparent timeline, and never auto-clear without patient confirmation.
- **Backend (`backend/server.py`)**:
  - New constants: `ACTIVE_ALERT_STATES = ("open","pending_confirmation","downgraded")`, `FINAL_ALERT_STATES`.
  - New helpers: `_detect_phrase_correction(text)`, `_is_affirmative(text)`, `_is_negative(text)`, `_make_event(...)`, `_append_alert_event(alert_id, event, updates)`.
  - Phrase regex catches "sorry / no chest pain / actually it's only / false alarm / i was wrong / i meant" — fires the lifecycle even when the LLM misses `correction:true`.
  - `/api/followup/message` flow now runs in stages on every patient turn:
    1. **Confirmation loop** — if any prior alert is `pending_confirmation`, the patient's current message is read as yes/no. Yes → `cleared_by_correction` (with `resolution_reason: "symptoms_corrected"`). No / "still bleeding" → reverts to `open` (event `correction_rejected`).
    2. **New correction detection** — AI flag OR phrase regex OR (low/medium urgency + prior high active). Moves prior emergency/high alerts to `pending_confirmation`, records `urgency_before_correction` + `proposed_urgency`, posts a clear yes/no system message ("Just to confirm — you're saying X is no longer a concern? Reply yes to clear, or no if it's still happening.").
    3. **Dynamic downgrade** — medium urgency + prior medium active alert → status `downgraded`, urgency dropped to low, doctor still sees it.
    4. **De-duplication** — new high/emergency triage with same `topic` as an active alert → `updated` event on the existing record (no stacking).
  - Every state change appends to `events[]` with `event`, `by`, `at`, `note`, `urgency_before/after`, `status_before/after`.
  - `GET /api/followup/alerts` now returns alerts in any active state (not just `"open"`).
  - New `GET /api/followup/alerts/{id}` for full detail incl. timeline.
  - `PATCH /api/followup/alerts/{id}` whitelists statuses (`open`, `downgraded`, `resolved`, `cleared_by_correction`, `auto_dismissed`, `dismissed`), records `doctor_resolved` event with optional note + `resolution_reason`.
- **Frontend (`Alerts.jsx`)**:
  - New status badges: "Awaiting confirmation" (orange) + "Downgraded" (blue) shown next to urgency badge.
  - Inline yellow notice on `pending_confirmation` alerts explaining the auto-clear behaviour.
  - Collapsible **Timeline** section per alert listing every lifecycle event with icon, color, label, timestamp, urgency transition, actor, and note.
- **Tests** — `backend/tests/test_alert_lifecycle.py`:
  - Phrase-helper unit checks (correction / affirm / negate variants).
  - Full E2E: emergency seed → correction phrase → pending_confirmation → "yes" clears with `resolution_reason="symptoms_corrected"` → cleared alert hidden from `GET /alerts`.
  - Negative path: "no, it's still bleeding" rolls back to `open` with `correction_rejected` event.
  - Doctor PATCH resolve appends `doctor_resolved` event; `GET /alerts/{id}` returns full timeline (4 events).
  - **All 6 test steps pass.**

### Phase 16 — CORS hardened (no wildcard with credentials) (28 Apr 2026)
- **Bug**: `CORS_ORIGINS="*"` + `allow_credentials=True` is invalid per CORS spec. Browsers reject it with "Cannot use wildcard in Access-Control-Allow-Origin when credentials flag is true". Older preview pod was getting away with it because Starlette echoes the Origin when `*` is given, but spec-strict browsers / strict reverse proxies break.
- **Fix in `backend/server.py`**: replaced single-line CORS middleware with an explicit allow-list. Strips any `*` if env contains it, falls back to a safe default list if env is empty/wildcard-only:
  - `https://projectcareai.net`, `https://www.projectcareai.net`
  - `https://patient-care-121.emergent.host` (prod backend)
  - `https://patient-care-121.preview.emergentagent.com` (preview)
  - `http://localhost:3000` (dev)
- **`backend/.env`**: `CORS_ORIGINS` rewritten to the same comma-separated explicit list — no `*`. Per-deploy override still possible via env.
- **Verified directly against Starlette (`localhost:8001`)**:
  - `Origin: https://projectcareai.net` → returns `access-control-allow-origin: https://projectcareai.net` + `access-control-allow-credentials: true` ✅
  - `Origin: https://evil.example.com` → no `access-control-allow-origin` header (browser blocks) ✅
- **Verified end-to-end** via preview ingress: doctor login + new signup still 200.

### Phase 15 — Production auth audit + error-surface upgrade (28 Apr 2026)
- **Full prod audit against `projectcareai.net`** (7-point checklist from user):
  - ENV: deployed frontend bundle's `REACT_APP_BACKEND_URL` = `https://patient-care-121.emergent.host` ✅
  - Auth provider: custom email/password, no external whitelist ✅
  - API connectivity: `POST /api/auth/login` on both `projectcareai.net/api/*` and `patient-care-121.emergent.host/api/*` returns **200** with correct Dr. Lahari record ✅
  - CORS: preflight from `Origin: https://projectcareai.net` returns `access-control-allow-origin: https://projectcareai.net` + `credentials: true` ✅
  - Cookies: `SameSite=none; Secure; HttpOnly` — correct for cross-origin ✅
  - DB: prod login/register return real user records ✅
  - All endpoints return expected auth-gated statuses (401 on empty login, 400 on empty register, 401 on /me without token) ✅
- **Login.jsx error-surface upgrade** (Task 6 from user): every failed auth attempt now (a) calls `console.error("[auth] submit failed", {tab, url, status, detail, error})` and (b) renders a collapsible "Debug info" panel on the login card showing Endpoint + HTTP Status + Error kind + Message. Toast messages now distinguish: 401→"Invalid credentials", 409→"Email already registered", no-response→"Can't reach the server", other→backend's actual `detail` + status. This is the #1 tool to debug future prod-vs-preview mismatches without devtools.
- **Conclusion**: prod auth is working end-to-end (proven by curl). Any "Invalid credentials" a user sees now comes with explicit debug info — either a genuine 401 (wrong password / password manager autofill bug) or a real network/CORS error that the panel will name.

### Phase 14 — Bulletproof auth on redeploy + admin recovery (27 Apr 2026)
- **Bug**: After redeploy, login still failed with "Invalid credentials" because `idrlapt@gmail.com` / `drgapt@gmail.com` already existed in prod Mongo with an OLDER password hash. Previous seed only created accounts when missing or back-filled hashes when missing — it did NOT overwrite existing wrong hashes.
- **Fix 1 — Force-reset on startup**: `ensure_canonical_accounts()` now ALWAYS sets `password_hash` to `pwd_ctx.hash("123456")` for both canonical accounts on every startup, regardless of pre-existing state. Reproduced exact prod symptom (forced wrong hash → login 401), restarted → seed log "Reset canonical doctor password" → login with `123456` returns 200.
- **Fix 2 — `POST /api/auth/admin-reset`**: token-protected endpoint (`ADMIN_RESET_TOKEN` in `backend/.env`) supporting two actions:
  - `action=reset` + `new_password` → overwrites any user's password hash.
  - `action=delete` → removes a user record so the email can be re-registered.
  - Used to recover from any stale-data lockout on the deployed app without DB access.
- Verified: canonical login 200, admin-reset → new password 200, admin-delete → re-register same email 200, bad token 401.
- **Files**: `backend/server.py` (force-reset logic + new `/api/auth/admin-reset` endpoint), `backend/.env` (added `ADMIN_RESET_TOKEN`), `memory/test_credentials.md` updated with recovery cookbook.

### Phase 13 — Auth survives redeploys (27 Apr 2026)
- **Bug**: After a redeploy / fresh-DB Mongo, `idrlapt@gmail.com` and `drgapt@gmail.com` didn't exist → sign-in returned 401. Old `startup_seed` only seeded patients, never users.
- **Fix**: New `ensure_canonical_accounts()` async function called from the existing `@app.on_event("startup")`. Idempotently:
  - Creates `idrlapt@gmail.com` with role=doctor + bcrypt hash of `123456` + Dr. Lahari profile fields if missing.
  - Creates `drgapt@gmail.com` with role=patient + bcrypt hash of `123456` + auto-linked patient record if missing.
  - If either account exists but lacks `password_hash` (e.g., legacy OAuth-only), back-fills the hash so password login starts working immediately.
- **Verified** by deleting both users, restarting backend, observing seed log lines, and successfully signing in with `idrlapt@gmail.com / 123456` and `drgapt@gmail.com / 123456`. Sign-up + new-user login also confirmed working; wrong password correctly returns 401.
- **Files**: `backend/server.py` (added ~70 LOC at startup hook + new helper), `memory/test_credentials.md` updated.

### Phase 12 — Demo Polish + Architecture Page (27 Apr 2026)
- **Landing simplification**: removed "Watch 2-min demo" secondary CTA. Single primary CTA renamed to **"Experience Live Demo"** with support text "No login required · 2-minute guided experience". Added **Architecture** link to top nav. Bottom CTA mirrors the same pattern.
- **Login exits**: added top-left **"← Back to Home"** link, top-right "Try live demo" link, and a demo-escape block below the Sign-in button ("Prefer to explore first? Try the demo — no login required." → "Just exploring? Try live demo →"). User can never get trapped on `/login`.
- **Simulated voice on /demo Symptoms step**: 🎤 Record button → 2-second "Recording…" animation → auto-fills transcript `"I'm feeling dizzy, weak, and sweating"` and auto-selects Dizziness/Weakness/Sweating chips. Zero microphone permissions, zero API calls. "Voice-first (simulated for demo)" note next to button.
- **NEW `/architecture` route → `Architecture.jsx`**: standalone, zero-API, presentation-ready system architecture page with:
  - 6 color-coded layers (Patient · Communication · AI · Data · Doctor · Integration cross-cutting band).
  - Patient → Twilio → AI Triage → Mongo → Doctor flow band.
  - 6 Design Principles cards.
  - 3 Stack-at-a-glance cards (Frontend · Backend · Operational).
  - CTA back to `/demo`.
- Verified end-to-end via Playwright: all 6 layers render, demo voice flow → AI hypoglycemia alert still works, login + back-to-home links functional.

### Phase 11 — Public Landing + Senior PM Static Demo (27 Apr 2026)
- **New `/` route → `Landing.jsx`** (public, no auth): hero w/ live-triage chat preview, How-it-works (3 cards), Features grid (6), bottom CTA. "Try Live Demo" + "Sign in" CTAs. Built by a practicing MBBS doctor messaging.
- **New `/demo` route → `Demo.jsx`** (public, ZERO API calls — bulletproof for live demos):
  - 12 scripted steps: Intro → Doctor pick (Dr. Lahari) → Basics (Patryk S, 34, Male) → Symptoms (Dizziness/Weakness/Sweating) → Vitals (BG **68 mg/dL**) → AI Analyzing→Alert (Possible hypoglycemia w/ reasoning + Dr. paged + WhatsApp alert) → Doctor handoff card (vitals/allergies/current Rx/Care AI assessment) → Live consultation chat → Rx draft (Oral glucose 15g STAT, hold tonight's insulin, 4-hr Care AI reminders) → Sign & send → Patient view (in-app + WhatsApp) → 24h continuity timeline → Finale.
  - Walkthrough verified end-to-end via Playwright; all 12 steps render correctly.
- **Routing/redirect updates**: doctor home moved `/` → `/dashboard`. Updated `Login.jsx`, `AuthCallback.jsx`, `RoleSelect.jsx`, `auth.jsx` ProtectedRoute, `Sidebar.jsx` (NAV_DOCTOR Dashboard link, brand-click target, `isActive`).
- **CSS**: added `.pill / .pill-on / .demo-input` to `index.css` for the demo's interactive option chips and form inputs.
- **Files added/changed**: `frontend/src/pages/Landing.jsx`, `frontend/src/pages/Demo.jsx`, `frontend/src/App.js`, `frontend/src/lib/auth.jsx`, `frontend/src/components/Sidebar.jsx`, `frontend/src/pages/Login.jsx`, `frontend/src/pages/AuthCallback.jsx`, `frontend/src/pages/RoleSelect.jsx`, `frontend/src/index.css`.

### Phase 10 — Demo Day Fixes (26 Apr 2026)

**Batch A — pre-demo critical**
- **A1 Hide Rx until finalized**: `ConsultationSession.jsx` only renders the prescription panel and doctor/patient summary cards for the patient when `session.status === "ended"`. Doctor sees the editor in `pending_rx` + `ended` as before. The intake summary preview is now doctor-only too.
- **A2 Patient intake immediately after booking**: Patients can start intake on `requested` appointments — they don't have to wait for the doctor to confirm the slot. INTAKE_SYSTEM has a new MANDATORY DEMOGRAPHIC GATE that asks for Name → Age (with bucket options) → Biological sex (with options) BEFORE clinical questions, but only when those fields are missing on the patient record. After intake the demographics auto-persist into `patients.personal_info`.
- **A3 AI false-alert correction**: New `correction:bool` field in the FOLLOWUP TRIAGE schema. When patient downgrades (e.g. "actually it's just heartburn"), all open emergency/high alerts for that patient flip to `status=cleared_by_correction`, a "✅ Previous alert cleared" system message is appended to the patient chat, and a new `info`-urgency alert (`source=correction`) is created so the doctor sees the update with the patient's clarification. Heuristic safety net: even without the prompt flag, downgrade from emergency/high → low/medium triggers the same flow.
- **A4 Post-prescription WhatsApp + Care AI Rx context**: `_build_patient_context` now exposes `latest_prescription` (med, dose, freq, duration, instructions, reason). FOLLOWUP_SYSTEM has a new PRESCRIPTION QUERIES rule — Care AI answers "what is this for", "can I take with food", "I missed a dose", "side effects" using exactly the data on file, and surfaces `topic="prescription_query"` triage when the patient implies stopping/changing the med. Same context flows to WhatsApp via the existing webhook adapter, so the Care AI on WhatsApp can read + explain + answer Rx queries identical to the web app.

**Batch B — multimodal /followup**
- **B1 Mic on /followup**: Already present (Web Speech via shared `lib/speech.js` helper). Verified.
- **B2 File/image upload on /followup**: New paperclip button next to the mic. Accepts images (jpg/png/heic/heif), PDFs, .doc/.docx. 10MB limit. Optimistic placeholder while uploading.
- **B3 + B4 GPT-4o vision interpretation**: New `POST /api/followup/upload` endpoint. Images are sent through GPT-4o vision with a strict JSON output contract (`image_type`, `summary_for_patient`, `summary_for_doctor`, `extracted_data` with medications/lab_values/key_findings, `urgency`, `alert_doctor`, `follow_up_questions`). The patient sees a friendly summary card in chat with extracted data; the doctor sees the original image + clinical summary as a `doctor_alert` (urgency-aware — symptom photos with red flags auto-escalate to high). Non-image files still get persisted, ack'd to the patient, and forwarded to the doctor without LLM analysis.
- New endpoints: `GET /api/followup/attachments/{id}` (ownership-gated). New collection: `followup_attachments`.
- Tests: `tests/test_demo_batch.py` — passes 100% with vision call live.


### Phase 11 — WhatsApp privacy controls (28 Apr 2026)
- **Backend (already shipped earlier this session)**: `GET /api/whatsapp/preferences` + `PATCH /api/whatsapp/preferences` (auth-gated). Per-channel toggles `send_prescriptions`, `send_summary`, `send_reminders`, `send_alerts`, `send_reports` + `consent`. `_wa_can_send` gate enforces verified-number + consent + per-channel before any outbound. Number change resets prefs; same number does not. Tests: `tests/test_whatsapp_phase23.py` (passing).
- **Frontend (NEW)**: `WhatsAppSettingsCard` component on `/portal` (below the Connect WhatsApp CTA). Shows status (Connected/Not connected) with masked number (`+91 •••••• 3210`), 5 channel toggles wired to `PATCH /api/whatsapp/preferences` with optimistic UI + error rollback, and a Disconnect button calling `POST /api/whatsapp/disconnect`. When unlinked the card renders disabled (opacity 0.6). All controls have `data-testid`s (`wa-settings-card`, `wa-status-text`, `wa-toggle-{key}`, `wa-disconnect-btn`).
- **Files**: `frontend/src/components/WhatsAppSettingsCard.jsx` (new), `frontend/src/pages/PatientPortal.jsx` (mounts card), `frontend/src/lib/api.js` (`getWhatsappPreferences`, `updateWhatsappPreferences` helpers).
- **Smoke-tested**: login as `drgapt@gmail.com` → toggles persist roundtrip, masked number renders correctly, disconnect button visibility gated on `linked && verified`.


### Phase 12 — Doctor "Command Center" Dashboard (28 Apr 2026)
- Full doctor `/dashboard` redesign per the design_guidelines.json blueprint (saved by `design_agent_full_stack`). Replaced the old patient-centric mock dashboard with an 11-section command center: KPI strip (6 metrics with threshold-based color), Active Consultation Panel (live preview of in-progress session w/ AI symptoms / meds / allergies / red flags / Rx CTA), Live Queue (urgency-sorted, Intake-completed badge, wait minutes), Today's Schedule timeline (vertical with status dots), Safety Alerts Panel (urgency-coloured with pulse), Quick Actions (5 actions), Analytics Pulse teaser (10-day sparkline + AI hours saved + abnormal labs), Templates Preview (Phase 2 placeholder), Doctor Journey horizontal rail (11 steps from Login to Follow-up).
- All KPIs, schedule, queue, alerts, and pulse pull from existing tested APIs (`/patients`, `/followup/alerts`, `/appointments`, `/pharmacy/prescriptions`, `/consultations`, `/analytics`). Active Consultation Panel reads the most recent `in_progress`/`live`/`pending_rx` session.
- Sidebar restructured: added "Consultations" (Video icon) and "Templates" (FileText icon, with "SOON" badge), renamed "Follow-up AI" → "Follow-ups", "Laboratory" → "Lab Results". Display order: Dashboard / Patients / Consultations / Templates / Follow-ups / Alerts / Lab Results / Analytics / Reminders / Messages / Pharmacy.
- New `/templates` route with `Templates.jsx` — Phase 2 placeholder showing 3 sample preset cards (Fever, Diabetes follow-up, Gastritis) with full Rx/Tests/Advice preview + "AI-learn my prescribing style" banner. All actions locked.
- Layout: added `/dashboard`, `/templates`, `/alerts` to focus mode so the right-side `RightPanel` (Find a doctor + queue) is hidden on these routes — dashboard gets full width.
- New CSS utility: `.hide-scrollbar` for the journey rail.
- **Files added**: `frontend/src/components/dashboard/{KpiStrip,ScheduleTimeline,LiveQueue,ActiveConsultPanel,AlertsSafetyPanel,QuickActions,TemplatesPreview,AnalyticsTeaser,DoctorJourney}.jsx`, `frontend/src/pages/Templates.jsx`. **Modified**: `Dashboard.jsx`, `Sidebar.jsx`, `Layout.jsx`, `App.js`, `lib/api.js` (added `listConsultationSessions`), `index.css`.
- **Phase 1 enforcement**: Templates module + AI suggestion engine deliberately NOT wired to backend — Templates page uses static preset cards locked behind a Phase 2 badge. The Active Consultation panel surfaces existing Care AI-generated intake data only; no new AI suggestion calls.
- **Smoke-tested**: doctor login → all 11 sections render with live data (3 consults, 35 patients, 3 alerts), sidebar shows new structure with SOON badge on Templates, Templates page renders preset cards, Doctor Journey rail scrolls horizontally with all 11 steps.


### Phase 13 — Templates Engine + Live AI Suggestions (28 Apr 2026)
**2A — Templates module (full CRUD)**
- Backend: 6 new endpoints in `server.py` (`GET/POST/PATCH/DELETE /api/templates`, `GET /api/templates/{id}`, `POST /api/templates/{id}/apply`). Doctor-scoped (`doctor_only` gate); each template stores `medications[]`, `tests[]`, `advice`, `follow_up`, `condition_tags[]`, `icon`, `usage_count`. Apply endpoint atomically increments `usage_count` and stamps `last_used_at` so the list sorts by "most used" — the "AI-learn my prescribing style" foundation.
- Frontend: `/templates` page rewritten as a real CRUD studio — list grid + "+ New template" CTA, full editor modal with structured sections (name, icon picker, condition tags, medications with dose/frequency/duration/instructions, tests with urgency, advice, follow-up), edit + delete per card, "Most used" badge on top template, empty-state with onboarding copy.
- `QuickPrescribeModal` wired to load doctor's templates on mount and surface a header dropdown ("Template · N") that applies a template with a single click — merges meds (preserving any AI-drafted starter), appends tests, fills advice/follow-up only when empty (never clobbers doctor input). Applies trigger `usage_count++` so subsequent dropdowns sort smartest-first.
- Files: `pages/Templates.jsx` (rewritten), `components/QuickPrescribeModal.jsx` (modified), `lib/api.js` (added 6 helpers), `index.css` (new `.input` utility).
- **Curl-tested** all 6 endpoints — create / list / get / patch / delete / apply (usage_count=1 verified) + 403 gate for patient role. **UI smoke-tested**: empty state → create → card render → editor reopen → apply in QuickPrescribeModal → med appears in form.

**2B — Live AI suggestions on Active Consult panel**
- `ActiveConsultPanel.jsx` rewritten — when an active session is detected, fires `POST /api/prescriptions/ai-guidance` with the patient's intake summary (chief complaint, current meds, provisional dx) and renders the response inline: suggested investigations (urgency-coloured pills: routine/urgent/stat), "Did you ask about?" missed symptoms list, and the follow-up hint. Loading + error + no-suggestions states all handled distinctly.
- Replaces the previous static "AI co-pilot · suggestions ready" placeholder. Doctor sees real, contextual gap analysis without leaving the dashboard.
- Phase 2 enforcement note: this surfaces an EXISTING Care AI endpoint that was already shipped & tested — we only added the dashboard-level UI binding.


### Phase 14 — Phase 3 Advanced AI (28 Apr 2026)

**3B — WhatsApp activity surface for the doctor**
- New backend endpoint `GET /api/whatsapp/activity` (doctor-only) — aggregates last-24h WhatsApp follow-up messages, groups by `patient_id`, returns: last message preview, message role, voice flag, urgency, total count per thread. Uses `followup_chats` collection (already populated by the inbound Twilio webhook). Doctor-only gate.
- New frontend widget `components/dashboard/WhatsAppActivity.jsx` mounted on `/dashboard` next to the Pulse card. Shows total messages + thread count, then a list of patient threads (avatar + last preview + voice badge + relative time) with click-to-open-chat. Empty state: "No WhatsApp activity in the last 24 hours."
- Reuses existing FollowupChat tagging (already shipped — inbound msgs already render with `source=whatsapp`/`media_type=voice` chips).

**3C — Autonomous AI Co-Pilot on alerts**
- New backend endpoint `POST /api/followup/alerts/{id}/copilot` (doctor-only). Pulls the alert + patient profile + last 10 follow-up messages, asks GPT-4o for 1-3 next actions in a strict JSON contract: `{summary, actions[{kind:"draft_reply|order_lab|escalate|prescribe|schedule_followup", title, why, suggested_text?, suggested_lab?, urgency:"routine|urgent|stat"}]}`. Hard caps + enum validation on every field. Conservative tone (no diagnostic conclusions).
- New frontend component `components/AlertCopilotCard.jsx` — embedded inside every open alert on `/alerts`. Shows a lazy "Suggest" button (saves LLM cost — only fires when the doctor asks). On click, renders each action with kind icon + urgency dot + plain-language "why" + the pre-drafted patient reply (italicized) when applicable. One-click "Send to patient" calls the existing `POST /api/messages` endpoint; "Open Rx" wires into the existing QuickPrescribeModal; "Open lab" / "Open chat" deep-link.
- **End-to-end smoke-tested**: doctor login → opened `/alerts` → 4 alerts each had the Co-Pilot card → clicked "Suggest" on the first → GPT-4o returned `{summary:"Patient uploaded an image, analysis unavailable.", actions:[{kind:"draft_reply", title:"Acknowledge image upload", urgency:"routine", suggested_text:"Thank you for uploading the image..."}]}` → action card rendered with working Send/Open chat buttons.

**Files added**: `backend/server.py` (2 new endpoints), `components/AlertCopilotCard.jsx`, `components/dashboard/WhatsAppActivity.jsx`. **Modified**: `pages/Alerts.jsx`, `pages/Dashboard.jsx`, `lib/api.js` (2 helpers). All lint clean.


### Phase 15 — Patient Experience Redesign (28 Apr 2026)
Per 8-part senior PM brief. Audit confirmed Parts 1, 2, 3, 5, 6 already shipped (auto-redirect on slot booking, 5-profile system at `/api/profiles`, AI memory + allergy collision checks, structured Rx, Voice Co-Pilot). New work focused on Parts 4, 7, 8.

**Part 8 — Patient Dashboard ("Hi, [Name]" experience)**: full `PatientPortal.jsx` rewrite. New IA: Hero (greeting + ProfileSwitcher dropdown + "Consult a Doctor" CTA) → WhatsApp/Reschedule banners → 3-col ROW 1 (Health Snapshot with conditions/allergies pills + last visit, Active Medications with reminder shortcut, Upcoming Visits with date stamps) → Recent Consultations grid (date · "X Rx" badge · "Open · ask AI" CTA) → Family Profiles row (avatars for all profiles + dashed "Add member" slot, max 5) → Care AI + Reminders shortcuts → WhatsApp settings.

**ProfileSwitcher** (new `components/ProfileSwitcher.jsx`): glassmorphic dropdown next to Consult CTA. Shows current profile (relationship label · name · initial avatar). Menu lists all owned profiles with relationship-coloured dots, switches via `POST /api/profiles/{id}/switch` with full page reload. Inline "+ Add" form (name/age/gender/relationship: mother/father/spouse/child/sibling/family/guest) creates new profile via `POST /api/profiles`. Hard-stops at 5/5.

**Part 4 — "Continue with Care AI" inline panel** on `ConsultationDetail.jsx`. Patient-only. Shows compact chat history (last 6 messages from `/api/care-ai/history/{patient_id}`), 3 quick prompts ("Should I worry about side effects?", "When should I follow up?", "Can I exercise normally?") to lower friction, and a chat input. Each message is auto-prefixed with consultation context ("I'm asking about my consultation on Apr 28 for…") so Care AI grounds answers to that specific visit. Uses existing `/api/care-ai/message` endpoint — no new backend.

**Part 7 — Reminders categorisation**: `Reminders.jsx` rewritten with 4 tabs (Medications · Follow-ups · Tests · Alerts), each with badge counts. Medications keeps the existing CRUD + log-taken UX. Follow-ups pulls from `/api/appointments` (filtered by `is_followup`/type). Tests pulls from `/api/lab/results` (status: ordered/pending). Alerts (doctor-only) pulls from `/api/followup/alerts`. Reminder cards now also show a "From consultation →" link when `source_consultation_id` is set, closing the loop between visit and ongoing care.

**Verified already shipped (no changes needed)**:
- Part 1: `PatientPortal.handleBooked` already navigates to `/consult/new?appointment_id=...` after slot booking, AI intake auto-starts.
- Part 2: `/api/profiles` (GET/POST/PATCH/DELETE/switch) backend live, max-5 enforced, `relationship` field respected.
- Part 3: `medical_facts` collection auto-extracts allergies/conditions from chat; pre-Rx allergy collision check in `QuickPrescribeModal` Co-Pilot.
- Part 5: Structured `QuickPrescribeModal` already covers all 9 sections (patient, complaint, summary, notes, meds, investigations, advice, follow-up, doctor letterhead).
- Part 6: Voice-first Rx via `/api/prescriptions/copilot/voice`; Co-Pilot warns on allergy/dose/gap/missed-symptom.

**Files**: `pages/PatientPortal.jsx` (rewrite), `pages/ConsultationDetail.jsx` (rewrite), `pages/Reminders.jsx` (rewrite), `components/ProfileSwitcher.jsx` (new), `lib/api.js` (5 profile helpers added). All lint clean.

**Smoke-tested** as `drgapt@gmail.com` (demo patient): hero renders correctly, ProfileSwitcher menu shows "Profiles · 1/5" + Add affordance, all 9 main sections rendered with live data (2 active Rx, 2 upcoming visits, 2 recent consultations, family profiles with self+add slot), Reminders tabs all switch correctly with empty states.


### Phase 16 — Pre-Treatment Validation Gate (29 Apr 2026)
**The single biggest clinical-safety win shipped this session.** Implements Rule 3 of the AI Care Engine spec: before a patient takes a newly issued medication, Care AI proactively asks for the relevant vitals, classifies them as safe/hold, and either clears the patient or holds the Rx + raises a doctor alert.

**Backend (`server.py`)**:
- `_VITAL_RULES`: rule table mapping medication keywords → required vitals with safe/hold thresholds. Currently covers insulin/sulfonylureas → blood glucose; ACE-I/ARB/CCB/beta-blocker → BP; antipyretics → temperature; anticoagulants → bleeding screen.
- `_required_vitals_for_meds(items)` resolves the union of vitals for an Rx.
- `_classify_vital(def, raw)` parses numeric, "120/80" BP, and yes/no formats; returns `{ok, status: safe|hold|unclear, reason}`.
- `GET /api/prescriptions/{rx_id}/safety-check` and `POST /api/prescriptions/{rx_id}/safety-check/submit` (patient or owning-doctor scoped).
- **Auto-trigger**: `quick_prescribe` now stamps `safety_check.status="pending"` on the consultation entry when the issued meds need vitals, drops a `safety_check_request` message into `followup_chats`, and pushes the prompt to WhatsApp (privacy-gated through `_wa_can_send`).
- **On hold**: auto-creates a `doctor_alerts` entry (`urgency=high`, `kind=safety_hold`), pushes a "Hold this medication" message to the followup chat + WhatsApp, returns the explicit hold reason.
- **On cleared**: posts a "✅ All vitals look safe — you can start" message.

**Frontend (`SafetyCheckBanner.jsx` + `PatientPortal.jsx`)**:
- New full-width banner mounts at the top of `/portal` whenever the patient's most-recent consultation has a pending/partial/hold safety check.
- Renders each required vital as a labelled input with the unit hint, calls `submitSafetyCheck` with optimistic UI.
- Hold state shows red border, plain-language reasons, and a "if you feel unwell, go to ER" failsafe.
- Cleared → banner auto-hides + toast confirms.

**Curl-tested**: insulin Rx → required vital `blood_glucose`; submitting `50` → status `hold` (alert raised); submitting `120` → status `cleared`. **UI smoke-tested**: amlodipine Rx → BP banner renders, submitting `125/82` → "All vitals safe" toast, banner removed.

**Audit of other AI-Care-Engine rules**: Rule 1 (context awareness) ✅ via `_build_patient_context`; Rule 2 (post-consult auto-summary push) ✅ via `_send_consultation_to_whatsapp`; Rule 4 (2-way WA chat) ✅ via `whatsapp_router.py`; Rule 6 (clinical media interpretation) ✅ via `/api/followup/upload` GPT-4o vision; Rule 7 (voice STT/TTS) ✅; Rule 8 (red-flag escalation) ✅ via `<TRIAGE>` JSON contract + `EMPATHY_RULES`; Rule 9 (structured response style) ✅ via `RESPONSE LENGTH` rules; Rule 10 (escalation) ✅. **Still pending**: Rule 5 (Day 1/3/5 proactive scheduled check-ins — needs cron/scheduler).


### Phase 17 — WhatsApp-First Care Engine (29 Apr 2026)
Turns WhatsApp into a true zero-app interface: patients can submit vitals, clear pre-treatment safety gates, and trigger emergency escalations without ever opening the web portal.

**Stateful session engine** (`whatsapp_sessions` collection): `{patient_id, current_stage: 'safety_check'|'idle', expected_input: ['blood_glucose'|'bp'|'temperature'|'bleeding'], active_rx_id, expires_at (72h)}`. Auto-set in `quick_prescribe` when an Rx requires vitals; auto-cleared when `submit_safety_check` returns `cleared`.

**Smart inbound parser** (`whatsapp_router.py`): regex-driven, runs BEFORE the LLM call.
- `_BP_RE` matches `120/80`, `120-80`. `_TEMP_RE` matches `98.6 F`, `37.1 c`. `_GLUCOSE_KEY_RE` matches `sugar 110`, `blood sugar is 130`. `_LONE_NUM_RE` matches a bare number — only mapped when the session has exactly one expected input (disambiguates by range: 30-600 → glucose, 90-110 → fahrenheit temp, 30-45 → celsius temp).
- When parsed values match `expected_input`, calls `submit_safety_check` **in-process** (no HTTP roundtrip) and returns the result via TwiML. Reply text differs by status (`cleared` / `hold` with reason / `partial` with re-ask of missing vitals).

**Emergency-keyword fast path**: `chest pain`, `can't breathe`, `breathless`, `shortness of breath`, `passed out`, `faint*`, `unconscious`, `seizure`, `stroke`, `bleeding heavily`, `vomit blood`, `suicide`. Bypasses LLM, instantly creates `doctor_alerts` entry with `urgency='emergency', kind='wa_emergency'`, replies with ER failsafe.

**Day 1/3/5 follow-up scheduler** (Rule 5 from the AI Care Engine spec):
- `_FOLLOWUP_TEMPLATES` defines the 3 check-in messages (Day 1: "How are you feeling today?", Day 3: "Are your symptoms improving?", Day 5: "Do you need a follow-up consult?").
- `_schedule_followup_checkins(patient_id, rx_id)` is called on safety-check `cleared` — creates 3 idempotent rows in `followup_schedule` with `due_at`, `status='pending'`.
- `POST /api/followup/scheduler/tick` (doctor/admin) processes all due entries, posts to `followup_chats`, pushes to WhatsApp via `_wa_can_send(send_reminders)`. Skips entries when an open `safety_hold` alert exists for the same Rx so we never pile on a patient already in trouble. Has `?test_due_within_seconds=N` for cron testing.
- `GET /api/followup/scheduler/queue` (doctor/admin) — debug surface for the queue.

**Files**: `whatsapp_router.py` (session engine + smart parser + emergency path + in-process safety submit), `server.py` (3 new endpoints + `_schedule_followup_checkins` helper + `quick_prescribe` session-set + `submit_safety_check` session-clear & schedule-trigger).

**End-to-end tested**:
- Metformin Rx → WA session created with `expected_input=['blood_glucose']`, `active_rx_id=...`. ✅
- Submit `blood_glucose=110` → status `cleared`, session auto-cleared, 3 follow-up rows created (Day 1/3/5 due dates correct). ✅
- `POST /api/followup/scheduler/tick?test_due_within_seconds=604800` → processed=3, sent=3, failures=0. ✅
- Patient `followup_messages` thread now contains: `async_prescription` → `safety_check_request` → `safety_clear` → `followup_day1` → `followup_day3` → `followup_day5`. ✅
- Regex parser test: `125/80` → BP, `98.6 F` → temp, `sugar 110` → glucose, `chest pain` / `can't breathe` → emergency, `120` → lone (resolved via session expected_input), `still fever` → no match (falls through to LLM). ✅


### Phase 18 — Clinical Intelligence Core (30 Apr 2026)
Explicit Senior-Doctor-over-Junior-Doctor reasoning loop on every Care AI message. Turns the follow-up assistant from a chatbot into a state-aware clinical decision system with explicit mode switching.

**Prompt upgrade** (`FOLLOWUP_SYSTEM`): added a new "Clinical Intelligence Core" block after the mixed-language section. Mandates on every message:
1. Context reconstruction (complaint, dx, Rx, vitals, timeline, risk).
2. Gap analysis ordered by risk × decision-impact (vitals > severity > duration > adherence > lifestyle > red flags).
3. Risk stratification (safe / caution / unsafe).
4. Decision pathway — choose ONE of: ASK / GUIDE / HOLD / ESCALATE.
5. Response shape: **Acknowledge → Interpret → Action** (prose, no labels).

**Mode enum** added to the TRIAGE JSON contract: `inquiry | reasoning | action | safety | escalation | delay`. Also added `risk: safe|caution|unsafe` and `gap: [up to 3 strings]` — the list of high-yield data the AI still needs.

**Extended triage parser** (`_parse_triage`): normalises the new fields with safe fallbacks. If the LLM omits `mode`, we derive it from urgency (emergency/high → escalation, else reasoning). If the LLM omits `risk`, we derive it from mode (safety/escalation → unsafe, else caution). `gap` is coerced to a list of ≤3 ≤80-char strings.

**Persistence**: `followup_message` handler and the WhatsApp inbound handler both persist `mode`, `risk`, `gap`, and `red_flags` onto the assistant's `followup_chats` document — so the dashboard and FollowupChat UI can surface them.

**UI surface** (`FollowupChat.jsx`, doctor-view only):
- New **MODE pill** next to each assistant message (colour-coded per mode: inquiry=blue, reasoning=violet, action=green, safety=red, escalation=amber, delay=grey).
- Small **risk chip** (caution/unsafe only; safe is implicit).
- **Gap analysis footer** — violet-tinted strip reading "Care AI next step: [gap items]" under every doctor-viewed AI message whenever the list is non-empty.
- Patient view remains clean — these clinical metadata badges are doctor-only (role-gated).

**Micro-rules baked into the prompt**: never finalize dx, never permanently change Rx, prefer escalation over risk, question prioritization ("what answer will most change my decision?"), temporal awareness (always track onset + trend), contradiction detection (low sugar + insulin planned → force safety mode).

**End-to-end tested**: sent `"I have fever"` → mode=`reasoning`, risk=`caution`, urgency=`medium`, text asked for current temperature — correct "ask before advising" behaviour. Chest-pain query → same inquiry pathway with urgency=`medium` until severity/duration resolved. Parser safely falls back when LLM omits newer fields. **Files**: `server.py` (`FOLLOWUP_SYSTEM` + `_parse_triage` + followup message persistence), `whatsapp_router.py` (WA persistence), `FollowupChat.jsx` (mode pill + risk chip + gap footer).


### Phase 19 — Condition-aware care + auto-scheduler + triage dashboard (30 Apr 2026)

**1. Condition-aware follow-up templates** (`_CONDITION_TEMPLATES`): rule-table matching substrings from `chief_complaint + assessment + reason + meds` against condition families — fever, diabetes, hypertension, cough/URI, gastritis. Each family has tailored Day 1 / Day 3 / Day 5 text ("Day 1 — share your current temperature", "Day 1 — what's your fasting sugar?", "Day 1 — what's your BP reading?"). `_resolve_condition_template` resolves the best match; `_schedule_followup_checkins` now stamps `condition_aware=true/false` on each scheduled row. Unmatched conditions still get the generic wording.

**2. Enriched clinical depth in prompt**: added `# CONDITION-SPECIFIC CLINICAL DEPTH` block to `FOLLOWUP_SYSTEM`. For fever/diabetes/hypertension/cough/gastritis, the LLM is given explicit 3-question priority orderings and named red-flag thresholds (e.g., temp ≥ 104°F, systolic ≥ 180 with symptoms = emergency; low sugar < 70 while on insulin/sulfonylurea → force `mode=safety` and HOLD). These answers feed back through the WA smart parser — a `"125/80"` reply on a hypertension thread now routes straight into `submit_safety_check`.

**3. Mode-based doctor dashboard prioritization**: `GET /api/whatsapp/activity` now stamps each thread with the most recent AI `mode`/`risk` and **sorts by mode priority** (safety → escalation → inquiry → reasoning → action → delay). The WhatsApp · 24h widget on the doctor dashboard has been rebuilt: counts "N need triage", the widget icon turns red when safety/escalation threads exist, each thread row shows a colour-coded mode chip, safety/escalation threads get red/amber left borders + accent avatar gradients so they pop out. A true real-time triage view — Dr. Lahari sees who's in trouble at a glance.

**4. Automated 15-min scheduler**: new `@app.on_event("startup") async def startup_scheduler` runs a background `_tick_loop` that polls `followup_schedule` every 15 min, processes due pending entries (skipping patients with open `safety_hold` alerts), writes to `followup_chats`, and pushes to WhatsApp through `_wa_can_send(send_reminders)`. Logged as `[followup-scheduler] background task started (15-min interval)`. The manual `POST /api/followup/scheduler/tick` endpoint remains for ops/debug.

**End-to-end tested**: fever Rx (chief_complaint="High fever with body ache") → all 3 Day templates stamped `condition_aware=true` with "share your current temperature" wording. LLM `"I have fever"` test — `mode=reasoning`, asks for temperature first before anything else (correct inquiry behaviour). Backend log shows scheduler task started on boot. Dashboard screenshot confirms the upgraded WhatsApp · 24h widget renders the empty state + the triage layout (safety/escalation would surface first with red accent when present).

**Files**: `server.py` (condition templates + scheduler task + prompt depth + mode-prioritised activity endpoint). `components/dashboard/WhatsAppActivity.jsx` (rebuilt — triage counter, mode chips, safety border). Total: +~350 LOC, all lint clean.


### Phase 20 — Deep Media Interpretation + Voice Reply Enhancements (30 Apr 2026)

**1. Images on WhatsApp → full clinical vision read**: The WhatsApp webhook now extracts every non-audio media item from Twilio's `MediaN` fields. For images (lab reports, symptom photos, Rx photos, pill packaging, medical documents), the payload is downloaded with Twilio Basic Auth and fed to a new shared helper `_vision_interpret_image` in `server.py` — which wraps GPT-4o vision under the existing `VISION_SYSTEM` contract. The webhook then composes a rich patient reply: `🔬 I reviewed your lab report`, summary, *Key values* bullet list (with reference ranges), *Medications* / *Findings*, and automatic escalation wording (`⚠️ I've alerted Dr. Lahari — she'll reach out shortly`) on high/emergency urgency. A `doctor_alerts` row with `source="whatsapp_image"` and `attachment_url` is raised for every image upload; an `image_analysis` chat turn (with structured analysis) is persisted to `followup_chats` so both the /followup UI and the dashboard mirror the WhatsApp conversation. Non-image docs (PDFs) are stored + acknowledged + alerted (low urgency) with a nudge to resend lab reports as photos for instant reads.

**2. Fixed a silent vision regression**: the existing `/api/followup/upload` vision call was passing `ImageContent(image_url=data_url)` — the emergentintegrations SDK's `ImageContent` only accepts `image_base64`. That meant every portal lab-report upload had been hitting the exception fallback ("saved it for Dr. Lahari to review"). Migrated to `ImageContent(image_base64=...)`; both the portal upload and the new WhatsApp pipeline now produce real clinical reads.

**3. Voice-reply preference + trigger modes**: added `voice_replies` to `whatsapp_prefs` (default OFF). Three new TTS-reply triggers beyond the existing "voice-in → voice-out" behaviour:
  - Patient toggled **Voice replies** ON in the portal (new toggle in `WhatsAppSettingsCard`)
  - Patient typed a natural-language request ("voice please", "voice note", "read it out", "speak this") — caught by `_VOICE_REQUEST_RE`
  - Patient sent an image → the AI always follows up with a TTS audio note when voice-reply preconditions are met (image analyses are medically complex and benefit from audio)

**4. Shared vision helper**: refactored the inline vision code from `/api/followup/upload` into `_vision_interpret_image(patient, data, content_type) -> dict | None`. The helper is injected into `build_whatsapp_router(vision_interpret=...)` so both channels produce the same clinical contract. `_default_wa_prefs` returns `voice_replies=False` so legacy users get an opt-in experience.

**5. Tests**: new `backend/tests/test_whatsapp_phase20.py` (5 passing tests) covering (a) vision helper returns contract, (b) `voice_replies` pref round-trips through `/api/whatsapp/preferences`, (c) voice-request regex matches common phrasings + rejects off-topic text, (d) webhook returns 200 on image payload with unreachable MediaUrl (graceful degradation), (e) `/api/followup/upload` E2E produces a real GPT-4o vision analysis. Existing `wa_care_engine_e2e.sh` still green — 21/21.

**Files**: `backend/server.py` (+`_vision_interpret_image`, `voice_replies` pref, `WaPrefsPatch`, router DI). `backend/whatsapp_router.py` (+`_extract_non_audio_media`, `_handle_image_media`, `_persist_image_turn`, `_VOICE_REQUEST_RE`, upgraded TTS trigger). `frontend/src/components/WhatsAppSettingsCard.jsx` (+ voice_replies toggle). `backend/tests/test_whatsapp_phase20.py` (new). Total: ~+270 LOC, lint clean.


### P1
- **End-of-Day Digest**: Care AI bundles all WhatsApp/follow-up activity for the day into one evening summary on Dr. Lahari's dashboard.
- **Emergency Voice Calls**: When triage = emergency, Twilio places an actual phone call to patient + doctor with a recorded warning (separate from voice-note replies).
- **Stronger emergency triage** in `FOLLOWUP_SYSTEM` — chest pain + dyspnea should be tagged `urgency=emergency` (currently sometimes `medium`).
- **Media expiry on /api/whatsapp/media/{id}.mp3** — record sets `expires_at` but `serve_media` doesn't enforce it.
- Replace `window.confirm` in `Reminders.jsx` with shadcn AlertDialog.
- Whitelist `status` values on `PATCH /api/followup/alerts/{id}`.
- Sanitize `/api/tts` error detail (don't leak provider error traces).
- Hoist `OpenAITextToSpeech` client to module-level singleton.
- Trim followup chat history to last ~20 turns before injecting into prompt.
- DELETE `/api/appointments/{id}` for stale TEST_ records (carryover iter-3).

### P2
- Advanced AI: differential diagnosis, ICD-10 suggestions, predictive risk.
- Wearables integration (Apple Health, Fitbit).
- EHR/FHIR interop (Epic, Cerner).
- SMS/email notifications (Twilio, Resend).
- Doctor voice consultations in-language.
- PDF export of consultation + follow-up transcripts.
- Telehealth video embeds.
- Multi-provider / Enterprise org features.
