"""
Integration tests for alert lifecycle (Phase 17).

Covers:
  1. Phrase-based correction detection + AI flag fallback
  2. high → pending_confirmation transition
  3. Confirmation loop:  yes → cleared_by_correction
                         no  → back to open
  4. Doctor resolve PATCH adds events[] timeline
  5. GET /followup/alerts returns active states (open + pending + downgraded)
  6. Helper-level unit checks for _detect_phrase_correction / _is_affirmative
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
    _detect_phrase_correction, _is_affirmative, _is_negative,
    db,
)

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001"
# inside the pod we can hit local backend for speed
LOCAL = "http://localhost:8001"


async def _login_doctor() -> str:
    async with httpx.AsyncClient(base_url=LOCAL, timeout=10) as c:
        r = await c.post("/api/auth/login", json={"email": "idrlapt@gmail.com", "password": "123456"})
        r.raise_for_status()
        return r.json()["token"]


async def _seed_alert(patient_id: str, urgency: str = "high", topic: str = "Possible chest pain"):
    aid = f"test_alert_{uuid.uuid4().hex[:8]}"
    await db.doctor_alerts.insert_one({
        "id": aid,
        "patient_id": patient_id,
        "patient_name": "Test Patient",
        "urgency": urgency,
        "topic": topic,
        "summary": "Initial alert (test seed)",
        "patient_message": "i have crushing chest pain",
        "ai_reply": "(test)",
        "status": "open",
        "created_at": "2026-04-28T00:00:00+00:00",
        "events": [{"event": "created", "by": "ai", "at": "2026-04-28T00:00:00+00:00",
                    "urgency_after": urgency, "status_after": "open"}],
    })
    return aid


def test_phrase_helpers():
    # Correction phrases
    assert _detect_phrase_correction("sorry, no chest pain")
    assert _detect_phrase_correction("Actually it's only mild")
    assert _detect_phrase_correction("false alarm guys")
    assert _detect_phrase_correction("I meant heartburn after spicy food")
    assert _detect_phrase_correction("no vomiting now")
    # NOT corrections
    assert not _detect_phrase_correction("I'm having severe chest pain")
    assert not _detect_phrase_correction("Hello doctor")
    # Affirmative / negative
    assert _is_affirmative("yes")
    assert _is_affirmative("Yeah that's right")
    assert _is_affirmative("Confirmed")
    assert _is_negative("no")
    assert _is_negative("still hurts a lot")
    assert not _is_affirmative("maybe later")
    print("✓ phrase helpers OK")


async def test_e2e_correction_loop():
    # Use the canonical demo patient (idempotently seeded on every backend start).
    pat = await db.users.find_one({"email": "drgapt@gmail.com"}, {"_id": 0})
    assert pat, "Demo patient missing — startup seed should create it"
    pid = pat["linked_patient_id"]
    assert pid, "drgapt linked_patient_id missing"

    # Pre-clean any stale test alerts
    await db.doctor_alerts.delete_many({"id": {"$regex": "^test_alert_"}})

    # Seed a high-urgency alert to simulate "the AI just paged the doctor"
    aid = await _seed_alert(pid, urgency="emergency", topic="Possible chest pain")

    # We don't want to hit the live LLM in tests — temporarily monkey-patch
    # the backend's _followup_llm_call to return a deterministic non-correction
    # reply with low urgency. (Server module is already imported above.)
    import server as srv
    original = srv._followup_llm_call

    async def fake_llm(patient, history, msg, lang):
        # Return a low-urgency reply with no correction flag so the lifecycle
        # logic falls back to phrase detection / heuristic.
        return ('I hear you. Glad it has eased — please keep an eye on it. '
                '<TRIAGE>{"urgency":"low","alert_doctor":false,"topic":"Possible chest pain","summary":"Patient says it has eased."}</TRIAGE>')

    srv._followup_llm_call = fake_llm
    try:
        token = await _login_doctor()
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=LOCAL, timeout=15, headers=headers) as c:
            # Step 1 — patient sends a phrase correction
            r1 = await c.post("/api/followup/message", json={
                "patient_id": pid,
                "message": "sorry, no chest pain — it was just heartburn after spicy food",
                "language": "en",
            })
            r1.raise_for_status()
            d1 = r1.json()
            assert aid in d1.get("pending_alert_ids", []), f"alert should be pending_confirmation, got {d1}"
            a1 = await db.doctor_alerts.find_one({"id": aid}, {"_id": 0})
            assert a1["status"] == "pending_confirmation"
            assert any(ev["event"] == "downgrade_proposed" for ev in a1.get("events", []))
            print("✓ step1 — alert moved to pending_confirmation on correction phrase")

            # Step 2a — patient confirms with "yes"
            r2 = await c.post("/api/followup/message", json={
                "patient_id": pid, "message": "yes that's right", "language": "en",
            })
            r2.raise_for_status()
            d2 = r2.json()
            assert aid in d2.get("cleared_alert_ids", []), f"alert should be cleared, got {d2}"
            a2 = await db.doctor_alerts.find_one({"id": aid}, {"_id": 0})
            assert a2["status"] == "cleared_by_correction"
            assert a2.get("resolution_reason") == "symptoms_corrected"
            assert any(ev["event"] == "cleared_by_correction" for ev in a2.get("events", []))
            print("✓ step2 — patient affirmation cleared the alert")

            # Step 3 — list active alerts; cleared one must NOT appear
            r3 = await c.get("/api/followup/alerts")
            r3.raise_for_status()
            ids = [a["id"] for a in r3.json()]
            assert aid not in ids, f"cleared alert leaked into active list: {ids}"
            print("✓ step3 — GET /followup/alerts hides cleared alerts")

            # Step 4 — seed another emergency, then test NEGATIVE confirmation
            aid2 = await _seed_alert(pid, urgency="high", topic="Possible bleeding")
            await c.post("/api/followup/message", json={
                "patient_id": pid, "message": "i was wrong sorry, it was just spotting", "language": "en",
            })
            a4 = await db.doctor_alerts.find_one({"id": aid2}, {"_id": 0})
            assert a4["status"] == "pending_confirmation"
            await c.post("/api/followup/message", json={
                "patient_id": pid, "message": "no, it's still bleeding actually", "language": "en",
            })
            a5 = await db.doctor_alerts.find_one({"id": aid2}, {"_id": 0})
            assert a5["status"] == "open", f"expected back to open after negation, got {a5['status']}"
            assert any(ev["event"] == "correction_rejected" for ev in a5.get("events", []))
            print("✓ step4 — negative confirmation rolls alert back to open")

            # Step 5 — doctor resolves via PATCH; events[] must record it.
            r5 = await c.patch(f"/api/followup/alerts/{aid2}", json={"status": "resolved", "note": "Spoke to patient."})
            r5.raise_for_status()
            a6 = await db.doctor_alerts.find_one({"id": aid2}, {"_id": 0})
            assert a6["status"] == "resolved"
            assert a6.get("resolution_reason") == "doctor_resolved"
            assert any(ev["event"] == "doctor_resolved" for ev in a6.get("events", []))
            print("✓ step5 — doctor resolve PATCH appends timeline event")

            # Step 6 — GET /followup/alerts/{id} returns full timeline
            r6 = await c.get(f"/api/followup/alerts/{aid2}")
            r6.raise_for_status()
            full = r6.json()
            assert isinstance(full.get("events"), list) and len(full["events"]) >= 3
            print(f"✓ step6 — alert detail returns {len(full['events'])} events")

    finally:
        srv._followup_llm_call = original
        await db.doctor_alerts.delete_many({"id": {"$regex": "^test_alert_"}})


async def main():
    test_phrase_helpers()
    await test_e2e_correction_loop()
    print("\nALL ALERT-LIFECYCLE TESTS PASSED ✓")


if __name__ == "__main__":
    asyncio.run(main())
