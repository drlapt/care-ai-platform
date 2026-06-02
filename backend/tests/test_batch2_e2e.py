"""Batch 2 end-to-end:
  #2 — Structured intake options + consent gate (intake_complete state, /share endpoint)
  #4 — Pending vs Confirmed split + alternate slot proposal + patient accept/reject
  #10 — AI-suggested Rx draft endpoint (/prescriptions/quick-draft)
"""
import os, sys, asyncio, secrets
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import httpx

API = os.environ.get("API_BASE_URL") or "https://patient-care-121.preview.emergentagent.com"


async def login(client, email, password):
    r = await client.post(f"{API}/api/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()["token"]


async def fresh_client():
    """Each role gets its own AsyncClient so cookies don't bleed across roles
    (server prefers session_token cookie over Authorization Bearer)."""
    return httpx.AsyncClient(timeout=60.0, cookies=httpx.Cookies())


async def main():
    cli_doc = await fresh_client()
    cli_pat = await fresh_client()
    cli_other = await fresh_client()
    try:
        # Setup
        doc_token = await login(cli_doc, "idrlapt@gmail.com", "123456")
        h_doc = {"Authorization": f"Bearer {doc_token}"}

        p_email = f"qab2+{secrets.token_hex(4)}@projectcare.app"
        r = await cli_pat.post(f"{API}/api/auth/register", json={"email": p_email, "password": "Pwd123456!", "name": "QA Batch2 Patient"})
        r.raise_for_status()
        pat_token = r.json()["token"]
        pat_user = r.json()["user"]
        pid = pat_user["linked_patient_id"]
        h_pat = {"Authorization": f"Bearer {pat_token}"}

        # === #4: Pending vs Confirmed + Alternate slot ===

        # Patient books a slot
        doctors = (await cli_pat.get(f"{API}/api/doctors", headers=h_pat)).json()["doctors"]
        doctor_id = doctors[0]["id"]
        appt_resp = await cli_pat.post(f"{API}/api/appointments", json={
            "patient_id": pid, "date": "2099-03-10", "time": "10:00",
            "type": "consultation", "reason": "Batch2 reschedule test",
            "duration_min": 30, "doctor_id": doctor_id, "department": "general",
        }, headers=h_pat)
        appt_resp.raise_for_status()
        appt = appt_resp.json()
        assert appt["status"] == "requested", f"expected requested, got {appt['status']}"
        print(f"OK: appointment created status=requested id={appt['id']}")

        # Doctor proposes an alternate slot
        r = await cli_doc.patch(f"{API}/api/appointments/{appt['id']}",
                            json={"proposed_date": "2099-03-10", "proposed_time": "15:00",
                                  "proposed_reason": "I'm in surgery at 10am — 3pm works better"},
                            headers=h_doc)
        r.raise_for_status()
        appt2 = r.json()
        assert appt2["status"] == "rescheduled"
        assert appt2["proposed_date"] == "2099-03-10"
        assert appt2["proposed_time"] == "15:00"
        print(f"OK: doctor proposed alternate slot status=rescheduled")

        # Patient ACCEPTS alternate
        r = await cli_pat.patch(f"{API}/api/appointments/{appt['id']}",
                            json={"patient_action": "accept_reschedule"}, headers=h_pat)
        r.raise_for_status()
        appt3 = r.json()
        assert appt3["status"] == "scheduled"
        assert appt3["date"] == "2099-03-10"
        assert appt3["time"] == "15:00"
        assert "proposed_date" not in appt3 or not appt3.get("proposed_date")
        print(f"OK: patient accepted alternate -> scheduled at {appt3['date']} {appt3['time']}")

        # Now create another, doctor proposes, patient REJECTS
        appt_b = (await cli_pat.post(f"{API}/api/appointments", json={
            "patient_id": pid, "date": "2099-03-11", "time": "11:00",
            "type": "consultation", "reason": "Batch2 reject test",
            "duration_min": 30, "doctor_id": doctor_id, "department": "general",
        }, headers=h_pat)).json()
        await cli_doc.patch(f"{API}/api/appointments/{appt_b['id']}",
                        json={"proposed_date": "2099-03-12", "proposed_time": "09:00", "proposed_reason": "Out of town"},
                        headers=h_doc)
        r = await cli_pat.patch(f"{API}/api/appointments/{appt_b['id']}",
                            json={"patient_action": "reject_reschedule"}, headers=h_pat)
        r.raise_for_status()
        appt_b2 = r.json()
        assert appt_b2["status"] == "cancelled"
        print(f"OK: patient rejected alternate -> cancelled")

        # Negative: a different patient cannot patch someone else's appointment
        other_email = f"qaB2other+{secrets.token_hex(3)}@projectcare.app"
        r = await cli_other.post(f"{API}/api/auth/register", json={"email": other_email, "password": "Pwd123456!", "name": "Other"})
        other_token = r.json()["token"]
        h_other = {"Authorization": f"Bearer {other_token}"}
        r = await cli_other.patch(f"{API}/api/appointments/{appt['id']}", json={"patient_action": "accept_reschedule"}, headers=h_other)
        assert r.status_code == 403, f"expected 403, got {r.status_code} body={r.text}"
        print("OK: cross-patient PATCH correctly rejected with 403")

        # === #10: AI-suggested Rx draft ===
        r = await cli_doc.post(f"{API}/api/prescriptions/quick-draft",
                           json={"patient_id": pid}, headers=h_doc)
        r.raise_for_status()
        draft = r.json()
        assert "items" in draft and "reason" in draft
        print(f"OK: quick-draft returned items={len(draft['items'])} reason={draft['reason'][:60]!r}")

        # Patient role cannot draft
        r = await cli_pat.post(f"{API}/api/prescriptions/quick-draft",
                           json={"patient_id": pid}, headers=h_pat)
        assert r.status_code == 403, f"patient should be 403, got {r.status_code}"
        print("OK: patient blocked from quick-draft (403)")

        # === #2: Intake → intake_complete → /share endpoint ===
        intake_appt = (await cli_pat.post(f"{API}/api/appointments", json={
            "patient_id": pid, "date": "2099-04-01", "time": "10:00",
            "type": "consultation", "reason": "mild headache 2 days",
            "duration_min": 30, "doctor_id": doctor_id, "department": "general",
        }, headers=h_pat)).json()
        await cli_doc.patch(f"{API}/api/appointments/{intake_appt['id']}", json={"status": "scheduled"}, headers=h_doc)

        # Patient starts intake
        r = await cli_pat.post(f"{API}/api/consultations/start-intake",
                           json={"appointment_id": intake_appt["id"], "language": "en"}, headers=h_pat)
        r.raise_for_status()
        sess = r.json()
        sess_id = sess["id"]
        assert sess["status"] == "intake"
        # Try /share before intake is complete — should 400
        r = await cli_pat.post(f"{API}/api/consultations/{sess_id}/share", headers=h_pat)
        assert r.status_code == 400, f"share before complete should 400, got {r.status_code}"
        print("OK: /share correctly rejects pre-intake_complete (400)")

        print("OK: Batch 2 structural endpoints all wired correctly")
    finally:
        await cli_doc.aclose(); await cli_pat.aclose(); await cli_other.aclose()


if __name__ == "__main__":
    asyncio.run(main())
    print("\nBatch 2 backend: PASS")
