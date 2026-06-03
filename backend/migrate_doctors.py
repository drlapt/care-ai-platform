"""
migrate_doctors.py — Project CARE AI
======================================
One-time migration: seeds the `doctors` collection from every existing
user document that has role="doctor".

Properties:
- Idempotent: safe to re-run at any time (skips docs that already exist)
- Non-destructive: touches nothing in `users` collection
- Indexed: creates 4 indexes on `doctors` after migration
- Logged: prints scanned / inserted / skipped counts

Usage:
    python migrate_doctors.py

Reads MONGO_URL and DB_NAME from .env automatically.
"""

import asyncio
import logging
from datetime import timezone
from pathlib import Path

from dotenv import load_dotenv
import os
import uuid

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError

load_dotenv(Path(__file__).parent / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
)
log = logging.getLogger(__name__)

# Fields promoted from users → doctors document.
# Any field absent on the user record gets this default.
_PROFILE_DEFAULTS = {
    "specialization": "General Physician",
    "department": "general",
    "experience_years": 0,
    "bio": "",
    "languages": ["English"],
    "rating": None,
}


def _normalize_languages(value) -> list:
    """Coerce languages field to a clean list of strings.

    Handles legacy shapes found in older user documents:
      "English"           → ["English"]
      ["English", "Hindi"] → ["English", "Hindi"]
      ["", "Hindi", " "]  → ["Hindi"]
      None / []           → ["English"]  (default)
    """
    if not value:
        return ["English"]
    if isinstance(value, str):
        value = [value]
    normalized = [str(x).strip() for x in value if str(x).strip()]
    return normalized if normalized else ["English"]


def _build_doctor_doc(user: dict) -> dict:
    """Build a doctors-collection document from a users-collection document."""
    now = _now_iso()
    return {
        # Primary key for the doctors collection
        "doctor_id": f"doc_{uuid.uuid4().hex[:12]}",
        # Join key back to users (auth stays in users)
        "user_id": user["user_id"],
        # Identity
        "name": user.get("name") or "Unknown Doctor",
        "email": user.get("email", ""),
        # Profile fields — use whatever is on the user doc, fall back to defaults
        "specialization": user.get("specialization") or _PROFILE_DEFAULTS["specialization"],
        "department": (user.get("department") or _PROFILE_DEFAULTS["department"]).lower().strip(),
        "experience_years": user.get("experience_years") or _PROFILE_DEFAULTS["experience_years"],
        "bio": user.get("bio") or _PROFILE_DEFAULTS["bio"],
        "languages": _normalize_languages(user.get("languages")),
        "rating": user.get("rating") or _PROFILE_DEFAULTS["rating"],
        # Lifecycle
        "is_active": True,
        "is_accepting_patients": True,
        "onboarding_status": "active",   # pre-existing doctors are already active
        # Timestamps
        "created_at": user.get("created_at") or now,
        "activated_at": user.get("created_at") or now,
        "updated_at": now,
        "migrated_at": now,
    }


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now(timezone.utc).isoformat()


async def migrate():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    log.info("Connected — database: %s", DB_NAME)

    # ------------------------------------------------------------------ #
    # Step 1: Create indexes on doctors collection FIRST
    # (safe even if collection is empty — MongoDB creates it on first insert)
    # ------------------------------------------------------------------ #
    log.info("Creating indexes on doctors collection…")

    await db.doctors.create_index(
        "doctor_id", unique=True, name="doctors_doctor_id_unique"
    )
    await db.doctors.create_index(
        "user_id", unique=True, name="doctors_user_id_unique"
    )
    await db.doctors.create_index(
        "email",
        unique=False,   # not unique: guards against historical duplicate emails
        sparse=True,    # sparse: don't index docs where email is absent
        name="doctors_email",
    )
    await db.doctors.create_index(
        "is_active", name="doctors_is_active"
    )
    # Compound: the primary query path for list_doctors
    await db.doctors.create_index(
        [("is_active", 1), ("department", 1)],
        name="doctors_is_active_department",
    )

    log.info("Indexes ready.")

    # ------------------------------------------------------------------ #
    # Step 2: Scan users collection for role=doctor
    # ------------------------------------------------------------------ #
    doctor_users = await db.users.find(
        {"role": "doctor"}, {"_id": 0}
    ).to_list(1000)

    scanned = len(doctor_users)
    inserted = 0
    skipped = 0

    log.info("Scanned %d user(s) with role=doctor", scanned)

    if scanned == 0:
        log.warning(
            "No users with role=doctor found. "
            "If this is unexpected, check that ensure_canonical_accounts() "
            "has run at least once (start the backend first)."
        )

    # ------------------------------------------------------------------ #
    # Step 3: Insert into doctors collection (skip if already exists)
    # ------------------------------------------------------------------ #
    for user in doctor_users:
        user_id = user.get("user_id")
        email = user.get("email", "")

        if not user_id:
            log.warning("Skipping user with no user_id: %s", email)
            skipped += 1
            continue

        # Idempotency check: skip if a doctors doc already exists for this user
        existing = await db.doctors.find_one({"user_id": user_id}, {"_id": 0, "doctor_id": 1})
        if existing:
            log.info("  SKIP  %-30s already in doctors collection (%s)", email, existing["doctor_id"])
            skipped += 1
            continue

        doc = _build_doctor_doc(user)
        try:
            await db.doctors.insert_one(doc)
            log.info("  INSERT %-30s → %s", email, doc["doctor_id"])
            inserted += 1
        except DuplicateKeyError as exc:
            log.warning("  DUPLICATE KEY on insert for %s — skipping. Detail: %s", email, exc.details)
            skipped += 1

    # ------------------------------------------------------------------ #
    # Step 4: Summary
    # ------------------------------------------------------------------ #
    log.info("─" * 50)
    log.info("Migration complete.")
    log.info("  Scanned : %d", scanned)
    log.info("  Inserted: %d", inserted)
    log.info("  Skipped : %d (already existed or invalid)", skipped)
    log.info("─" * 50)

    # Verify final state
    total_doctors = await db.doctors.count_documents({})
    active_doctors = await db.doctors.count_documents({"is_active": True})
    log.info("doctors collection now contains: %d total, %d active", total_doctors, active_doctors)

    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())