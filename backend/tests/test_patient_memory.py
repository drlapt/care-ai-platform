"""
Integration tests for Phase 21 — structured patient memory + multi-profile +
clinical decision support.

Covers:
  1. Multi-profile CRUD + max-5 enforcement + switch
  2. Regex fact-extraction (positive + transient-symptom negatives)
  3. Pending-fact creation via /followup/message + confirmation prompt in reply
  4. "yes" promotes pending → medical_facts (with `confidence=confirmed` +
     mirrored to medical_history.allergies)
  5. "no" dismisses pending facts
  6. Allergy collision check at /prescriptions/quick (409 + override path)
  7. Confidence layer — only `confirmed` facts trigger collisions
"""
import asyncio
import os
import sys
import uuid

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from server import (  # noqa: E402
    _extract_pending_facts_from_message, _drug_allergy_collisions,
    _normalise_fact_value, db,
)

LOCAL = "http://localhost:8001"


async def login(email: str, password: str) -> dict:
    async with httpx.AsyncClient(base_url=LOCAL, timeout=10) as c:
        r = await c.post("/api/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        return r.json()


def test_extract_facts_positive():
    cases = [
        ("I'm allergic to penicillin", [("allergy", "penicillin")]),
        ("Im allergic to cefixime, by the way", [("allergy", "cefixime")]),
        ("I've got a known allergy to sulfa", [("allergy", "sulfa")]),
        ("I had an allergic reaction to amoxicillin last year", [("allergy", "amoxicillin last year")]),  # boundary captures
        ("I have diabetes type 2 and hypertension", [("condition", "diabetes type 2")]),
        ("I've been diagnosed with asthma", [("condition", "asthma")]),
        ("I take amlodipine daily for my BP", [("medication", "amlodipine")]),
        ("My father has diabetes", [("family_history", "diabetes")]),
    ]
    for text, expected in cases:
        out = _extract_pending_facts_from_message(text)
        for typ, val in expected:
            assert any(o["type"] == typ and val.split()[0] in o["value"] for o in out), \
                f"FAIL {text!r}: missing ({typ}, {val}) in {out}"
    print("✓ regex captures expected facts")


def test_extract_facts_transient_negatives():
    """Transient symptoms must NOT be captured as durable facts."""
    transient = [
        "I have a fever today",
        "I'm having a headache",
        "I have nausea",
        "I had vomiting yesterday",
        "I have a cough since morning",
    ]
    for t in transient:
        out = _extract_pending_facts_from_message(t)
        # None should be type=condition with these symptoms
        assert all(f["type"] != "condition" for f in out), f"transient symptom captured: {t} -> {out}"
    print("✓ transient symptoms NOT captured")


def test_drug_allergy_collisions_unit():
    patient = {
        "medical_facts": [
            {"type": "allergy", "value": "penicillin", "confidence": "confirmed"},
            {"type": "allergy", "value": "cefixime", "confidence": "inferred"},  # NOT confirmed
        ],
        "medical_history": {"allergies": []},
    }
    # confirmed penicillin → amoxicillin (penicillin class) collides
    cols = _drug_allergy_collisions([{"medication": "Amoxicillin"}], patient)
    assert any(c["allergy"] == "penicillin" for c in cols), f"penicillin class miss: {cols}"
    # inferred cefixime should NOT collide
    cols2 = _drug_allergy_collisions([{"medication": "Cefixime"}], patient)
    assert cols2 == [], f"inferred allergy must NOT collide, got {cols2}"
    # name match
    patient["medical_facts"].append({"type": "allergy", "value": "ibuprofen", "confidence": "confirmed"})
    cols3 = _drug_allergy_collisions([{"medication": "Ibuprofen 400mg"}], patient)
    assert any(c["medication"] == "Ibuprofen 400mg" for c in cols3)
    print("✓ collision detection: name-match + class-match, only confirmed counts")


async def test_e2e_memory_and_collision():
    # Pick fresh user to avoid cross-test contamination
    email = f"memtest_{uuid.uuid4().hex[:6]}@example.com"
    pwd = "abc123"
    async with httpx.AsyncClient(base_url=LOCAL, timeout=15) as c:
        r = await c.post("/api/auth/register", json={"email": email, "password": pwd, "name": "Mem Test"})
        r.raise_for_status()
        sess = r.json()
        token = sess["token"]
        pid = sess["user"]["linked_patient_id"]
    headers = {"Authorization": f"Bearer {token}"}

    # ---- 1. PROFILE LIST → 1 self profile ----
    async with httpx.AsyncClient(base_url=LOCAL, timeout=15, headers=headers) as c:
        r = await c.get("/api/profiles")
        r.raise_for_status()
        d = r.json()
        assert len(d["profiles"]) >= 1
        active = d["active_profile_id"]
        assert active == pid
        print(f"✓ profile list works (active={active}, {len(d['profiles'])} profiles)")

        # ---- 2. CREATE up to MAX_PROFILES_PER_USER additional → 5 limit ----
        created_ids = []
        for i in range(4):
            r = await c.post("/api/profiles", json={"name": f"Family Member {i}", "age": 30 + i, "gender": "Male", "relationship": "family"})
            r.raise_for_status()
            created_ids.append(r.json()["id"])
        # 6th profile must fail
        r = await c.post("/api/profiles", json={"name": "Sixth", "relationship": "guest"})
        assert r.status_code == 400
        print(f"✓ max-5 enforced (created {len(created_ids)} extra → 6th got 400)")

        # ---- 3. SWITCH active profile ----
        r = await c.post(f"/api/profiles/{created_ids[0]}/switch")
        r.raise_for_status()
        assert r.json()["active_profile_id"] == created_ids[0]
        # Switch back to self for the remaining tests
        r = await c.post(f"/api/profiles/{pid}/switch")
        r.raise_for_status()
        print("✓ switch profile works")

        # ---- 4. PATCH + DELETE ----
        r = await c.patch(f"/api/profiles/{created_ids[1]}", json={"name": "Renamed"})
        r.raise_for_status()
        r = await c.delete(f"/api/profiles/{created_ids[1]}")
        r.raise_for_status()
        print("✓ profile patch + delete")

    # ---- 5. /followup/message captures allergy, asks for confirmation ----
    # Patch backend's _followup_llm_call so this test doesn't burn LLM budget
    import server as srv
    original = srv._followup_llm_call

    async def fake_llm(patient, history, msg, lang):
        return ('Thanks for sharing — I will note this. '
                '<TRIAGE>{"urgency":"low","alert_doctor":false,"topic":"chat","summary":""}</TRIAGE>')

    srv._followup_llm_call = fake_llm
    try:
        async with httpx.AsyncClient(base_url=LOCAL, timeout=15, headers=headers) as c:
            r = await c.post("/api/followup/message", json={
                "patient_id": pid, "message": "By the way, I'm allergic to penicillin", "language": "en",
            })
            r.raise_for_status()
            d = r.json()
            pending = d.get("pending_facts") or []
            assert any(f["type"] == "allergy" and "penicillin" in f["value"] for f in pending), f"missing pending allergy: {d}"
            # Reply must contain the confirmation question
            assert "save" in (d.get("message", {}) or {}).get("text", "").lower(), "no save question in reply"
            print(f"✓ allergy captured as pending → AI asked to save (pending={pending})")

            # ---- 6. Patient confirms → fact promoted ----
            r = await c.post("/api/followup/message", json={
                "patient_id": pid, "message": "yes please save it", "language": "en",
            })
            r.raise_for_status()
            d = r.json()
            assert d.get("promoted_fact_ids"), f"no promoted_fact_ids in {d}"
            print(f"✓ 'yes' promoted pending → confirmed (ids={d['promoted_fact_ids']})")

            # ---- 7. Verify medical_facts persisted with confidence=confirmed ----
            r = await c.get(f"/api/profiles/{pid}/facts")
            r.raise_for_status()
            facts = r.json()["facts"]
            assert any(f["type"] == "allergy" and f["confidence"] == "confirmed" and "penicillin" in f["value"] for f in facts), f"missing confirmed allergy: {facts}"
            assert r.json()["pending"] == [], f"pending not cleared: {r.json()['pending']}"
            print(f"✓ confirmed fact persisted (confidence=confirmed); pending list empty")

            # ---- 8. Negative confirmation path: introduce another fact, dismiss ----
            r = await c.post("/api/followup/message", json={
                "patient_id": pid, "message": "I have asthma too", "language": "en",
            })
            r.raise_for_status()
            r2 = await c.post("/api/followup/message", json={
                "patient_id": pid, "message": "no actually skip that", "language": "en",
            })
            r2.raise_for_status()
            d = r2.json()
            assert d.get("dismissed_pending_count", 0) >= 1, f"no dismissed: {d}"
            r = await c.get(f"/api/profiles/{pid}/facts")
            assert r.json()["pending"] == []
            assert all(f["value"] != "asthma" for f in r.json()["facts"]), "asthma should NOT be in confirmed facts after 'no'"
            print("✓ 'no' dismisses pending fact; nothing leaks into confirmed")
    finally:
        srv._followup_llm_call = original

    # ---- 9. Doctor prescribes Amoxicillin → 409 collision (penicillin allergy) ----
    doc_sess = await login("idrlapt@gmail.com", "123456")
    doc_headers = {"Authorization": f"Bearer {doc_sess['token']}"}
    async with httpx.AsyncClient(base_url=LOCAL, timeout=15, headers=doc_headers) as c:
        body = {
            "patient_id": pid,
            "items": [{"medication": "Amoxicillin", "dose": "500mg", "frequency": "TID", "duration": "5d"}],
            "reason": "URTI",
        }
        r = await c.post("/api/prescriptions/quick", json=body)
        assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text}"
        detail = r.json()["detail"]
        assert detail.get("error") == "allergy_collision"
        assert any(c2["allergy"] == "penicillin" for c2 in detail["collisions"])
        print(f"✓ allergy collision blocked Amoxicillin ({detail['collisions']})")

        # ---- 10. Override path → succeeds ----
        body["override_allergy_warning"] = True
        r = await c.post("/api/prescriptions/quick", json=body)
        r.raise_for_status()
        print("✓ override_allergy_warning=True bypasses block (200)")

    # Cleanup test user/profile to keep prod data clean
    await db.users.delete_one({"email": email})
    await db.patients.delete_many({"id": {"$in": [pid] + created_ids}})


async def main():
    test_extract_facts_positive()
    test_extract_facts_transient_negatives()
    test_drug_allergy_collisions_unit()
    await test_e2e_memory_and_collision()
    print("\nALL PHASE-21 MEMORY TESTS PASSED ✓")


if __name__ == "__main__":
    asyncio.run(main())
