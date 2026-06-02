"""
Iteration 5 — P0 features backend tests:
  • Email/Password auth (register, login, /auth/me)
  • 24/7 Follow-up Care AI chat (/api/followup/*)
  • Medication Reminders (/api/reminders/*)
  • Doctor alerts list + resolve
  • Role scoping (patient linked_patient_id enforcement)
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://patient-care-121.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def doctor_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/demo-doctor", timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def patient_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/demo-patient", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    s.headers["Authorization"] = f"Bearer {data['token']}"
    s.linked_patient_id = data["user"].get("linked_patient_id")
    return s


@pytest.fixture(scope="module")
def seeded_patient_id(doctor_session):
    """Return the first demo patient id — used by doctor-driven flows."""
    r = doctor_session.get(f"{API}/patients", timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) > 0, "No seeded patients"
    return items[0]["id"]


# ---------- Email/Password auth ----------

class TestEmailPasswordAuth:
    def test_register_then_me(self):
        email = f"qa+{uuid.uuid4().hex[:8]}@projectcare.app"
        payload = {"email": email, "password": "Passw0rd!", "name": "QA Patient", "role": "patient"}
        r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and "user" in data
        assert data["user"]["email"] == email
        assert data["user"]["role"] == "patient"
        assert "password_hash" not in data["user"]

        # /auth/me via Bearer
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {data['token']}"}, timeout=15)
        assert me.status_code == 200, me.text
        assert me.json()["email"] == email

    def test_register_duplicate_email_returns_409(self):
        email = f"qa+{uuid.uuid4().hex[:8]}@projectcare.app"
        payload = {"email": email, "password": "Passw0rd!", "name": "Dup", "role": "patient"}
        r1 = requests.post(f"{API}/auth/register", json=payload, timeout=15)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/auth/register", json=payload, timeout=15)
        assert r2.status_code == 409

    def test_register_weak_password_rejected(self):
        r = requests.post(f"{API}/auth/register", json={
            "email": f"qa+{uuid.uuid4().hex[:6]}@projectcare.app",
            "password": "123",
            "role": "patient",
        }, timeout=15)
        assert r.status_code == 400

    def test_login_success_and_bad_password(self):
        email = f"qa+{uuid.uuid4().hex[:8]}@projectcare.app"
        pw = "Passw0rd!"
        reg = requests.post(f"{API}/auth/register", json={"email": email, "password": pw, "role": "patient"}, timeout=15)
        assert reg.status_code == 200

        ok = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
        assert ok.status_code == 200
        assert "token" in ok.json()

        bad = requests.post(f"{API}/auth/login", json={"email": email, "password": "wrongpass"}, timeout=15)
        assert bad.status_code == 401


# ---------- Follow-up chat & alerts ----------

class TestFollowup:
    def test_emergency_creates_alert(self, doctor_session, seeded_patient_id):
        msg = "I have severe crushing chest pain radiating to my left arm, sweating, and I can't breathe"
        r = doctor_session.post(f"{API}/followup/message",
                                json={"patient_id": seeded_patient_id, "message": msg}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "message" in data and data["message"]["role"] == "assistant"
        # triage urgency should be emergency or high
        assert data.get("urgency") in ("emergency", "high", "medium", "low", None)
        # For a clear emergency, urgency should be emergency/high AND alert should fire
        assert data.get("alert") is not None, f"Expected doctor alert for emergency scenario, got urgency={data.get('urgency')}"
        assert data["alert"]["patient_id"] == seeded_patient_id
        assert data["alert"]["status"] == "open"
        TestFollowup._alert_id = data["alert"]["id"]

    def test_history_persisted_in_order(self, doctor_session, seeded_patient_id):
        r = doctor_session.get(f"{API}/followup/messages/{seeded_patient_id}", timeout=20)
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 2
        # Latest pair should have user then assistant; check monotonic order
        timestamps = [m["created_at"] for m in msgs]
        assert timestamps == sorted(timestamps)
        assert any(m["role"] == "user" for m in msgs)
        assert any(m["role"] == "assistant" for m in msgs)

    def test_alerts_list_doctor_only(self, doctor_session, patient_session):
        r = doctor_session.get(f"{API}/followup/alerts", timeout=20)
        assert r.status_code == 200
        alerts = r.json()
        assert isinstance(alerts, list)
        # should contain our emergency
        ids = [a["id"] for a in alerts]
        assert getattr(TestFollowup, "_alert_id", None) in ids

        # patient forbidden
        rp = patient_session.get(f"{API}/followup/alerts", timeout=15)
        assert rp.status_code == 403

    def test_resolve_alert(self, doctor_session):
        aid = getattr(TestFollowup, "_alert_id", None)
        assert aid, "prior test did not produce an alert id"
        r = doctor_session.patch(f"{API}/followup/alerts/{aid}", json={"status": "resolved"}, timeout=15)
        assert r.status_code == 200
        # It should disappear from open list
        lst = doctor_session.get(f"{API}/followup/alerts", timeout=15).json()
        assert aid not in [a["id"] for a in lst]


# ---------- Role scoping on follow-up ----------

class TestFollowupRoleScoping:
    def test_patient_cannot_post_to_other_patient(self, patient_session, seeded_patient_id):
        if patient_session.linked_patient_id == seeded_patient_id:
            pytest.skip("demo patient happens to be linked to the probe patient")
        r = patient_session.post(f"{API}/followup/message",
                                 json={"patient_id": seeded_patient_id, "message": "hi"}, timeout=30)
        assert r.status_code == 403

    def test_patient_can_post_to_own(self, patient_session):
        if not patient_session.linked_patient_id:
            pytest.skip("demo patient not linked")
        r = patient_session.post(f"{API}/followup/message",
                                 json={"patient_id": patient_session.linked_patient_id,
                                       "message": "Just a mild question about my morning medication timing."},
                                 timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["message"]["role"] == "assistant"

    def test_patient_cannot_read_others_history(self, patient_session, seeded_patient_id):
        if patient_session.linked_patient_id == seeded_patient_id:
            pytest.skip("same patient")
        r = patient_session.get(f"{API}/followup/messages/{seeded_patient_id}", timeout=15)
        assert r.status_code == 403


# ---------- Reminders CRUD ----------

class TestReminders:
    def test_reminder_lifecycle(self, doctor_session, seeded_patient_id):
        # create
        payload = {
            "patient_id": seeded_patient_id,
            "medication": "TEST_Metformin",
            "dose": "500mg",
            "times_per_day": 2,
            "time_of_day": "08:00, 20:00",
            "notes": "with food",
        }
        cr = doctor_session.post(f"{API}/reminders", json=payload, timeout=15)
        assert cr.status_code == 200, cr.text
        rem = cr.json()
        assert rem["medication"] == "TEST_Metformin"
        assert rem["times_per_day"] == 2
        assert rem["taken_log"] == []
        rid = rem["id"]

        # list — appears
        lst = doctor_session.get(f"{API}/reminders", timeout=15)
        assert lst.status_code == 200
        assert any(r["id"] == rid for r in lst.json())

        # taken
        t = doctor_session.post(f"{API}/reminders/{rid}/taken", timeout=15)
        assert t.status_code == 200
        lst2 = doctor_session.get(f"{API}/reminders", timeout=15).json()
        match = next(r for r in lst2 if r["id"] == rid)
        assert len(match["taken_log"]) == 1

        # delete
        d = doctor_session.delete(f"{API}/reminders/{rid}", timeout=15)
        assert d.status_code == 200
        lst3 = doctor_session.get(f"{API}/reminders", timeout=15).json()
        assert not any(r["id"] == rid for r in lst3)

    def test_patient_sees_only_own_reminders(self, doctor_session, patient_session, seeded_patient_id):
        if not patient_session.linked_patient_id:
            pytest.skip("no linked patient")
        # doctor creates a reminder for a different patient
        if patient_session.linked_patient_id == seeded_patient_id:
            pytest.skip("demo patient equals probe patient")
        cr = doctor_session.post(f"{API}/reminders", json={
            "patient_id": seeded_patient_id, "medication": "TEST_OtherOnly", "times_per_day": 1
        }, timeout=15)
        rid = cr.json()["id"]
        try:
            lst = patient_session.get(f"{API}/reminders", timeout=15).json()
            assert all(r["patient_id"] == patient_session.linked_patient_id for r in lst)
            assert not any(r["id"] == rid for r in lst)
        finally:
            doctor_session.delete(f"{API}/reminders/{rid}", timeout=15)


# ---------- Unauth sanity ----------

class TestUnauth:
    def test_followup_alerts_requires_auth(self):
        r = requests.get(f"{API}/followup/alerts", timeout=10)
        assert r.status_code == 401

    def test_reminders_requires_auth(self):
        r = requests.get(f"{API}/reminders", timeout=10)
        assert r.status_code == 401
