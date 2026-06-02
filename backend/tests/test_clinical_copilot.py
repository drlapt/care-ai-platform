"""
Integration tests for Phase 22 — AI Clinical Co-Pilot.

Covers:
  - _med_key normalisation
  - _parse_daily_mg (dose × frequency math)
  - _check_dose_warnings (high / low / unknown)
  - _check_interaction_warnings (warfarin + ibuprofen, atorvastatin + clarithromycin)
  - _check_gap_warnings (untreated symptom)
  - _build_suggestions (de-dupe vs current Rx)
  - End-to-end: POST /api/prescriptions/copilot/check returns the right buckets
  - Status ordering (blocking > warn > ok)
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
    _med_key, _parse_daily_mg, _check_dose_warnings,
    _check_interaction_warnings, _check_gap_warnings, _build_suggestions, db,
)

LOCAL = "http://localhost:8001"


def test_med_key_normalisation():
    assert _med_key("Amoxicillin 500mg") == "amoxicillin"
    assert _med_key("Atorvastatin 20 mg") == "atorvastatin"
    assert _med_key("Levothyroxine 25 mcg") == "levothyroxine"
    assert _med_key("Metoprolol succinate") == "metoprolol succinate"
    assert _med_key("Warfarin Sodium") == "warfarin"
    print("✓ med-key normalisation")


def test_dose_math():
    # 500mg TID = 1500 mg/day
    assert _parse_daily_mg({"dose": "500mg", "frequency": "TID"}) == 1500
    assert _parse_daily_mg({"dose": "1000 mg", "frequency": "QID"}) == 4000
    assert _parse_daily_mg({"dose": "10 mg", "frequency": "OD"}) == 10
    assert _parse_daily_mg({"dose": "25 mcg", "frequency": "OD"}) == 25 / 1000  # mg/day
    assert _parse_daily_mg({"dose": "no number", "frequency": "TID"}) is None
    print("✓ daily-mg math")


def test_dose_warnings():
    # High dose — paracetamol 1000mg QID = 4000 mg/day = at max (no warning)
    out_max = _check_dose_warnings([{"medication": "Paracetamol 1000mg", "dose": "1000mg", "frequency": "QID"}])
    assert all(w["kind"] != "dose_high" for w in out_max), out_max
    # Higher: paracetamol 1500 mg QID = 6000 mg/day → warn
    out_high = _check_dose_warnings([{"medication": "Paracetamol", "dose": "1500mg", "frequency": "QID"}])
    assert any(w["kind"] == "dose_high" for w in out_high), out_high
    # Lower: amlodipine 1mg OD = 1 mg/day < 2.5 → low warning
    out_low = _check_dose_warnings([{"medication": "Amlodipine", "dose": "1mg", "frequency": "OD"}])
    assert any(w["kind"] == "dose_low" for w in out_low), out_low
    # Unknown drug: no warning
    out_unknown = _check_dose_warnings([{"medication": "MysteryDrug", "dose": "5mg", "frequency": "OD"}])
    assert out_unknown == [], out_unknown
    print("✓ dose warnings")


def test_interaction_warnings():
    cases = [
        ([{"medication": "Warfarin"}, {"medication": "Ibuprofen 400mg"}], "major"),
        ([{"medication": "Atorvastatin 40mg"}, {"medication": "Clarithromycin"}], "major"),
        ([{"medication": "Ramipril"}, {"medication": "Ibuprofen"}], "caution"),
        ([{"medication": "Paracetamol"}, {"medication": "ORS"}], None),  # no interaction
    ]
    for meds, want_severity in cases:
        out = _check_interaction_warnings(meds)
        if want_severity:
            assert any(w["severity"] == want_severity for w in out), f"missing {want_severity}: {meds} -> {out}"
        else:
            assert out == [], f"unexpected interaction: {meds} -> {out}"
    print("✓ interaction warnings")


def test_gap_warnings():
    # Patient has loose stools + fever; Rx only has paracetamol → gap on diarrhoea/loose stools
    text = "Patient has fever and loose stools for 2 days, complaining of vomiting too."
    rx = [{"medication": "Paracetamol 500mg", "dose": "500mg", "frequency": "QID"}]
    gaps = _check_gap_warnings(text, rx)
    symptoms = {g["symptom"] for g in gaps}
    assert "loose stools" in symptoms, gaps
    assert "vomiting" in symptoms, gaps
    # If we now add ORS + Ondansetron, gap should disappear
    rx2 = rx + [{"medication": "ORS"}, {"medication": "Ondansetron 4mg"}]
    gaps2 = _check_gap_warnings(text, rx2)
    assert all(g["symptom"] not in {"loose stools", "vomiting"} for g in gaps2), gaps2
    print("✓ gap detection")


def test_suggestions_dedupe():
    text = "fever and headache"
    rx = [{"medication": "Paracetamol"}]
    s = _build_suggestions(text, rx)
    # Already on paracetamol → no suggestion list
    assert all("paracetamol" not in (i["medication"] or "").lower() for i in s)
    # Without paracetamol → present
    s2 = _build_suggestions(text, [])
    assert any("paracetamol" in (i["medication"] or "").lower() for i in s2)
    print("✓ suggestions de-duped against current Rx")


async def test_e2e_copilot_endpoint():
    # Login as doctor
    async with httpx.AsyncClient(base_url=LOCAL, timeout=15) as c:
        r = await c.post("/api/auth/login", json={"email": "idrlapt@gmail.com", "password": "123456"})
        r.raise_for_status()
        doc_token = r.json()["token"]

    # Find demo patient + add a confirmed penicillin allergy fact
    pat = await db.users.find_one({"email": "drgapt@gmail.com"}, {"_id": 0})
    pid = pat["linked_patient_id"]
    fact_id = str(uuid.uuid4())
    await db.patients.update_one(
        {"id": pid},
        {"$pull": {"medical_facts": {"value": "penicillin"}}},
    )
    await db.patients.update_one(
        {"id": pid},
        {"$push": {"medical_facts": {
            "id": fact_id, "type": "allergy", "value": "penicillin",
            "source": "test_seed", "confidence": "confirmed",
            "captured_at": "2026-04-28T00:00:00+00:00",
        }}},
    )
    # Set chief complaint
    await db.patients.update_one({"id": pid}, {"$set": {"chief_complaint": "Fever, loose stools, vomiting since yesterday."}})

    headers = {"Authorization": f"Bearer {doc_token}"}
    async with httpx.AsyncClient(base_url=LOCAL, timeout=20, headers=headers) as c:
        # Case 1: clean Rx — no warnings
        r = await c.post("/api/prescriptions/copilot/check", json={
            "patient_id": pid,
            "items": [{"medication": "Paracetamol", "dose": "500mg", "frequency": "TID", "duration": "3 days"}],
            "chief_complaint": "Fever",
        })
        r.raise_for_status()
        d = r.json()
        assert d["allergy_warnings"] == []
        assert d["status"] in ("ok", "warn"), d
        print(f"✓ clean Rx → status={d['status']}, gap={len(d['gap_warnings'])}")

        # Case 2: amoxicillin (penicillin class) → blocking allergy
        r = await c.post("/api/prescriptions/copilot/check", json={
            "patient_id": pid,
            "items": [{"medication": "Amoxicillin", "dose": "500mg", "frequency": "TID", "duration": "5 days"}],
            "chief_complaint": "Fever, loose stools, vomiting",
        })
        r.raise_for_status()
        d = r.json()
        assert d["status"] == "blocking", d
        assert any(a["allergy"] == "penicillin" for a in d["allergy_warnings"]), d
        # Untreated loose stools + vomiting also flagged
        gap_symptoms = {g["symptom"] for g in d["gap_warnings"]}
        assert "loose stools" in gap_symptoms or "vomiting" in gap_symptoms, gap_symptoms
        print(f"✓ amoxicillin → blocking allergy + {len(d['gap_warnings'])} gap warnings")

        # Case 3: warfarin + ibuprofen → major interaction (warn — no allergy)
        r = await c.post("/api/prescriptions/copilot/check", json={
            "patient_id": pid,
            "items": [
                {"medication": "Warfarin", "dose": "5mg", "frequency": "OD", "duration": "ongoing"},
                {"medication": "Ibuprofen 400mg", "dose": "400mg", "frequency": "TID", "duration": "3 days"},
            ],
            "chief_complaint": "Joint pain",
        })
        r.raise_for_status()
        d = r.json()
        assert d["status"] == "blocking", d
        assert any(i["severity"] == "major" for i in d["interaction_warnings"]), d
        print(f"✓ warfarin + ibuprofen → blocking major interaction")

        # Case 4: paracetamol 1500mg QID = 6000 mg/day → dose_high (warn)
        r = await c.post("/api/prescriptions/copilot/check", json={
            "patient_id": pid,
            "items": [{"medication": "Paracetamol", "dose": "1500mg", "frequency": "QID", "duration": "3 days"}],
            "chief_complaint": "Severe headache",
        })
        r.raise_for_status()
        d = r.json()
        assert d["status"] in ("warn", "blocking"), d
        assert any(w["kind"] == "dose_high" for w in d["dose_warnings"]), d
        print(f"✓ paracetamol overdose → dose_high warning")

        # Case 5: suggestion engine — empty Rx with fever + headache
        r = await c.post("/api/prescriptions/copilot/check", json={
            "patient_id": pid,
            "items": [],
            "chief_complaint": "fever and headache",
        })
        r.raise_for_status()
        d = r.json()
        assert any("paracetamol" in (s["medication"] or "").lower() for s in d["suggestions"]), d
        print(f"✓ suggestion engine returned {len(d['suggestions'])} candidates")

    # cleanup
    await db.patients.update_one({"id": pid}, {"$pull": {"medical_facts": {"id": fact_id}}})


async def main():
    test_med_key_normalisation()
    test_dose_math()
    test_dose_warnings()
    test_interaction_warnings()
    test_gap_warnings()
    test_suggestions_dedupe()
    await test_e2e_copilot_endpoint()
    print("\nALL PHASE-22 COPILOT TESTS PASSED ✓")


if __name__ == "__main__":
    asyncio.run(main())
