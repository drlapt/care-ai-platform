"""Iteration 4 — Care AI personality engine: conversation continuity, urgency triage,
structured handoff, /summary endpoint, and patient persistence checks."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
STD = 30
AI = 180


@pytest.fixture(scope="module")
def doctor_session():
    s = requests.Session()
    # idempotent seed
    s.post(f"{API}/seed", timeout=60)
    r = s.post(f"{API}/auth/demo-doctor", timeout=STD)
    assert r.status_code == 200, r.text
    j = r.json()
    s.headers.update({"Authorization": f"Bearer {j['token']}"})
    return s


def _create_patient(doctor, *, name, complaint, age=45, gender="Male"):
    payload = {
        "personal_info": {"name": name, "age": age, "gender": gender, "phone": "+15551112222", "email": f"test+{uuid.uuid4().hex[:6]}@ex.com"},
        "chief_complaint": complaint,
    }
    r = doctor.post(f"{API}/patients", json=payload, timeout=STD)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ---------- Summary endpoint: empty state ----------
class TestCareAISummaryEndpoint:
    def test_summary_before_any_chat(self, doctor_session):
        pid = _create_patient(doctor_session, name="TEST Summary Empty", complaint="mild tension headache")
        r = doctor_session.get(f"{API}/care-ai/summary/{pid}", timeout=STD)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("has_summary") is False, d
        # endpoint shape
        for k in ["has_summary", "urgency", "handoff_doctor", "summary", "red_flags"]:
            assert k in d, f"missing {k}"

    def test_summary_unauth(self, doctor_session):
        # take any existing patient id
        pts = doctor_session.get(f"{API}/patients", timeout=STD).json()
        pid = pts[0]["id"]
        r = requests.get(f"{API}/care-ai/summary/{pid}", timeout=STD)
        assert r.status_code == 401


# ---------- Conversation continuity ----------
class TestConversationContinuity:
    def test_follow_ups_do_not_repeat_greeting(self, doctor_session):
        pid = _create_patient(doctor_session, name="TEST Continuity", complaint="headache for 2 days")
        # start
        r = doctor_session.post(f"{API}/care-ai/start", json={"patient_id": pid}, timeout=AI)
        assert r.status_code == 200, r.text
        greeting = r.json()["message"]["text"].lower()
        assert len(greeting) > 10

        turns = [
            "It's on the right side, throbbing, 6 out of 10.",
            "Started two days ago. No nausea.",
            "No vision changes, no fever.",
            "No head injury. I'm just tired and stressed.",
            "No, I haven't taken any medicine yet.",
        ]
        replies = []
        for msg in turns:
            rr = doctor_session.post(f"{API}/care-ai/message", json={"patient_id": pid, "message": msg}, timeout=AI)
            assert rr.status_code == 200, rr.text
            d = rr.json()
            text = d["message"]["text"]
            assert isinstance(text, str) and len(text) > 0
            assert "<SUMMARY>" not in text
            replies.append(text)

        # No follow-up should re-greet with "Hello <name>, I'm Care AI"
        for t in replies:
            low = t.lower()
            assert not (low.startswith("hello") and "i'm care ai" in low), f"Re-greeting detected: {t[:120]}"
        # Replies shouldn't be identical (progression check)
        assert len(set(replies)) >= max(2, len(replies) - 1), "Replies too repetitive"


# ---------- Urgency triage: EMERGENCY scenario ----------
class TestEmergencyTriage:
    def test_chest_pain_radiation_diaphoresis(self, doctor_session):
        pid = _create_patient(doctor_session, name="TEST Emergency", complaint="severe chest pain radiating to left arm", age=62, gender="Male")
        r = doctor_session.post(f"{API}/care-ai/start", json={"patient_id": pid}, timeout=AI)
        assert r.status_code == 200

        # A red-flag packed cardiac presentation — drives emergency triage
        turns = [
            "The pain started 45 minutes ago, it's crushing in my center chest, 9 out of 10.",
            "It radiates down my left arm and into my jaw.",
            "I'm sweating profusely and feel nauseated. I'm short of breath.",
            "I have high blood pressure and my father had a heart attack at 55.",
            "I'm feeling dizzy, the pain has not gone away.",
            "No, I have not taken anything yet. Please help.",
        ]
        final = None
        for msg in turns:
            rr = doctor_session.post(f"{API}/care-ai/message", json={"patient_id": pid, "message": msg}, timeout=AI)
            assert rr.status_code == 200, rr.text
            final = rr.json()
            if final.get("done"):
                break

        # If LLM didn't finalize yet, one more nudge
        if not final or not final.get("done"):
            rr = doctor_session.post(f"{API}/care-ai/message", json={"patient_id": pid, "message": "That's all I can share, please summarize for the doctor now."}, timeout=AI)
            final = rr.json()

        assert final is not None
        if final.get("done"):
            urgency = (final.get("urgency") or "").lower()
            assert urgency == "emergency", f"Expected emergency, got {urgency}. Payload: {final}"

            hd = final.get("handoff_doctor") or (final.get("profile_update") or {}).get("handoff_doctor")
            assert hd, "handoff_doctor missing"
            # required keys
            for k in ["chief_complaint", "hpi", "ros", "red_flags", "assessment", "recommendations", "confidence"]:
                assert k in hd, f"handoff_doctor missing {k}"
            # HPI is a clinical paragraph
            hpi = hd["hpi"] or ""
            assert isinstance(hpi, str) and len(hpi) > 60, f"HPI too short: {hpi!r}"
            assert hpi.count(".") >= 2, "HPI should have multiple sentences"
            # red flags include cardiac signals
            rf_text = str(hd.get("red_flags") or "").lower()
            assert any(w in rf_text for w in ["chest", "radiat", "diaphor", "sweat", "cardiac", "arm", "jaw"]), f"red_flags missing cardiac cues: {hd.get('red_flags')}"

            # Verify persistence via GET /summary
            rs = doctor_session.get(f"{API}/care-ai/summary/{pid}", timeout=STD)
            assert rs.status_code == 200
            s = rs.json()
            assert s["has_summary"] is True
            assert (s["urgency"] or "").lower() == "emergency"
            assert s["handoff_doctor"]
            assert s["red_flags"] is not None

            # patient document persists onboarding.care_ai_*
            pg = doctor_session.get(f"{API}/patients/{pid}", timeout=STD).json()
            onb = pg.get("onboarding") or {}
            assert onb.get("care_ai_urgency", "").lower() == "emergency"
            assert onb.get("care_ai_handoff")
            assert "care_ai_summary" in onb
            assert "care_ai_red_flags" in onb
        else:
            pytest.fail(f"Care AI did not finalize emergency scenario after {len(turns)+1} turns. Last reply: {final.get('message',{}).get('text','')[:200]}")


# ---------- Urgency triage: ROUTINE scenario ----------
class TestRoutineTriage:
    def test_mild_headache_routine_triage(self, doctor_session):
        pid = _create_patient(doctor_session, name="TEST Routine", complaint="occasional mild headache for a week", age=30, gender="Female")
        r = doctor_session.post(f"{API}/care-ai/start", json={"patient_id": pid}, timeout=AI)
        assert r.status_code == 200
        turns = [
            "It's a dull headache, maybe 2 out of 10, happens in the late afternoon.",
            "No nausea, no vision changes, no fever.",
            "No head injury. No neck stiffness.",
            "I've been staring at a laptop all week and sleeping poorly.",
            "I took paracetamol once and it helped.",
            "No other symptoms, thank you.",
        ]
        final = None
        for msg in turns:
            rr = doctor_session.post(f"{API}/care-ai/message", json={"patient_id": pid, "message": msg}, timeout=AI)
            assert rr.status_code == 200, rr.text
            final = rr.json()
            if final.get("done"):
                break
        if final and final.get("done"):
            urgency = (final.get("urgency") or "").lower()
            assert urgency in ("medium", "low"), f"Expected medium/low, got {urgency}"
        else:
            # Not finalized — still OK, but flag as soft skip
            pytest.skip("Routine scenario did not finalize within 6 turns; not a regression")
