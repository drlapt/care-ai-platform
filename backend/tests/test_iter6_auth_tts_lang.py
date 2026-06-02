"""
Iteration 6 backend tests
Covers deltas:
- Email/password auth with hardcoded doctor routing (idrlapt@gmail.com)
- Patient auto-creates linked_patient_id and matching patients record
- /api/followup/message language parameter (hi/te) and urgency triage
- POST /api/tts via Emergent LLM key (OpenAI tts-1)
- Reminder ownership regression (403 for cross-patient)
"""
import os
import uuid
import pytest
import requests
from pathlib import Path


def _load_frontend_backend_url() -> str:
    env_val = os.environ.get("REACT_APP_BACKEND_URL")
    if env_val:
        return env_val
    # Fallback: read /app/frontend/.env
    fe_env = Path("/app/frontend/.env")
    if fe_env.exists():
        for line in fe_env.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("REACT_APP_BACKEND_URL not set and frontend/.env unreadable")


BASE_URL = _load_frontend_backend_url().rstrip("/")
API = f"{BASE_URL}/api"

DOCTOR_EMAIL = "idrlapt@gmail.com"
DOCTOR_PASSWORD = "DrLahari!"


# ---------- helpers ----------

def _post(path, json=None, token=None, timeout=60):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.post(f"{API}{path}", json=json, headers=headers, timeout=timeout)


def _get(path, token=None, timeout=30):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.get(f"{API}{path}", headers=headers, timeout=timeout)


def _delete(path, token=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.delete(f"{API}{path}", headers=headers, timeout=30)


def _register_patient():
    """Register a brand new patient. Returns (token, user_dict)."""
    email = f"qa+{uuid.uuid4().hex[:10]}@projectcare.app"
    r = _post("/auth/register", {"email": email, "password": "Passw0rd!", "name": "QA Patient"})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def doctor_token():
    """Register idrlapt doctor once (or login if already exists)."""
    r = _post("/auth/register", {"email": DOCTOR_EMAIL, "password": DOCTOR_PASSWORD, "name": "Dr. Lahari"})
    if r.status_code == 200:
        return r.json()["token"]
    # If already registered → login
    assert r.status_code == 409, f"doctor register unexpected: {r.status_code} {r.text}"
    r2 = _post("/auth/login", {"email": DOCTOR_EMAIL, "password": DOCTOR_PASSWORD})
    assert r2.status_code == 200, f"doctor login failed: {r2.status_code} {r2.text}"
    return r2.json()["token"]


@pytest.fixture(scope="module")
def patient_ctx():
    """Fresh patient for the module. Returns {token, user_id, linked_patient_id, email}."""
    token, user = _register_patient()
    return {
        "token": token,
        "user_id": user["user_id"],
        "linked_patient_id": user["linked_patient_id"],
        "email": user["email"],
    }


# ============================================================
# AUTH — doctor routing, patient linked_patient_id, validation
# ============================================================

class TestAuthRegistration:

    def test_doctor_email_yields_role_doctor(self, doctor_token):
        # Verify /auth/me returns role=doctor
        r = _get("/auth/me", token=doctor_token)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["email"] == DOCTOR_EMAIL
        assert u["role"] == "doctor", f"expected role=doctor, got {u.get('role')}"

    def test_doctor_duplicate_register_409(self):
        r = _post("/auth/register", {"email": DOCTOR_EMAIL, "password": DOCTOR_PASSWORD, "name": "Dr. Lahari"})
        assert r.status_code == 409, f"expected 409 on duplicate, got {r.status_code} {r.text}"

    def test_doctor_login_works(self):
        r = _post("/auth/login", {"email": DOCTOR_EMAIL, "password": DOCTOR_PASSWORD})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["role"] == "doctor"
        assert isinstance(body["token"], str) and len(body["token"]) > 0

    def test_patient_register_has_linked_patient_id(self, patient_ctx):
        lp = patient_ctx["linked_patient_id"]
        assert lp and isinstance(lp, str)
        # Must be a UUID
        uuid.UUID(lp)  # raises if not valid

    def test_patient_linked_patient_record_exists(self, patient_ctx, doctor_token):
        lp = patient_ctx["linked_patient_id"]
        # Doctor can fetch patient by id
        r = _get(f"/patients/{lp}", token=doctor_token)
        assert r.status_code == 200, f"GET /patients/{lp} → {r.status_code} {r.text}"
        p = r.json()
        assert p["id"] == lp
        assert p["personal_info"]["email"] == patient_ctx["email"]

    def test_register_weak_password_400(self):
        r = _post("/auth/register", {
            "email": f"qa+weak{uuid.uuid4().hex[:6]}@projectcare.app",
            "password": "abc",
            "name": "Weak",
        })
        assert r.status_code == 400, f"expected 400 on weak pwd, got {r.status_code}"

    def test_register_duplicate_email_409(self, patient_ctx):
        r = _post("/auth/register", {
            "email": patient_ctx["email"],
            "password": "Passw0rd!",
            "name": "Dup",
        })
        assert r.status_code == 409


# ============================================================
# FOLLOWUP — language param (hi, te) + urgency triage
# ============================================================

DEVANAGARI_RE = __import__("re").compile(r"[\u0900-\u097F]")
TELUGU_RE = __import__("re").compile(r"[\u0C00-\u0C7F]")


class TestFollowupLanguage:

    def test_hindi_reply_contains_devanagari(self, patient_ctx):
        r = _post("/followup/message", {
            "patient_id": patient_ctx["linked_patient_id"],
            "message": "Mujhe aaj subah halka sir dard hai.",
            "language": "hi",
        }, token=patient_ctx["token"], timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        text = body["message"]["text"]
        assert DEVANAGARI_RE.search(text), f"Expected Devanagari chars in hi reply, got: {text!r}"

    def test_telugu_reply_contains_telugu_script(self, patient_ctx):
        r = _post("/followup/message", {
            "patient_id": patient_ctx["linked_patient_id"],
            "message": "Naaku tala noppi vastondi.",
            "language": "te",
        }, token=patient_ctx["token"], timeout=90)
        assert r.status_code == 200, r.text
        text = r.json()["message"]["text"]
        assert TELUGU_RE.search(text), f"Expected Telugu chars in te reply, got: {text!r}"

    def test_emergency_urgency_triage_still_parses(self, patient_ctx):
        r = _post("/followup/message", {
            "patient_id": patient_ctx["linked_patient_id"],
            "message": (
                "I have the worst headache of my life, sudden onset, with vomiting, "
                "my vision is blurring and my left arm feels numb."
            ),
            "language": "en",
        }, token=patient_ctx["token"], timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        urg = body.get("urgency")
        assert urg in {"emergency", "high", "medium"}, f"unexpected urgency: {urg}"


# ============================================================
# TTS  — /api/tts (auth required, audio/mpeg, empty=400)
# ============================================================

class TestTTS:

    def test_tts_unauthenticated_401(self):
        r = requests.post(f"{API}/tts", json={"text": "Hello"}, timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_tts_empty_text_400(self, patient_ctx):
        r = _post("/tts", {"text": "   "}, token=patient_ctx["token"])
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_tts_returns_mp3_audio(self, patient_ctx):
        r = requests.post(
            f"{API}/tts",
            json={"text": "Hello, this is a test of the emergency broadcast.", "voice": "nova"},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {patient_ctx['token']}",
            },
            timeout=90,
        )
        assert r.status_code == 200, f"tts failed: {r.status_code} {r.text[:400]}"
        ctype = r.headers.get("content-type", "").lower()
        assert "audio/mpeg" in ctype, f"unexpected content-type: {ctype}"
        assert len(r.content) > 1000, f"audio body too small: {len(r.content)}"


# ============================================================
# REMINDER OWNERSHIP REGRESSION
# ============================================================

class TestReminderOwnership:

    def test_patient_cannot_create_reminder_for_other(self, patient_ctx, doctor_token):
        # Create a second patient — use a brand new register
        other_token, other_user = _register_patient()
        other_pid = other_user["linked_patient_id"]

        # Patient A tries to create a reminder for patient B → 403
        r = _post("/reminders", {
            "patient_id": other_pid,
            "medication": "TEST_CrossPatient",
            "dose": "5mg",
            "times_per_day": 1,
            "time_of_day": "08:00",
        }, token=patient_ctx["token"])
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_patient_cannot_mark_or_delete_others_reminder(self, patient_ctx, doctor_token):
        # Doctor creates a reminder on an unrelated patient
        other_token, other_user = _register_patient()
        other_pid = other_user["linked_patient_id"]
        rc = _post("/reminders", {
            "patient_id": other_pid,
            "medication": "TEST_OwnershipCheck",
            "dose": "10mg",
            "times_per_day": 1,
            "time_of_day": "09:00",
        }, token=doctor_token)
        assert rc.status_code == 200, rc.text
        rid = rc.json()["id"]

        # Patient A (not owner) cannot mark taken
        r1 = _post(f"/reminders/{rid}/taken", {}, token=patient_ctx["token"])
        assert r1.status_code == 403

        # Patient A cannot delete
        r2 = _delete(f"/reminders/{rid}", token=patient_ctx["token"])
        assert r2.status_code == 403

        # Doctor can delete
        r3 = _delete(f"/reminders/{rid}", token=doctor_token)
        assert r3.status_code == 200

    def test_doctor_can_create_mark_delete_any_reminder(self, patient_ctx, doctor_token):
        pid = patient_ctx["linked_patient_id"]
        rc = _post("/reminders", {
            "patient_id": pid,
            "medication": "TEST_DoctorFlow",
            "dose": "20mg",
            "times_per_day": 2,
            "time_of_day": "08:00, 20:00",
        }, token=doctor_token)
        assert rc.status_code == 200
        rid = rc.json()["id"]

        r1 = _post(f"/reminders/{rid}/taken", {}, token=doctor_token)
        assert r1.status_code == 200

        r2 = _delete(f"/reminders/{rid}", token=doctor_token)
        assert r2.status_code == 200
