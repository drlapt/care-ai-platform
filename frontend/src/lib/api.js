import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Per-tab session isolation: token stored in sessionStorage so you can open
// patient + doctor in two tabs of the same browser without cookie collision.
const TOKEN_KEY = "pc_session_token";
export const setAuthToken = (t) => { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); };
export const getAuthToken = () => sessionStorage.getItem(TOKEN_KEY);

export const api = axios.create({
  baseURL: API,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const t = getAuthToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// Auth
export const authMe = () => api.get("/auth/me").then((r) => r.data);
export const authLogout = () => api.post("/auth/logout").then((r) => r.data).finally(() => setAuthToken(null));
export const authDemoDoctor = () => api.post("/auth/demo-doctor").then((r) => { setAuthToken(r.data?.token); return r.data; });
export const authDemoPatient = () => api.post("/auth/demo-patient").then((r) => { setAuthToken(r.data?.token); return r.data; });
export const authExchangeSession = (session_id) => api.post("/auth/session", { session_id }).then((r) => { setAuthToken(r.data?.token); return r.data; });
export const authSetRole = (role) => api.post("/auth/role", { role }).then((r) => r.data);
export const authRegister = (payload) => api.post("/auth/register", payload).then((r) => { setAuthToken(r.data?.token); return r.data; });
export const authLogin = (email, password) => api.post("/auth/login", { email, password }).then((r) => { setAuthToken(r.data?.token); return r.data; });// 24/7 Follow-up AI
export const followupHistory = (patient_id) => api.get(`/followup/messages/${patient_id}`).then((r) => r.data);
export const followupMessage = (patient_id, message, language = "en") => api.post("/followup/message", { patient_id, message, language }).then((r) => r.data);
export const listDoctorAlerts = () => api.get("/followup/alerts").then((r) => r.data);
export const ackDoctorAlert = (id, status = "resolved") => api.patch(`/followup/alerts/${id}`, { status }).then((r) => r.data);

// Text-to-Speech — returns a Blob of audio/mpeg
export const ttsSpeak = (text, voice = "nova", speed = 1.0) =>
  api.post("/tts", { text, voice, speed }, { responseType: "blob" }).then((r) => r.data);

// Live consultation sessions
export const listConsultationSessions = () => api.get("/consultations").then((r) => r.data);
export const startIntake = (appointment_id, language = "en") => api.post("/consultations/start-intake", { appointment_id, language }).then((r) => r.data);
export const sendIntake = (session_id, message) => api.post("/consultations/intake-message", { session_id, message }).then((r) => r.data);
export const doctorJoinConsultation = (session_id) => api.post(`/consultations/${session_id}/join`).then((r) => r.data);
export const sendLiveMessage = (session_id, text) => api.post("/consultations/message", { session_id, text }).then((r) => r.data);
export const getConsultationSession = (session_id) => api.get(`/consultations/session/${session_id}`).then((r) => r.data);
export const getConsultationByAppt = (appointment_id) => api.get(`/consultations/by-appointment/${appointment_id}`).then((r) => r.data);
export const endConsultation = (session_id) => api.post(`/consultations/${session_id}/end`).then((r) => r.data);
export const updatePrescription = (session_id, items, doctor_notes = "") => api.patch("/consultations/prescription", { session_id, items, doctor_notes }).then((r) => r.data);
export const finalizeConsultation = (session_id) => api.post(`/consultations/${session_id}/finalize`).then((r) => r.data);
export const setConsultationLanguage = (session_id, language) => api.patch(`/consultations/${session_id}/language`, { language }).then((r) => r.data);
export const uploadConsultationFile = (session_id, file) => {
  const form = new FormData();
  form.append("file", file);
  return api.post(`/consultations/${session_id}/upload`, form, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
};
export const attachmentUrl = (attachment_id) => `${API}/consultations/attachments/${attachment_id}`;

// Doctor async quick-prescribe
export const quickPrescribe = (payload) => api.post("/prescriptions/quick", payload).then((r) => r.data);
export const quickPrescribeDraft = (payload) => api.post("/prescriptions/quick-draft", payload).then((r) => r.data);
export const rxAiGuidance = (payload) => api.post("/prescriptions/ai-guidance", payload).then((r) => r.data);
export const copilotCheck = (payload) => api.post("/prescriptions/copilot/check", payload).then((r) => r.data);

// Rx Templates (doctor-owned)
export const listTemplates = () => api.get("/templates").then((r) => r.data);
export const getTemplate = (id) => api.get(`/templates/${id}`).then((r) => r.data);
export const createTemplate = (payload) => api.post("/templates", payload).then((r) => r.data);
export const updateTemplate = (id, payload) => api.patch(`/templates/${id}`, payload).then((r) => r.data);
export const deleteTemplate = (id) => api.delete(`/templates/${id}`).then((r) => r.data);
export const applyTemplate = (id) => api.post(`/templates/${id}/apply`).then((r) => r.data);
export const copilotVoice = async (file, patientId) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("patient_id", patientId || "");
  return api.post("/prescriptions/copilot/voice", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
};

// Patient consents to share intake summary with the doctor
export const shareIntake = (session_id) => api.post(`/consultations/${session_id}/share`).then((r) => r.data);

// Follow-up multimodal upload (B1–B4): image / document / pdf
export const uploadFollowupFile = (patient_id, file, language = "en") => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("patient_id", patient_id);
  fd.append("language", language);
  return api.post("/followup/upload", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
};
export const followupAttachmentUrl = (id) => `${API}/followup/attachments/${id}`;

// Support mode chat (app help) — NOT medical
export const supportChat = (payload) => api.post("/support/chat", payload).then((r) => r.data);

// WhatsApp
export const whatsappStart = (whatsapp_number, language = "en") => api.post("/whatsapp/connect/start", { whatsapp_number, language }).then((r) => r.data);
export const whatsappVerify = (code) => api.post("/whatsapp/connect/verify", { code }).then((r) => r.data);
export const whatsappDisconnect = () => api.post("/whatsapp/disconnect").then((r) => r.data);
export const getWhatsappPreferences = () => api.get("/whatsapp/preferences").then((r) => r.data);
export const updateWhatsappPreferences = (patch) => api.patch("/whatsapp/preferences", patch).then((r) => r.data);

// Reminders
export const listReminders = () => api.get("/reminders").then((r) => r.data);
export const createReminder = (payload) => api.post("/reminders", payload).then((r) => r.data);
export const logTaken = (id) => api.post(`/reminders/${id}/taken`).then((r) => r.data);
export const deleteReminder = (id) => api.delete(`/reminders/${id}`).then((r) => r.data);

// Patients
export const listPatients = () => api.get("/patients").then((r) => r.data);
export const getPatient = (id) => api.get(`/patients/${id}`).then((r) => r.data);
export const getPatientAlertHistory = (id) => api.get(`/patients/${id}/alerts`).then((r) => r.data);
export const createPatient = (payload) => api.post("/patients", payload).then((r) => r.data);
export const generateQuestions = (complaint) => api.post("/generate-questions", { complaint }).then((r) => r.data);
export const saveOnboarding = (id, answers) => api.put(`/patients/${id}/onboarding`, { answers }).then((r) => r.data);
export const processConsultation = (id, conversation) => api.post(`/patients/${id}/consultations`, { conversation }).then((r) => r.data);
export const getConsultation = (id) => api.get(`/consultations/${id}`).then((r) => r.data);

// Voice
export const transcribeAudio = (blob, filename = "audio.webm") => {
  const fd = new FormData();
  fd.append("file", blob, filename);
  return api.post("/transcribe", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
};

// Appointments
export const listAppointments = () => api.get("/appointments").then((r) => r.data);
export const createAppointment = (payload) => api.post("/appointments", payload).then((r) => r.data);
export const listDoctors = (department) => api.get("/doctors", { params: department ? { department } : {} }).then((r) => r.data);
export const doctorAvailability = (doctorId, date) => api.get(`/doctors/${doctorId}/availability`, { params: { date } }).then((r) => r.data);
export const updateAppointment = (id, patch) => api.patch(`/appointments/${id}`, patch).then((r) => r.data);

// Messages
export const listThreads = () => api.get("/messages/threads").then((r) => r.data);
export const getThread = (patient_id) => api.get(`/messages/thread/${patient_id}`).then((r) => r.data);
export const sendMessage = (patient_id, text) => api.post("/messages", { patient_id, text }).then((r) => r.data);

// Pharmacy / Lab / Analytics
export const listPrescriptions = () => api.get("/pharmacy/prescriptions").then((r) => r.data);
export const listLabResults = () => api.get("/lab/results").then((r) => r.data);
export const createLabResult = (payload) => api.post("/lab/results", payload).then((r) => r.data);
export const getAnalytics = () => api.get("/analytics").then((r) => r.data);
export const getStats = () => api.get("/stats").then((r) => r.data);

// Care AI
export const careAIStart = (patient_id) => api.post("/care-ai/start", { patient_id }).then((r) => r.data);
export const careAIMessage = (patient_id, message) => api.post("/care-ai/message", { patient_id, message }).then((r) => r.data);
export const careAIHistory = (patient_id) => api.get(`/care-ai/history/${patient_id}`).then((r) => r.data);
export const careAICopilot = (patient_id, transcript) => api.post("/care-ai/copilot", { patient_id, transcript }).then((r) => r.data);
export const careAISummary = (patient_id) => api.get(`/care-ai/summary/${patient_id}`).then((r) => r.data);
export const classifySpeaker = (text) => api.post("/care-ai/classify-speaker", { text }).then((r) => r.data);

// Profiles (multi-profile support — Self / Family / Guest, max 5)
export const listProfiles = () => api.get("/profiles").then((r) => r.data);
export const createProfile = (payload) => api.post("/profiles", payload).then((r) => r.data);
export const updateProfile = (id, payload) => api.patch(`/profiles/${id}`, payload).then((r) => r.data);
export const deleteProfile = (id) => api.delete(`/profiles/${id}`).then((r) => r.data);
export const switchProfile = (id) => api.post(`/profiles/${id}/switch`).then((r) => r.data);
export const extractProfileFromText = (text, relationship) =>
  api.post("/profiles/ai-extract", { text, relationship }).then((r) => r.data);

// Sprint 2.2 — Living Health Record
export const getHealthRecord = (profileId) => api.get(`/profiles/${profileId}/health-record`).then((r) => r.data);
export const addCondition = (profileId, payload) => api.post(`/profiles/${profileId}/conditions`, payload).then((r) => r.data);
export const deleteCondition = (profileId, conditionId) => api.delete(`/profiles/${profileId}/conditions/${conditionId}`).then((r) => r.data);
export const patchCondition = (profileId, conditionId, payload) => api.patch(`/profiles/${profileId}/conditions/${conditionId}`, payload).then((r) => r.data);
export const addMedication = (profileId, payload) => api.post(`/profiles/${profileId}/medications`, payload).then((r) => r.data);
export const deleteMedication = (profileId, medicationId) => api.delete(`/profiles/${profileId}/medications/${medicationId}`).then((r) => r.data);
export const patchMedication = (profileId, medicationId, payload) => api.patch(`/profiles/${profileId}/medications/${medicationId}`, payload).then((r) => r.data);
export const addAllergy = (profileId, payload) => api.post(`/profiles/${profileId}/allergies`, payload).then((r) => r.data);
export const patchAllergy = (profileId, allergyId, payload) => api.patch(`/profiles/${profileId}/allergies/${allergyId}`, payload).then((r) => r.data);
export const deleteAllergy = (profileId, allergyId) => api.delete(`/profiles/${profileId}/allergies/${allergyId}`).then((r) => r.data);

// Phase 13 — Autonomous co-pilot + WhatsApp activity
export const alertCopilot = (alert_id) => api.post(`/followup/alerts/${alert_id}/copilot`).then((r) => r.data);
export const whatsappActivity = () => api.get("/whatsapp/activity").then((r) => r.data);

// Phase 16 — Pre-treatment safety check
export const getSafetyCheck = (rx_id) => api.get(`/prescriptions/${rx_id}/safety-check`).then((r) => r.data);
export const submitSafetyCheck = (rx_id, values) => api.post(`/prescriptions/${rx_id}/safety-check/submit`, { values }).then((r) => r.data);
