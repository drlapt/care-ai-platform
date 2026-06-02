"""
Integration tests for Phase 23 — WhatsApp privacy gates + per-channel toggles.

Phase 1 charter (per the user):
  - Consent + verification REQUIRED before any delivery
  - Per-channel toggles (prescriptions / summary / reminders / reports / alerts)
  - Phone-change MUST reset verification + consent
  - Reports default OFF; everything else default ON after consent

Tests cover:
  1. _wa_can_send unit — un-verified, no-prefs, opted-out, opted-in
  2. GET/PATCH /api/whatsapp/preferences (auth required, defaults sane)
  3. Toggle prescriptions OFF blocks delivery (mocked send_whatsapp)
  4. consent OFF blocks all
  5. Phone-change at /whatsapp/connect/start wipes verified_at + prefs
  6. /whatsapp/disconnect wipes everything (full reset)
"""
import asyncio
import os
import sys
import uuid
from typing import List

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from server import _wa_can_send, _default_wa_prefs, db  # noqa: E402

LOCAL = "http://localhost:8001"


def test_can_send_unit():
    # No number → False
    assert not _wa_can_send({}, "send_prescriptions")
    # Number but unverified → False
    assert not _wa_can_send({"whatsapp_number": "+91123"}, "send_prescriptions")
    # Verified but no consent → False
    u = {"whatsapp_number": "+91123", "whatsapp_verified_at": "now",
         "whatsapp_prefs": {**_default_wa_prefs(), "consent": False}}
    assert not _wa_can_send(u, "send_prescriptions")
    # Fully opted-in → True for default-on channels
    u2 = {"whatsapp_number": "+91123", "whatsapp_verified_at": "now",
          "whatsapp_prefs": _default_wa_prefs()}
    assert _wa_can_send(u2, "send_prescriptions")
    assert _wa_can_send(u2, "send_summary")
    assert _wa_can_send(u2, "send_reminders")
    assert _wa_can_send(u2, "send_alerts")
    # Reports default OFF
    assert not _wa_can_send(u2, "send_reports")
    # Bad channel name → False
    assert not _wa_can_send(u2, "send_invented")
    print("✓ _wa_can_send unit: number / verification / consent / per-channel")


async def _register_test_user() -> tuple:
    email = f"watest_{uuid.uuid4().hex[:6]}@example.com"
    async with httpx.AsyncClient(base_url=LOCAL, timeout=15) as c:
        r = await c.post("/api/auth/register", json={"email": email, "password": "abc123", "name": "WA Test"})
        r.raise_for_status()
        sess = r.json()
    return sess["token"], sess["user"]["user_id"], email


async def test_preferences_endpoints():
    token, uid, email = await _register_test_user()
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(base_url=LOCAL, timeout=10, headers=headers) as c:
        # Initial GET — unlinked, no consent
        r = await c.get("/api/whatsapp/preferences")
        r.raise_for_status()
        d = r.json()
        assert d["linked"] is False
        assert d["verified"] is False
        assert d["prefs"]["consent"] is False
        # PATCH must require auth
        r2 = await httpx.AsyncClient(base_url=LOCAL).patch("/api/whatsapp/preferences", json={"consent": True})
        assert r2.status_code in (401, 403)
        # Toggle OFF prescriptions
        r3 = await c.patch("/api/whatsapp/preferences", json={"send_prescriptions": False})
        r3.raise_for_status()
        # Re-fetch and confirm
        r4 = await c.get("/api/whatsapp/preferences")
        assert r4.json()["prefs"]["send_prescriptions"] is False
        # Reports default OFF
        assert r4.json()["prefs"]["send_reports"] is False
        print("✓ /api/whatsapp/preferences GET + PATCH + auth gate")
    await db.users.delete_one({"email": email})


async def test_phone_change_reset_and_disconnect():
    token, uid, email = await _register_test_user()
    # Manually mark verified + linked + prefs
    await db.users.update_one(
        {"user_id": uid},
        {"$set": {
            "whatsapp_number": "+919999999999",
            "whatsapp_verified_at": "2026-04-28T00:00:00Z",
            "whatsapp_linked_at": "2026-04-28T00:00:00Z",
            "whatsapp_prefs": _default_wa_prefs(),
        }},
    )
    # Mock send_whatsapp so /connect/start doesn't actually call Twilio
    import whatsapp_router as wr
    orig = wr.send_whatsapp
    async def fake_send(num, body=None, **kw):
        return ("SM_FAKE", None)
    wr.send_whatsapp = fake_send
    try:
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=LOCAL, timeout=10, headers=headers) as c:
            # Same number — should NOT reset
            r = await c.post("/api/whatsapp/connect/start", json={"whatsapp_number": "+919999999999"})
            r.raise_for_status()
            u = await db.users.find_one({"user_id": uid}, {"_id": 0, "whatsapp_verified_at": 1, "whatsapp_prefs": 1})
            assert u.get("whatsapp_verified_at"), "same-number /connect/start should NOT reset verification"
            assert u.get("whatsapp_prefs", {}).get("consent") is True, "same-number /connect/start should NOT reset prefs"

            # DIFFERENT number — MUST reset
            r2 = await c.post("/api/whatsapp/connect/start", json={"whatsapp_number": "+918888888888"})
            r2.raise_for_status()
            u2 = await db.users.find_one({"user_id": uid}, {"_id": 0})
            assert "whatsapp_verified_at" not in u2, f"verification should be unset, got {u2.get('whatsapp_verified_at')}"
            assert "whatsapp_prefs" not in u2, "prefs should be unset on number change"
            print("✓ phone-change resets verification + prefs (same-number path preserves)")

            # /disconnect must full-reset
            await db.users.update_one({"user_id": uid}, {"$set": {
                "whatsapp_number": "+918888888888",
                "whatsapp_verified_at": "now",
                "whatsapp_prefs": _default_wa_prefs(),
            }})
            r3 = await c.post("/api/whatsapp/disconnect")
            r3.raise_for_status()
            u3 = await db.users.find_one({"user_id": uid}, {"_id": 0})
            assert "whatsapp_number" not in u3
            assert "whatsapp_verified_at" not in u3
            assert "whatsapp_prefs" not in u3
            print("✓ /disconnect full-resets")
    finally:
        wr.send_whatsapp = orig
    await db.users.delete_one({"email": email})


async def test_delivery_gate():
    """Toggle OFF prescriptions → _send_consultation_to_whatsapp must NOT call send_whatsapp."""
    token, uid, email = await _register_test_user()
    pat = await db.users.find_one({"user_id": uid}, {"_id": 0, "linked_patient_id": 1})
    pid = pat["linked_patient_id"]
    # Verified + consent ON, but prescriptions OFF
    prefs = _default_wa_prefs()
    prefs["send_prescriptions"] = False
    prefs["send_summary"] = False  # also off → entire delivery should short-circuit
    await db.users.update_one(
        {"user_id": uid},
        {"$set": {
            "whatsapp_number": "+911234567890",
            "whatsapp_verified_at": "now",
            "whatsapp_linked_at": "now",
            "whatsapp_prefs": prefs,
        }},
    )

    import whatsapp_router as wr
    calls: List[str] = []
    orig = wr.send_whatsapp
    async def fake_send(num, body=None, **kw):
        calls.append(body or "(media)")
        return ("SM_FAKE", None)
    wr.send_whatsapp = fake_send

    import server as srv
    try:
        await srv._send_consultation_to_whatsapp(
            patient_id=pid,
            summary={"patient_summary": "Test summary"},
            rx_items=[{"medication": "Paracetamol", "dose": "500mg", "frequency": "TID", "duration": "3d"}],
            explanation="Take with food.",
            language="en",
        )
        assert calls == [], f"Both Rx + summary OFF — must not send. Got calls: {calls}"
        print("✓ both toggles OFF → zero outbound calls")

        # Now flip Rx ON, summary still OFF
        prefs["send_prescriptions"] = True
        await db.users.update_one({"user_id": uid}, {"$set": {"whatsapp_prefs": prefs}})
        calls.clear()
        await srv._send_consultation_to_whatsapp(
            patient_id=pid, summary={"patient_summary": "Test"},
            rx_items=[{"medication": "Paracetamol", "dose": "500mg", "frequency": "TID", "duration": "3d"}],
            explanation="Take with food.", language="en",
        )
        assert any("Prescription" in c for c in calls), f"Rx ON but no Rx message sent: {calls}"
        assert not any("Consultation summary" in c for c in calls), f"summary OFF but summary sent: {calls}"
        print(f"✓ Rx ON + summary OFF → only Rx delivered ({len(calls)} message)")

        # Revoke consent → all OFF
        prefs["consent"] = False
        await db.users.update_one({"user_id": uid}, {"$set": {"whatsapp_prefs": prefs}})
        calls.clear()
        await srv._send_consultation_to_whatsapp(
            patient_id=pid, summary={"patient_summary": "Test"},
            rx_items=[{"medication": "Paracetamol", "dose": "500mg", "frequency": "TID", "duration": "3d"}],
            explanation="Take with food.", language="en",
        )
        assert calls == [], f"consent revoked but messages sent: {calls}"
        print("✓ consent revoked → zero outbound calls (master gate)")
    finally:
        wr.send_whatsapp = orig
    await db.users.delete_one({"email": email})
    await db.patients.delete_one({"id": pid})


async def main():
    test_can_send_unit()
    await test_preferences_endpoints()
    await test_phone_change_reset_and_disconnect()
    await test_delivery_gate()
    print("\nALL PHASE-23 WHATSAPP TESTS PASSED ✓")


if __name__ == "__main__":
    asyncio.run(main())
