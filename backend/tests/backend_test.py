"""Project Care Phase 2 — Backend test suite.

Covers: Auth (demo doctor/patient, me, logout, role), patient role isolation,
appointments, messages, pharmacy, lab, analytics, seed idempotency,
voice transcription size guards.
"""
import io
import os
import wave
import struct
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

STD = 30
AI = 90


def _wav_bytes(seconds: float = 1.0, freq: int = 440, sr: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        n = int(sr * seconds)
        for i in range(n):
            val = int(32767 * 0.1)
            w.writeframesraw(struct.pack("<h", val if i % 50 < 25 else -val))
    return buf.getvalue()


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def doctor():
    s = requests.Session()
    r = s.post(f"{API}/auth/demo-doctor", timeout=STD)
    assert r.status_code == 200, r.text
    j = r.json()
    s.headers.update({"Authorization": f"Bearer {j['token']}"})
    return s, j["user"], j["token"]


@pytest.fixture(scope="session")
def patient_user():
    s = requests.Session()
    # Ensure seeded
    requests.post(f"{API}/seed", timeout=60)
    r = s.post(f"{API}/auth/demo-patient", timeout=STD)
    assert r.status_code == 200, r.text
    j = r.json()
    s.headers.update({"Authorization": f"Bearer {j['token']}"})
    return s, j["user"], j["token"]


# ---------- Health ----------
class TestHealth:
    def test_root(self):
        r = requests.get(f"{API}/", timeout=STD)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# ---------- Auth ----------
class TestAuth:
    def test_demo_doctor_creates_session(self, doctor):
        s, user, token = doctor
        assert user["role"] == "doctor"
        assert user["email"] == "demo.doctor@projectcare.app"
        assert token.startswith("sess_")

    def test_demo_patient_creates_session(self, patient_user):
        s, user, token = patient_user
        assert user["role"] == "patient"
        assert user["linked_patient_id"], "patient must be linked to a seeded patient"

    def test_me_with_bearer(self, doctor):
        s, *_ = doctor
        r = s.get(f"{API}/auth/me", timeout=STD)
        assert r.status_code == 200
        assert r.json()["role"] == "doctor"

    def test_me_unauth_returns_401(self):
        r = requests.get(f"{API}/auth/me", timeout=STD)
        assert r.status_code == 401

    def test_protected_endpoints_401_without_auth(self):
        for path in ["/patients", "/appointments", "/messages/threads", "/lab/results", "/pharmacy/prescriptions", "/analytics"]:
            r = requests.get(f"{API}{path}", timeout=STD)
            assert r.status_code == 401, f"{path} should be auth-gated, got {r.status_code}"

    def test_logout(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/demo-doctor", timeout=STD)
        token = r.json()["token"]
        # logout via cookie session
        s.cookies.set("session_token", token, domain=BASE_URL.split("://")[1].split("/")[0])
        rl = s.post(f"{API}/auth/logout", timeout=STD)
        assert rl.status_code == 200
        # Token now invalid
        rm = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=STD)
        assert rm.status_code == 401

    def test_set_role(self, doctor):
        s, *_ = doctor
        r = s.post(f"{API}/auth/role", json={"role": "doctor"}, timeout=STD)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "doctor"
        # Bad role
        rb = s.post(f"{API}/auth/role", json={"role": "wizard"}, timeout=STD)
        assert rb.status_code == 400

    def test_patient_role_isolation(self, patient_user):
        s, user, _ = patient_user
        r = s.get(f"{API}/patients", timeout=STD)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["id"] == user["linked_patient_id"]


# ---------- Seed ----------
class TestSeed:
    def test_seed_idempotent(self):
        r1 = requests.post(f"{API}/seed", timeout=60)
        r2 = requests.post(f"{API}/seed", timeout=60)
        assert r1.status_code == 200 and r2.status_code == 200
        d = r2.json()
        assert d["patients"] == 5
        assert d["appointments"] == 6
        assert d["messages"] == 4
        assert d["lab_results"] == 7


# ---------- Appointments ----------
class TestAppointments:
    def test_list_appointments(self, doctor):
        s, *_ = doctor
        r = s.get(f"{API}/appointments", timeout=STD)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 6
        assert all("patient_name" in i for i in items)
        assert all(i["patient_name"] != "Unknown" for i in items)

    def test_create_and_update_appointment(self, doctor):
        s, *_ = doctor
        # pick first patient
        patients = s.get(f"{API}/patients", timeout=STD).json()
        pid = patients[0]["id"]
        payload = {"patient_id": pid, "date": "2026-02-15", "time": "10:00", "duration_min": 30, "type": "consultation", "reason": "TEST_followup"}
        r = s.post(f"{API}/appointments", json=payload, timeout=STD)
        assert r.status_code == 200
        appt = r.json()
        assert appt["status"] == "scheduled"
        # update status
        ru = s.patch(f"{API}/appointments/{appt['id']}", json={"status": "completed"}, timeout=STD)
        assert ru.status_code == 200
        assert ru.json()["status"] == "completed"


# ---------- Messages ----------
class TestMessages:
    def test_threads_and_thread(self, doctor):
        s, *_ = doctor
        r = s.get(f"{API}/messages/threads", timeout=STD)
        assert r.status_code == 200
        threads = r.json()
        assert len(threads) >= 1
        pid = threads[0]["patient_id"]
        rt = s.get(f"{API}/messages/thread/{pid}", timeout=STD)
        assert rt.status_code == 200
        msgs = rt.json()
        assert isinstance(msgs, list) and len(msgs) >= 1

    def test_create_message(self, doctor):
        s, *_ = doctor
        patients = s.get(f"{API}/patients", timeout=STD).json()
        pid = patients[0]["id"]
        r = s.post(f"{API}/messages", json={"patient_id": pid, "text": "TEST_hello"}, timeout=STD)
        assert r.status_code == 200
        m = r.json()
        assert m["text"] == "TEST_hello"
        assert m["sender"] == "doctor"


# ---------- Pharmacy ----------
class TestPharmacy:
    def test_pharmacy_prescriptions(self, doctor):
        s, *_ = doctor
        r = s.get(f"{API}/pharmacy/prescriptions", timeout=STD)
        assert r.status_code == 200
        items = r.json()
        # seed has at least 7 medications across patients
        assert len(items) >= 5
        assert all("patient_name" in i and "medication" in i for i in items)


# ---------- Lab ----------
class TestLab:
    def test_lab_results_with_flags(self, doctor):
        s, *_ = doctor
        r = s.get(f"{API}/lab/results", timeout=STD)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 7
        flags = {i["flag"] for i in items}
        assert {"high", "low", "normal"} & flags
        # at least one abnormal
        assert any(i["flag"] in ("high", "low") for i in items)

    def test_create_lab_autoflags(self, doctor):
        s, *_ = doctor
        patients = s.get(f"{API}/patients", timeout=STD).json()
        pid = patients[0]["id"]
        # value above ref_high -> high
        r = s.post(f"{API}/lab/results", json={"patient_id": pid, "test_name": "TEST_LDL", "value": 200, "unit": "mg/dL", "ref_low": 0, "ref_high": 130}, timeout=STD)
        assert r.status_code == 200
        assert r.json()["flag"] == "high"


# ---------- Analytics ----------
class TestAnalytics:
    def test_analytics(self, doctor):
        s, *_ = doctor
        r = s.get(f"{API}/analytics", timeout=STD)
        assert r.status_code == 200
        d = r.json()
        for k in ["total_patients", "total_consultations", "hours_saved", "top_conditions", "consultations_by_day"]:
            assert k in d
        assert d["total_patients"] >= 5
        assert isinstance(d["top_conditions"], list)


# ---------- Voice ----------
class TestVoice:
    def test_transcribe_too_small(self, doctor):
        s, *_ = doctor
        files = {"file": ("tiny.wav", b"x" * 200, "audio/wav")}
        r = s.post(f"{API}/transcribe", files=files, timeout=STD)
        assert r.status_code == 400

    def test_transcribe_too_large(self, doctor):
        s, *_ = doctor
        big = b"\x00" * (26 * 1024 * 1024)
        files = {"file": ("big.wav", big, "audio/wav")}
        r = s.post(f"{API}/transcribe", files=files, timeout=120)
        assert r.status_code == 413

    def test_transcribe_real_audio(self, doctor):
        s, *_ = doctor
        wav = _wav_bytes(seconds=2.0)
        files = {"file": ("clip.wav", wav, "audio/wav")}
        r = s.post(f"{API}/transcribe", files=files, timeout=AI)
        # Whisper may return empty text for tone-only; accept 200 with text key
        assert r.status_code == 200, r.text
        d = r.json()
        assert "text" in d and "segments" in d and "language" in d
