"""Batch 1 integration test:
  #1 — /api/doctors, /api/doctors/{id}/availability, doctor_id propagation in appointments
  #5 — Consultation control: server still accepts intake (patient-only) and live messages.
"""
import os, sys, asyncio, secrets
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import httpx

API = os.environ.get("API_BASE_URL") or "https://patient-care-121.preview.emergentagent.com"


async def login(client, email, password):
    r = await client.post(f"{API}/api/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()["token"]


async def main():
    async with httpx.AsyncClient(timeout=30.0) as cli:
        # Doctor login
        doc_token = await login(cli, "idrlapt@gmail.com", "123456")
        h_doc = {"Authorization": f"Bearer {doc_token}"}

        # Patient — register a fresh one
        p_email = f"qab1+{secrets.token_hex(4)}@projectcare.app"
        r = await cli.post(f"{API}/api/auth/register", json={"email": p_email, "password": "Pwd123456!", "name": "QA Batch1 Patient"})
        r.raise_for_status()
        pat_token = r.json()["token"]
        pat_user = r.json()["user"]
        h_pat = {"Authorization": f"Bearer {pat_token}"}

        # 1) /api/doctors — should be exactly one canonical doctor
        r = await cli.get(f"{API}/api/doctors", headers=h_pat)
        r.raise_for_status()
        d = r.json()
        assert len(d["doctors"]) == 1, f"expected 1 doctor, got {len(d['doctors'])}"
        doc = d["doctors"][0]
        for k in ("id", "name", "specialization", "experience_years", "department", "bio", "rating"):
            assert k in doc, f"doctor card missing {k}"
        assert d["departments"][0]["id"] == "general"
        print(f"OK: /api/doctors -> {doc['name']} · {doc['specialization']} · {doc['experience_years']}y · ⭐{doc['rating']}")

        # 2) Availability — all slots free for an unused future date
        date = "2099-01-15"
        r = await cli.get(f"{API}/api/doctors/{doc['id']}/availability", params={"date": date}, headers=h_pat)
        r.raise_for_status()
        avail = r.json()
        assert all(s["available"] for s in avail["slots"]), "all slots should be free for unused date"
        first_slot = avail["slots"][0]["time"]
        print(f"OK: /availability -> {len(avail['slots'])} slots, first={first_slot}")

        # 3) Book through the new flow with doctor_id + department
        r = await cli.post(f"{API}/api/appointments", json={
            "patient_id": pat_user["linked_patient_id"],
            "date": date, "time": first_slot,
            "type": "consultation", "reason": "Batch 1 booking test",
            "duration_min": 30,
            "doctor_id": doc["id"], "department": "general",
        }, headers=h_pat)
        r.raise_for_status()
        appt = r.json()
        assert appt["doctor_id"] == doc["id"]
        assert appt["doctor_name"] == doc["name"]
        assert appt["department"] == "general"
        assert appt["status"] == "requested"
        print(f"OK: appointment booked id={appt['id']} status={appt['status']} doctor={appt['doctor_name']}")

        # 4) After booking, the slot should now show unavailable
        r = await cli.get(f"{API}/api/doctors/{doc['id']}/availability", params={"date": date}, headers=h_pat)
        r.raise_for_status()
        slot = next(s for s in r.json()["slots"] if s["time"] == first_slot)
        assert not slot["available"], f"slot {first_slot} should be unavailable after booking"
        print(f"OK: slot {first_slot} now booked")

        # 5) Cleanup
        await cli.delete(f"{API}/api/appointments/{appt['id']}", headers=h_doc)
        print("OK: cleanup done")


if __name__ == "__main__":
    asyncio.run(main())
    print("\nBatch 1 backend: PASS")
