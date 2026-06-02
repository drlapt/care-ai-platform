"""Care AI — backend tests for /api/care-ai/* endpoints (Iteration 3)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
STD = 30
AI = 120


@pytest.fixture(scope="module")
def doctor():
    s = requests.Session()
    requests.post(f"{API}/seed", timeout=60)
    r = s.post(f"{API}/auth/demo-doctor", timeout=STD)
    assert r.status_code == 200, r.text
    j = r.json()
    s.headers.update({"Authorization": f"Bearer {j['token']}"})
    return s


@pytest.fixture(scope="module")
def patient_id(doctor):
    pts = doctor.get(f"{API}/patients", timeout=STD).json()
    assert pts, "no seeded patients"
    # Sarah Johnson — chief complaint chest pain, allergic to Penicillin
    sarah = next((p for p in pts if p["personal_info"]["name"].startswith("Sarah")), pts[0])
    return sarah["id"]


# ------- Care AI start -------
class TestCareAIStart:
    def test_start_unauth(self, patient_id):
        r = requests.post(f"{API}/care-ai/start", json={"patient_id": patient_id}, timeout=STD)
        assert r.status_code == 401

    def test_start_404_for_unknown(self, doctor):
        r = doctor.post(f"{API}/care-ai/start", json={"patient_id": "does-not-exist"}, timeout=AI)
        assert r.status_code == 404

    def test_start_returns_personalized_greeting(self, doctor, patient_id):
        r = doctor.post(f"{API}/care-ai/start", json={"patient_id": patient_id}, timeout=AI)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "message" in d and "done" in d
        msg = d["message"]
        assert msg["role"] == "assistant"
        text = msg["text"]
        assert len(text) > 10
        # Should mention patient first name OR Care AI somewhere
        assert ("Sarah" in text) or ("care ai" in text.lower())


# ------- Care AI message + history -------
class TestCareAIMessage:
    def test_message_continues_conversation(self, doctor, patient_id):
        r = doctor.post(f"{API}/care-ai/message",
                        json={"patient_id": patient_id, "message": "It's a tight pressure feeling, started 2 days ago, about 6/10 severity."},
                        timeout=AI)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "message" in d and "done" in d and "handoff" in d and "profile_update" in d
        assert d["message"]["role"] == "assistant"
        assert isinstance(d["message"]["text"], str) and len(d["message"]["text"]) > 0
        # No leaked tags
        assert "<SUMMARY>" not in d["message"]["text"]

    def test_history_returns_ordered(self, doctor, patient_id):
        r = doctor.get(f"{API}/care-ai/history/{patient_id}", timeout=STD)
        assert r.status_code == 200
        msgs = r.json()
        assert isinstance(msgs, list)
        assert len(msgs) >= 2  # start + first message exchange
        roles = [m["role"] for m in msgs]
        assert "assistant" in roles and "user" in roles
        # ordered by created_at ascending
        ts = [m["created_at"] for m in msgs]
        assert ts == sorted(ts)


# ------- Copilot -------
class TestCopilot:
    def test_copilot_returns_clinical_suggestions(self, doctor, patient_id):
        transcript = (
            "Doctor: Tell me what brings you in today.\n"
            "Patient: I've had chest pain for two days, radiates to my left arm, gets worse when I climb stairs.\n"
            "Doctor: Any nausea, sweating, or shortness of breath?\n"
            "Patient: Yes, a little short of breath and sweaty when it hits.\n"
        )
        r = doctor.post(f"{API}/care-ai/copilot",
                        json={"patient_id": patient_id, "transcript": transcript},
                        timeout=AI)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["next_questions", "red_flags", "differential_dx", "rx_suggestions", "education_points"]:
            assert k in d, f"missing key: {k}"
        assert isinstance(d["next_questions"], list) and len(d["next_questions"]) >= 1
        assert isinstance(d["differential_dx"], list)
        # Each rx suggestion has the safe_with_allergies flag
        for rx in d["rx_suggestions"]:
            assert "medication" in rx
            assert "safe_with_allergies" in rx

    def test_copilot_respects_penicillin_allergy(self, doctor, patient_id):
        # Coax Rx — patient has Penicillin allergy. If LLM proposes any penicillin-class
        # drug it must mark safe_with_allergies=False.
        transcript = (
            "Doctor: Looks like a strep throat. Considering antibiotics.\n"
            "Patient: I have severe sore throat, fever 39C, swollen tonsils with pus.\n"
        )
        r = doctor.post(f"{API}/care-ai/copilot",
                        json={"patient_id": patient_id, "transcript": transcript},
                        timeout=AI)
        assert r.status_code == 200, r.text
        d = r.json()
        for rx in d.get("rx_suggestions", []):
            med = (rx.get("medication") or "").lower()
            if any(x in med for x in ["penicillin", "amoxicillin", "ampicillin", "augmentin"]):
                assert rx.get("safe_with_allergies") is False, f"Penicillin-class flagged safe: {rx}"


# ------- Speaker classifier -------
class TestSpeakerClassifier:
    def test_patient_phrase(self, doctor):
        r = doctor.post(f"{API}/care-ai/classify-speaker", json={"text": "I have chest pain"}, timeout=STD)
        assert r.status_code == 200
        d = r.json()
        assert d["speaker"] == "Patient"
        assert 0.5 <= d["confidence"] <= 0.95

    def test_doctor_phrase(self, doctor):
        r = doctor.post(f"{API}/care-ai/classify-speaker", json={"text": "I am prescribing aspirin daily"}, timeout=STD)
        assert r.status_code == 200
        d = r.json()
        assert d["speaker"] == "Dr"
        assert 0.5 <= d["confidence"] <= 0.95

    def test_unauth(self):
        r = requests.post(f"{API}/care-ai/classify-speaker", json={"text": "hi"}, timeout=STD)
        assert r.status_code == 401
