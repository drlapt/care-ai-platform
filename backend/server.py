from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form, Cookie, Header
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import io
import json
from openai import AsyncOpenAI
import logging
import asyncio
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
import uuid
from datetime import datetime, timezone, timedelta


from passlib.context import CryptContext

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Project Care API v2")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ============================================================
# Utilities
# ============================================================

def _now() -> datetime:
    return datetime.now(timezone.utc)

def _now_iso() -> str:
    return _now().isoformat()


def _strip_json_fence(txt: str) -> str:
    txt = txt.strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt)
        txt = re.sub(r"\s*```$", "", txt)
    return txt.strip()



    cleaned = _strip_json_fence(response)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"(\[.*\]|\{.*\})", cleaned, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        raise



openai_client = AsyncOpenAI(api_key=EMERGENT_LLM_KEY)

async def _llm_json(system_message: str, user_text: str, session_id: str) -> Any:
    response = await openai_client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_text},
        ],
    )

    content = response.choices[0].message.content
    return json.loads(content)


async def _llm_text(system_message: str, user_text: str, session_id: str) -> str:
    response = await openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_text},
        ],
    )

    return response.choices[0].message.content

# ============================================================
# Auth
# ============================================================

class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = ""
    role: Optional[str] = None  # "doctor" | "patient" | "admin"
    linked_patient_id: Optional[str] = None
    whatsapp_number: Optional[str] = None
    whatsapp_pending_number: Optional[str] = None
    whatsapp_language: Optional[str] = None
    created_at: str


async def get_current_user(
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> User:
    token = session_token
    if not token and authorization:
        if authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = sess.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < _now():
        raise HTTPException(status_code=401, detail="Session expired")

    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # ensure created_at is string
    if isinstance(user.get("created_at"), datetime):
        user["created_at"] = user["created_at"].isoformat()
    return User(**user)


def require_role(*roles):
    async def checker(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail=f"Requires role: {roles}")
        return user
    return checker


def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key="session_token",
        value=token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )


async def _create_session(user_id: str) -> str:
    token = f"sess_{uuid.uuid4().hex}{uuid.uuid4().hex[:8]}"
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": _now() + timedelta(days=7),
        "created_at": _now(),
    })
    return token


DOCTOR_EMAIL = "idrlapt@gmail.com"


@api_router.post("/auth/register")
async def register(request: Request, response: Response):
    body = await request.json()
    email = (body.get("email") or "").lower().strip()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip() or email.split("@")[0]
    whatsapp_number = (body.get("whatsapp_number") or "").strip()
    whatsapp_language = (body.get("whatsapp_language") or "en").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Hardcoded routing: only idrlapt@gmail.com is the doctor; everyone else is a patient.
    role = "doctor" if email == DOCTOR_EMAIL else "patient"

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Auto-create a patient record so the user can use Talk-to-AI / Reminders immediately.
    linked_patient_id: Optional[str] = None
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    if role == "patient":
        linked_patient_id = str(uuid.uuid4())
        await db.patients.insert_one({
            "id": linked_patient_id,
            "profile_owner_user_id": user_id,
            "relationship": "self",
            "personal_info": {"name": name, "email": email},
            "medical_history": {"allergies": [], "current_medications": [], "current_conditions": []},
            "medical_facts": [],
            "pending_facts": [],
            "chief_complaint": "",
            "consultations": [],
            "consultation_count": 0,
            "profile_completeness": 10,
            "onboarding": {},
            "created_at": _now_iso(),
            "is_demo": False,
        })

    user_doc = {
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": "",
        "role": role,
        "linked_patient_id": linked_patient_id,
        "password_hash": pwd_ctx.hash(password),
        "created_at": _now_iso(),
    }
    if whatsapp_number:
        # Stored as pending until verified via /whatsapp/connect/verify
        user_doc["whatsapp_pending_number"] = whatsapp_number
        user_doc["whatsapp_language"] = whatsapp_language if whatsapp_language in ("en", "hi", "te", "ta") else "en"
    await db.users.insert_one(user_doc.copy())
    token = await _create_session(user_id)
    _set_session_cookie(response, token)
    user_doc.pop("_id", None)
    user_doc.pop("password_hash", None)
    return {"user": user_doc, "token": token}


@api_router.post("/auth/login")
async def login(request: Request, response: Response):
    body = await request.json()

    email = (body.get("email") or "").lower().strip()
    password = body.get("password") or ""

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    user = await db.users.find_one({"email": email})

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    password_hash = user.get("password_hash")

    if not password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not pwd_ctx.verify(password, password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Soft-deleted accounts cannot log in
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    token = await _create_session(user["user_id"])

    _set_session_cookie(response, token)

    user.pop("_id", None)
    user.pop("password_hash", None)

    return {
        "user": user,
        "token": token
    }
async def admin_reset_account(request: Request):
    """Token-protected: reset password for any account, OR delete an account so the
    user can re-register. Useful on production when Mongo has stale data and the
    user needs to recover a stuck login/signup. Token is set via env ADMIN_RESET_TOKEN.

    Body: { "token": "<ADMIN_RESET_TOKEN>", "email": "...", "action": "reset"|"delete", "new_password": "..." (for reset) }
    """
    body = await request.json()
    expected = os.environ.get("ADMIN_RESET_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Admin reset disabled (no ADMIN_RESET_TOKEN set)")
    if (body.get("token") or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    email = (body.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="email required")
    action = (body.get("action") or "reset").lower()

    if action == "delete":
        r = await db.users.delete_one({"email": email})
        return {"deleted": r.deleted_count, "email": email}

    new_password = body.get("new_password") or "123456"
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one(
        {"email": email},
        {"$set": {"password_hash": pwd_ctx.hash(new_password)}},
    )
    return {"reset": True, "email": email}


@api_router.post("/auth/demo-doctor")
async def demo_doctor_login(response: Response):
    """Fast-path demo login — creates or reuses a demo doctor account."""
    demo_email = "demo.doctor@projectcare.app"
    existing = await db.users.find_one({"email": demo_email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        # Ensure doctor name is current (handle renames)
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": "Dr. Lahari"}})
        user_doc = {**existing, "name": "Dr. Lahari"}
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": demo_email,
            "name": "Dr. Lahari",
            "picture": "",
            "role": "doctor",
            "linked_patient_id": None,
            "created_at": _now_iso(),
        }
        await db.users.insert_one(user_doc.copy())
        user_doc.pop("_id", None)

    token = await _create_session(user_id)
    _set_session_cookie(response, token)
    if isinstance(user_doc.get("created_at"), datetime):
        user_doc["created_at"] = user_doc["created_at"].isoformat()
    return {"user": user_doc, "token": token}


@api_router.post("/auth/demo-patient")
async def demo_patient_login(response: Response):
    demo_email = "demo.patient@projectcare.app"
    # Link to the first seeded patient
    first_patient = await db.patients.find_one({"is_demo": True}, {"_id": 0})
    linked_id = first_patient["id"] if first_patient else None

    existing = await db.users.find_one({"email": demo_email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"linked_patient_id": linked_id}})
        user_doc = {**existing, "linked_patient_id": linked_id}
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": demo_email,
            "name": first_patient["personal_info"]["name"] if first_patient else "Demo Patient",
            "picture": "",
            "role": "patient",
            "linked_patient_id": linked_id,
            "created_at": _now_iso(),
        }
        await db.users.insert_one(user_doc.copy())
        user_doc.pop("_id", None)

    token = await _create_session(user_id)
    _set_session_cookie(response, token)
    return {"user": user_doc, "token": token}


@api_router.post("/auth/role")
async def set_role(request: Request, user: User = Depends(get_current_user)):
    body = await request.json()
    role = body.get("role")
    if role not in ("doctor", "patient", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    update = {"role": role}
    if role == "patient":
        # auto-link to first unlinked demo patient or create shell
        first = await db.patients.find_one({"is_demo": True}, {"_id": 0})
        update["linked_patient_id"] = first["id"] if first else None
    await db.users.update_one({"user_id": user.user_id}, {"$set": update})
    u = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    return {"user": u}


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return user.model_dump()


@api_router.post("/auth/logout")
async def logout(response: Response, session_token: Optional[str] = Cookie(default=None)):
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ============================================================
# Patient models & helpers (existing + extended)
# ============================================================

class PersonalInfo(BaseModel):
    name: str
    age: int
    gender: str
    phone: str
    email: Optional[str] = ""
    emergency_contact_name: Optional[str] = ""
    emergency_contact_phone: Optional[str] = ""


class PatientCreate(BaseModel):
    personal_info: PersonalInfo
    chief_complaint: str


class QuestionRequest(BaseModel):
    complaint: str


class OnboardingAnswers(BaseModel):
    answers: List[Dict[str, Any]]


class ConsultationCreate(BaseModel):
    conversation: str


# ---- LLM helpers (same as v1) ----

async def generate_medical_questions(complaint: str) -> List[Dict[str, Any]]:
    system = (
        "You are a medical AI assistant specializing in patient intake. "
        "Generate 6-8 highly relevant medical history questions for this complaint. "
        "Focus on: onset, severity, associated symptoms, history, medications, allergies, family history, lifestyle. "
        'Return ONLY a JSON array. Each: {"question": str, "type": "multiple_choice|scale|yes_no|text", "options"?: [str], "min"?: int, "max"?: int}. No markdown.'
    )
    data = await _llm_json(system, f"Chief complaint: {complaint}", f"qgen-{uuid.uuid4()}")
    if isinstance(data, dict) and "questions" in data:
        data = data["questions"]
    for i, q in enumerate(data):
        q["id"] = f"q{i+1}"
    return data


async def extract_clinical_entities(conversation: str, patient_context: Dict[str, Any]) -> Dict[str, Any]:
    system = (
        "You are a clinical NLP assistant. Extract clinical info from the conversation. "
        "Only extract explicitly mentioned. Return ONLY JSON with shape: "
        "{chief_complaint, symptoms:[{name,severity,duration}], medications:[{name,dose,frequency,duration,instructions}], "
        "instructions:[], allergies:[], vital_signs:{}, red_flags:[], assessment, plan, confidence}"
    )
    user = f"Patient: {patient_context}\n\nConversation:\n{conversation}"
    return await _llm_json(system, user, f"extract-{uuid.uuid4()}")


async def detect_contradictions(extracted: Dict[str, Any], patient_profile: Dict[str, Any]) -> List[Dict[str, str]]:
    system = (
        "Clinical safety assistant. Compare new findings vs existing history. Flag contradictions. "
        'Return ONLY JSON array: [{type, description, severity:"high|medium|low", suggested_action}]. Empty [] if none.'
    )
    user = f"Profile:\n{json.dumps(patient_profile, default=str)[:4000]}\n\nExtracted:\n{json.dumps(extracted, default=str)[:4000]}"
    try:
        data = await _llm_json(system, user, f"contra-{uuid.uuid4()}")
        if isinstance(data, dict):
            data = data.get("contradictions", [])
        return data or []
    except Exception:
        return []


async def generate_doctor_summary(patient: Dict[str, Any], extracted: Dict[str, Any]) -> str:
    system = "Senior physician. Write concise SOAP-style clinical note (Subjective, Objective, Assessment, Plan). Reference ICD-10 where applicable. <300 words, plain text."
    pi = patient.get("personal_info", {})
    user = f"Patient: {pi.get('name')}, {pi.get('age')}y {pi.get('gender')}\nCC: {patient.get('medical_history',{}).get('chief_complaint','')}\nHx: {json.dumps(patient.get('medical_history',{}), default=str)[:2000]}\nFindings: {json.dumps(extracted, default=str)[:2000]}"
    return await _llm_text(system, user, f"docsum-{uuid.uuid4()}")


async def generate_patient_summary(patient: Dict[str, Any], extracted: Dict[str, Any]) -> str:
    system = "Caring health coach. Simple, reassuring, 8th grade reading level. Explain what was discussed, plan, next steps, when to seek urgent care. <250 words."
    pi = patient.get("personal_info", {})
    user = f"Patient: {pi.get('name')}\nTold doctor: {patient.get('medical_history',{}).get('chief_complaint','')}\nFindings+Plan: {json.dumps(extracted, default=str)[:2000]}"
    return await _llm_text(system, user, f"patsum-{uuid.uuid4()}")


async def generate_prescription_explanations(medications: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not medications:
        return []
    system = "Pharmacist. For each medication return JSON array with: name, purpose, when_to_take, how_often, duration, side_effects, food_interactions, warnings. Simple language."
    try:
        data = await _llm_json(system, f"Medications:\n{json.dumps(medications)}", f"rx-{uuid.uuid4()}")
        if isinstance(data, dict) and "medications" in data:
            data = data["medications"]
        return data or []
    except Exception:
        return []


def _build_patient_doc(payload: PatientCreate, created_by: str) -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "created_by": created_by,
        "personal_info": payload.personal_info.model_dump(),
        "medical_history": {
            "chief_complaint": payload.chief_complaint,
            "current_conditions": [], "past_conditions": [], "medications": [],
            "allergies": [], "family_history": [], "social_history": [],
        },
        "onboarding": {"questions": [], "answers": [], "completed": False},
        "consultations": [],
        "timeline": [{"date": _now_iso(), "type": "registration", "summary": "Patient registered"}],
        "risk_factors": [],
        "profile_completeness": 40,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }


def _calc_completeness(p: Dict[str, Any]) -> int:
    s = 40
    if p.get("onboarding", {}).get("completed"): s += 30
    if p.get("medical_history", {}).get("medications"): s += 10
    if p.get("medical_history", {}).get("allergies"): s += 10
    if p.get("consultations"): s += 10
    return min(s, 100)


# ============================================================
# Routes — Patients (auth-gated)
# ============================================================

@api_router.get("/")
async def root():
    return {"message": "Project Care API v2", "status": "ok"}


@api_router.post("/patients")
async def create_patient(payload: PatientCreate, user: User = Depends(get_current_user)):
    doc = _build_patient_doc(payload, created_by=user.user_id)
    await db.patients.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


@api_router.get("/patients")
async def list_patients(user: User = Depends(get_current_user)):
    # Patients see only their linked patient
    if user.role == "patient" and user.linked_patient_id:
        patients = await db.patients.find({"id": user.linked_patient_id}, {"_id": 0}).to_list(1)
    else:
        patients = await db.patients.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [
        {
            "id": p["id"],
            "personal_info": p.get("personal_info", {}),
            "chief_complaint": p.get("medical_history", {}).get("chief_complaint", ""),
            "profile_completeness": p.get("profile_completeness", 0),
            "consultation_count": len(p.get("consultations", [])),
            "created_at": p.get("created_at"),
            "last_visit": (p.get("consultations") or [{}])[-1].get("date") if p.get("consultations") else None,
        }
        for p in patients
    ]


@api_router.get("/patients/{patient_id}")
async def get_patient(patient_id: str, user: User = Depends(get_current_user)):
    if user.role == "patient" and user.linked_patient_id != patient_id:
        raise HTTPException(status_code=403, detail="Access denied")
    patient = await db.patients.find_one({"id": patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@api_router.get("/patients/{patient_id}/alerts")
async def patient_alerts_history(patient_id: str, user: User = Depends(get_current_user)):
    """Doctor-only: full alert audit trail for one patient (all states)."""
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="Access denied")
    patient = await db.patients.find_one({"id": patient_id}, {"_id": 0, "personal_info": 1, "id": 1})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    alerts = await db.doctor_alerts.find(
        {"patient_id": patient_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return {
        "patient_id": patient_id,
        "patient_name": (patient.get("personal_info") or {}).get("name") or "Unknown",
        "alerts": alerts,
        "counts": {
            "total": len(alerts),
            "active": sum(1 for a in alerts if a.get("status") in ACTIVE_ALERT_STATES),
            "resolved": sum(1 for a in alerts if a.get("status") in FINAL_ALERT_STATES),
            "high_severity": sum(1 for a in alerts if (a.get("urgency") or "").lower() in ("emergency", "high")),
        },
    }


@api_router.post("/generate-questions")
async def generate_questions(req: QuestionRequest, user: User = Depends(get_current_user)):
    try:
        questions = await generate_medical_questions(req.complaint)
        return {"questions": questions}
    except Exception as e:
        logger.exception("Question gen failed")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.put("/patients/{patient_id}/onboarding")
async def save_onboarding(patient_id: str, payload: OnboardingAnswers, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    mh = patient.get("medical_history", {})
    for item in payload.answers:
        q = (item.get("question") or "").lower()
        a = item.get("answer")
        if a in (None, "", []): continue
        a_str = str(a)
        if "medication" in q or "medicine" in q:
            mh.setdefault("medications", []).append({"name": a_str, "source": "onboarding"})
        elif "allerg" in q:
            mh.setdefault("allergies", []).append(a_str)
        elif "family" in q or "father" in q or "mother" in q:
            mh.setdefault("family_history", []).append(f"{item.get('question')}: {a_str}")
        elif "smoke" in q or "alcohol" in q or "exercise" in q:
            mh.setdefault("social_history", []).append(f"{item.get('question')}: {a_str}")
        elif "diabetes" in q or "heart" in q or "hypertension" in q or "chronic" in q or "condition" in q:
            mh.setdefault("current_conditions", []).append(f"{item.get('question')}: {a_str}")
    update = {
        "medical_history": mh,
        "onboarding": {"questions": patient.get("onboarding", {}).get("questions", []), "answers": payload.answers, "completed": True, "completed_at": _now_iso()},
        "updated_at": _now_iso(),
        "timeline": (patient.get("timeline") or []) + [{"date": _now_iso(), "type": "onboarding", "summary": "Medical history collected via AI questionnaire"}],
    }
    update["profile_completeness"] = _calc_completeness({**patient, **update})
    await db.patients.update_one({"id": patient_id}, {"$set": update})
    return await db.patients.find_one({"id": patient_id}, {"_id": 0})


@api_router.post("/patients/{patient_id}/consultations")
async def process_consultation(patient_id: str, payload: ConsultationCreate, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    pi = patient.get("personal_info", {})
    ctx = {"name": pi.get("name"), "age": pi.get("age"), "gender": pi.get("gender")}

    try:
        extracted = await extract_clinical_entities(payload.conversation, ctx)
    except Exception as e:
        logger.exception("Extraction failed")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {e}")

    contradictions, doctor_summary, patient_summary, rx_explain = await asyncio.gather(
        detect_contradictions(extracted, patient),
        generate_doctor_summary(patient, extracted),
        generate_patient_summary(patient, extracted),
        generate_prescription_explanations(extracted.get("medications", [])),
        return_exceptions=True,
    )

    def safe(v, d): return d if isinstance(v, Exception) else v

    consult = {
        "id": str(uuid.uuid4()),
        "date": _now_iso(),
        "doctor_id": user.user_id,
        "doctor_name": user.name,
        "conversation": payload.conversation,
        "extracted_data": extracted,
        "doctor_summary": safe(doctor_summary, ""),
        "patient_summary": safe(patient_summary, ""),
        "prescriptions": safe(rx_explain, []),
        "contradictions_found": safe(contradictions, []),
    }

    mh = patient.get("medical_history", {})
    for med in extracted.get("medications", []) or []:
        mh.setdefault("medications", []).append({**med, "source": f"consultation:{consult['id']}"})
    for a in extracted.get("allergies", []) or []:
        if a and a not in mh.get("allergies", []):
            mh.setdefault("allergies", []).append(a)
    if extracted.get("assessment"):
        mh.setdefault("current_conditions", []).append({"condition": extracted["assessment"], "diagnosed_at": consult["date"]})

    timeline = (patient.get("timeline") or []) + [{"date": consult["date"], "type": "consultation", "summary": extracted.get("assessment") or "Consultation completed"}]
    consultations = (patient.get("consultations") or []) + [consult]
    new_p = {**patient, "medical_history": mh, "consultations": consultations, "timeline": timeline, "updated_at": _now_iso()}
    new_p["profile_completeness"] = _calc_completeness(new_p)
    new_p.pop("_id", None)
    await db.patients.update_one({"id": patient_id}, {"$set": {
        "medical_history": new_p["medical_history"], "consultations": new_p["consultations"],
        "timeline": new_p["timeline"], "updated_at": new_p["updated_at"], "profile_completeness": new_p["profile_completeness"],
    }})
    return {"consultation": consult, "patient": new_p}


@api_router.get("/consultations/{consultation_id}")
async def get_consultation(consultation_id: str, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"consultations.id": consultation_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Consultation not found")
    if user.role == "patient" and user.linked_patient_id != patient["id"]:
        raise HTTPException(status_code=403)
    c = next((c for c in patient.get("consultations", []) if c["id"] == consultation_id), None)
    return {"consultation": c, "patient": patient}


# ============================================================
# Voice — Whisper transcription
# ============================================================

async def _whisper_transcribe_bytes(
    audio_bytes: bytes,
    filename: str = "audio.webm",
    language: Optional[str] = None,
    prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """Reusable Whisper STT. Returns {text, language, duration}.
    Pass `language` as ISO-639-1 (e.g. 'en','hi','te','ta') to anchor decoding;
    omit to let Whisper auto-detect (best for free-form WhatsApp voice notes).
    """
    if len(audio_bytes) < 1024:
        raise ValueError("Audio too small / empty")
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise ValueError("Audio too large (max 25MB)")
    buf = io.BytesIO(audio_bytes)
    buf.name = filename
    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
    kwargs = {
        "file": buf,
        "model": "whisper-1",
        "response_format": "verbose_json",
        "prompt": prompt or "Patient describing symptoms or follow-up question. Medical terms: symptoms, medications, allergies, dosage, prescription.",
        "temperature": 0.0,
    }
    if language:
        kwargs["language"] = language
    response = await stt.transcribe(**kwargs)
    return {
        "text": (response.text or "").strip(),
        "language": getattr(response, "language", language or "en"),
        "duration": getattr(response, "duration", None),
    }


async def _tts_synth_bytes(text: str, voice: str = "nova", speed: float = 1.0) -> bytes:
    """Reusable OpenAI TTS. Returns mp3 bytes."""
    text = (text or "").strip()[:4000]
    if not text:
        return b""
    tts_client = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
    return await tts_client.generate_speech(
        text=text,
        model="tts-1",
        voice=voice or "nova",
        speed=max(0.5, min(1.5, speed or 1.0)),
        response_format="mp3",
    )


@api_router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file too large (max 25MB)")
    if len(content) < 1024:
        raise HTTPException(status_code=400, detail="Audio file too small / empty")

    # Pass an in-memory buffer with a filename so OpenAI SDK detects format
    filename = file.filename or "audio.webm"
    buf = io.BytesIO(content)
    buf.name = filename

    try:
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        response = await stt.transcribe(
            file=buf,
            model="whisper-1",
            response_format="verbose_json",
            language="en",
            prompt="This is a medical consultation between a Doctor and a Patient. Common terms: symptoms, medications, allergies, diagnosis, prescription.",
            temperature=0.0,
            timestamp_granularities=["segment"],
        )
        segments = []
        if hasattr(response, "segments") and response.segments:
            for s in response.segments:
                segments.append({
                    "start": getattr(s, "start", 0),
                    "end": getattr(s, "end", 0),
                    "text": getattr(s, "text", ""),
                })
        return {
            "text": response.text,
            "language": getattr(response, "language", "en"),
            "duration": getattr(response, "duration", None),
            "segments": segments,
        }
    except Exception as e:
        logger.exception("Whisper failed")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


# ============================================================
# Doctors (selection + availability)
# ============================================================

DEPARTMENTS = [
    {"id": "general", "label": "General Physician"},
]

# Default profile for Dr. Lahari (the only doctor available right now).
# Stored on the users document the first time the endpoint is hit so future
# admin tooling can edit it directly.
_DEFAULT_DOCTOR_PROFILE = {
    "specialization": "General Physician",
    "department": "general",
    "experience_years": 12,
    "bio": "Internal medicine specialist focusing on preventive care, chronic conditions, and AI-assisted triage. 24/7 follow-up via Care AI.",
    "languages": ["English", "Hindi", "Telugu", "Tamil"],
    "rating": 4.9,
}


async def _ensure_doctor_profile(doctor_user: Dict[str, Any]) -> Dict[str, Any]:
    """Backfill missing profile fields on the doctor user record (idempotent)."""
    updates = {}
    for k, v in _DEFAULT_DOCTOR_PROFILE.items():
        if doctor_user.get(k) in (None, "", []):
            updates[k] = v
    if updates:
        await db.users.update_one({"user_id": doctor_user["user_id"]}, {"$set": updates})
        doctor_user.update(updates)
    return doctor_user


def _doctor_card(u: Dict[str, Any]) -> Dict[str, Any]:
    """Public-safe doctor card payload — no email, no password hash."""
    return {
        "id": u["user_id"],
        "name": u.get("name") or "Dr. Lahari",
        "specialization": u.get("specialization") or _DEFAULT_DOCTOR_PROFILE["specialization"],
        "department": u.get("department") or _DEFAULT_DOCTOR_PROFILE["department"],
        "experience_years": u.get("experience_years") or _DEFAULT_DOCTOR_PROFILE["experience_years"],
        "bio": u.get("bio") or _DEFAULT_DOCTOR_PROFILE["bio"],
        "languages": u.get("languages") or _DEFAULT_DOCTOR_PROFILE["languages"],
        "rating": u.get("rating") or _DEFAULT_DOCTOR_PROFILE["rating"],
    }


@api_router.get("/doctors")
async def list_doctors(department: Optional[str] = None, user: User = Depends(get_current_user)):
    # Only the canonical Dr. Lahari is exposed today. Future: support multiple
    # active doctors via an explicit `is_active` flag on the user record.
    q = {"role": "doctor", "email": DOCTOR_EMAIL}
    if department:
        q["department"] = department
    docs = await db.users.find(q, {"_id": 0}).to_list(50)
    out = [_doctor_card(await _ensure_doctor_profile(u)) for u in docs]
    # Defensive fallback: if NO department filter was applied and we somehow have
    # no doctor record yet, surface the canonical Dr. Lahari so the UI never breaks.
    if not out and not department:
        d = await db.users.find_one({"email": DOCTOR_EMAIL}, {"_id": 0})
        if d:
            out.append(_doctor_card(await _ensure_doctor_profile(d)))
    return {"departments": DEPARTMENTS, "doctors": out}


@api_router.get("/doctors/{doctor_id}/availability")
async def doctor_availability(doctor_id: str, date: str, user: User = Depends(get_current_user)):
    """Returns the list of half-hour slots between 09:00–17:00 marked as booked or free."""
    all_slots = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00",
                 "14:00","14:30","15:00","15:30","16:00","16:30"]
    booked = await db.appointments.find(
        {"doctor_id": doctor_id, "date": date, "status": {"$in": ["requested", "scheduled", "confirmed"]}},
        {"_id": 0, "time": 1},
    ).to_list(200)
    booked_set = {b["time"] for b in booked}
    return {
        "doctor_id": doctor_id,
        "date": date,
        "slots": [{"time": s, "available": s not in booked_set} for s in all_slots],
    }


# ============================================================
# Appointments
# ============================================================

class AppointmentCreate(BaseModel):
    patient_id: str
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    duration_min: int = 30
    type: str = "consultation"  # consultation|follow_up|procedure
    reason: Optional[str] = ""
    doctor_id: Optional[str] = None
    department: Optional[str] = None


@api_router.get("/appointments")
async def list_appointments(user: User = Depends(get_current_user)):
    q = {}
    if user.role == "patient" and user.linked_patient_id:
        q = {"patient_id": user.linked_patient_id}
    items = await db.appointments.find(q, {"_id": 0}).sort([("date", 1), ("time", 1)]).to_list(500)
    # Hydrate with patient name
    patient_ids = {i["patient_id"] for i in items}
    patients = {p["id"]: p for p in await db.patients.find({"id": {"$in": list(patient_ids)}}, {"_id": 0, "id": 1, "personal_info": 1}).to_list(500)}
    for i in items:
        p = patients.get(i["patient_id"], {})
        i["patient_name"] = p.get("personal_info", {}).get("name", "Unknown")
    return items


@api_router.post("/appointments")
async def create_appointment(payload: AppointmentCreate, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0, "personal_info": 1, "id": 1})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    # Patient can only book for themselves.
    if user.role == "patient" and user.linked_patient_id != payload.patient_id:
        raise HTTPException(status_code=403, detail="Patients can only book for themselves")

    # If a patient is booking, the appointment belongs to the chosen doctor (default Dr. Lahari).
    if user.role == "patient":
        if payload.doctor_id:
            doctor_user = await db.users.find_one(
                {"user_id": payload.doctor_id, "role": "doctor"},
                {"_id": 0, "user_id": 1, "name": 1, "specialization": 1, "department": 1},
            )
            if not doctor_user:
                raise HTTPException(status_code=404, detail="Doctor not found")
        else:
            doctor_user = await db.users.find_one({"email": DOCTOR_EMAIL}, {"_id": 0, "user_id": 1, "name": 1, "specialization": 1, "department": 1})
        doctor_id = (doctor_user or {}).get("user_id", "")
        doctor_name = (doctor_user or {}).get("name") or "Dr. Lahari"
        doctor_specialization = (doctor_user or {}).get("specialization") or _DEFAULT_DOCTOR_PROFILE["specialization"]
        doctor_department = payload.department or (doctor_user or {}).get("department") or _DEFAULT_DOCTOR_PROFILE["department"]
    else:
        doctor_id = user.user_id
        doctor_name = user.name
        doctor_specialization = _DEFAULT_DOCTOR_PROFILE["specialization"]
        doctor_department = payload.department or _DEFAULT_DOCTOR_PROFILE["department"]

    doc = {
        "id": str(uuid.uuid4()),
        "patient_id": payload.patient_id,
        "patient_name": patient["personal_info"]["name"],
        "doctor_id": doctor_id,
        "doctor_name": doctor_name,
        "doctor_specialization": doctor_specialization,
        "department": doctor_department,
        "date": payload.date,
        "time": payload.time,
        "duration_min": payload.duration_min,
        "type": payload.type,
        "reason": payload.reason,
        "status": "requested" if user.role == "patient" else "scheduled",
        "requested_by": user.role,
        "created_at": _now_iso(),
    }
    await db.appointments.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


@api_router.patch("/appointments/{appt_id}")
async def update_appointment(appt_id: str, request: Request, user: User = Depends(get_current_user)):
    body = await request.json()
    appt = await db.appointments.find_one({"id": appt_id}, {"_id": 0})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    # Patients may only confirm/decline a doctor's reschedule proposal on their own appointment.
    if user.role == "patient":
        if appt.get("patient_id") != user.linked_patient_id:
            raise HTTPException(status_code=403, detail="Not your appointment")
        action = body.get("patient_action")
        if action == "accept_reschedule":
            if not (appt.get("proposed_date") and appt.get("proposed_time")):
                raise HTTPException(status_code=400, detail="No proposal to accept")
            await db.appointments.update_one({"id": appt_id}, {"$set": {
                "date": appt["proposed_date"], "time": appt["proposed_time"],
                "status": "scheduled",
            }, "$unset": {"proposed_date": "", "proposed_time": "", "proposed_reason": ""}})
        elif action == "reject_reschedule":
            await db.appointments.update_one({"id": appt_id}, {"$set": {
                "status": "cancelled",
            }, "$unset": {"proposed_date": "", "proposed_time": "", "proposed_reason": ""}})
        else:
            raise HTTPException(status_code=400, detail="patient_action must be accept_reschedule or reject_reschedule")
        return await db.appointments.find_one({"id": appt_id}, {"_id": 0})

    # Doctor flow — full edit power, including proposing an alternate slot.
    allowed = {"status", "date", "time", "reason", "proposed_date", "proposed_time", "proposed_reason"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields")
    # Doctor proposing an alternate → status flips to 'rescheduled' for patient acknowledgement.
    if updates.get("proposed_date") and updates.get("proposed_time"):
        updates["status"] = "rescheduled"
    await db.appointments.update_one({"id": appt_id}, {"$set": updates})
    return await db.appointments.find_one({"id": appt_id}, {"_id": 0})


@api_router.delete("/appointments/{appt_id}")
async def delete_appointment(appt_id: str, user: User = Depends(get_current_user)):
    res = await db.appointments.delete_one({"id": appt_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return {"deleted": True, "id": appt_id}


@api_router.post("/admin/cleanup-orphans")
async def cleanup_orphans(user: User = Depends(get_current_user)):
    """Remove appointments/messages/labs referencing patients that no longer exist."""
    patient_ids = {p["id"] for p in await db.patients.find({}, {"_id": 0, "id": 1}).to_list(10000)}
    removed = {}
    for col in ("appointments", "messages", "lab_results"):
        res = await db[col].delete_many({"patient_id": {"$nin": list(patient_ids)}})
        removed[col] = res.deleted_count
    return {"removed": removed}


@api_router.get("/admin/doctors")
async def admin_list_doctors(user: User = Depends(require_role("admin", "doctor"))):
    """Admin: list all doctor accounts with full profile (no password hash)."""
    docs = await db.users.find(
        {"role": "doctor"},
        {"_id": 0, "password_hash": 0},
    ).to_list(200)
    for d in docs:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
    return {"doctors": docs, "total": len(docs)}


class AdminDoctorCreate(BaseModel):
    email: str
    password: str
    name: str
    specialization: Optional[str] = "General Physician"
    department: Optional[str] = "general"
    experience_years: Optional[int] = 0
    bio: Optional[str] = ""
    languages: Optional[List[str]] = ["English"]
    rating: Optional[float] = None


class AdminDoctorUpdate(BaseModel):
    is_active: Optional[bool] = None
    specialization: Optional[str] = None
    department: Optional[str] = None
    bio: Optional[str] = None
    name: Optional[str] = None
    experience_years: Optional[int] = None
    languages: Optional[List[str]] = None
    rating: Optional[float] = None


@api_router.post("/admin/doctors", status_code=201)
async def admin_create_doctor(payload: AdminDoctorCreate, user: User = Depends(require_role("admin"))):
    """Admin: create a new doctor account."""
    email = payload.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    existing = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": payload.name.strip() or email.split("@")[0],
        "picture": "",
        "role": "doctor",
        "linked_patient_id": None,
        "password_hash": pwd_ctx.hash(payload.password),
        "specialization": payload.specialization or "General Physician",
        "department": (payload.department or "general").lower().strip(),
        "experience_years": payload.experience_years or 0,
        "bio": payload.bio or "",
        "languages": payload.languages or ["English"],
        "rating": payload.rating,
        "is_active": True,
        "created_at": _now_iso(),
    }
    await db.users.insert_one(doc.copy())
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return {"doctor": doc}


@api_router.patch("/admin/doctors/{doctor_user_id}")
async def admin_update_doctor(
    doctor_user_id: str,
    payload: AdminDoctorUpdate,
    user: User = Depends(require_role("admin")),
):
    """Admin: update allowed profile fields on a doctor account. Password not editable here."""
    target = await db.users.find_one(
        {"user_id": doctor_user_id, "role": "doctor"},
        {"_id": 0, "password_hash": 0},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Doctor not found")

    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.users.update_one({"user_id": doctor_user_id}, {"$set": updates})
    updated = await db.users.find_one(
        {"user_id": doctor_user_id},
        {"_id": 0, "password_hash": 0},
    )
    if isinstance(updated.get("created_at"), datetime):
        updated["created_at"] = updated["created_at"].isoformat()
    return {"doctor": updated}


@api_router.delete("/admin/doctors/{doctor_user_id}")
async def admin_delete_doctor(
    doctor_user_id: str,
    user: User = Depends(require_role("admin")),
):
    """Admin: soft-delete a doctor (sets is_active=False + deleted_at). Never physically removes the record."""
    target = await db.users.find_one(
        {"user_id": doctor_user_id, "role": "doctor"},
        {"_id": 0, "password_hash": 0},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Doctor not found")

    # Guard: canonical seeded doctor must never be soft-deleted
    if target.get("email") == DOCTOR_EMAIL:
        raise HTTPException(status_code=403, detail="Cannot deactivate the canonical doctor account")

    # Guard: admin cannot soft-delete themselves (if they somehow also hold doctor role)
    if doctor_user_id == user.user_id:
        raise HTTPException(status_code=403, detail="Cannot deactivate your own account")

    deleted_at = _now_iso()
    await db.users.update_one(
        {"user_id": doctor_user_id},
        {"$set": {"is_active": False, "deleted_at": deleted_at}},
    )

    # Revoke all active sessions so the doctor cannot authenticate after deactivation
    revoke_result = await db.user_sessions.delete_many({"user_id": doctor_user_id})

    updated = await db.users.find_one(
        {"user_id": doctor_user_id},
        {"_id": 0, "password_hash": 0},
    )
    if isinstance(updated.get("created_at"), datetime):
        updated["created_at"] = updated["created_at"].isoformat()

    return {
        "doctor": updated,
        "sessions_revoked": revoke_result.deleted_count,
    }


# ============================================================
# Messages
# ============================================================

class MessageCreate(BaseModel):
    patient_id: str
    text: str


@api_router.get("/messages/threads")
async def list_threads(user: User = Depends(get_current_user)):
    if user.role == "patient" and user.linked_patient_id:
        q = {"patient_id": user.linked_patient_id}
    else:
        q = {}
    pipeline = [
        {"$match": q},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": "$patient_id",
            "last_message": {"$first": "$text"},
            "last_sender": {"$first": "$sender"},
            "last_at": {"$first": "$created_at"},
            "unread": {"$sum": {"$cond": [{"$and": [{"$eq": ["$read", False]}, {"$ne": ["$sender", user.role]}]}, 1, 0]}},
        }},
        {"$project": {"_id": 0, "patient_id": "$_id", "last_message": 1, "last_sender": 1, "last_at": 1, "unread": 1}},
        {"$sort": {"last_at": -1}},
    ]
    threads = await db.messages.aggregate(pipeline).to_list(200)
    ids = [t["patient_id"] for t in threads]
    patients = {p["id"]: p for p in await db.patients.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "personal_info": 1}).to_list(500)}
    for t in threads:
        p = patients.get(t["patient_id"], {})
        t["patient_name"] = p.get("personal_info", {}).get("name", "Unknown")
    return threads


@api_router.get("/messages/thread/{patient_id}")
async def get_thread(patient_id: str, user: User = Depends(get_current_user)):
    if user.role == "patient" and user.linked_patient_id != patient_id:
        raise HTTPException(status_code=403)
    msgs = await db.messages.find({"patient_id": patient_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    # Mark as read for the reader
    await db.messages.update_many(
        {"patient_id": patient_id, "read": False, "sender": {"$ne": user.role}},
        {"$set": {"read": True}}
    )
    return msgs


@api_router.post("/messages")
async def create_message(payload: MessageCreate, user: User = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "patient_id": payload.patient_id,
        "sender": user.role or "doctor",
        "sender_name": user.name,
        "text": payload.text,
        "read": False,
        "created_at": _now_iso(),
    }
    await db.messages.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


# ============================================================
# Pharmacy (aggregate from consultations + patient histories)
# ============================================================

@api_router.get("/pharmacy/prescriptions")
async def list_prescriptions(user: User = Depends(get_current_user)):
    q = {}
    if user.role == "patient" and user.linked_patient_id:
        q = {"id": user.linked_patient_id}
    patients = await db.patients.find(q, {"_id": 0}).to_list(500)
    items = []
    for p in patients:
        pi = p.get("personal_info", {})
        # from history
        for m in p.get("medical_history", {}).get("medications", []) or []:
            if isinstance(m, dict):
                items.append({
                    "patient_id": p["id"], "patient_name": pi.get("name"),
                    "medication": m.get("name"), "frequency": m.get("frequency"),
                    "dose": m.get("dose"), "source": m.get("source", "history"),
                    "date": p.get("created_at"),
                })
            else:
                items.append({"patient_id": p["id"], "patient_name": pi.get("name"), "medication": str(m), "source": "history", "date": p.get("created_at")})
        # from consultations
        for c in p.get("consultations", []) or []:
            for rx in c.get("prescriptions", []) or []:
                items.append({
                    "patient_id": p["id"], "patient_name": pi.get("name"),
                    "medication": rx.get("name"), "purpose": rx.get("purpose"),
                    "when_to_take": rx.get("when_to_take"), "how_often": rx.get("how_often"),
                    "duration": rx.get("duration"), "side_effects": rx.get("side_effects"),
                    "warnings": rx.get("warnings"),
                    "source": f"consultation {c['id'][:8]}", "date": c.get("date"),
                })
    items.sort(key=lambda x: x.get("date") or "", reverse=True)
    return items


# ============================================================
# Laboratory
# ============================================================

class LabResultCreate(BaseModel):
    patient_id: str
    test_name: str
    value: float
    unit: str
    ref_low: Optional[float] = None
    ref_high: Optional[float] = None
    date: Optional[str] = None


def _flag(value, lo, hi):
    if lo is None or hi is None: return "normal"
    if value < lo: return "low"
    if value > hi: return "high"
    return "normal"


@api_router.get("/lab/results")
async def list_lab_results(user: User = Depends(get_current_user)):
    q = {}
    if user.role == "patient" and user.linked_patient_id:
        q = {"patient_id": user.linked_patient_id}
    items = await db.lab_results.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    ids = {i["patient_id"] for i in items}
    patients = {p["id"]: p for p in await db.patients.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "personal_info": 1}).to_list(500)}
    for i in items:
        p = patients.get(i["patient_id"], {})
        i["patient_name"] = p.get("personal_info", {}).get("name", "Unknown")
    return items


@api_router.post("/lab/results")
async def create_lab_result(payload: LabResultCreate, user: User = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "patient_id": payload.patient_id,
        "test_name": payload.test_name,
        "value": payload.value,
        "unit": payload.unit,
        "ref_low": payload.ref_low,
        "ref_high": payload.ref_high,
        "flag": _flag(payload.value, payload.ref_low, payload.ref_high),
        "date": payload.date or _now_iso(),
        "ordered_by": user.user_id,
    }
    await db.lab_results.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


# ============================================================
# Analytics
# ============================================================

@api_router.get("/analytics")
async def analytics(user: User = Depends(get_current_user)):
    total_patients = await db.patients.count_documents({})
    pipeline = [
        {"$project": {"cc": {"$size": {"$ifNull": ["$consultations", []]}}, "created_at": 1, "medical_history": 1}},
        {"$group": {"_id": None, "total_consults": {"$sum": "$cc"}}},
    ]
    agg = await db.patients.aggregate(pipeline).to_list(1)
    total_consults = agg[0]["total_consults"] if agg else 0

    # Conditions leaderboard
    cond_pipe = [
        {"$project": {"c": "$medical_history.current_conditions"}},
        {"$unwind": "$c"},
        {"$group": {"_id": {"$cond": [{"$eq": [{"$type": "$c"}, "object"]}, "$c.condition", "$c"]}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}, {"$limit": 8},
    ]
    conditions = [{"name": x["_id"] or "—", "count": x["count"]} async for x in db.patients.aggregate(cond_pipe)]

    # Consultations per day (last 14)
    consults_pipe = [
        {"$unwind": "$consultations"},
        {"$project": {"day": {"$substr": ["$consultations.date", 0, 10]}}},
        {"$group": {"_id": "$day", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    by_day = [{"day": x["_id"], "count": x["count"]} async for x in db.patients.aggregate(consults_pipe)]

    total_appts = await db.appointments.count_documents({})
    unread_msgs = await db.messages.count_documents({"read": False})
    abnormal_labs = await db.lab_results.count_documents({"flag": {"$in": ["high", "low"]}})

    # Time saved estimate: 8 min/consultation
    minutes_saved = total_consults * 8
    return {
        "total_patients": total_patients,
        "total_consultations": total_consults,
        "total_appointments": total_appts,
        "unread_messages": unread_msgs,
        "abnormal_labs": abnormal_labs,
        "minutes_saved": minutes_saved,
        "hours_saved": round(minutes_saved / 60, 1),
        "top_conditions": conditions,
        "consultations_by_day": by_day,
    }


@api_router.get("/stats")
async def stats(user: User = Depends(get_current_user)):
    total = await db.patients.count_documents({})
    return {"total_patients": total, "queue_current": "C15", "queue_position": "4 of 18", "queue_eta": "16:10"}


# ============================================================
# Care AI — conversational onboarding + live clinical copilot
# ============================================================

CARE_AI_SYSTEM = """You are Care AI, an expert virtual medical assistant. Your job: conduct a warm, intelligent, clinically rigorous intake conversation with the patient BEFORE they see the doctor, then produce a structured clinical handoff summary.

# PERSONALITY
- Warm, professional, empathetic. 8th-grade reading level. No medical jargon unless you immediately define it.
- Keep each reply under 40 words (until the final summary).
- Ask ONE specific question at a time — never stack questions.
- Acknowledge feelings briefly when appropriate ("I understand that must be worrying," "I can hear you're in pain").
- Never diagnose, never prescribe. You gather, synthesize, and hand off.

# OPENING (first reply only)
Start with a personalized greeting using the patient's first name, introduce yourself as Care AI, mention you'll prepare a summary for the specific named doctor, then briefly acknowledge the chief complaint with empathy, then ask the first most-important follow-up.

# SYMPTOM-SPECIFIC INTERVIEW PROTOCOLS
Choose the protocol that best matches the chief complaint (or blend if mixed). Ask questions roughly in order but adapt based on answers.

## Chest pain (cardiac-rule-out priority)
Key questions: onset/duration · pain quality (sharp/dull/pressure/burning) · severity 1-10 · radiation (arm/jaw/neck/back) · exertional vs rest · associated SOB, diaphoresis, nausea, dizziness · history of HTN/DM/CAD · family Hx of heart disease · smoking.
RED FLAGS: crushing/pressure pain, radiation to L arm or jaw, diaphoresis, severe SOB, syncope, pain >20 min at rest — URGENCY=emergency.

## Headache (neuro priority)
Key questions: onset (especially thunderclap) · location · severity · "is this the worst headache of your life?" · vision changes · nausea/vomiting · photophobia/phonophobia · neck stiffness · fever · recent head trauma · focal weakness/numbness · similar past episodes · pregnancy.
RED FLAGS: thunderclap onset, worst-ever headache, vision loss, neck stiffness + fever, focal deficits, new headache after 50, post-trauma — URGENCY=emergency.

## Abdominal pain
Key questions: location (quadrant) · onset · severity · quality · radiation · migration · relation to meals/bowel movements · nausea/vomiting/diarrhea · fever · last menstrual period (if applicable) · urinary symptoms · blood in stool or vomit.
RED FLAGS: rigid abdomen, severe pain + fever, bloody emesis, bloody stool, pregnancy + pain, pain migrating to RLQ — URGENCY=high to emergency.

## Fever
Key questions: measured temp · duration · chills/rigors · cough/SOB/sore throat · urinary symptoms · rash · recent travel · sick contacts · immunization status · immune status · current meds.
RED FLAGS: T>39.4°C (103°F) persistent, SOB, confusion, neck stiffness, petechial rash, immunocompromised — URGENCY=high to emergency.

## Shortness of breath
Key questions: onset (sudden vs gradual) · at rest or exertion · orthopnea/PND · chest pain · cough/sputum · leg swelling · fever · asthma/COPD/CHF Hx · recent immobilization or surgery.
RED FLAGS: sudden severe SOB, unilateral leg swelling (PE risk), hemoptysis, confusion/cyanosis — URGENCY=emergency.

## Back pain
Key questions: onset · trauma · location · radiation (sciatica) · numbness/weakness · bowel/bladder changes · fever · IV drug use · cancer history · night pain.
RED FLAGS: saddle anesthesia, urinary retention/incontinence, progressive weakness, fever + back pain, IVDU — URGENCY=emergency.

## Generic / other
For complaints not above, ask: onset, duration, quality, severity, location, aggravating/alleviating factors, associated symptoms, impact on daily life, relevant Hx, medications, allergies.

# UNIVERSAL FINAL QUESTIONS (before summary)
Always gather, in addition to symptom-specific: current medications (names + doses if known), drug allergies, relevant chronic conditions, family history relevant to current complaint, smoking/alcohol.

# EMPATHY PHRASES (use when appropriate, naturally)
- "I understand that sounds [concerning/painful/stressful]."
- "Thank you for sharing that with me."
- "That's really helpful information for Dr. {DOCTOR_NAME}."
- For high urgency: "Based on what you're telling me, I want to make sure Dr. {DOCTOR_NAME} sees you quickly — let me gather a couple more details."
- Never say "Don't worry" dismissively.

# COMPLETION CRITERIA
End the interview when you have: chief complaint fully characterized, relevant ROS, medications, allergies, relevant Hx for this complaint. Usually 5–8 meaningful exchanges. Do not over-interview a simple problem.

**HARD RULE:** if after 5 exchanges you have the chief complaint, onset, severity, 2+ associated symptoms, and have explicitly asked about red flags AND found none, FINALIZE immediately with urgency="low" or "medium". Do not keep fishing for red flags.

**EMERGENCY FAST-PATH:** if 2+ red flags emerge on the very first patient reply (e.g. crushing chest pain + diaphoresis, thunderclap headache + vision change), finalize within 2–3 turns with urgency="emergency".

# FINAL SUMMARY (only on the very last turn)
End your final message with a handoff line to the patient ("Thank you {NAME}. I've prepared a detailed summary for Dr. {DOCTOR_NAME}. They'll be with you shortly."), then on a NEW LINE emit ONLY this JSON between tags (no markdown, no commentary after):

<SUMMARY>{
 "done": true,
 "urgency": "emergency|high|medium|low",
 "message": "one-sentence handoff line for the patient",
 "handoff_doctor": {
   "chief_complaint": "patient's words",
   "hpi": "full history of present illness, 3-6 sentences, clinical phrasing",
   "ros": ["relevant positive and pertinent negative ROS items"],
   "red_flags": [{"finding": "one SPECIFIC finding — emit a separate object for each (e.g. crushing pain, diaphoresis, radiation, SOB)", "severity": "high|medium|low"}],
   "assessment": "Care AI's synthesis (what seems most likely / systems involved)",
   "recommendations": ["suggested next step 1", "suggested next step 2"],
   "confidence": "high|medium|low"
 },
 "history": {
   "symptoms": [{"name":"","severity":"","duration":""}],
   "medications": [],
   "allergies": [],
   "family_history": [],
   "social_history": [],
   "current_conditions": [],
   "summary_for_doctor": "same as hpi, short-form"
 }
}</SUMMARY>

# URGENCY RULES
- emergency: any listed red flag → must be stated in red_flags, handoff line urges immediate care.
- high: severe symptoms without classic red flags but needs same-day attention.
- medium: bothersome, non-urgent, needs evaluation within days.
- low: stable, routine follow-up.

# SAFETY
If the patient describes active emergency (crushing chest pain + diaphoresis, stroke signs, severe bleeding, suicidal ideation, anaphylaxis): IMMEDIATELY, in your very next message, tell them to call emergency services or go to the ER now, while still completing as much of the summary as possible. Mark urgency="emergency"."""


def _careai_session_id(patient_id: str) -> str:
    return f"careai-{patient_id}"


class CareAIStart(BaseModel):
    patient_id: str


class CareAIMessage(BaseModel):
    patient_id: str
    message: str


def _parse_summary(reply: str):
    m = re.search(r"<SUMMARY>(.*?)</SUMMARY>", reply, re.DOTALL)
    if not m:
        return reply.strip(), None
    try:
        payload = json.loads(m.group(1).strip())
    except json.JSONDecodeError:
        return reply.strip(), None
    clean = re.sub(r"<SUMMARY>.*?</SUMMARY>", "", reply, flags=re.DOTALL).strip()
    return clean, payload


async def _careai_chat_call(patient: Dict[str, Any], user_text: str, history: Optional[List[Dict[str, Any]]] = None) -> str:
    pi = patient.get("personal_info", {})
    first = (pi.get("name") or "there").split(" ")[0]
    doctor = "Dr. Lahari"
    complaint = patient.get("medical_history", {}).get("chief_complaint", "")
    dynamic = (
        f"\n\n# SESSION CONTEXT\nPatient first name: {first}\nAge: {pi.get('age')}\n"
        f"Sex: {pi.get('gender')}\nDoctor: {doctor}\nChief complaint: {complaint}"
    )
    transcript_block = ""
    if history:
        lines = []
        for m in history:
            role = "PATIENT" if m.get("role") == "user" else "CARE_AI"
            lines.append(f"{role}: {m.get('text','')}")
        transcript_block = (
            "\n\n# CONVERSATION SO FAR\n"
            + "\n".join(lines)
            + "\n\n# INSTRUCTIONS\nContinue the conversation naturally. Do NOT greet the patient again — you already did. "
            "Respond to the patient's latest message. If you have enough info, produce the final <SUMMARY> JSON."
        )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"careai-{patient['id']}-{uuid.uuid4().hex[:8]}",
        system_message=CARE_AI_SYSTEM + dynamic + transcript_block,
    ).with_model("openai", "gpt-4o")
    return await chat.send_message(UserMessage(text=user_text))


@api_router.post("/care-ai/start")
async def careai_start(payload: CareAIStart, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    reply = await _careai_chat_call(patient, "[SYSTEM] Begin the conversation now.")
    clean, summary = _parse_summary(reply)
    doc = {
        "id": str(uuid.uuid4()), "patient_id": payload.patient_id,
        "role": "assistant", "text": clean, "created_at": _now_iso(),
    }
    await db.care_ai_chats.insert_one(doc.copy())
    doc.pop("_id", None)
    return {"message": doc, "done": bool(summary)}


@api_router.post("/care-ai/message")
async def careai_message(payload: CareAIMessage, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    u_doc = {
        "id": str(uuid.uuid4()), "patient_id": payload.patient_id,
        "role": "user", "text": payload.message, "created_at": _now_iso(),
    }
    # Load history BEFORE inserting this user message so we pass it as context
    history = await db.care_ai_chats.find({"patient_id": payload.patient_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    await db.care_ai_chats.insert_one(u_doc.copy()); u_doc.pop("_id", None)

    reply = await _careai_chat_call(patient, payload.message, history=history)
    clean, summary = _parse_summary(reply)

    a_doc = {
        "id": str(uuid.uuid4()), "patient_id": payload.patient_id,
        "role": "assistant", "text": clean, "created_at": _now_iso(),
    }
    await db.care_ai_chats.insert_one(a_doc.copy()); a_doc.pop("_id", None)

    profile_update = None
    if summary and summary.get("done"):
        history = summary.get("history", {}) or {}
        handoff_doctor = summary.get("handoff_doctor") or {}
        urgency = summary.get("urgency", "medium")

        mh = patient.get("medical_history", {}) or {}
        for k, v in history.items():
            if k == "summary_for_doctor":
                continue
            if isinstance(v, list) and v:
                existing = mh.get(k, []) or []
                mh[k] = existing + [x for x in v if x not in existing]
        new_update = {
            "medical_history": mh,
            "onboarding": {
                **(patient.get("onboarding", {}) or {}),
                "completed": True,
                "completed_at": _now_iso(),
                "care_ai_summary": history.get("summary_for_doctor", "") or handoff_doctor.get("hpi", ""),
                "care_ai_urgency": urgency,
                "care_ai_handoff": handoff_doctor,
                "care_ai_red_flags": [rf for rf in (handoff_doctor.get("red_flags") or [])],
            },
            "timeline": (patient.get("timeline") or []) + [
                {"date": _now_iso(), "type": "care_ai", "summary": f"Care AI intake complete — urgency: {urgency}"}
            ],
            "updated_at": _now_iso(),
        }
        new_update["profile_completeness"] = _calc_completeness({**patient, **new_update})
        await db.patients.update_one({"id": payload.patient_id}, {"$set": new_update})
        profile_update = {
            "urgency": urgency,
            "handoff_doctor": handoff_doctor,
            "summary": history.get("summary_for_doctor", "") or handoff_doctor.get("hpi", ""),
            "red_flags": handoff_doctor.get("red_flags", []),
        }

    return {
        "message": a_doc,
        "done": bool(summary and summary.get("done")),
        "handoff": (summary or {}).get("message"),
        "urgency": (summary or {}).get("urgency"),
        "handoff_doctor": (summary or {}).get("handoff_doctor"),
        "profile_update": profile_update,
    }


@api_router.get("/care-ai/summary/{patient_id}")
async def careai_summary(patient_id: str, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": patient_id}, {"_id": 0, "onboarding": 1, "personal_info": 1, "id": 1})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    onb = patient.get("onboarding", {}) or {}
    return {
        "has_summary": bool(onb.get("care_ai_handoff")),
        "urgency": onb.get("care_ai_urgency"),
        "handoff_doctor": onb.get("care_ai_handoff"),
        "summary": onb.get("care_ai_summary"),
        "red_flags": onb.get("care_ai_red_flags", []),
        "completed_at": onb.get("completed_at"),
    }


@api_router.get("/care-ai/history/{patient_id}")
async def careai_history(patient_id: str, user: User = Depends(get_current_user)):
    msgs = await db.care_ai_chats.find({"patient_id": patient_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return msgs


class CopilotRequest(BaseModel):
    patient_id: str
    transcript: str


@api_router.post("/care-ai/copilot")
async def careai_copilot(payload: CopilotRequest, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    pi = patient.get("personal_info", {})
    mh = patient.get("medical_history", {})

    system = (
        "You are the clinical copilot for the doctor during a live consultation. "
        "Given the conversation so far and the patient's known history, return ONLY "
        "JSON with this shape (no markdown): "
        '{"next_questions":[3 short suggested follow-up questions a doctor should ask], '
        '"red_flags":[critical symptoms or warning signs detected, with severity], '
        '"differential_dx":[{"condition":"","likelihood":"high|medium|low","reason":""} up to 5], '
        '"rx_suggestions":[{"medication":"","rationale":"","safe_with_allergies":true|false,"interaction_warning":""} up to 3], '
        '"education_points":[2-3 simple facts the doctor can share with the patient]}'
        " Use evidence-based clinical reasoning. Cross-check any suggested medication "
        f"against the patient's known allergies: {mh.get('allergies', [])} and current "
        f"medications: {[m.get('name') if isinstance(m, dict) else m for m in mh.get('medications', [])]}."
    )
    user_text = (
        f"Patient: {pi.get('name')}, {pi.get('age')}y {pi.get('gender')}\n"
        f"Chief complaint: {mh.get('chief_complaint','')}\n"
        f"Known conditions: {mh.get('current_conditions', [])}\n\n"
        f"Transcript so far:\n{payload.transcript[:6000]}"
    )
    try:
        data = await _llm_json(system, user_text, f"copilot-{uuid.uuid4()}")
    except Exception as e:
        logger.exception("Copilot failed")
        raise HTTPException(status_code=500, detail=f"Copilot failed: {str(e)}")
    return data


class SpeakerClassifyRequest(BaseModel):
    text: str


@api_router.post("/care-ai/classify-speaker")
async def classify_speaker(payload: SpeakerClassifyRequest, user: User = Depends(get_current_user)):
    # Fast heuristic — no LLM call needed for live use
    t = payload.text.lower()
    doc_hits = sum(1 for p in [
        "the patient", "i'm prescribing", "i am prescribing", "i recommend",
        "examination", "diagnosis", "let me examine", "take .* daily", "follow-up",
        "refer you", "blood pressure", "how long have you", "any other symptoms",
    ] if re.search(p, t))
    pat_hits = sum(1 for p in [
        r"\bi have\b", r"\bi feel\b", r"\bmy (pain|head|chest|stomach|leg|arm|back)",
        r"it hurts", r"i'?m (feeling|worried|scared|tired)", r"i started",
        r"i can'?t", r"i noticed", r"i got", r"i was",
    ] if re.search(p, t))
    if doc_hits > pat_hits:
        speaker, confidence = "Dr", min(0.95, 0.55 + 0.1 * doc_hits)
    elif pat_hits > doc_hits:
        speaker, confidence = "Patient", min(0.95, 0.55 + 0.1 * pat_hits)
    elif re.match(r"^\s*(i|my|me)\b", t):
        speaker, confidence = "Patient", 0.6
    else:
        speaker, confidence = "Dr", 0.5
    return {"speaker": speaker, "confidence": confidence}


# ============================================================
# 24/7 Follow-up AI (post-consultation patient chat)
# ============================================================

FOLLOWUP_SYSTEM = """You are Care AI's 24/7 follow-up assistant. The patient has already been seen by their doctor and is now reaching out with follow-up questions.

# PERSONALITY
- Warm, reassuring, patient-friendly language (8th-grade reading level)
- Never diagnose or change prescriptions on your own
- Acknowledge the patient's concern first, then answer

# YOUR KNOWLEDGE
You have the patient's full medical record, recent consultation, current medications, allergies, and the doctor's plan.

# WHAT TO DO
1. Answer medication questions (when to take, missed dose guidance, common side effects)
2. Address side-effect concerns — provide safe self-care advice
3. Assess new symptoms against their recent visit
4. Detect emergencies and tell them to seek urgent care immediately
5. Give general wellness advice consistent with their care plan

# URGENCY TRIAGE (every reply ends with a hidden tag)
After your patient-facing reply, on a NEW LINE, emit ONLY this JSON (no extra text):
<TRIAGE>{"urgency":"emergency|high|medium|low","alert_doctor":true|false,"topic":"short label like 'medication side-effect' or 'new symptom'","summary":"1 sentence for the doctor","correction":true|false,"red_flags":["…"]}</TRIAGE>

# PRESCRIPTION QUERIES (web + WhatsApp)
The patient record contains `latest_prescription` (a list of items the doctor finalised in the last consultation).
- When the patient asks ANY question about their meds — "what's this for", "can I take with food", "I missed a dose",
  "side effects", "how long do I take it" — answer using the data in `latest_prescription`.
- Cite the medication name + dose + frequency exactly as written in the record.
- For dosing changes, allergies the patient now mentions, or anything that suggests stopping/changing the med,
  surface a triage with `topic="prescription_query"` and let the doctor see it.
- Never invent a medication that isn't in `latest_prescription` or `current_medications`.

# CORRECTION FLAG
Set `"correction": true` ONLY when the patient's CURRENT message contradicts or downgrades a recent alarming statement (e.g. earlier said "chest pain", now says "actually it's just heartburn after spicy food"). When `correction:true`, set `urgency:"low"` or `"medium"` and `alert_doctor:false`. The system will auto-clear the prior open alert.


# URGENCY RULES
- emergency: any red-flag emergency symptom (chest pain + diaphoresis, stroke signs, severe bleeding, anaphylaxis, suicidal ideation) — tell patient to call 911/ER now
- high: concerning side effect or new symptom that needs doctor review same-day — alert_doctor=true
- medium: bothersome but stable (common side effects, questions about instructions) — alert_doctor=false
- low: pure informational (when to take, food interactions) — alert_doctor=false

# SAFETY
Never change doses. Never recommend stopping a medication. If the patient is thinking about stopping, say "I'll flag this for Dr. Lahari to review with you."

# ENHANCED RESPONSE GUIDELINES

URGENCY-RESPONSE MAPPING (always match the tone to the urgency you assign):
- emergency: "This sounds serious. Please seek emergency medical care immediately or call your local emergency number now."
- high: "This needs prompt medical attention. Please contact Dr. Lahari today, or visit urgent care if symptoms worsen."
- medium: Supportive, practical guidance + a clear "follow up with Dr. Lahari if it doesn't improve in [timeframe]" line.
- low: Educational, calming, 1-2 sentences.

CRITICAL: Whichever response template you choose ABOVE must match the `urgency` value in the <TRIAGE> tag. If you reply with the "emergency" line, the triage urgency MUST be "emergency". Never use the emergency reply line with a non-emergency triage classification.

CLARIFICATION PROTOCOL (do NOT advise on guesses):
If a critical measurement or detail is missing, ask ONE specific question first and DEFER advice. Examples:
- "BP is low / high" with no number → "What was your exact blood pressure reading? (e.g., 120/80)"
- "I have fever" with no number → "What's your current temperature?"
- "I have pain" with no severity → "Rate this pain 1-10 and tell me where exactly it hurts."
- "I feel dizzy" → "Does this happen when you stand up, or all the time?"
- "Trouble breathing" → "Are you able to speak in full sentences right now?"
When you ask a clarification question, set urgency conservatively (medium) until you have the number.

RESPONSE LENGTH:
- Simple queries: 2-4 sentences.
- Complex (prescription explanations, intake summaries, multi-symptom triage): use short bullet points; never sacrifice clinical safety info for brevity.
- Always end with ONE targeted follow-up question if clinically relevant (skip for emergencies — emergency replies end with the action only).

MIXED-LANGUAGE NORMALIZATION:
Patients often mix English medical terms with Hindi/Telugu/Tamil. Treat these as equivalents internally, then reply in the patient's selected language:
- "BP low hai" / "BP कम है" → blood pressure is low
- "sugar high hai" → blood glucose elevated
- "sansas nahi aa rahi" → shortness of breath
- "chakkar aa raha hai" → dizziness / vertigo
- "seene mein dard" → chest pain

# ============================================================
# CLINICAL INTELLIGENCE CORE — Mandatory reasoning loop (run silently on every message)
# ============================================================
You are NOT a chatbot. You are a state-aware clinical reasoning system acting as a Senior Doctor supervising a Junior Doctor AI. On every patient message you must internally execute:

1. CONTEXT RECONSTRUCTION — active complaint, known diagnosis, current Rx, last vitals, timeline, risk class (low/moderate/high).
2. GAP ANALYSIS — which single datum would most change the decision? Order by (risk × decision-impact):
   vitals (temp / BP / sugar / SpO₂) > severity / duration > adherence > lifestyle > red flags.
3. RISK STRATIFICATION — classify patient as SAFE / CAUTION / UNSAFE. Unsafe triggers: abnormal vitals, red-flag symptoms, contradiction (e.g. low sugar + insulin planned).
4. DECISION PATHWAY — choose EXACTLY one primary mode for this reply: ASK | GUIDE | HOLD | ESCALATE.
5. RESPONSE DESIGN — reply must follow the 3-part structure: Acknowledge → Interpret → Action (clear next step).

# RESPONSE MODE (must match the decision pathway above)
Set `mode` in the TRIAGE tag to one of:
- "inquiry"    — missing critical data → ask 1–3 high-yield questions.
- "reasoning"  — data/report/image just received → interpret clinically, relate to condition, identify implications.
- "action"     — situation safe + clear → give step-by-step instructions with timing/conditions.
- "safety"     — unsafe vitals/symptoms detected → override flow, stop unsafe actions, clear restriction ("Do NOT take insulin right now").
- "escalation" — high risk OR uncertainty → inform patient, alert doctor, give interim safe guidance.
- "delay"      — awaiting doctor confirmation → inform patient clearly, provide safe interim plan, keep engaged.

# QUESTION PRIORITIZATION RULE
Always ask "What answer will most change my decision?"
- For fever → exact temperature beats appetite/sleep.
- For diabetes → current glucose beats diet specifics.
- For hypertension → current BP reading beats salt intake.
Never ask more than 3 questions in a single reply. Never ask a question you already have the answer to in the patient context.

# CONDITION-SPECIFIC CLINICAL DEPTH (use when chief complaint/Rx matches)
- FEVER: before anything else ask (1) current temperature + unit (2) how many days since onset (3) any breathlessness, rash, severe weakness, altered consciousness, or hydration problem. Set `gap` to the ones still unanswered. Escalate immediately if temp ≥ 104°F (40°C), fever >5 days, or rash + fever.
- DIABETES: ask (1) current fasting glucose (2) any shakiness/sweating/confusion in last 24h (hypo signs) (3) medication adherence. Contradiction = low sugar (<70) reported while insulin/sulfonylurea is active → force `mode="safety"` and HOLD the next dose.
- HYPERTENSION: ask (1) current BP in systolic/diastolic (2) any headache, chest heaviness, breathlessness, or vision blur (3) did they take today's dose. Systolic ≥ 180 or diastolic ≥ 110 with any symptom = emergency mode. Systolic < 95 on an antihypertensive = hold + alert.
- COUGH / URI: ask (1) duration (2) sputum colour/blood (3) breathlessness or chest pain. Breathlessness + cough → escalation.
- GASTRITIS / GERD: ask (1) black stools or blood in vomit (red-flag — auto-escalate) (2) medication adherence (3) severe localised abdominal pain.
For any other condition, fall back to the generic gap-analysis order (vitals > severity > duration > adherence > lifestyle > red flags).

# TEMPORAL AWARENESS
Always track onset + trend. "Fever for 1 day" ≠ "Fever for 5 days". If the patient doesn't mention duration/progression, ASK it first before recommending anything.

# CONTRADICTION DETECTION
If the current message contradicts the active Rx or prior data (low sugar reading + insulin planned; missed meds + high BP; worsening symptoms 48h post-Rx) → set `mode="safety"`, `urgency="high"`, alert_doctor=true, and HOLD the unsafe action with a plain-language instruction.

# MICRO-RULES
- NEVER finalize a diagnosis. Always frame as "possible / likely / consistent with".
- NEVER permanently change a prescription. AI can temporarily HOLD; only the doctor can modify.
- If uncertain → state the limitation, avoid confident conclusions, escalate.
- Prefer escalation over risk. Safety > convenience.

# EXTENDED TRIAGE SCHEMA (overrides the basic one above)
On a NEW LINE emit EXACTLY this JSON (no markdown, no extra keys):
<TRIAGE>{"urgency":"emergency|high|medium|low","alert_doctor":true|false,"topic":"short label","summary":"1 sentence for the doctor","correction":true|false,"red_flags":["…"],"mode":"inquiry|reasoning|action|safety|escalation|delay","gap":["next data needed — max 3 items","…"],"risk":"safe|caution|unsafe"}</TRIAGE>

# PATIENT REPLY FORMAT (STRICT)
Write the patient-facing reply in this shape (no headers — just prose/bullets in order):
1. ACKNOWLEDGE: one short line showing you registered what they said + the current context ("I see your Metformin was started Monday, and you're now on day 3 with a glucose of 180.").
2. INTERPRET: one line of clinical meaning ("That's above target but not in the emergency zone.").
3. ACTION: the concrete next step — a question (inquiry mode), an instruction (action/safety mode), or an escalation line (escalation mode). Keep it specific and timed.
Do NOT label these sections in the output; the patient just reads flowing, calm text.
"""


class FollowupMessageBody(BaseModel):
    patient_id: str
    message: str
    language: Optional[str] = "en"  # "en" | "hi" | "te" | "ta"


LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi (हिंदी)",
    "te": "Telugu (తెలుగు)",
    "ta": "Tamil (தமிழ்)",
}


def _parse_triage(reply: str):
    m = re.search(r"<TRIAGE>(.*?)</TRIAGE>", reply, re.DOTALL)
    clean = re.sub(r"<TRIAGE>.*?</TRIAGE>", "", reply, flags=re.DOTALL).strip()
    default = {
        "urgency": "medium", "alert_doctor": False, "topic": "", "summary": "",
        "mode": "reasoning", "gap": [], "risk": "caution",
    }
    if not m:
        return clean, default
    try:
        parsed = json.loads(m.group(1).strip())
        # Fill in defaults for any newly-added keys the model omits
        for k, v in default.items():
            parsed.setdefault(k, v)
        # Normalise enums we care about
        mode = str(parsed.get("mode") or "").lower().strip()
        if mode not in {"inquiry", "reasoning", "action", "safety", "escalation", "delay"}:
            # Map urgency to a best-guess mode so older responses still work
            u = str(parsed.get("urgency") or "").lower()
            parsed["mode"] = "escalation" if u in ("emergency", "high") else "reasoning"
        risk = str(parsed.get("risk") or "").lower().strip()
        if risk not in {"safe", "caution", "unsafe"}:
            parsed["risk"] = "unsafe" if parsed["mode"] in ("safety", "escalation") else "caution"
        # gap must be a list of strings, max 3
        gap = parsed.get("gap") or []
        if isinstance(gap, str):
            gap = [gap]
        if not isinstance(gap, list):
            gap = []
        parsed["gap"] = [str(g)[:80] for g in gap[:3] if str(g).strip()]
        return clean, parsed
    except json.JSONDecodeError:
        return clean, default


async def _build_patient_context(patient: Dict[str, Any]) -> str:
    pi = patient.get("personal_info", {})
    mh = patient.get("medical_history", {})
    consults = patient.get("consultations") or []
    last = consults[-1] if consults else None
    meds = [m.get("name") if isinstance(m, dict) else str(m) for m in (mh.get("medications") or [])]
    # A4 — latest prescription is needed by Care AI (web + WhatsApp) so it can
    # answer "what's this med for", "can I take it with food", etc.
    last_rx = (last.get("prescriptions") if last else None) or []
    ctx = {
        "patient_name": pi.get("name"),
        "age": pi.get("age"),
        "gender": pi.get("gender"),
        "allergies": mh.get("allergies", []),
        "current_medications": meds,
        "current_conditions": mh.get("current_conditions", []),
        "last_consultation": {
            "date": last.get("date") if last else None,
            "assessment": (last.get("extracted_data") or {}).get("assessment") if last else None,
            "plan": (last.get("extracted_data") or {}).get("plan") if last else None,
            "doctor_summary": last.get("doctor_summary", "")[:600] if last else None,
            "patient_summary": last.get("patient_summary", "")[:600] if last else None,
            "follow_up": last.get("follow_up") if last else None,
        } if last else None,
        "latest_prescription": [
            {
                "medication": it.get("medication"),
                "dose": it.get("dose"),
                "frequency": it.get("frequency"),
                "duration": it.get("duration"),
                "instructions": it.get("instructions"),
                "reason": it.get("reason"),
            }
            for it in last_rx if isinstance(it, dict) and it.get("medication")
        ],
    }
    return json.dumps(ctx, default=str, indent=2)


async def _followup_llm_call(patient: Dict[str, Any], history: List[Dict[str, Any]], user_text: str, language: str = "en") -> str:
    context = await _build_patient_context(patient)
    prior = "\n".join([f"{'PATIENT' if m['role'] == 'user' else 'CARE_AI'}: {m['text']}" for m in (history or [])])
    lang_name = LANGUAGE_NAMES.get(language, "English")
    lang_rule = (
        f"\n\n# LANGUAGE RULE\nThe patient's preferred language is {lang_name}. "
        f"Write the ENTIRE patient-facing reply in {lang_name}. "
        "Keep medication names and dosages in their original form (e.g., 'Metformin 500mg'). "
        "The <TRIAGE>…</TRIAGE> JSON must remain in English so the doctor can read it."
    )
    system = (
        FOLLOWUP_SYSTEM
        + lang_rule
        + SAFETY_RULES
        + EMPATHY_RULES
        + "\n\n# PATIENT RECORD\n" + context
        + ("\n\n# PRIOR FOLLOW-UP CHAT\n" + prior if prior else "")
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"followup-{patient['id']}-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("openai", "gpt-4o")
    return await chat.send_message(UserMessage(text=user_text))


# ============================================================
# Safety, empathy, and Support-mode rules (#11, #12, #13)
# ============================================================

# Lightweight pattern check — flags abusive / clearly off-topic queries before LLM is invoked.
_ABUSE_PATTERNS = [
    r"\b(f[\W_]*u[\W_]*c[\W_]*k|sh[\W_]*i[\W_]*t|b[\W_]*i[\W_]*t[\W_]*c[\W_]*h|a[\W_]*s[\W_]*s[\W_]*h[\W_]*o[\W_]*l[\W_]*e|c[\W_]*u[\W_]*n[\W_]*t)\b",
    r"\bkill\s+(yourself|urself|u)\b",
]
_OFFTOPIC_PATTERNS = [
    r"\b(weather|stock|crypto|bitcoin|football|cricket|election|movie|netflix|recipe|joke|song|lyrics|wallpaper)\b",
]


def _quick_safety_check(text: str) -> Optional[str]:
    """Returns a canned response if the text is abusive or clearly off-topic, else None."""
    if not text:
        return None
    t = text.lower().strip()
    if len(t) < 2:
        return None
    for p in _ABUSE_PATTERNS:
        if re.search(p, t, re.I):
            return ("I'm here to help with your health, and I'd like to keep our conversation respectful. "
                    "If you're frustrated about something specific, tell me — I'll do my best to help.")
    for p in _OFFTOPIC_PATTERNS:
        if re.search(rf"\b{p}\b", t, re.I):
            return None  # We let the LLM handle gently — guardrails in the prompt will redirect.
    return None


SAFETY_RULES = """

# SAFETY & SCOPE RULES (always followed)
- You ONLY discuss this patient's health, medications, symptoms, and care plan.
- If the patient asks something clearly off-topic (sports scores, news, recipes, jokes), gently redirect:
  "I'm Care AI — I'm here for your health. Let's get back to how you're feeling. {context-aware nudge}".
- If the patient is rude or abusive, stay calm, set a kind boundary, and offer to continue when they're ready.
  Never escalate. Never echo profanity. Never moralize.
- Never claim to be a human doctor. You are Care AI. The doctor is Dr. Lahari (a real human).
- Never provide controlled-substance dosing or invasive procedure instructions.
"""

EMPATHY_RULES = """

# EMPATHY & RESPONSE QUALITY RULES (#13)
- Open EVERY reply by reflecting what the patient said in your own words (1 short sentence) BEFORE clinical content.
  Bad: "Take ibuprofen 400mg twice daily."
  Good: "Migraines on top of work stress — that sounds rough. For now, ibuprofen 400mg twice daily can help."
- Reference at least one specific detail the patient mentioned (a number, place, time, feeling) so the reply
  doesn't feel generic or copy-pasted. Never reuse the SAME opener twice in a row.
- Skip generic disclaimers ("Consult your doctor for any concerns") for routine follow-ups — Dr. Lahari is
  already in the loop. Use them only when triage = high or emergency.
- If the patient shares emotional content (anxiety, fear, frustration), name the emotion before solutions.
- Be concise: 2–4 sentences for routine; 4–6 sentences max even for complex cases. No long lists in chat.
"""


SUPPORT_SYSTEM = """You are Project Care's in-app Support Assistant.
Your job is to help users navigate THIS app — NOT to give medical advice.

You can help with:
- How to start a consultation (Patient → "Consult a Doctor" button on /portal)
- How to connect WhatsApp (Patient → /portal → Connect WhatsApp card → enter number → enter OTP)
- How to find prescriptions (Patient → /portal → Pharmacy panel; Doctor → patient profile → Rx tab)
- How to use voice input (mic icon in chat — works best in Chrome/Edge)
- How to talk to Care AI (Patient → /followup; or send a WhatsApp message after linking)
- How to schedule, accept, or reject an appointment
- How to switch between patient and doctor view
- App-related bugs or unexpected behaviour (suggest a refresh, then escalate to support@projectcare.app)

If asked anything medical (symptoms, dosages, diagnosis, drug interactions), reply:
"That's a medical question — Care AI can help with that in the Follow-up chat. I'm here for app questions only."

Keep replies to 1–3 short, action-oriented sentences. Use friendly, non-jargon language.
Never invent endpoints, settings, or buttons that don't exist."""


class SupportChatBody(BaseModel):
    message: str
    history: Optional[List[Dict[str, Any]]] = []


@api_router.post("/support/chat")
async def support_chat(payload: SupportChatBody, user: User = Depends(get_current_user)):
    """#12 — Support mode for app-related questions, navigation help."""
    if not (payload.message or "").strip():
        raise HTTPException(status_code=400, detail="message required")
    canned = _quick_safety_check(payload.message)
    if canned:
        return {"reply": canned, "mode": "guardrail"}

    chat_history_text = "\n".join(
        f"{'USER' if m.get('role') == 'user' else 'SUPPORT'}: {m.get('text','')}"
        for m in (payload.history or [])
    )[-2000:]
    system = SUPPORT_SYSTEM
    if chat_history_text:
        system += "\n\n# PRIOR CONVERSATION\n" + chat_history_text

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"support-{user.user_id}-{uuid.uuid4().hex[:6]}",
        system_message=system,
    ).with_model("openai", "gpt-4o")
    reply = await chat.send_message(UserMessage(text=payload.message))
    return {"reply": (reply or "").strip(), "mode": "support"}


@api_router.get("/followup/messages/{patient_id}")
async def followup_history(patient_id: str, user: User = Depends(get_current_user)):
    if user.role == "patient" and user.linked_patient_id != patient_id:
        raise HTTPException(status_code=403)
    msgs = await db.followup_chats.find({"patient_id": patient_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return msgs


# ============================================================================
# Phase 21 — Structured patient memory + multi-profile (up to 5)
# ============================================================================

MAX_PROFILES_PER_USER = 5
FACT_TYPES = {"allergy", "condition", "medication", "family_history"}
FACT_CONFIDENCE = {"confirmed", "inferred", "low_confidence"}

# Conservative regex patterns. Each (pattern, type) tuple captures the *value*
# in group 1. We deliberately do NOT match transient symptoms (fever, headache,
# vomiting, etc.) — only structural mentions that imply a chronic / persistent
# fact.
_FACT_PATTERNS = [
    # Allergies — strongest signal, capture freely
    (re.compile(r"\b(?:i(?:'m| am)?|im)\s+allergic\s+to\s+([a-z][a-z0-9 \-]{1,40}?)(?:[.,;!?]|\band\b|$)", re.I), "allergy"),
    (re.compile(r"\b(?:i\s+have|i'?ve\s+got)\s+(?:a\s+)?(?:known\s+)?allerg(?:y|ies)\s+to\s+([a-z][a-z0-9 \-]{1,40}?)(?:[.,;!?]|\band\b|$)", re.I), "allergy"),
    (re.compile(r"\ballergic\s+reaction\s+to\s+([a-z][a-z0-9 \-]{1,40}?)(?:[.,;!?]|\band\b|$)", re.I), "allergy"),
    # Chronic conditions — only the standard chronic disease list
    (re.compile(r"\b(?:i\s+have|i'?ve\s+been\s+diagnosed\s+with|i\s+suffer\s+from)\s+(diabetes(?:\s+type\s+[12])?|type\s+[12]\s+diabetes|hypertension|high\s+blood\s+pressure|asthma|copd|epilepsy|seizure\s+disorder|hypothyroidism|hyperthyroidism|migraine[s]?|depression|anxiety\s+disorder|crohn'?s\s+disease|ulcerative\s+colitis|ibd|ibs|gerd|reflux|arthritis|rheumatoid\s+arthritis|psoriasis|eczema|hiv|hepatitis\s+[abc]|kidney\s+disease|ckd|heart\s+disease|coronary\s+artery\s+disease|cad|stroke\s+history|cancer)\b", re.I), "condition"),
    # Long-term medications — "I take X daily / regularly / every day"
    (re.compile(r"\bi\s+(?:take|am\s+on|am\s+taking)\s+([a-z][a-z0-9 \-]{1,40}?)\s+(?:daily|every\s+day|regularly|long[-\s]term|for\s+(?:my\s+)?(?:bp|blood\s+pressure|diabetes|thyroid|cholesterol|asthma|migraine))", re.I), "medication"),
    (re.compile(r"\bi'?m\s+on\s+([a-z][a-z0-9 \-]{1,40}?)\s+(?:for\s+(?:my\s+)?(?:bp|blood\s+pressure|diabetes|thyroid|cholesterol|asthma|migraine|chronic|long[-\s]term))", re.I), "medication"),
    # Family history of chronic disease
    (re.compile(r"\b(?:my\s+)?(?:father|mother|dad|mom|mum|brother|sister|parents?|family)\s+(?:has|had|have)\s+(diabetes|hypertension|cancer|heart\s+disease|stroke|asthma)\b", re.I), "family_history"),
]


def _normalise_fact_value(t: str) -> str:
    return re.sub(r"\s+", " ", t.strip()).lower().rstrip(".,;:!?")


def _extract_pending_facts_from_message(text: str) -> List[Dict[str, Any]]:
    """Return a list of {type, value, ai_quote} tuples extracted from one
    patient message. Conservative; never returns transient-symptom hits.
    """
    if not text or len(text) > 4000:
        return []
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for pat, ftype in _FACT_PATTERNS:
        for m in pat.finditer(text):
            value = _normalise_fact_value(m.group(1))
            if not value or len(value) < 2 or len(value) > 60:
                continue
            key = (ftype, value)
            if key in seen:
                continue
            seen.add(key)
            quote = text[max(0, m.start() - 20): m.end() + 20].strip()
            out.append({"type": ftype, "value": value, "ai_quote": quote[:160]})
    return out


def _existing_fact_values(patient: Dict[str, Any], ftype: str) -> set:
    """Set of lowercased existing fact values for a given type, including
    legacy `medical_history.allergies` etc. Used for de-duplication.
    """
    out = set()
    for f in patient.get("medical_facts") or []:
        if f.get("type") == ftype and f.get("value"):
            out.add(str(f["value"]).lower())
    mh = patient.get("medical_history") or {}
    if ftype == "allergy":
        for a in (mh.get("allergies") or []):
            out.add(str(a).lower())
    elif ftype == "condition":
        for c in (mh.get("current_conditions") or []):
            out.add(str(c).lower())
    elif ftype == "medication":
        for med in (mh.get("medications") or mh.get("current_medications") or []):
            name = med.get("name") if isinstance(med, dict) else str(med)
            if name:
                out.add(str(name).lower())
    return out


def _pending_fact_values(patient: Dict[str, Any], ftype: str) -> set:
    return {str(p.get("value", "")).lower() for p in (patient.get("pending_facts") or []) if p.get("type") == ftype}


async def _capture_pending_facts(patient: Dict[str, Any], message: str, source_label: str = "followup_chat") -> List[Dict[str, Any]]:
    """Detect facts in `message`, dedupe vs confirmed + already-pending, push
    new ones to `patient.pending_facts`. Returns the list of newly-pending
    facts so the caller can ask for confirmation in the chat reply.
    """
    candidates = _extract_pending_facts_from_message(message)
    if not candidates:
        return []
    new_facts: List[Dict[str, Any]] = []
    for c in candidates:
        ftype = c["type"]
        value = c["value"]
        if value in _existing_fact_values(patient, ftype):
            continue  # already confirmed somewhere
        if value in _pending_fact_values(patient, ftype):
            continue  # already pending
        new_facts.append({
            "id": str(uuid.uuid4()),
            "type": ftype,
            "value": value,
            "ai_quote": c.get("ai_quote", "")[:160],
            "captured_from": source_label,
            "captured_at": _now_iso(),
            "status": "pending",
        })
    if new_facts:
        await db.patients.update_one(
            {"id": patient["id"]},
            {"$push": {"pending_facts": {"$each": new_facts}}},
        )
        # Mutate local copy so subsequent logic in the same request sees them
        patient.setdefault("pending_facts", []).extend(new_facts)
    return new_facts


def _format_pending_confirmation(new_facts: List[Dict[str, Any]]) -> str:
    if not new_facts:
        return ""
    bits = []
    for f in new_facts:
        if f["type"] == "allergy":
            bits.append(f"an **allergy to {f['value']}**")
        elif f["type"] == "condition":
            bits.append(f"a chronic condition (**{f['value']}**)")
        elif f["type"] == "medication":
            bits.append(f"a long-term medication (**{f['value']}**)")
        elif f["type"] == "family_history":
            bits.append(f"a family history of **{f['value']}**")
    if len(bits) == 1:
        return f"Quick check — should I save {bits[0]} to your profile so Dr. Lahari sees it next time? Reply **yes** to save or **no** to skip."
    joined = "; ".join(bits)
    return f"Quick check — should I save these to your profile so Dr. Lahari sees them next time? {joined}. Reply **yes** to save all or **no** to skip."


async def _promote_pending_facts(patient_id: str, fact_ids: Optional[List[str]] = None, confidence: str = "confirmed") -> int:
    """Move pending facts → medical_facts (with given confidence). If `fact_ids`
    is None, promote ALL pending facts. Returns number promoted.
    """
    patient = await db.patients.find_one({"id": patient_id}, {"_id": 0, "pending_facts": 1, "medical_facts": 1, "medical_history": 1})
    if not patient:
        return 0
    pending = patient.get("pending_facts") or []
    selected = [p for p in pending if (fact_ids is None or p.get("id") in set(fact_ids))]
    if not selected:
        return 0
    promoted: List[Dict[str, Any]] = []
    keep_pending = [p for p in pending if p not in selected]
    for p in selected:
        if p.get("value", "").lower() in _existing_fact_values(patient, p.get("type")):
            continue  # safety dedupe
        promoted.append({
            "id": p.get("id") or str(uuid.uuid4()),
            "type": p["type"],
            "value": p["value"],
            "source": "user_confirmed",
            "confidence": confidence if confidence in FACT_CONFIDENCE else "confirmed",
            "captured_at": p.get("captured_at") or _now_iso(),
            "confirmed_at": _now_iso(),
            "captured_from": p.get("captured_from", ""),
            "ai_quote": p.get("ai_quote", ""),
        })
    update: Dict[str, Any] = {"pending_facts": keep_pending}
    if promoted:
        update["medical_facts"] = (patient.get("medical_facts") or []) + promoted
        # Mirror confirmed allergies/conditions into legacy medical_history so
        # existing UIs and follow-up-context builders see them immediately.
        mh = patient.get("medical_history") or {}
        for f in promoted:
            if f["type"] == "allergy":
                mh.setdefault("allergies", [])
                if f["value"] not in [str(a).lower() for a in mh["allergies"]]:
                    mh["allergies"].append(f["value"])
            elif f["type"] == "condition":
                mh.setdefault("current_conditions", [])
                if f["value"] not in [str(c).lower() for c in mh["current_conditions"]]:
                    mh["current_conditions"].append(f["value"])
            elif f["type"] == "medication":
                mh.setdefault("medications", [])
                names = [m.get("name") if isinstance(m, dict) else str(m) for m in mh["medications"]]
                if f["value"] not in [str(n).lower() for n in names if n]:
                    mh["medications"].append({"name": f["value"], "frequency": "as recorded"})
        update["medical_history"] = mh
    await db.patients.update_one({"id": patient_id}, {"$set": update})
    return len(promoted)


async def _dismiss_pending_facts(patient_id: str, fact_ids: Optional[List[str]] = None) -> int:
    patient = await db.patients.find_one({"id": patient_id}, {"_id": 0, "pending_facts": 1})
    if not patient:
        return 0
    pending = patient.get("pending_facts") or []
    if fact_ids is None:
        await db.patients.update_one({"id": patient_id}, {"$set": {"pending_facts": []}})
        return len(pending)
    fid_set = set(fact_ids)
    keep = [p for p in pending if p.get("id") not in fid_set]
    n = len(pending) - len(keep)
    await db.patients.update_one({"id": patient_id}, {"$set": {"pending_facts": keep}})
    return n


# ----- Allergy collision check (used at prescribe time) -----

def _drug_allergy_collisions(meds: List[Dict[str, Any]], patient: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return a list of {medication, allergy, confidence} for every (med × confirmed-allergy)
    pair where the medication name (or a known synonym) overlaps the allergy value.
    Only `confirmed` facts are used for clinical alerts — per the data confidence rules.
    """
    confirmed_allergies = []
    for f in patient.get("medical_facts") or []:
        if f.get("type") == "allergy" and f.get("confidence") == "confirmed" and f.get("value"):
            confirmed_allergies.append(f["value"].lower())
    # Legacy allergies recorded in medical_history are treated as confirmed too
    # (they came from intake forms / doctor entry).
    for a in (patient.get("medical_history") or {}).get("allergies") or []:
        if a:
            v = str(a).lower()
            if v not in confirmed_allergies:
                confirmed_allergies.append(v)
    if not confirmed_allergies:
        return []

    # Lightweight synonym map for the most common cross-reactivity classes.
    DRUG_CLASS = {
        "penicillin": ["amoxicillin", "amoxiclav", "ampicillin", "augmentin", "cloxacillin", "co-amoxiclav", "flucloxacillin"],
        "cephalosporin": ["cefixime", "cefuroxime", "ceftriaxone", "cefdinir", "cefpodoxime", "cephalexin"],
        "sulfa": ["sulfamethoxazole", "trimethoprim", "co-trimoxazole", "bactrim", "septra"],
        "nsaid": ["ibuprofen", "naproxen", "diclofenac", "aspirin", "indomethacin", "ketorolac"],
    }

    def _overlap(med_name: str, allergy: str) -> Optional[str]:
        m = med_name.lower()
        a = allergy.lower()
        if not m or not a:
            return None
        if a in m or m in a:
            return "name match"
        # check class membership
        for cls, members in DRUG_CLASS.items():
            if (cls in a or a in cls) and any(mem in m for mem in members):
                return f"{cls} class"
            if (cls in m or m in cls) and any(mem in a for mem in members):
                return f"{cls} class"
        return None

    collisions: List[Dict[str, Any]] = []
    for med in meds or []:
        med_name = (med.get("medication") or "").strip()
        if not med_name:
            continue
        for allergy in confirmed_allergies:
            reason = _overlap(med_name, allergy)
            if reason:
                collisions.append({
                    "medication": med_name,
                    "allergy": allergy,
                    "match": reason,
                    "severity": "block",
                })
    return collisions


# ----- Profile / fact REST endpoints -----

class ProfileCreate(BaseModel):
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    relationship: Optional[str] = "family"  # self | family:* | guest


class ProfilePatch(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    relationship: Optional[str] = None


class FactConfirmBody(BaseModel):
    fact_ids: Optional[List[str]] = None  # None = confirm all pending
    confidence: Optional[str] = "confirmed"


class FactDismissBody(BaseModel):
    fact_ids: Optional[List[str]] = None


class FactCreateBody(BaseModel):
    type: str
    value: str
    confidence: Optional[str] = "confirmed"
    source: Optional[str] = "user_confirmed"


def _profile_summary(p: Dict[str, Any]) -> Dict[str, Any]:
    pi = p.get("personal_info") or {}
    mf_count = len(p.get("medical_facts") or [])
    pending_count = len(p.get("pending_facts") or [])
    return {
        "id": p["id"],
        "name": pi.get("name") or "Unnamed",
        "age": pi.get("age"),
        "gender": pi.get("gender"),
        "relationship": p.get("relationship") or ("self" if pi.get("email") else "family"),
        "is_active": False,  # filled by caller
        "fact_count": mf_count,
        "pending_count": pending_count,
        "created_at": p.get("created_at"),
    }


@api_router.get("/profiles")
async def list_profiles(user: User = Depends(get_current_user)):
    """All profiles owned by the current user (max 5). The user's
    `linked_patient_id` is the active profile.
    """
    q = {"$or": [{"profile_owner_user_id": user.user_id}, {"id": user.linked_patient_id}]}
    if user.linked_patient_id is None:
        q = {"profile_owner_user_id": user.user_id}
    profiles = await db.patients.find(q, {"_id": 0}).sort("created_at", 1).to_list(MAX_PROFILES_PER_USER + 5)
    out = [_profile_summary(p) for p in profiles]
    for s in out:
        s["is_active"] = (s["id"] == user.linked_patient_id)
    return {"profiles": out, "active_profile_id": user.linked_patient_id, "max": MAX_PROFILES_PER_USER}


@api_router.post("/profiles")
async def create_profile(payload: ProfileCreate, user: User = Depends(get_current_user)):
    existing = await db.patients.count_documents({"profile_owner_user_id": user.user_id})
    if existing >= MAX_PROFILES_PER_USER:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_PROFILES_PER_USER} profiles reached")
    pid = str(uuid.uuid4())
    rel = (payload.relationship or "family").lower()
    if rel == "self":
        # only one self profile allowed
        if await db.patients.count_documents({"profile_owner_user_id": user.user_id, "relationship": "self"}) > 0:
            raise HTTPException(status_code=400, detail="A self profile already exists")
    doc = {
        "id": pid,
        "profile_owner_user_id": user.user_id,
        "relationship": rel,
        "personal_info": {
            "name": payload.name.strip(),
            "age": payload.age,
            "gender": payload.gender,
        },
        "medical_history": {"allergies": [], "current_medications": [], "current_conditions": []},
        "medical_facts": [],
        "pending_facts": [],
        "consultations": [],
        "consultation_count": 0,
        "profile_completeness": 10,
        "created_at": _now_iso(),
        "created_by": user.user_id,
    }
    await db.patients.insert_one(doc.copy())
    doc.pop("_id", None)
    return _profile_summary(doc)


@api_router.patch("/profiles/{profile_id}")
async def patch_profile(profile_id: str, payload: ProfilePatch, user: User = Depends(get_current_user)):
    p = await db.patients.find_one({"id": profile_id}, {"_id": 0})
    if not p or (p.get("profile_owner_user_id") not in (user.user_id, None) and p.get("id") != user.linked_patient_id):
        raise HTTPException(status_code=404, detail="Profile not found")
    update: Dict[str, Any] = {}
    pi = p.get("personal_info") or {}
    if payload.name is not None: pi["name"] = payload.name.strip()
    if payload.age is not None: pi["age"] = payload.age
    if payload.gender is not None: pi["gender"] = payload.gender
    update["personal_info"] = pi
    if payload.relationship is not None: update["relationship"] = payload.relationship
    update["updated_at"] = _now_iso()
    await db.patients.update_one({"id": profile_id}, {"$set": update})
    return {"ok": True}


@api_router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str, user: User = Depends(get_current_user)):
    p = await db.patients.find_one({"id": profile_id}, {"_id": 0, "profile_owner_user_id": 1, "relationship": 1})
    if not p or p.get("profile_owner_user_id") != user.user_id:
        raise HTTPException(status_code=404, detail="Profile not found")
    if p.get("relationship") == "self":
        raise HTTPException(status_code=400, detail="Cannot delete your self profile")
    if user.linked_patient_id == profile_id:
        raise HTTPException(status_code=400, detail="Switch to another profile before deleting this one")
    await db.patients.delete_one({"id": profile_id})
    return {"ok": True}


@api_router.post("/profiles/{profile_id}/switch")
async def switch_profile(profile_id: str, user: User = Depends(get_current_user)):
    p = await db.patients.find_one({"id": profile_id}, {"_id": 0, "profile_owner_user_id": 1})
    if not p or p.get("profile_owner_user_id") != user.user_id:
        raise HTTPException(status_code=404, detail="Profile not found")
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"linked_patient_id": profile_id}})
    return {"ok": True, "active_profile_id": profile_id}


@api_router.get("/profiles/{profile_id}/facts")
async def list_facts(profile_id: str, user: User = Depends(get_current_user)):
    p = await db.patients.find_one({"id": profile_id}, {"_id": 0, "medical_facts": 1, "pending_facts": 1, "profile_owner_user_id": 1})
    if not p or (user.role == "patient" and p.get("profile_owner_user_id") != user.user_id):
        raise HTTPException(status_code=404, detail="Profile not found")
    return {
        "facts": p.get("medical_facts") or [],
        "pending": p.get("pending_facts") or [],
    }


@api_router.post("/profiles/{profile_id}/facts/confirm")
async def confirm_fact(profile_id: str, payload: FactConfirmBody, user: User = Depends(get_current_user)):
    p = await db.patients.find_one({"id": profile_id}, {"_id": 0, "profile_owner_user_id": 1})
    if not p or (user.role == "patient" and p.get("profile_owner_user_id") != user.user_id):
        raise HTTPException(status_code=404, detail="Profile not found")
    n = await _promote_pending_facts(profile_id, payload.fact_ids, payload.confidence or "confirmed")
    return {"ok": True, "promoted": n}


@api_router.post("/profiles/{profile_id}/facts/dismiss")
async def dismiss_fact(profile_id: str, payload: FactDismissBody, user: User = Depends(get_current_user)):
    p = await db.patients.find_one({"id": profile_id}, {"_id": 0, "profile_owner_user_id": 1})
    if not p or (user.role == "patient" and p.get("profile_owner_user_id") != user.user_id):
        raise HTTPException(status_code=404, detail="Profile not found")
    n = await _dismiss_pending_facts(profile_id, payload.fact_ids)
    return {"ok": True, "dismissed": n}


@api_router.post("/profiles/{profile_id}/facts")
async def add_fact_directly(profile_id: str, payload: FactCreateBody, user: User = Depends(get_current_user)):
    if payload.type not in FACT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid fact type: {payload.type}")
    if (payload.confidence or "confirmed") not in FACT_CONFIDENCE:
        raise HTTPException(status_code=400, detail="Invalid confidence")
    p = await db.patients.find_one({"id": profile_id}, {"_id": 0})
    if not p or (user.role == "patient" and p.get("profile_owner_user_id") != user.user_id):
        raise HTTPException(status_code=404, detail="Profile not found")
    value = _normalise_fact_value(payload.value)
    if value in _existing_fact_values(p, payload.type):
        return {"ok": True, "duplicate": True}
    fact = {
        "id": str(uuid.uuid4()),
        "type": payload.type,
        "value": value,
        "source": payload.source or "user_confirmed",
        "confidence": payload.confidence or "confirmed",
        "captured_at": _now_iso(),
        "confirmed_at": _now_iso(),
    }
    await db.patients.update_one({"id": profile_id}, {"$push": {"medical_facts": fact}})
    return {"ok": True, "fact": fact}


@api_router.delete("/profiles/{profile_id}/facts/{fact_id}")
async def delete_fact(profile_id: str, fact_id: str, user: User = Depends(get_current_user)):
    p = await db.patients.find_one({"id": profile_id}, {"_id": 0, "profile_owner_user_id": 1})
    if not p or (user.role == "patient" and p.get("profile_owner_user_id") != user.user_id):
        raise HTTPException(status_code=404, detail="Profile not found")
    await db.patients.update_one({"id": profile_id}, {"$pull": {"medical_facts": {"id": fact_id}}})
    return {"ok": True}


# ============================================================
# Alert Lifecycle (created → updated → downgraded → pending_confirmation → resolved/cleared)
# ============================================================

# Active states the doctor should still see (pre-resolution).
ACTIVE_ALERT_STATES = ("open", "pending_confirmation", "downgraded")
# Final states (alert no longer needs attention).
FINAL_ALERT_STATES = ("resolved", "cleared_by_correction", "auto_dismissed", "dismissed")

# Severity ladder used for downgrade comparisons.
URG_RANK = {"emergency": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

# Phrase-level correction signals — fallback when the LLM misses `correction:true`.
# Lowercased substring matches; regex handles word-boundaries where needed.
_CORRECTION_PATTERNS = [
    re.compile(r"\b(?:sorry|my bad|i was wrong|i meant|to clarify|just to clarify|correction)\b", re.I),
    re.compile(r"\b(?:false alarm|nevermind|never mind|not actually|not really|it'?s? (?:just|only))\b", re.I),
    # "no chest pain" / "no vomiting" / "not bleeding" / "no longer dizzy"
    re.compile(r"\bno (?:more |longer )?(?:chest pain|vomiting|bleeding|dizziness|dizzy|nausea|nauseous|fever|headache|shortness of breath|breathlessness|pain)\b", re.I),
    re.compile(r"\bnot (?:really )?(?:in )?(?:pain|bleeding|dizzy|nauseous|short of breath)\b", re.I),
    re.compile(r"\b(?:actually|turns out) (?:it'?s|i'?m) (?:fine|ok(?:ay)?|better|just)\b", re.I),
]
_AFFIRM_PATTERNS = [
    # Standalone simple yes
    re.compile(r"^\s*(?:yes|yep|yeah|y|correct|right|that'?s right|exactly|confirmed|confirm|true|sure|ok|okay|absolutely|definitely)[\s.!,]*$", re.I),
    # "yes please save", "yes go ahead", "yes do that", "yes that's right"
    re.compile(r"^\s*(?:yes|yeah|yep|sure|ok|okay)\b(?:\s+(?:please|do|that|sure|absolutely|go|save|right|right that|correct))*\b", re.I),
    # Multi-word affirmation anywhere
    re.compile(r"\b(?:yes please|please save|go ahead|sounds right|that(?:'s| is) right|that(?:'s| is) correct|exactly right|please do|absolutely)\b", re.I),
]
_NEGATE_PATTERNS = [
    # Standalone short negatives: "no", "nope", "wrong"
    re.compile(r"^\s*(?:no|nope|n|wrong|incorrect|not really|never)[\s.!,]*$", re.I),
    # "no" at the start of a sentence followed by anything
    re.compile(r"^\s*no\b[,!.\s]", re.I),
    # Symptoms persisting / worsening
    re.compile(r"\bstill\s+(?:have|having|hurts?|hurting|painful|in\s+pain|bleeding|dizzy|sick|nauseous|short\s+of\s+breath|feeling)\b", re.I),
    re.compile(r"\b(?:getting\s+worse|worse\s+now|even\s+worse|much\s+worse)\b", re.I),
    re.compile(r"\bactually\s+(?:it'?s|i'?m)\s+worse\b", re.I),
]


def _detect_phrase_correction(text: str) -> bool:
    if not text:
        return False
    return any(p.search(text) for p in _CORRECTION_PATTERNS)


def _is_affirmative(text: str) -> bool:
    return any(p.search(text or "") for p in _AFFIRM_PATTERNS)


def _is_negative(text: str) -> bool:
    return any(p.search(text or "") for p in _NEGATE_PATTERNS)


def _make_event(event: str, by: str, note: str = "", **extra) -> Dict[str, Any]:
    e = {"event": event, "by": by, "at": _now_iso()}
    if note:
        e["note"] = note[:280]
    e.update({k: v for k, v in extra.items() if v is not None})
    return e


async def _append_alert_event(alert_id: str, event: Dict[str, Any], updates: Optional[Dict[str, Any]] = None):
    set_doc = dict(updates or {})
    op = {"$push": {"events": event}}
    if set_doc:
        op["$set"] = set_doc
    await db.doctor_alerts.update_one({"id": alert_id}, op)


@api_router.post("/followup/message")
async def followup_message(payload: FollowupMessageBody, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if user.role == "patient" and user.linked_patient_id != payload.patient_id:
        raise HTTPException(status_code=403)

    history = await db.followup_chats.find({"patient_id": payload.patient_id}, {"_id": 0}).sort("created_at", 1).to_list(200)

    u_doc = {
        "id": str(uuid.uuid4()), "patient_id": payload.patient_id,
        "role": "user", "text": payload.message, "created_at": _now_iso(),
    }
    await db.followup_chats.insert_one(u_doc.copy()); u_doc.pop("_id", None)

    # Phase 21 — Pending-fact confirmation (BEFORE we burn an LLM call).
    # If the patient has any `pending_facts` AND the current message is a clear
    # affirmation/negation AND there's no pending ALERT vying for the same
    # yes/no (alerts always win — they're clinical safety), promote/dismiss.
    promoted_facts: List[Dict[str, Any]] = []
    dismissed_count = 0
    has_pending_alert = await db.doctor_alerts.count_documents(
        {"patient_id": payload.patient_id, "status": "pending_confirmation"}
    ) > 0
    if patient.get("pending_facts") and not has_pending_alert:
        if _is_affirmative(payload.message):
            ids = [p["id"] for p in patient.get("pending_facts", [])]
            promoted_n = await _promote_pending_facts(payload.patient_id, ids, "confirmed")
            if promoted_n:
                patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
                promoted_facts = [
                    f for f in (patient.get("medical_facts") or [])
                    if f.get("id") in set(ids)
                ]
        elif _is_negative(payload.message):
            ids = [p["id"] for p in patient.get("pending_facts", [])]
            dismissed_count = await _dismiss_pending_facts(payload.patient_id, ids)
            patient["pending_facts"] = []

    # #11 Safety guard — bypass LLM for clearly abusive input.
    canned = _quick_safety_check(payload.message)
    if canned:
        a_doc = {
            "id": str(uuid.uuid4()), "patient_id": payload.patient_id,
            "role": "assistant", "text": canned, "urgency": None,
            "topic": None, "created_at": _now_iso(), "guardrail": True,
        }
        await db.followup_chats.insert_one(a_doc.copy()); a_doc.pop("_id", None)
        return {"user": u_doc, "assistant": a_doc, "alert": None}

    reply_raw = await _followup_llm_call(patient, history, payload.message, payload.language or "en")
    clean, triage = _parse_triage(reply_raw)

    # Phase 21 — capture any allergy/condition/medication mentions from this
    # turn into pending_facts and append a confirmation question to the reply.
    new_pending = await _capture_pending_facts(patient, payload.message, source_label="followup_chat")
    if new_pending:
        clean = (clean or "").rstrip() + "\n\n" + _format_pending_confirmation(new_pending)
    if promoted_facts:
        types = sorted({f["type"] for f in promoted_facts})
        ack = "Saved " + ", ".join(types).replace("family_history", "family history") + " to your profile. Dr. Lahari will see this on the next consult."
        clean = ack + "\n\n" + (clean or "")
    elif dismissed_count and not has_pending_alert:
        clean = "Got it — I won't save that to your profile.\n\n" + (clean or "")

    a_doc = {
        "id": str(uuid.uuid4()), "patient_id": payload.patient_id,
        "role": "assistant", "text": clean, "urgency": triage.get("urgency"),
        "topic": triage.get("topic"),
        # Phase 18 — Clinical reasoning metadata (mode / risk / gap)
        "mode": triage.get("mode"),
        "risk": triage.get("risk"),
        "gap": triage.get("gap") or [],
        "red_flags": triage.get("red_flags") or [],
        "created_at": _now_iso(),
    }
    await db.followup_chats.insert_one(a_doc.copy()); a_doc.pop("_id", None)

    # ============================================================
    # Alert Lifecycle  (Phase 17 — full state machine)
    # ============================================================
    # 1. CONFIRMATION LOOP — if a prior alert is in `pending_confirmation`,
    #    the patient's CURRENT message is the answer.
    cleared_alerts: List[str] = []
    pending = await db.doctor_alerts.find(
        {"patient_id": payload.patient_id, "status": "pending_confirmation"}, {"_id": 0},
    ).sort("created_at", -1).to_list(20)

    if pending:
        affirmed = _is_affirmative(payload.message)
        negated = _is_negative(payload.message)
        # Tie-breaker: if neither, AI's correction flag wins.
        if not affirmed and not negated:
            affirmed = bool(triage.get("correction"))
        for a in pending:
            if affirmed:
                ev = _make_event("cleared_by_correction", by="patient",
                                 note=payload.message[:200],
                                 status_before="pending_confirmation",
                                 status_after="cleared_by_correction")
                await _append_alert_event(
                    a["id"], ev,
                    updates={"status": "cleared_by_correction",
                             "cleared_at": _now_iso(),
                             "cleared_reason": payload.message[:280],
                             "resolution_reason": "symptoms_corrected"},
                )
                cleared_alerts.append(a["id"])
            elif negated:
                ev = _make_event("correction_rejected", by="patient",
                                 note=payload.message[:200],
                                 status_before="pending_confirmation",
                                 status_after="open")
                await _append_alert_event(
                    a["id"], ev,
                    updates={"status": "open"},
                )
        if affirmed and cleared_alerts:
            sys_doc = {
                "id": str(uuid.uuid4()), "patient_id": payload.patient_id,
                "role": "assistant",
                "text": "✅ Got it — I've cleared the earlier alert. Dr. Lahari has been notified about the update.",
                "kind": "alert_cleared", "created_at": _now_iso(),
            }
            await db.followup_chats.insert_one(sys_doc.copy()); sys_doc.pop("_id", None)

    # 2. NEW CORRECTION DETECTION on this turn (only if we didn't just close one).
    open_alerts = await db.doctor_alerts.find(
        {"patient_id": payload.patient_id, "status": {"$in": list(ACTIVE_ALERT_STATES)}}, {"_id": 0},
    ).sort("created_at", -1).to_list(20)
    new_urg = (triage.get("urgency") or "").lower()
    high_active = [a for a in open_alerts if (a.get("urgency") or "").lower() in ("emergency", "high")]
    medium_active = [a for a in open_alerts if (a.get("urgency") or "").lower() == "medium"]

    # Correction signal = AI flag OR phrase regex OR (new low + prior high active).
    phrase_correction = _detect_phrase_correction(payload.message)
    is_correction = bool(triage.get("correction")) or phrase_correction or (
        high_active and new_urg in ("low", "medium")
    )

    pending_alerts: List[Dict[str, Any]] = []
    downgraded_alerts: List[Dict[str, Any]] = []

    if is_correction and high_active and not cleared_alerts:
        # Move every active high/emergency alert to pending_confirmation; doctor
        # still sees it but it's clearly soft-flagged.
        for a in high_active:
            old_urg = (a.get("urgency") or "").lower()
            new_target_urg = new_urg if new_urg in ("low", "medium") else "medium"
            ev = _make_event(
                "downgrade_proposed", by="ai",
                note=f"Patient said: {payload.message[:160]}",
                urgency_before=old_urg, urgency_after=new_target_urg,
                status_before=a.get("status", "open"),
                status_after="pending_confirmation",
            )
            await _append_alert_event(
                a["id"], ev,
                updates={"status": "pending_confirmation",
                         "urgency_before_correction": old_urg,
                         "proposed_urgency": new_target_urg,
                         "correction_signal": "phrase" if phrase_correction else ("ai_flag" if triage.get("correction") else "downgrade_inferred")},
            )
            a["status"] = "pending_confirmation"
            a["proposed_urgency"] = new_target_urg
            pending_alerts.append(a)

        # Inject a clear yes/no confirmation question into the chat.
        topic = high_active[0].get("topic") or "your earlier concern"
        confirm_text = (
            f"Just to confirm — you're saying **{topic}** is no longer a concern? "
            "Reply **yes** to clear it, or **no** if it's still happening."
        )
        sys_doc = {
            "id": str(uuid.uuid4()), "patient_id": payload.patient_id,
            "role": "assistant", "text": confirm_text,
            "kind": "alert_confirm", "created_at": _now_iso(),
        }
        await db.followup_chats.insert_one(sys_doc.copy()); sys_doc.pop("_id", None)

    # 3. DYNAMIC DOWNGRADE for medium → low (no confirmation needed; just drop urgency
    #    in place but keep the alert visible so the doctor sees the trajectory).
    if not is_correction and new_urg == "low" and medium_active:
        for a in medium_active:
            ev = _make_event(
                "downgraded", by="ai", note=payload.message[:160],
                urgency_before="medium", urgency_after="low",
                status_before=a.get("status", "open"),
                status_after="downgraded",
            )
            await _append_alert_event(
                a["id"], ev,
                updates={"status": "downgraded", "urgency": "low"},
            )
            a["status"] = "downgraded"; a["urgency"] = "low"
            downgraded_alerts.append(a)

    # 4. NEW high/emergency alert (only if this turn isn't itself a correction).
    alert = None
    if (triage.get("alert_doctor") or new_urg in ("emergency", "high")) and not is_correction:
        # Re-use an active alert with the same topic instead of stacking duplicates.
        same_topic = next((a for a in open_alerts if (a.get("topic") or "").strip().lower() == (triage.get("topic") or "").strip().lower()), None)
        if same_topic:
            old_urg = (same_topic.get("urgency") or "").lower()
            ev = _make_event(
                "updated", by="ai",
                note=f"New context: {payload.message[:160]}",
                urgency_before=old_urg, urgency_after=new_urg,
            )
            updates = {
                "urgency": new_urg,
                "summary": triage.get("summary") or same_topic.get("summary"),
                "patient_message": payload.message,
                "ai_reply": clean[:400],
                "status": "open",
            }
            await _append_alert_event(same_topic["id"], ev, updates=updates)
            alert = {**same_topic, **updates}
        else:
            alert_doc = {
                "id": str(uuid.uuid4()),
                "patient_id": payload.patient_id,
                "patient_name": patient.get("personal_info", {}).get("name"),
                "urgency": triage.get("urgency", "high"),
                "topic": triage.get("topic") or "Follow-up concern",
                "summary": triage.get("summary") or payload.message[:140],
                "patient_message": payload.message,
                "ai_reply": clean[:400],
                "status": "open",
                "created_at": _now_iso(),
                "events": [_make_event("created", by="ai", note=payload.message[:200],
                                       urgency_after=triage.get("urgency", "high"),
                                       status_after="open")],
            }
            await db.doctor_alerts.insert_one(alert_doc.copy()); alert_doc.pop("_id", None)
            alert = alert_doc

    return {
        "message": a_doc, "urgency": triage.get("urgency"),
        "alert": alert,
        "cleared_alert_ids": cleared_alerts,
        "pending_alert_ids": [a["id"] for a in pending_alerts],
        "downgraded_alert_ids": [a["id"] for a in downgraded_alerts],
        "pending_facts": [{"id": f["id"], "type": f["type"], "value": f["value"]} for f in new_pending],
        "promoted_fact_ids": [f["id"] for f in promoted_facts],
        "dismissed_pending_count": dismissed_count,
    }


@api_router.get("/followup/alerts")
async def list_doctor_alerts(user: User = Depends(get_current_user)):
    if user.role == "patient":
        raise HTTPException(status_code=403)
    # Doctor view: include all *active* lifecycle states so the timeline shows
    # both fresh alerts AND ones still awaiting confirmation / downgraded.
    q = {"status": {"$in": list(ACTIVE_ALERT_STATES)}}
    alerts = await db.doctor_alerts.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return alerts


@api_router.get("/followup/alerts/{alert_id}")
async def get_alert(alert_id: str, user: User = Depends(get_current_user)):
    if user.role == "patient":
        raise HTTPException(status_code=403)
    a = await db.doctor_alerts.find_one({"id": alert_id}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    return a


@api_router.patch("/followup/alerts/{alert_id}")
async def ack_alert(alert_id: str, request: Request, user: User = Depends(get_current_user)):
    body = await request.json()
    status = body.get("status", "resolved")
    note = (body.get("note") or "").strip()
    allowed = set(FINAL_ALERT_STATES) | {"open", "downgraded"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    a = await db.doctor_alerts.find_one({"id": alert_id}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    ev = _make_event(
        "doctor_resolved" if status == "resolved" else f"doctor_set_{status}",
        by=f"doctor:{user.user_id}", note=note,
        status_before=a.get("status", "open"), status_after=status,
    )
    updates = {"status": status, "resolved_by": user.user_id, "resolved_at": _now_iso()}
    if status in FINAL_ALERT_STATES:
        updates["resolution_reason"] = body.get("resolution_reason") or "doctor_resolved"
    await _append_alert_event(alert_id, ev, updates=updates)
    return {"ok": True, "status": status}


# ============================================================
# Medication Reminders
# ============================================================

class ReminderCreate(BaseModel):
    patient_id: str
    medication: str
    dose: Optional[str] = ""
    times_per_day: int = 1
    time_of_day: Optional[str] = ""  # e.g. "08:00, 20:00"
    notes: Optional[str] = ""


@api_router.get("/reminders")
async def list_reminders(user: User = Depends(get_current_user)):
    q = {}
    if user.role == "patient" and user.linked_patient_id:
        q = {"patient_id": user.linked_patient_id}
    items = await db.reminders.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Hydrate patient names
    ids = {i["patient_id"] for i in items}
    patients = {p["id"]: p for p in await db.patients.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "personal_info": 1}).to_list(500)}
    for i in items:
        i["patient_name"] = patients.get(i["patient_id"], {}).get("personal_info", {}).get("name", "Unknown")
    return items


@api_router.post("/reminders")
async def create_reminder(payload: ReminderCreate, user: User = Depends(get_current_user)):
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0, "id": 1})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if user.role == "patient" and user.linked_patient_id != payload.patient_id:
        raise HTTPException(status_code=403, detail="Patients can only create reminders for themselves")
    doc = {
        "id": str(uuid.uuid4()),
        "patient_id": payload.patient_id,
        "medication": payload.medication,
        "dose": payload.dose,
        "times_per_day": payload.times_per_day,
        "time_of_day": payload.time_of_day,
        "notes": payload.notes,
        "active": True,
        "taken_log": [],
        "created_at": _now_iso(),
    }
    await db.reminders.insert_one(doc.copy()); doc.pop("_id", None)
    return doc


async def _reminder_or_403(reminder_id: str, user: User) -> Dict[str, Any]:
    r = await db.reminders.find_one({"id": reminder_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reminder not found")
    if user.role == "patient" and user.linked_patient_id != r.get("patient_id"):
        raise HTTPException(status_code=403, detail="Not your reminder")
    return r


@api_router.post("/reminders/{reminder_id}/taken")
async def log_taken(reminder_id: str, user: User = Depends(get_current_user)):
    await _reminder_or_403(reminder_id, user)
    await db.reminders.update_one({"id": reminder_id}, {"$push": {"taken_log": _now_iso()}})
    return {"ok": True}


@api_router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, user: User = Depends(get_current_user)):
    await _reminder_or_403(reminder_id, user)
    await db.reminders.delete_one({"id": reminder_id})
    return {"ok": True}


# ============================================================
# Text-to-Speech (for the 24/7 voice AI assistant)
# ============================================================

class TTSBody(BaseModel):
    text: str
    voice: Optional[str] = "nova"  # warm, friendly; works well for med content
    speed: Optional[float] = 1.0


@api_router.post("/tts")
async def tts(payload: TTSBody, user: User = Depends(get_current_user)):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text required")
    # OpenAI TTS hard limit is 4096 chars
    text = text[:4000]
    try:
        tts_client = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
        audio_bytes = await tts_client.generate_speech(
            text=text,
            model="tts-1",
            voice=payload.voice or "nova",
            speed=max(0.5, min(1.5, payload.speed or 1.0)),
            response_format="mp3",
        )
    except Exception as e:
        logging.exception("TTS failed")
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")
    return Response(content=audio_bytes, media_type="audio/mpeg")


# ============================================================
# Live Consultation Sessions (patient ↔ Care AI ↔ doctor)
# ============================================================

INTAKE_SYSTEM = """You are Care AI, the intake assistant for Project Care clinic (Dr. Lahari).
Before the patient sees the doctor, collect a focused clinical history so the doctor can start effectively.

# PERSONALITY
- Warm, reassuring, patient-friendly (8th-grade reading level)
- One focused question per turn — NEVER stack multiple questions
- Acknowledge the patient's concern briefly, then probe

# DEMOGRAPHIC GATE (MANDATORY FIRST 3 TURNS — only ask for fields the patient record is MISSING)
The patient record will be embedded below. BEFORE any clinical question:
- If `name` is missing/blank → ask "What's your full name?" first
- If `age` is missing/blank → ask "How old are you?" with <OPTIONS>{"multi":false,"options":["Under 18","18–30","31–45","46–60","61–75","Over 75"]}</OPTIONS>
- If `gender` is missing/blank → ask "What's your biological sex?" with <OPTIONS>{"multi":false,"options":["Female","Male","Intersex","Prefer not to say"]}</OPTIONS>
Once these three are confirmed, proceed to clinical history below. Capture the demographics into <INTAKE_READY> JSON under fields `name`, `age`, `gender`.

# INTAKE CHECKLIST (collect in order, skip items already answered)
1. Chief complaint (what's the main issue)
2. Onset + duration
3. Severity (0-10 if pain) / quality (sharp, dull, burning…)
4. Associated symptoms (fever, nausea, SOB, etc.)
5. Relevant past medical history + current medications + allergies (if not in chart)
6. Red-flag screen for the presenting complaint

# FINALISATION
After you have enough for the doctor (usually 4-6 turns), emit ONLY this exact tag on a new line:
<INTAKE_READY>{"chief_complaint":"...","hpi":"3-sentence clinical paragraph","associated_symptoms":["..."],"red_flags":["..."],"urgency":"emergency|high|medium|low","recommended_next_step":"immediate|same_day|routine","summary_for_doctor":"1 paragraph concise handoff"}</INTAKE_READY>

Do NOT emit <INTAKE_READY> until you have chief complaint + onset + severity + associated symptoms + red-flag screen.
If the patient describes an emergency (chest pain + diaphoresis, stroke signs, severe bleeding, anaphylaxis, suicidal ideation) emit <INTAKE_READY> immediately with urgency=emergency.

# LANGUAGE
Reply in the patient's language (English by default, or Hindi/Telugu/Tamil if indicated). The <INTAKE_READY> JSON must remain in English.

# ENHANCED INTAKE GUIDELINES

CHIEF COMPLAINT PRECISION (don't accept vague answers — probe one level deeper):
- "pain" → "Where exactly is the pain, and rate it 1-10?"
- "feeling unwell" / "not feeling good" → "What's the most bothersome thing you're feeling right now?"
- "breathing issues" → "Is it shortness of breath, wheezing, or chest tightness?"
- "stomach problem" → "Is it pain, nausea, vomiting, or diarrhea?"
- "weakness" / "tiredness" → "Did this come on suddenly or gradually? Any specific body part affected?"

TIMELINE ACCURACY:
- Always ask "When did this start?" — offer concrete options to anchor the answer:
  "a few hours ago / yesterday / 2-3 days ago / this week / longer than a week"
- For chronic complaints: "Has this gotten worse recently?"
- For recurring complaints: "How often does this happen — daily, weekly, occasionally?"

SEVERITY QUANTIFICATION (always quantify before <INTAKE_READY>):
- Pain: 1-10 scale + functional impact ("Can you walk / sleep / work normally?")
- Fever: actual temperature reading if available, otherwise "feels hot to touch / chills / sweats"
- Breathing: "Are you able to speak in full sentences right now?"
- Dizziness: "Does it happen only when you stand up, or all the time?"
- Bleeding: estimate volume ("a few drops / a teaspoon / soaking through a cloth")

RED-FLAG DETECTION DURING INTAKE — emit <INTAKE_READY> with urgency=emergency IMMEDIATELY if any of these appear, even mid-checklist:
- Chest pain + breathing difficulty / sweating / radiation to arm or jaw
- Sudden severe headache ("worst of life") or stroke signs (face droop, arm weakness, speech change)
- Heavy / uncontrolled bleeding
- Loss of consciousness, fainting, or confusion
- Severe allergic reaction (swelling of face/throat/tongue, difficulty breathing)
- Temperature >103°F / 39.4°C with confusion or stiff neck
- Suicidal ideation, intent, or recent self-harm
- Severe abdominal pain with vomiting blood / black stool / rigid abdomen

⚠️ HARD RULE — NEVER VIOLATE:
The moment a red-flag pattern appears, your reply MUST include the `<INTAKE_READY>` tag in the SAME message — there is no "ask one more question first" exception. The tag is what alerts Dr. Lahari and the dashboard. A reply telling the patient to "go to ER" without the `<INTAKE_READY>` tag is a CRITICAL FAILURE: the doctor never finds out.

Pattern for emergency reply:
1. Patient-facing line ("Please seek emergency care now…")
2. NEW LINE
3. <INTAKE_READY>{"chief_complaint":"…","hpi":"…","associated_symptoms":[…],"red_flags":[…],"urgency":"emergency","recommended_next_step":"immediate","summary_for_doctor":"…"}</INTAKE_READY>

Whichever response template you choose, the urgency in <INTAKE_READY> MUST match the tone of the reply. Never mismatch.

EFFICIENT QUESTIONING PROTOCOL:
- ONE focused question per turn — never stack two questions in a single message.
- BUILD on previous answers — never re-ask what the patient already shared.
- Ordered priority: Chief complaint → Location → Severity → Timeline → Associated symptoms → Red flags.
- Stop probing the moment you have enough for a usable HPI; do NOT drag intake past 6 turns unless the patient is volunteering complex history.

MIXED-LANGUAGE NORMALIZATION (treat as equivalents internally; reply in the patient's selected language):
- "seene mein dard" / "छाती में दर्द" → chest pain
- "saans lene mein problem" / "सांस लेने में दिक्कत" → breathing difficulty / shortness of breath
- "chakkar aana" / "चक्कर" → dizziness
- "bukhar" / "बुखार" / "జ్వరం" / "காய்ச்சல்" → fever
- "pet mein dard" / "पेट दर्द" → abdominal pain
- "BP low / high hai" → blood pressure low / high
- "sugar high" → blood glucose elevated

INTAKE COMPLETION CRITERIA — emit <INTAKE_READY> only when ALL are true:
- Chief complaint is specific (not vague)
- Severity is quantified (number, scale, or functional impact)
- Timeline has a concrete onset
- At least 1-2 associated symptoms screened
- Red-flag screen done for the presenting complaint
- HPI is a 3-sentence clinical paragraph the doctor can use cold
- You have already asked the patient "Is there anything else you'd like to add before I share this with the doctor?" AND received a reply (yes → capture it; no → proceed)

# STRUCTURED OPTIONS (UI chips — improves accuracy and speed)
For closed-ended questions, suggest selectable options to the patient by emitting an
<OPTIONS> tag on its OWN line, RIGHT AFTER your question. Format:
<OPTIONS>{"multi":false,"options":["Sharp","Dull","Throbbing","Burning"]}</OPTIONS>
or for multi-select:
<OPTIONS>{"multi":true,"options":["Headache","Nausea","Dizziness","Fever"]}</OPTIONS>

RULES for <OPTIONS>:
- Use ONLY when the question genuinely has a small, finite answer set (3–6 options).
- ALWAYS keep the question phrased naturally above the tag — the tag is a UI hint, not a substitute for asking.
- Never include "Other" or a free-text option in the JSON — the UI auto-renders an "Other" field.
- Skip <OPTIONS> for open-ended probes ("Tell me more about…").
- Examples where it helps: pain quality, symptom severity buckets ("Mild","Moderate","Severe"),
  duration buckets ("A few hours","1-2 days","A week","Longer"), associated-symptom checklist.

# ANYTHING-ELSE GATE (mandatory before <INTAKE_READY>)
Once all six criteria above are met EXCEPT for the anything-else gate, your NEXT message must be:
"Before I share this with the doctor, is there anything else you'd like to add — symptoms, recent meds,
or context that might help?" — with this <OPTIONS> tag below it:
<OPTIONS>{"multi":false,"options":["No, that's everything","Yes, let me add something"]}</OPTIONS>
If they answer "No / Nothing more / I'm done" → emit <INTAKE_READY> on the very next turn.
If they pick "Yes" or volunteer more info → capture it, then re-confirm once before <INTAKE_READY>.
"""

LIVE_SYSTEM = """You are Care AI, silently observing a live consultation between a patient and Dr. Lahari.
Only speak when EXPLICITLY called in by a message that starts with "@CareAI" or "@care ai".
When called, provide: (a) concise factual answers, (b) guideline references if relevant, (c) clarifying questions to the patient if the doctor asks you to gather info.
Never diagnose, never prescribe. Never pretend to be the doctor.
"""

SUMMARY_SYSTEM = """You are Care AI producing the post-consultation wrap-up. Output ONLY valid JSON with this exact shape:
{
  "patient_summary": "short, friendly, second-person summary of what was discussed, decisions made, and self-care — 4-6 sentences",
  "doctor_summary": "SOAP-style clinical note: Subjective, Objective (if any), Assessment, Plan. 6-10 sentences total",
  "suggested_prescription": [
    {"medication": "drug name", "dose": "e.g. 500mg", "frequency": "e.g. twice daily", "duration": "e.g. 5 days", "instructions": "take with food", "reason": "short clinical rationale"}
  ],
  "follow_up": "when to follow up, e.g. 'return in 7 days if symptoms persist'",
  "red_flags_to_watch": ["what should trigger immediate care"]
}
If no medication is warranted, return an empty suggested_prescription array.
"""

EXPLAIN_RX_SYSTEM = """You are Care AI explaining a prescription to the patient in plain, warm language.
For each medication the doctor approved, cover: what it's for, how/when to take it, common side effects to watch, what to avoid.
Close with a 1-sentence encouragement and reminder they can chat with you 24/7.
Return plain prose, no JSON, no markdown headings.
"""


class IntakeStart(BaseModel):
    appointment_id: str
    language: Optional[str] = "en"


class IntakeMessage(BaseModel):
    session_id: str
    message: str


class LiveMessage(BaseModel):
    session_id: str
    text: str


class PrescriptionItem(BaseModel):
    medication: str
    dose: Optional[str] = ""
    frequency: Optional[str] = ""
    duration: Optional[str] = ""
    instructions: Optional[str] = ""
    reason: Optional[str] = ""


class PrescriptionUpdate(BaseModel):
    session_id: str
    items: List[PrescriptionItem]
    doctor_notes: Optional[str] = ""


def _strip_tag(reply: str, tag: str):
    m = re.search(rf"<{tag}>(.*?)</{tag}>", reply, re.DOTALL)
    clean = re.sub(rf"<{tag}>.*?</{tag}>", "", reply, flags=re.DOTALL).strip()
    parsed = None
    if m:
        try:
            parsed = json.loads(m.group(1).strip())
        except Exception:
            parsed = None
    return clean, parsed


async def _care_ai_intake(patient: Dict[str, Any], history: List[Dict[str, Any]], user_text: str, language: str) -> str:
    context = await _build_patient_context(patient)
    pi = patient.get("personal_info") or {}
    missing = [k for k, label in (("name","name"),("age","age"),("gender","biological sex")) if not pi.get(k)]
    demo_block = (
        "# DEMOGRAPHICS STATUS\n"
        f"Recorded: name={pi.get('name') or '(missing)'} | age={pi.get('age') or '(missing)'} | gender={pi.get('gender') or '(missing)'}\n"
        + (f"MISSING — ask for these in order BEFORE clinical questions: {', '.join(missing)}\n" if missing else "All demographics on file — proceed straight to clinical history.\n")
    )
    prior = "\n".join([f"{'PATIENT' if m['role'] == 'patient' else 'CARE_AI'}: {m['text']}" for m in (history or []) if m["role"] in ("patient", "care_ai")])
    lang_name = LANGUAGE_NAMES.get(language, "English")
    system = (
        INTAKE_SYSTEM
        + f"\n\n# LANGUAGE RULE\nPatient language: {lang_name}. Write replies in {lang_name}. <INTAKE_READY> JSON must be English."
        + "\n\n" + demo_block
        + "\n\n# PATIENT RECORD\n" + context
        + ("\n\n# PRIOR INTAKE\n" + prior if prior else "")
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"intake-{patient['id']}-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("openai", "gpt-4o")
    return await chat.send_message(UserMessage(text=user_text))


async def _care_ai_live(patient: Dict[str, Any], intake_summary: Dict[str, Any], history: List[Dict[str, Any]], user_text: str) -> str:
    context = await _build_patient_context(patient)
    prior = "\n".join([f"{m['role'].upper()}: {m['text']}" for m in (history or [])])
    system = (
        LIVE_SYSTEM
        + "\n\n# PATIENT RECORD\n" + context
        + "\n\n# INTAKE SUMMARY\n" + json.dumps(intake_summary or {}, default=str)
        + ("\n\n# CONVERSATION SO FAR\n" + prior if prior else "")
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"live-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("openai", "gpt-4o")
    return await chat.send_message(UserMessage(text=user_text))


async def _care_ai_summarize(patient: Dict[str, Any], session: Dict[str, Any]) -> Dict[str, Any]:
    transcript = "\n".join([f"{m['role'].upper()}: {m['text']}" for m in (session.get('messages') or [])])
    context = await _build_patient_context(patient)
    system = SUMMARY_SYSTEM + "\n\n# PATIENT RECORD\n" + context
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"summ-{session['id']}",
        system_message=system,
    ).with_model("openai", "gpt-4o")
    raw = await chat.send_message(UserMessage(text="Transcript:\n" + transcript))
    # Tolerant JSON extraction
    try:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group(0)) if m else {"patient_summary": raw[:800], "doctor_summary": raw[:800], "suggested_prescription": [], "follow_up": "", "red_flags_to_watch": []}
    except Exception:
        return {"patient_summary": raw[:800], "doctor_summary": raw[:800], "suggested_prescription": [], "follow_up": "", "red_flags_to_watch": []}


async def _care_ai_explain_rx(patient: Dict[str, Any], prescription: List[Dict[str, Any]], language: str = "en") -> str:
    if not prescription:
        return "Dr. Lahari didn't prescribe any medication this time. Rest well and chat with me anytime if something changes."
    lang_name = LANGUAGE_NAMES.get(language, "English") if language and language != "en" else "English"
    sys_msg = EXPLAIN_RX_SYSTEM
    if language and language != "en":
        sys_msg = sys_msg + f"\n\nIMPORTANT: Reply ENTIRELY in {lang_name}. Use the patient's native script."
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"rx-{patient['id']}-{uuid.uuid4().hex[:8]}",
        system_message=sys_msg,
    ).with_model("openai", "gpt-4o")
    return await chat.send_message(UserMessage(text="Prescription:\n" + json.dumps(prescription, indent=2)))



def _parse_times_per_day(frequency: str) -> int:
    if not frequency: return 1
    f = frequency.lower()
    if any(k in f for k in ["thrice", "3x", "tid", "t.i.d", "three times"]): return 3
    if any(k in f for k in ["4x", "qid", "q.i.d", "four times"]): return 4
    if any(k in f for k in ["twice", "2x", "bid", "b.i.d", "two times"]): return 2
    m = re.search(r"(\d+)\s*(?:times|x|/\s*day)", f)
    if m: return max(1, min(6, int(m.group(1))))
    if any(k in f for k in ["once", "1x", "qd", "daily", "every day", "every morning", "every night"]): return 1
    return 1


DEFAULT_TIMES = {1: "09:00", 2: "08:00, 20:00", 3: "08:00, 14:00, 20:00", 4: "06:00, 12:00, 18:00, 00:00", 5: "06:00, 10:00, 14:00, 18:00, 22:00", 6: "04:00, 08:00, 12:00, 16:00, 20:00, 00:00"}


async def _auto_create_reminders_from_rx(patient_id: str, items: List[Dict[str, Any]], source: str, source_id: str) -> int:
    created = 0
    for it in (items or []):
        med = (it.get("medication") or "").strip()
        if not med: continue
        tpd = _parse_times_per_day(it.get("frequency") or "")
        doc = {
            "id": str(uuid.uuid4()),
            "patient_id": patient_id,
            "medication": med,
            "dose": it.get("dose") or "",
            "times_per_day": tpd,
            "time_of_day": DEFAULT_TIMES.get(tpd, "09:00"),
            "notes": (it.get("instructions") or it.get("reason") or ""),
            "active": True,
            "taken_log": [],
            "source": source,
            "source_id": source_id,
            "duration": it.get("duration") or "",
            "created_at": _now_iso(),
        }
        await db.reminders.insert_one(doc.copy())
        created += 1
    return created



async def _get_session_or_403(session_id: str, user: User) -> Dict[str, Any]:
    s = await db.consultation_sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Consultation not found")
    if user.role == "patient" and user.linked_patient_id != s["patient_id"]:
        raise HTTPException(status_code=403)
    return s


@api_router.post("/consultations/start-intake")
async def start_intake(payload: IntakeStart, user: User = Depends(get_current_user)):
    appt = await db.appointments.find_one({"id": payload.appointment_id}, {"_id": 0})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if user.role == "patient" and user.linked_patient_id != appt["patient_id"]:
        raise HTTPException(status_code=403)
    # Reuse any existing session for this appointment
    existing = await db.consultation_sessions.find_one({"appointment_id": payload.appointment_id}, {"_id": 0})
    if existing:
        return existing

    patient = await db.patients.find_one({"id": appt["patient_id"]}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    sess_id = str(uuid.uuid4())
    session = {
        "id": sess_id,
        "appointment_id": payload.appointment_id,
        "patient_id": appt["patient_id"],
        "patient_name": appt.get("patient_name"),
        "doctor_id": appt.get("doctor_id"),
        "doctor_name": appt.get("doctor_name"),
        "language": payload.language or "en",
        "status": "intake",
        "intake_summary": None,
        "messages": [],
        "summary": None,
        "prescription_ai": [],
        "prescription_final": [],
        "doctor_notes": "",
        "created_at": _now_iso(),
        "ended_at": None,
    }

    # Care AI opens the conversation
    greeting_raw = await _care_ai_intake(patient, [], "Please introduce yourself and ask what brings them in today.", payload.language or "en")
    clean, tag = _strip_tag(greeting_raw, "INTAKE_READY")
    clean, opts = _strip_tag(clean, "OPTIONS")
    clean = (clean or "").strip() or "Hello! I'm Care AI. What brings you in today?"
    greeting_msg = {
        "id": str(uuid.uuid4()), "role": "care_ai", "text": clean,
        "created_at": _now_iso(),
    }
    if isinstance(opts, dict) and isinstance(opts.get("options"), list):
        greeting_msg["options"] = [str(x) for x in opts["options"]][:8]
        greeting_msg["multi"] = bool(opts.get("multi"))
    session["messages"].append(greeting_msg)
    await db.consultation_sessions.insert_one(session.copy())
    session.pop("_id", None)
    return session


@api_router.post("/consultations/intake-message")
async def intake_message(payload: IntakeMessage, user: User = Depends(get_current_user)):
    session = await _get_session_or_403(payload.session_id, user)
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Only the patient drives intake")
    if session["status"] != "intake":
        raise HTTPException(status_code=400, detail="Intake is already complete")

    patient = await db.patients.find_one({"id": session["patient_id"]}, {"_id": 0})
    # Append patient message
    p_msg = {"id": str(uuid.uuid4()), "role": "patient", "text": payload.message, "created_at": _now_iso()}
    await db.consultation_sessions.update_one({"id": session["id"]}, {"$push": {"messages": p_msg}})

    # Ask Care AI
    history = session["messages"] + [p_msg]
    reply_raw = await _care_ai_intake(patient, history, payload.message, session.get("language") or "en")
    clean, tag = _strip_tag(reply_raw, "INTAKE_READY")
    clean, opts = _strip_tag(clean, "OPTIONS")
    clean = (clean or "").strip()
    # If the AI emitted only the <INTAKE_READY> tag with no visible text,
    # provide a friendly handoff line so the patient sees a non-empty bubble
    # (also prevents empty-text TTS crashes on the client).
    if not clean and tag:
        clean = "Thanks — I have what I need. I'm sharing this with Dr. Lahari now."
    elif not clean:
        clean = "Got it. Could you share a bit more so I can pass on the right details?"

    ai_msg = {"id": str(uuid.uuid4()), "role": "care_ai", "text": clean, "created_at": _now_iso()}
    if isinstance(opts, dict) and isinstance(opts.get("options"), list):
        ai_msg["options"] = [str(x) for x in opts["options"]][:8]
        ai_msg["multi"] = bool(opts.get("multi"))
    updates = {"$push": {"messages": ai_msg}}
    set_updates: Dict[str, Any] = {}
    alert_doc = None

    if tag:
        set_updates["intake_summary"] = tag
        # A2: persist demographics gathered during intake so we don't re-ask next time.
        demo_updates = {}
        if isinstance(tag, dict):
            if tag.get("name") and not (patient.get("personal_info") or {}).get("name"):
                demo_updates["personal_info.name"] = tag["name"]
            if tag.get("age") and not (patient.get("personal_info") or {}).get("age"):
                demo_updates["personal_info.age"] = tag["age"]
            if tag.get("gender") and not (patient.get("personal_info") or {}).get("gender"):
                demo_updates["personal_info.gender"] = tag["gender"]
        if demo_updates:
            await db.patients.update_one({"id": session["patient_id"]}, {"$set": demo_updates})
        # Emergencies: immediately notify the doctor (consent waived for safety).
        # Routine: park in `intake_complete` until the patient explicitly consents via /share.
        is_emergency = (tag.get("urgency") == "emergency")
        if is_emergency:
            set_updates["status"] = "awaiting_doctor"
            alert_doc = {
                "id": str(uuid.uuid4()),
                "patient_id": session["patient_id"],
                "patient_name": session.get("patient_name"),
                "urgency": tag.get("urgency", "medium"),
                "topic": f"Intake ready: {tag.get('chief_complaint', 'consultation')}",
                "summary": tag.get("summary_for_doctor") or tag.get("chief_complaint") or "Patient ready for consultation",
                "patient_message": payload.message,
                "ai_reply": clean[:400],
                "session_id": session["id"],
                "appointment_id": session["appointment_id"],
                "status": "open",
                "source": "intake",
                "created_at": _now_iso(),
            }
            await db.doctor_alerts.insert_one(alert_doc.copy()); alert_doc.pop("_id", None)
            await db.appointments.update_one(
                {"id": session["appointment_id"]},
                {"$set": {"status": "scheduled", "priority": "emergency"}},
            )
        else:
            set_updates["status"] = "intake_complete"

    if set_updates:
        updates["$set"] = set_updates
    await db.consultation_sessions.update_one({"id": session["id"]}, updates)
    fresh = await db.consultation_sessions.find_one({"id": session["id"]}, {"_id": 0})
    return {"session": fresh, "alert": alert_doc}


class IntakeShareBody(BaseModel):
    session_id: str


@api_router.post("/consultations/{session_id}/share")
async def share_intake(session_id: str, user: User = Depends(get_current_user)):
    """Patient consents to sharing the AI intake summary with the doctor.
    Transitions the session from `intake_complete` → `awaiting_doctor` and creates
    the doctor alert. No-op for emergencies (already shared)."""
    session = await _get_session_or_403(session_id, user)
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Only the patient can share intake")
    if session["status"] == "awaiting_doctor":
        return {"session": session, "alert": None, "already_shared": True}
    if session["status"] != "intake_complete":
        raise HTTPException(status_code=400, detail=f"Cannot share from status={session['status']}")

    tag = session.get("intake_summary") or {}
    alert_doc = {
        "id": str(uuid.uuid4()),
        "patient_id": session["patient_id"],
        "patient_name": session.get("patient_name"),
        "urgency": tag.get("urgency", "medium"),
        "topic": f"Intake ready: {tag.get('chief_complaint', 'consultation')}",
        "summary": tag.get("summary_for_doctor") or tag.get("chief_complaint") or "Patient ready for consultation",
        "patient_message": "",
        "ai_reply": "",
        "session_id": session["id"],
        "appointment_id": session["appointment_id"],
        "status": "open",
        "source": "intake",
        "created_at": _now_iso(),
    }
    await db.doctor_alerts.insert_one(alert_doc.copy()); alert_doc.pop("_id", None)
    await db.consultation_sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "awaiting_doctor", "consented_at": _now_iso()}},
    )
    fresh = await db.consultation_sessions.find_one({"id": session_id}, {"_id": 0})
    return {"session": fresh, "alert": alert_doc, "already_shared": False}


@api_router.post("/consultations/{session_id}/join")
async def doctor_join(session_id: str, user: User = Depends(get_current_user)):
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="Only doctors can join a consultation")
    session = await _get_session_or_403(session_id, user)
    if session["status"] in ("ended", "pending_rx"):
        raise HTTPException(status_code=400, detail=f"Cannot join a {session['status']} session")
    now = _now_iso()
    join_msg = {
        "id": str(uuid.uuid4()),
        "role": "system",
        "text": f"Dr. {(user.name or 'Lahari').split()[-1]} has joined the consultation.",
        "created_at": now,
    }
    await db.consultation_sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "live", "doctor_joined_at": now, "doctor_id": user.user_id, "doctor_name": user.name},
         "$push": {"messages": join_msg}},
    )
    return await db.consultation_sessions.find_one({"id": session_id}, {"_id": 0})


@api_router.post("/consultations/message")
async def live_message(payload: LiveMessage, user: User = Depends(get_current_user)):
    session = await _get_session_or_403(payload.session_id, user)
    if session["status"] not in ("live", "awaiting_doctor"):
        raise HTTPException(status_code=400, detail=f"Session not live (status={session['status']})")
    role = "patient" if user.role == "patient" else "doctor"
    msg = {"id": str(uuid.uuid4()), "role": role, "text": payload.text, "created_at": _now_iso(), "sender_name": user.name}
    await db.consultation_sessions.update_one({"id": session["id"]}, {"$push": {"messages": msg}})

    # Care AI responds only when addressed
    ai_reply = None
    text_low = payload.text.lower().strip()
    if text_low.startswith("@careai") or text_low.startswith("@care ai") or text_low.startswith("@care-ai"):
        clean_q = re.sub(r"^@care[\s-]?ai", "", payload.text, flags=re.IGNORECASE).strip(" :,-")
        patient = await db.patients.find_one({"id": session["patient_id"]}, {"_id": 0})
        hist = (session.get("messages") or []) + [msg]
        reply = await _care_ai_live(patient, session.get("intake_summary") or {}, hist, clean_q or payload.text)
        ai_reply = {"id": str(uuid.uuid4()), "role": "care_ai", "text": reply.strip(), "created_at": _now_iso()}
        await db.consultation_sessions.update_one({"id": session["id"]}, {"$push": {"messages": ai_reply}})
    fresh = await db.consultation_sessions.find_one({"id": session["id"]}, {"_id": 0})
    return {"session": fresh, "ai_reply": ai_reply}


@api_router.get("/consultations/session/{session_id}")
async def get_session(session_id: str, user: User = Depends(get_current_user)):
    return await _get_session_or_403(session_id, user)


@api_router.get("/consultations/by-appointment/{appointment_id}")
async def get_by_appt(appointment_id: str, user: User = Depends(get_current_user)):
    appt = await db.appointments.find_one({"id": appointment_id}, {"_id": 0})
    if not appt:
        raise HTTPException(status_code=404)
    if user.role == "patient" and user.linked_patient_id != appt["patient_id"]:
        raise HTTPException(status_code=403)
    s = await db.consultation_sessions.find_one({"appointment_id": appointment_id}, {"_id": 0})
    return s or {"exists": False}


@api_router.post("/consultations/{session_id}/end")
async def end_consultation(session_id: str, user: User = Depends(get_current_user)):
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="Only the doctor can end a consultation")
    session = await _get_session_or_403(session_id, user)
    if session["status"] == "ended":
        return session
    patient = await db.patients.find_one({"id": session["patient_id"]}, {"_id": 0})
    summary = await _care_ai_summarize(patient, session)
    await db.consultation_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "pending_rx",  # doctor must approve prescription
            "summary": summary,
            "prescription_ai": summary.get("suggested_prescription") or [],
            "prescription_final": summary.get("suggested_prescription") or [],  # seed final with AI draft
            "live_ended_at": _now_iso(),
        }},
    )
    return await db.consultation_sessions.find_one({"id": session_id}, {"_id": 0})


@api_router.patch("/consultations/prescription")
async def update_prescription(payload: PrescriptionUpdate, user: User = Depends(get_current_user)):
    if user.role == "patient":
        raise HTTPException(status_code=403)
    session = await _get_session_or_403(payload.session_id, user)
    if session["status"] not in ("pending_rx", "ended"):
        raise HTTPException(status_code=400, detail="Cannot edit prescription at this stage")
    items = [i.model_dump() for i in payload.items]
    await db.consultation_sessions.update_one(
        {"id": payload.session_id},
        {"$set": {"prescription_final": items, "doctor_notes": payload.doctor_notes or ""}},
    )
    return await db.consultation_sessions.find_one({"id": payload.session_id}, {"_id": 0})


@api_router.post("/consultations/{session_id}/finalize")
async def finalize_consultation(session_id: str, user: User = Depends(get_current_user)):
    if user.role == "patient":
        raise HTTPException(status_code=403)
    session = await _get_session_or_403(session_id, user)
    if session["status"] == "ended":
        return session
    patient = await db.patients.find_one({"id": session["patient_id"]}, {"_id": 0})

    # Care AI explains the final Rx to the patient (in their preferred language)
    language = session.get("language") or "en"
    rx_items = session.get("prescription_final") or []
    explanation = await _care_ai_explain_rx(patient, rx_items, language=language)
    rx_msg = {"id": str(uuid.uuid4()), "role": "care_ai", "text": explanation, "created_at": _now_iso(), "kind": "prescription_explanation"}
    await db.consultation_sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "ended", "ended_at": _now_iso()},
         "$push": {"messages": rx_msg}},
    )

    # Archive into patient record as a consultation entry
    summary = session.get("summary") or {}
    consult_entry = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "date": _now_iso(),
        "doctor_name": session.get("doctor_name"),
        "patient_summary": summary.get("patient_summary", ""),
        "doctor_summary": summary.get("doctor_summary", ""),
        "prescriptions": rx_items,
        "follow_up": summary.get("follow_up", ""),
        "extracted_data": {"assessment": (session.get("intake_summary") or {}).get("chief_complaint", "")},
    }
    await db.patients.update_one(
        {"id": session["patient_id"]},
        {"$push": {"consultations": consult_entry}, "$inc": {"consultation_count": 1}},
    )

    # Mark appointment completed
    await db.appointments.update_one({"id": session["appointment_id"]}, {"$set": {"status": "completed"}})

    # Auto-resolve intake alert for this session
    await db.doctor_alerts.update_many(
        {"session_id": session_id, "status": "open"},
        {"$set": {"status": "resolved", "resolved_at": _now_iso()}},
    )

    # Auto-generate medication reminders from finalized prescription
    await _auto_create_reminders_from_rx(
        patient_id=session["patient_id"],
        items=rx_items,
        source="consultation",
        source_id=session_id,
    )

    # === #6 + #8: mirror summary + Rx explanation into followup_chats ===
    # Patients see ONE timeline (consultation summary + ongoing follow-up + WhatsApp)
    # in /followup, instead of having to dig back into the consultation room.
    await _mirror_consultation_to_followup(session, summary, rx_items, explanation)

    # === #7: push summary + Rx + explanation to WhatsApp (if linked) ===
    asyncio.create_task(_send_consultation_to_whatsapp(
        patient_id=session["patient_id"],
        summary=summary,
        rx_items=rx_items,
        explanation=explanation,
        language=language,
    ))

    return await db.consultation_sessions.find_one({"id": session_id}, {"_id": 0})


async def _mirror_consultation_to_followup(session, summary, rx_items, explanation):
    """Append the consultation summary + Rx as a single 'system' card in followup_chats
    so the patient sees a unified history (#8 single chat window)."""
    bullets = []
    if summary.get("patient_summary"):
        bullets.append(summary["patient_summary"])
    if rx_items:
        rx_text = "\n".join(
            f"  • {it.get('medication','')} — {it.get('dose','')} {it.get('frequency','')} for {it.get('duration','')}"
            + (f" ({it.get('instructions')})" if it.get("instructions") else "")
            for it in rx_items if it.get("medication")
        )
        if rx_text:
            bullets.append("Prescribed:\n" + rx_text)
    if summary.get("follow_up"):
        bullets.append("Follow-up: " + summary["follow_up"])
    body = "\n\n".join(bullets) if bullets else "Consultation complete."

    doctor = (session.get("doctor_name") or "Dr. Lahari").strip()
    if not doctor.lower().startswith("dr"):
        doctor = "Dr. " + doctor
    summary_msg = {
        "id": f"consult-{session['id']}-summary",
        "patient_id": session["patient_id"],
        "role": "assistant",
        "text": f"📝 Consultation summary from {doctor}:\n\n{body}",
        "created_at": _now_iso(),
        "source": "consultation_summary",
        "kind": "consultation_summary",
        "session_id": session["id"],
    }
    await db.followup_chats.insert_one(summary_msg)

    # The patient-friendly Rx explanation (in their language) gets its own card
    if explanation:
        await db.followup_chats.insert_one({
            "id": f"consult-{session['id']}-rx",
            "patient_id": session["patient_id"],
            "role": "assistant",
            "text": explanation,
            "created_at": _now_iso(),
            "source": "consultation_summary",
            "kind": "rx_explanation",
            "session_id": session["id"],
        })

# ============================================================================
# Phase 23 — WhatsApp privacy toggles + per-channel gating (Phase 1 charter)
# ============================================================================
WA_CHANNELS = ("send_prescriptions", "send_summary", "send_reminders", "send_reports", "send_alerts")


def _default_wa_prefs(consent: bool = True) -> Dict[str, Any]:
    """Conservative defaults matching the consent-gate ask. Reports default
    OFF (Phase 1 spec — "Conditional: Lab reports → only if user allows"); the
    other channels default ON because the user opted into "prescriptions,
    updates & follow-ups" at the gate.
    """
    return {
        "consent": consent,
        "consent_at": _now_iso() if consent else None,
        "send_prescriptions": True,
        "send_summary": True,
        "send_reminders": True,
        "send_alerts": True,
        "send_reports": False,
        # Phase 20 — voice replies: when ON, every WhatsApp AI reply is also
        # sent as a TTS audio note so the patient can listen hands-free.
        "voice_replies": False,
    }


def _wa_can_send(user_doc: Dict[str, Any], channel: str) -> bool:
    """Single source-of-truth gate. True only if number verified + consent +
    per-channel toggle on.
    """
    if not user_doc or channel not in WA_CHANNELS:
        return False
    if not user_doc.get("whatsapp_number"):
        return False
    if not user_doc.get("whatsapp_verified_at"):
        return False
    prefs = user_doc.get("whatsapp_prefs") or {}
    return bool(prefs.get("consent", False)) and bool(prefs.get(channel, False))


@api_router.get("/whatsapp/preferences")
async def get_whatsapp_preferences(user: User = Depends(get_current_user)):
    u = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "user_id": 1, "whatsapp_number": 1, "whatsapp_verified_at": 1,
         "whatsapp_prefs": 1, "whatsapp_language": 1},
    )
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "linked": bool(u.get("whatsapp_number")),
        "verified": bool(u.get("whatsapp_verified_at")),
        "phone_number": u.get("whatsapp_number"),
        "language": u.get("whatsapp_language") or "en",
        "prefs": u.get("whatsapp_prefs") or {**_default_wa_prefs(False), "consent": False},
    }


class WaPrefsPatch(BaseModel):
    send_prescriptions: Optional[bool] = None
    send_summary: Optional[bool] = None
    send_reminders: Optional[bool] = None
    send_reports: Optional[bool] = None
    send_alerts: Optional[bool] = None
    consent: Optional[bool] = None  # patient can revoke consent at any time
    voice_replies: Optional[bool] = None  # Phase 20 — TTS audio replies


@api_router.patch("/whatsapp/preferences")
async def patch_whatsapp_preferences(payload: WaPrefsPatch, user: User = Depends(get_current_user)):
    u = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "user_id": 1, "whatsapp_prefs": 1})
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    prefs = u.get("whatsapp_prefs") or _default_wa_prefs()
    body = payload.model_dump(exclude_none=True)
    if not body:
        return {"prefs": prefs, "ok": True}
    prefs.update(body)
    if "consent" in body:
        prefs["consent_at"] = _now_iso()
    await db.users.update_one({"user_id": user.user_id}, {"$set": {"whatsapp_prefs": prefs}})
    return {"prefs": prefs, "ok": True}




async def _send_consultation_to_whatsapp(patient_id: str, summary: Dict[str, Any], rx_items: List[Dict[str, Any]], explanation: str, language: str = "en"):
    """Push the consultation summary + Rx + Care AI explanation to the patient's
    WhatsApp number, in their preferred language. No-op if not linked or if
    consent / per-channel toggles are OFF.
    """
    try:
        user_doc = await db.users.find_one(
            {"linked_patient_id": patient_id, "whatsapp_number": {"$exists": True, "$ne": None}},
            {"_id": 0, "whatsapp_number": 1, "whatsapp_language": 1,
             "whatsapp_verified_at": 1, "whatsapp_prefs": 1},
        )
        if not user_doc or not user_doc.get("whatsapp_number"):
            return
        # Phase 23 — privacy gate. Skip entirely if NEITHER summary nor Rx is allowed.
        can_summary = _wa_can_send(user_doc, "send_summary")
        can_rx = _wa_can_send(user_doc, "send_prescriptions")
        if not can_summary and not can_rx:
            logger.info("WhatsApp delivery skipped — patient has prefs disabled.")
            return
        from whatsapp_router import send_whatsapp as _wa_send

        wa_lang = user_doc.get("whatsapp_language") or language or "en"
        ps = (summary or {}).get("patient_summary") or ""
        # Localize the patient_summary into the WhatsApp language if needed
        if ps and wa_lang and wa_lang != "en":
            try:
                lang_name = LANGUAGE_NAMES.get(wa_lang, "English")
                t_chat = LlmChat(
                    api_key=EMERGENT_LLM_KEY,
                    session_id=f"trans-{uuid.uuid4().hex[:6]}",
                    system_message=(
                        f"Translate the user's text into {lang_name}. Use the native script. "
                        "Keep medical terms accurate. Reply with ONLY the translation, no preface."
                    ),
                ).with_model("openai", "gpt-4o")
                ps = await t_chat.send_message(UserMessage(text=ps))
            except Exception:
                logger.warning("WhatsApp summary translation failed — sending in original language")

        rx_text = "\n".join(
            f"• {it.get('medication','')} {it.get('dose','')}, {it.get('frequency','')} × {it.get('duration','')}"
            + (f" — {it.get('instructions')}" if it.get("instructions") else "")
            for it in (rx_items or []) if it.get("medication")
        )

        if can_summary:
            chunk1 = "📝 Consultation summary from Dr. Lahari:\n\n" + (ps or "Consultation completed.")
            await _wa_send(user_doc["whatsapp_number"], chunk1)
        if can_rx and rx_text:
            await _wa_send(user_doc["whatsapp_number"], "💊 Prescription:\n" + rx_text)
        if can_summary and explanation:
            await _wa_send(user_doc["whatsapp_number"], explanation[:1500])
    except Exception:
        logger.exception("Failed to push consultation to WhatsApp")


@api_router.get("/consultations")
async def list_consultations(user: User = Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if user.role == "patient" and user.linked_patient_id:
        q["patient_id"] = user.linked_patient_id
    items = await db.consultation_sessions.find(q, {"_id": 0, "id": 1, "patient_id": 1, "patient_name": 1, "doctor_name": 1, "status": 1, "created_at": 1, "ended_at": 1, "intake_summary": 1, "appointment_id": 1}).sort("created_at", -1).to_list(100)
    return items



# ============================================================
# Chat attachments (file sharing inside consultation)
# ============================================================

import base64 as _b64


@api_router.post("/consultations/{session_id}/upload")
async def upload_attachment(session_id: str, file: UploadFile = File(...), user: User = Depends(get_current_user)):
    session = await _get_session_or_403(session_id, user)
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")
    if len(data) < 16:
        raise HTTPException(status_code=400, detail="File is empty")
    content_type = file.content_type or "application/octet-stream"
    att_id = str(uuid.uuid4())
    # Store base64 inline (simple & self-contained; fine for MVP up to 10MB)
    await db.consultation_attachments.insert_one({
        "id": att_id,
        "session_id": session_id,
        "uploader_role": "patient" if user.role == "patient" else "doctor",
        "uploader_id": user.user_id,
        "filename": file.filename or "attachment",
        "content_type": content_type,
        "size": len(data),
        "b64": _b64.b64encode(data).decode(),
        "created_at": _now_iso(),
    })
    role = "patient" if user.role == "patient" else "doctor"
    url = f"/api/consultations/attachments/{att_id}"
    msg = {
        "id": str(uuid.uuid4()),
        "role": role,
        "text": f"📎 Shared file: {file.filename}",
        "kind": "attachment",
        "attachment": {"id": att_id, "filename": file.filename, "content_type": content_type, "size": len(data), "url": url},
        "created_at": _now_iso(),
        "sender_name": user.name,
    }
    await db.consultation_sessions.update_one({"id": session_id}, {"$push": {"messages": msg}})
    return {"session": await db.consultation_sessions.find_one({"id": session_id}, {"_id": 0}), "attachment": msg["attachment"]}


@api_router.get("/consultations/attachments/{attachment_id}")
async def get_attachment(attachment_id: str, user: User = Depends(get_current_user)):
    att = await db.consultation_attachments.find_one({"id": attachment_id}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404)
    # Ownership check via session
    sess = await db.consultation_sessions.find_one({"id": att["session_id"]}, {"_id": 0, "patient_id": 1})
    if not sess:
        raise HTTPException(status_code=404)
    if user.role == "patient" and user.linked_patient_id != sess["patient_id"]:
        raise HTTPException(status_code=403)
    return Response(content=_b64.b64decode(att["b64"]), media_type=att.get("content_type") or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{att["filename"]}"'})


# ============================================================
# Follow-up multimodal uploads (B1–B4)
#   Patients can attach images / PDFs in /followup. Images are run through
#   GPT-4o vision for clinical interpretation, the analysis is stored as
#   the AI's reply, and a doctor_alert summarising the upload is created
#   so the doctor sees both the original attachment and the AI's read.
# ============================================================

VISION_SYSTEM = """You are Care AI, helping a patient interpret a medical image they sent on follow-up.
Possible image types: prescription, lab/test report, symptom photo (e.g. rash, wound, swelling),
medical document (referral, discharge note), or pill/medication packaging.

# OUTPUT — return ONLY this JSON (no prose, no markdown fences)
{
  "image_type": "prescription | lab_report | symptom_photo | medical_document | medication | unknown",
  "summary_for_patient": "2–4 short sentences in patient-friendly language explaining what you see and what to do",
  "summary_for_doctor": "2–3 clinical sentences for Dr. Lahari — values, abnormal findings, suspected diagnoses",
  "extracted_data": {  // best-effort, omit fields you cannot read
    "medications": [{"name":"","dose":"","frequency":""}],
    "lab_values": [{"name":"","value":"","reference":""}],
    "key_findings": ["…"]
  },
  "urgency": "emergency | high | medium | low",
  "alert_doctor": true | false,
  "follow_up_questions": ["…optional patient-facing clarifying questions…"]
}

# RULES
- Be conservative. If the image is blurry, dark, or not clearly medical → image_type="unknown",
  ask in `follow_up_questions` for a clearer photo, urgency="low", alert_doctor=false.
- Symptom photos that suggest cellulitis, deep wounds, abscess, severe rash with systemic signs,
  jaundice, or evident infection → urgency="high" + alert_doctor=true.
- Lab values clearly outside normal ranges (extreme glucose, troponin, K+, Hb<7, etc.) → urgency="high"+alert.
- Prescription images → just extract meds, urgency="low" unless contraindicated with patient allergies.
- NEVER make up values you can't see.
"""


async def _vision_interpret_image(patient: Dict[str, Any], data: bytes, content_type: str) -> Optional[Dict[str, Any]]:
    """Run GPT-4o vision over a single image (bytes). Returns the VISION_SYSTEM
    JSON dict or None on failure. Reusable by /followup/upload and the
    WhatsApp inbound media pipeline so both channels produce the same clinical read.
    """
    try:
        b64 = _b64.b64encode(data).decode()
        from emergentintegrations.llm.chat import ImageContent  # local import — optional dep
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"vision-{uuid.uuid4().hex[:8]}",
            system_message=VISION_SYSTEM + "\n\n# PATIENT RECORD\n" + (await _build_patient_context(patient)),
        ).with_model("openai", "gpt-4o")
        raw = await chat.send_message(UserMessage(
            text="Please interpret this image per the OUTPUT contract.",
            file_contents=[ImageContent(image_base64=b64)],
        ))
        try:
            return json.loads(_strip_json_fence(raw or "").strip())
        except Exception:
            logger.warning("Vision returned non-JSON: %s", (raw or "")[:300])
            return {
                "image_type": "unknown",
                "summary_for_patient": (raw or "")[:600],
                "summary_for_doctor": "Vision analysis returned non-JSON.",
                "extracted_data": {},
                "urgency": "low",
                "alert_doctor": False,
                "follow_up_questions": [],
            }
    except Exception:
        logger.exception("Vision analysis failed")
        return None


@api_router.post("/followup/upload")
async def followup_upload(file: UploadFile = File(...), patient_id: str = Form(...), language: str = Form("en"), user: User = Depends(get_current_user)):
    """B1–B4: Patient uploads an image/document on /followup.
    Image → GPT-4o vision interpretation; PDF/doc → stored + a generic AI ack.
    Always: persist attachment, append a chat row, raise a doctor alert."""
    if user.role == "patient" and user.linked_patient_id != patient_id:
        raise HTTPException(status_code=403, detail="Not your patient record")
    patient = await db.patients.find_one({"id": patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")
    if len(data) < 16:
        raise HTTPException(status_code=400, detail="File is empty")
    content_type = (file.content_type or "").lower() or "application/octet-stream"
    is_image = content_type.startswith("image/")
    att_id = str(uuid.uuid4())

    await db.followup_attachments.insert_one({
        "id": att_id,
        "patient_id": patient_id,
        "uploader_id": user.user_id,
        "filename": file.filename or "attachment",
        "content_type": content_type,
        "size": len(data),
        "b64": _b64.b64encode(data).decode(),
        "created_at": _now_iso(),
    })
    url = f"/api/followup/attachments/{att_id}"

    # 1. Persist a patient turn referencing the upload
    user_msg = {
        "id": str(uuid.uuid4()),
        "patient_id": patient_id,
        "role": "user",
        "text": f"📎 Uploaded: {file.filename or 'attachment'}",
        "kind": "attachment",
        "attachment": {"id": att_id, "filename": file.filename, "content_type": content_type, "size": len(data), "url": url},
        "created_at": _now_iso(),
    }
    await db.followup_chats.insert_one(user_msg.copy()); user_msg.pop("_id", None)

    analysis = None
    summary_for_doctor = None
    summary_for_patient = None
    urgency = "low"
    alert_needed = False

    if is_image:
        # Shared helper → reused by WhatsApp media pipeline too.
        analysis = await _vision_interpret_image(patient, data, content_type)
        if analysis:
            summary_for_patient = (analysis.get("summary_for_patient") or "I've shared this with Dr. Lahari.").strip()
            summary_for_doctor = (analysis.get("summary_for_doctor") or "").strip()
            urgency = (analysis.get("urgency") or "low").lower()
            alert_needed = bool(analysis.get("alert_doctor"))
        else:
            summary_for_patient = "Got your image. I've saved it for Dr. Lahari to review."
            summary_for_doctor = f"Image upload (analysis unavailable). Filename: {file.filename}"
            urgency = "low"
    else:
        summary_for_patient = "Got your file — Dr. Lahari can open it from your follow-up."
        summary_for_doctor = f"Patient shared a non-image file: {file.filename} ({content_type})."

    # 2. AI reply card (with the analysis attached so the UI can render structured details)
    ai_msg = {
        "id": str(uuid.uuid4()),
        "patient_id": patient_id,
        "role": "assistant",
        "text": summary_for_patient or "I've shared this with Dr. Lahari.",
        "kind": "image_analysis" if is_image else "attachment_ack",
        "analysis": analysis,
        "attachment_id": att_id,
        "urgency": urgency,
        "created_at": _now_iso(),
    }
    await db.followup_chats.insert_one(ai_msg.copy()); ai_msg.pop("_id", None)

    # 3. Doctor alert — always create one for uploads (low urgency by default), so the doctor never misses a shared image.
    alert_doc = {
        "id": str(uuid.uuid4()),
        "patient_id": patient_id,
        "patient_name": (patient.get("personal_info") or {}).get("name"),
        "urgency": urgency if (alert_needed or urgency in ("emergency", "high")) else "low",
        "topic": f"Patient uploaded {analysis.get('image_type') if analysis else 'file'}".replace("_", " "),
        "summary": summary_for_doctor or f"Patient uploaded {file.filename}.",
        "patient_message": file.filename or "uploaded file",
        "ai_reply": (summary_for_patient or "")[:400],
        "attachment_id": att_id,
        "attachment_url": url,
        "status": "open",
        "source": "followup_upload",
        "created_at": _now_iso(),
    }
    await db.doctor_alerts.insert_one(alert_doc.copy()); alert_doc.pop("_id", None)

    return {
        "user_message": user_msg,
        "ai_message": ai_msg,
        "attachment": {"id": att_id, "filename": file.filename, "content_type": content_type, "size": len(data), "url": url},
        "analysis": analysis,
        "alert": alert_doc if alert_needed or urgency in ("emergency", "high") else None,
    }


@api_router.get("/followup/attachments/{attachment_id}")
async def get_followup_attachment(attachment_id: str, user: User = Depends(get_current_user)):
    att = await db.followup_attachments.find_one({"id": attachment_id}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404)
    if user.role == "patient" and user.linked_patient_id != att["patient_id"]:
        raise HTTPException(status_code=403)
    return Response(
        content=_b64.b64decode(att["b64"]),
        media_type=att.get("content_type") or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{att["filename"]}"'},
    )


# ============================================================
# Language patch + async doctor quick-prescribe
# ============================================================

class LanguagePatch(BaseModel):
    language: str


@api_router.patch("/consultations/{session_id}/language")
async def set_session_language(session_id: str, payload: LanguagePatch, user: User = Depends(get_current_user)):
    session = await _get_session_or_403(session_id, user)
    if payload.language not in LANGUAGE_NAMES:
        raise HTTPException(status_code=400, detail="Unsupported language")
    await db.consultation_sessions.update_one({"id": session_id}, {"$set": {"language": payload.language}})
    return {"ok": True, "language": payload.language}


class InvestigationItem(BaseModel):
    name: str
    urgency: Optional[str] = "routine"  # routine | urgent | stat
    reason: Optional[str] = ""


class QuickRxBody(BaseModel):
    patient_id: str
    items: List[PrescriptionItem]
    reason: str = ""
    alert_id: Optional[str] = None
    # New structured clinical fields (Phase 20). All optional → backwards compatible.
    chief_complaint: Optional[str] = ""
    clinical_summary: Optional[str] = ""
    provisional_diagnosis: Optional[str] = ""
    doctor_notes: Optional[str] = ""
    investigations: Optional[List[InvestigationItem]] = None
    advice: Optional[str] = ""
    follow_up: Optional[str] = ""
    red_flags: Optional[List[str]] = None
    # Phase 21 — when set true, doctor explicitly overrides allergy collisions.
    override_allergy_warning: Optional[bool] = False


class QuickRxDraftBody(BaseModel):
    patient_id: str
    alert_id: Optional[str] = None
    chat_context: Optional[str] = None  # Optional free-form context the doctor wants to inject


class RxGuidanceBody(BaseModel):
    patient_id: str
    alert_id: Optional[str] = None
    current_diagnosis: Optional[str] = ""
    current_medications: Optional[List[str]] = None  # just the names
    current_investigations: Optional[List[str]] = None
    chief_complaint: Optional[str] = ""


# ============================================================================
# Phase 22 — Clinical Co-Pilot (gap / dose / interaction / suggestion engine)
# ============================================================================

# Per-drug daily-dose envelopes. Conservative ranges drawn from common adult
# dosing references; we only WARN, never block. Values in mg/day (oral) unless
# noted. Doctor remains the source of truth.
DRUG_DOSE_DB: Dict[str, Dict[str, Any]] = {
    "paracetamol":      {"min": 500,  "max": 4000, "unit": "mg/day", "note": "Hepatic — keep <4g/day."},
    "acetaminophen":    {"min": 500,  "max": 4000, "unit": "mg/day", "note": "Hepatic — keep <4g/day."},
    "ibuprofen":        {"min": 200,  "max": 2400, "unit": "mg/day", "note": "Renal/GI — caution if dehydrated."},
    "naproxen":         {"min": 220,  "max": 1500, "unit": "mg/day"},
    "diclofenac":       {"min": 50,   "max": 200,  "unit": "mg/day"},
    "aspirin":          {"min": 75,   "max": 4000, "unit": "mg/day", "note": "Low-dose ≤300mg cardio; high-dose for analgesia."},
    "amoxicillin":      {"min": 500,  "max": 3000, "unit": "mg/day"},
    "amoxiclav":        {"min": 625,  "max": 2625, "unit": "mg/day"},
    "azithromycin":     {"min": 250,  "max": 500,  "unit": "mg/day", "note": "Typically 5-day course; max 500 mg/day."},
    "cefixime":         {"min": 200,  "max": 400,  "unit": "mg/day"},
    "ciprofloxacin":    {"min": 500,  "max": 1500, "unit": "mg/day"},
    "doxycycline":      {"min": 100,  "max": 200,  "unit": "mg/day"},
    "clarithromycin":   {"min": 500,  "max": 1000, "unit": "mg/day"},
    "metronidazole":    {"min": 600,  "max": 2000, "unit": "mg/day"},
    "metformin":        {"min": 500,  "max": 2550, "unit": "mg/day"},
    "amlodipine":       {"min": 2.5,  "max": 10,   "unit": "mg/day"},
    "losartan":         {"min": 25,   "max": 100,  "unit": "mg/day"},
    "ramipril":         {"min": 2.5,  "max": 10,   "unit": "mg/day"},
    "atorvastatin":     {"min": 10,   "max": 80,   "unit": "mg/day"},
    "rosuvastatin":     {"min": 5,    "max": 40,   "unit": "mg/day"},
    "omeprazole":       {"min": 20,   "max": 80,   "unit": "mg/day"},
    "pantoprazole":     {"min": 20,   "max": 80,   "unit": "mg/day"},
    "ranitidine":       {"min": 150,  "max": 600,  "unit": "mg/day"},
    "ondansetron":      {"min": 4,    "max": 24,   "unit": "mg/day"},
    "loperamide":       {"min": 2,    "max": 16,   "unit": "mg/day"},
    "ors":              {"min": 1,    "max": 12,   "unit": "sachets/day", "note": "Replace as per losses."},
    "salbutamol":       {"min": 4,    "max": 32,   "unit": "mg/day", "note": "Inhaler dose differs."},
    "prednisolone":     {"min": 5,    "max": 60,   "unit": "mg/day"},
    "warfarin":         {"min": 1,    "max": 10,   "unit": "mg/day", "note": "INR-guided — wide individual variation."},
    "levothyroxine":    {"min": 25,   "max": 200,  "unit": "mcg/day"},
}

# Pairwise interactions — non-exhaustive but covers the highest-yield clinical
# combinations a primary-care doctor sees. severity = info | caution | major.
DRUG_INTERACTIONS: List[Dict[str, Any]] = [
    {"a": "warfarin",     "b": "ibuprofen",      "severity": "major",   "note": "↑ bleeding risk via platelet inhibition + INR."},
    {"a": "warfarin",     "b": "aspirin",        "severity": "major",   "note": "↑ bleeding risk."},
    {"a": "warfarin",     "b": "naproxen",       "severity": "major",   "note": "↑ bleeding risk."},
    {"a": "warfarin",     "b": "diclofenac",     "severity": "major",   "note": "↑ bleeding risk."},
    {"a": "warfarin",     "b": "ciprofloxacin",  "severity": "caution", "note": "May ↑ INR."},
    {"a": "warfarin",     "b": "metronidazole",  "severity": "major",   "note": "Significantly ↑ INR."},
    {"a": "metformin",    "b": "contrast",       "severity": "caution", "note": "Hold around iodinated contrast — lactic acidosis risk."},
    {"a": "ramipril",     "b": "ibuprofen",      "severity": "caution", "note": "↑ AKI risk; ↓ antihypertensive efficacy."},
    {"a": "losartan",     "b": "ibuprofen",      "severity": "caution", "note": "↑ AKI risk."},
    {"a": "amlodipine",   "b": "simvastatin",    "severity": "caution", "note": "Cap simvastatin at 20 mg/day."},
    {"a": "atorvastatin", "b": "clarithromycin", "severity": "major",   "note": "↑ statin levels → myopathy risk."},
    {"a": "atorvastatin", "b": "erythromycin",   "severity": "major",   "note": "↑ statin levels → myopathy risk."},
    {"a": "ssri",         "b": "tramadol",       "severity": "major",   "note": "Serotonin syndrome risk."},
    {"a": "ssri",         "b": "maoi",           "severity": "major",   "note": "Serotonin syndrome — contraindicated."},
    {"a": "ondansetron",  "b": "ciprofloxacin",  "severity": "caution", "note": "Both QT-prolonging."},
]

# Symptom → standard first-line medication suggestions. Conservative; doctor
# decides what to actually use.
SYMPTOM_MED_HINTS: Dict[str, List[Dict[str, str]]] = {
    "fever":           [{"medication": "Paracetamol", "dose": "500-1000mg", "frequency": "QID PRN", "duration": "as needed", "reason": "Antipyretic"}],
    "high fever":      [{"medication": "Paracetamol", "dose": "1000mg",    "frequency": "QID PRN", "duration": "as needed", "reason": "Antipyretic"}],
    "headache":        [{"medication": "Paracetamol", "dose": "500-1000mg", "frequency": "PRN",     "duration": "as needed", "reason": "Analgesic"}],
    "body ache":       [{"medication": "Paracetamol", "dose": "500-1000mg", "frequency": "QID PRN", "duration": "as needed", "reason": "Analgesic"}],
    "loose stools":    [{"medication": "ORS",         "dose": "1 sachet",   "frequency": "after each loose stool", "duration": "until resolution", "reason": "Rehydration"}],
    "diarrhea":        [{"medication": "ORS",         "dose": "1 sachet",   "frequency": "after each loose stool", "duration": "until resolution", "reason": "Rehydration"}],
    "diarrhoea":       [{"medication": "ORS",         "dose": "1 sachet",   "frequency": "after each loose stool", "duration": "until resolution", "reason": "Rehydration"}],
    "vomiting":        [{"medication": "Ondansetron", "dose": "4mg",        "frequency": "TID PRN", "duration": "2-3 days",   "reason": "Antiemetic"}],
    "nausea":          [{"medication": "Ondansetron", "dose": "4mg",        "frequency": "BID PRN", "duration": "2-3 days",   "reason": "Antiemetic"}],
    "acidity":         [{"medication": "Pantoprazole","dose": "40mg",       "frequency": "OD before food", "duration": "5-7 days", "reason": "Acid suppression"}],
    "heartburn":       [{"medication": "Pantoprazole","dose": "40mg",       "frequency": "OD before food", "duration": "5-7 days", "reason": "Acid suppression"}],
    "cough":           [{"medication": "Dextromethorphan", "dose": "10-20mg", "frequency": "QID PRN", "duration": "5 days", "reason": "Antitussive (dry cough)"}],
    "sore throat":     [{"medication": "Paracetamol", "dose": "500-1000mg", "frequency": "QID PRN", "duration": "as needed", "reason": "Analgesic"}],
    "runny nose":      [{"medication": "Cetirizine",  "dose": "10mg",       "frequency": "OD",      "duration": "5 days",     "reason": "Antihistamine"}],
    "blocked nose":    [{"medication": "Xylometazoline 0.05%", "dose": "1-2 sprays", "frequency": "BID", "duration": "max 5 days", "reason": "Decongestant"}],
}


def _med_key(name: str) -> str:
    """Normalise a medication name for DB lookup. Strips strength, brand, etc."""
    n = (name or "").lower().strip()
    # Strip dose suffixes like "500mg", "40 mg", "250 mg/5 ml"
    n = re.sub(r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)\b.*$", "", n).strip()
    # Strip salt suffixes
    for s in (" hcl", " hydrochloride", " sodium", " potassium"):
        if n.endswith(s):
            n = n[: -len(s)].strip()
    return n


def _parse_daily_mg(med: Dict[str, Any]) -> Optional[float]:
    """Best-effort extraction of total daily dose in mg from {dose, frequency}."""
    dose_str = (med.get("dose") or "").lower()
    freq_str = (med.get("frequency") or "").lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*(mg|mcg|g)", dose_str)
    if not m:
        return None
    val = float(m.group(1))
    unit = m.group(2)
    if unit == "g":
        val *= 1000
    elif unit == "mcg":
        val /= 1000
    # Map frequency to per-day count
    times_per_day = None
    for token, n in [
        ("once", 1), ("od", 1), ("hs", 1), ("bedtime", 1),
        ("twice", 2), ("bid", 2), ("bd", 2),
        ("thrice", 3), ("tid", 3), ("tds", 3), ("3 times", 3), ("three times", 3),
        ("qid", 4), ("qds", 4), ("4 times", 4), ("four times", 4),
        ("q4h", 6), ("q6h", 4), ("q8h", 3), ("q12h", 2),
    ]:
        if token in freq_str:
            times_per_day = n
            break
    if times_per_day is None:
        return None
    return val * times_per_day


def _check_dose_warnings(meds: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in meds or []:
        key = _med_key(m.get("medication") or "")
        if not key:
            continue
        info = DRUG_DOSE_DB.get(key)
        if not info:
            continue
        daily = _parse_daily_mg(m)
        if daily is None:
            continue
        if daily > info["max"]:
            out.append({
                "medication": m.get("medication"),
                "kind": "dose_high",
                "severity": "caution",
                "computed_daily": daily,
                "expected": f"{info['min']}–{info['max']} {info['unit']}",
                "note": (info.get("note") or "Dose appears higher than typical adult range."),
            })
        elif daily < info["min"]:
            out.append({
                "medication": m.get("medication"),
                "kind": "dose_low",
                "severity": "info",
                "computed_daily": daily,
                "expected": f"{info['min']}–{info['max']} {info['unit']}",
                "note": "Dose appears lower than typical adult range.",
            })
    return out


def _check_interaction_warnings(meds: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    keys = [_med_key(m.get("medication") or "") for m in meds or []]
    keys = [k for k in keys if k]
    out: List[Dict[str, Any]] = []
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            for pair in DRUG_INTERACTIONS:
                pa, pb = pair["a"], pair["b"]
                hit = (
                    (pa in a and pb in b) or
                    (pb in a and pa in b)
                )
                if hit:
                    out.append({
                        "drug_a": a, "drug_b": b,
                        "severity": pair["severity"],
                        "note": pair["note"],
                    })
    return out


def _check_gap_warnings(symptoms_text: str, meds: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Flag symptoms in the patient's complaint/intake that have no
    obvious medication coverage in the current Rx draft."""
    if not symptoms_text:
        return []
    txt = symptoms_text.lower()
    med_names = " ".join(_med_key(m.get("medication") or "") for m in (meds or []))
    out: List[Dict[str, Any]] = []
    seen_symptoms: set = set()
    for symptom, hints in SYMPTOM_MED_HINTS.items():
        if symptom in seen_symptoms:
            continue
        if symptom not in txt:
            continue
        # Already covered if any hint medication appears in the Rx
        covered = any(_med_key(h["medication"]) in med_names for h in hints)
        if covered:
            continue
        seen_symptoms.add(symptom)
        out.append({
            "symptom": symptom,
            "suggestion": hints[0],
            "note": f"Patient mentioned **{symptom}** — no treatment in current Rx. Consider {hints[0]['medication']}?",
        })
    return out


def _build_suggestions(symptoms_text: str, meds: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Symptom-driven medication suggestions (de-duplicated against current Rx)."""
    if not symptoms_text:
        return []
    txt = symptoms_text.lower()
    med_names = " ".join(_med_key(m.get("medication") or "") for m in (meds or []))
    seen: set = set()
    out: List[Dict[str, Any]] = []
    for symptom, hints in SYMPTOM_MED_HINTS.items():
        if symptom not in txt:
            continue
        for h in hints:
            mk = _med_key(h["medication"])
            if mk in med_names or mk in seen:
                continue
            seen.add(mk)
            out.append({**h, "for_symptom": symptom})
    return out[:5]


class CopilotCheckBody(BaseModel):
    patient_id: str
    items: List[PrescriptionItem]
    chief_complaint: Optional[str] = ""
    clinical_summary: Optional[str] = ""
    provisional_diagnosis: Optional[str] = ""
    alert_id: Optional[str] = None


@api_router.post("/prescriptions/copilot/check")
async def copilot_check(payload: CopilotCheckBody, user: User = Depends(get_current_user)):
    """Subtle-by-default safety pass over the doctor's current Rx draft.

    Returns 4 buckets of structured findings + symptom suggestions. The doctor
    is ALWAYS in control — this endpoint never modifies state.
    """
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="Doctors only")
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Build a single symptoms blob from chief complaint + summary + recent
    # patient messages. Truncate to keep latency predictable.
    recent = await db.followup_chats.find(
        {"patient_id": payload.patient_id, "role": "user"}, {"_id": 0, "text": 1},
    ).sort("created_at", -1).limit(8).to_list(8)
    intake = (patient.get("chief_complaint") or "")
    symptoms_text = "\n".join(filter(None, [
        payload.chief_complaint or "",
        payload.clinical_summary or "",
        intake,
        *(m.get("text", "") for m in recent),
    ]))[:4000]

    items = [it.model_dump() for it in payload.items]
    allergy = _drug_allergy_collisions(items, patient)
    dose = _check_dose_warnings(items)
    interactions = _check_interaction_warnings(items)
    gaps = _check_gap_warnings(symptoms_text, items)
    suggestions = _build_suggestions(symptoms_text, items)

    severity_rank = {"major": 3, "block": 3, "caution": 2, "info": 1}
    blocking = bool(allergy) or any(w.get("severity") == "major" for w in interactions)
    status = "ok"
    if blocking:
        status = "blocking"
    elif dose or interactions or gaps:
        status = "warn"

    return {
        "status": status,
        "blocking": blocking,
        "allergy_warnings": allergy,
        "dose_warnings": dose,
        "interaction_warnings": interactions,
        "gap_warnings": gaps,
        "suggestions": suggestions,
        "checked_at": _now_iso(),
        "rank_hint": severity_rank,
    }


@api_router.post("/prescriptions/copilot/voice")
async def copilot_voice(file: UploadFile = File(...), patient_id: str = Form(""), user: User = Depends(get_current_user)):
    """Doctor speaks the prescription → Whisper transcribes → LLM parses into
    a structured `items[]` draft. Doctor reviews/edits before signing.
    """
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="Doctors only")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio too large (>20 MB)")

    stt_out = await _whisper_transcribe_bytes(raw, mime=file.content_type or "audio/webm", language=None)
    transcript = (stt_out.get("text") or "").strip()
    if not transcript:
        return {"transcript": "", "items": [], "reason": "(empty transcription)"}

    system = (
        "You convert a doctor's spoken instructions into a STRICT JSON medication list. "
        "Output ONLY a single JSON object: "
        '{"items":[{"medication":"…","dose":"…","frequency":"…","duration":"…","instructions":"…","reason":"…"}], '
        '"reason":"one-line clinical reasoning"}. '
        "Rules: do NOT invent meds the doctor did not name; preserve dose/frequency/duration verbatim where stated; "
        "use BID/TID/QID for frequencies; default duration to '5 days' when unstated; max 6 items."
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"copilot-voice-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("openai", "gpt-4o")
    raw_reply = await chat.send_message(UserMessage(text=f"Doctor said:\n{transcript}"))
    parsed_json = _strip_json_fence(raw_reply or "")
    try:
        data = json.loads(parsed_json)
    except Exception:
        logger.warning("Copilot voice LLM returned non-JSON: %s", parsed_json[:300])
        data = {"items": [], "reason": ""}
    items = []
    for it in (data.get("items") or [])[:6]:
        if not isinstance(it, dict):
            continue
        med = (it.get("medication") or "").strip()
        if not med:
            continue
        items.append({
            "medication": med,
            "dose": (it.get("dose") or "").strip(),
            "frequency": (it.get("frequency") or "").strip() or "as directed",
            "duration": (it.get("duration") or "").strip() or "5 days",
            "instructions": (it.get("instructions") or "").strip(),
            "reason": (it.get("reason") or "").strip(),
        })
    return {
        "transcript": transcript,
        "items": items,
        "reason": (data.get("reason") or "").strip()[:200],
    }




@api_router.post("/prescriptions/quick-draft")
async def quick_prescribe_draft(payload: QuickRxDraftBody, user: User = Depends(get_current_user)):
    """AI-suggested medication draft for the doctor to review.

    Pulls patient profile + recent follow-up chat (and the linked alert when present)
    and asks GPT-4o to propose 1–4 evidence-based medications. The doctor can then
    modify / add / delete / approve in the QuickPrescribeModal before issuing.
    """
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="Only doctors can draft prescriptions")
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Build context from the most recent follow-up chat + alert
    history = await db.followup_chats.find(
        {"patient_id": payload.patient_id}, {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(20)
    history.reverse()
    recent = "\n".join(f"{m.get('role','user').upper()}: {m.get('text','')}" for m in history)[:4000]

    alert_block = ""
    if payload.alert_id:
        alert = await db.doctor_alerts.find_one({"id": payload.alert_id}, {"_id": 0})
        if alert:
            alert_block = (
                f"Alert urgency: {alert.get('urgency')}\n"
                f"Topic: {alert.get('topic')}\n"
                f"Patient said: {alert.get('patient_message', '')}\n"
                f"AI triage summary: {alert.get('summary', '')}\n"
            )

    pi = patient.get("personal_info", {}) or {}
    mh = patient.get("medical_history", {}) or {}
    profile_block = json.dumps({
        "name": pi.get("name"),
        "age": pi.get("age"),
        "gender": pi.get("gender"),
        "allergies": mh.get("allergies", []),
        "current_medications": [m.get("name") if isinstance(m, dict) else str(m) for m in (mh.get("medications") or [])],
        "current_conditions": mh.get("current_conditions", []),
    }, default=str)

    system = (
        "You are Care AI's clinical decision-support brain helping a primary-care doctor draft a "
        "short, safe asynchronous prescription based on a patient's recent follow-up activity.\n\n"
        "OUTPUT — return ONLY a JSON object (no prose, no markdown fences) with shape:\n"
        '{"items":[{"medication":"…","dose":"…","frequency":"…","duration":"…","instructions":"…","reason":"…"}],'
        '"reason":"1-line clinical reason for the doctor"}\n\n'
        "RULES\n"
        "- 1 to 4 items. Conservative, evidence-based, generic names where possible.\n"
        "- Always check `allergies` and `current_medications` before suggesting (no duplicates, no contraindications).\n"
        "- Frequency in plain words (e.g. 'twice daily').\n"
        "- Duration explicit (e.g. '5 days').\n"
        "- `instructions` should be patient-friendly (e.g. 'Take with food').\n"
        "- `reason` per-item is the indication (e.g. 'fever', 'reflux').\n"
        "- If the patient's situation is an emergency or requires in-person evaluation, return `{\"items\":[],\"reason\":\"in-person evaluation recommended\"}` instead of risky meds.\n"
    )
    nl = "\n"
    alert_section = f"ALERT CONTEXT:{nl}{alert_block}{nl}" if alert_block else ""
    note_section = f"DOCTOR NOTE:{nl}{payload.chat_context}{nl}{nl}" if payload.chat_context else ""
    user_text = (
        f"PATIENT PROFILE:\n{profile_block}\n\n"
        f"{alert_section}"
        f"RECENT FOLLOW-UP TRANSCRIPT (most recent last):\n{recent or '(no recent chat)'}\n\n"
        f"{note_section}"
        "Draft a prescription per the OUTPUT contract."
    )

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"rx-draft-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("openai", "gpt-4o")
    raw = await chat.send_message(UserMessage(text=user_text))
    raw = _strip_json_fence(raw or "")

    try:
        data = json.loads(raw)
    except Exception:
        logger.warning("Rx-draft LLM returned non-JSON: %s", raw[:300])
        data = {"items": [], "reason": "Draft unavailable — please add medications manually."}
    items = data.get("items") or []
    cleaned = []
    for it in items:
        if not isinstance(it, dict):
            continue
        cleaned.append({
            "medication": (it.get("medication") or "").strip(),
            "dose": (it.get("dose") or "").strip(),
            "frequency": (it.get("frequency") or "").strip(),
            "duration": (it.get("duration") or "").strip(),
            "instructions": (it.get("instructions") or "").strip(),
            "reason": (it.get("reason") or "").strip(),
        })
    return {
        "items": [c for c in cleaned if c["medication"]],
        "reason": (data.get("reason") or "")[:200],
    }


@api_router.post("/prescriptions/ai-guidance")
async def rx_ai_guidance(payload: RxGuidanceBody, user: User = Depends(get_current_user)):
    """Asks Care AI three clinical-safety questions on behalf of the doctor:
        1. Should we add any tests/investigations?
        2. Is a follow-up needed and when?
        3. Any symptoms or red-flags the doctor may have missed?
    Returns structured suggestions the UI can let the doctor accept with one click.
    """
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="Doctors only")
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    history = await db.followup_chats.find(
        {"patient_id": payload.patient_id}, {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(20)
    history.reverse()
    recent = "\n".join(f"{m.get('role','user').upper()}: {m.get('text','')}" for m in history)[:3000]

    pi = patient.get("personal_info") or {}
    mh = patient.get("medical_history") or {}
    profile = json.dumps({
        "age": pi.get("age"),
        "gender": pi.get("gender"),
        "allergies": mh.get("allergies", []),
        "current_conditions": mh.get("current_conditions", []),
    }, default=str)

    alert_block = ""
    if payload.alert_id:
        alert = await db.doctor_alerts.find_one({"id": payload.alert_id}, {"_id": 0})
        if alert:
            alert_block = f"OPEN ALERT: {alert.get('topic')} — {alert.get('summary','')}\n"

    system = (
        "You are a clinical-decision-support assistant helping a primary-care doctor finalise a prescription. "
        "You are NOT writing the prescription — only flagging gaps. Output ONLY a JSON object with this shape:\n"
        '{"investigations":[{"name":"…","urgency":"routine|urgent|stat","reason":"…"}],'
        '"follow_up":"plain-language follow-up plan or empty string",'
        '"missed_symptoms":["short bullet — symptom or red-flag the doctor may want to ask about"]}\n'
        "Rules: be conservative, max 4 investigations, max 4 missed symptoms. Skip anything already covered by the doctor's input. "
        "If nothing to add for a section, return an empty array/empty string."
    )
    user_text = (
        f"PATIENT: {profile}\n\n"
        f"CHIEF COMPLAINT (doctor): {payload.chief_complaint or '(not provided)'}\n"
        f"PROVISIONAL DIAGNOSIS (doctor): {payload.current_diagnosis or '(not provided)'}\n"
        f"DOCTOR-PLANNED MEDS: {', '.join(payload.current_medications or []) or '(none)'}\n"
        f"DOCTOR-PLANNED TESTS: {', '.join(payload.current_investigations or []) or '(none)'}\n\n"
        f"{alert_block}"
        f"RECENT CARE-AI / PATIENT CHAT (most recent last):\n{recent or '(no recent chat)'}\n\n"
        "Suggest gaps per the OUTPUT contract."
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"rx-guidance-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("openai", "gpt-4o")
    raw = await chat.send_message(UserMessage(text=user_text))
    raw = _strip_json_fence(raw or "")
    try:
        data = json.loads(raw)
    except Exception:
        logger.warning("Rx-guidance LLM returned non-JSON: %s", raw[:300])
        data = {"investigations": [], "follow_up": "", "missed_symptoms": []}

    investigations = []
    for it in (data.get("investigations") or [])[:4]:
        if not isinstance(it, dict):
            continue
        name = (it.get("name") or "").strip()
        if not name:
            continue
        urg = (it.get("urgency") or "routine").lower()
        if urg not in {"routine", "urgent", "stat"}:
            urg = "routine"
        investigations.append({"name": name, "urgency": urg, "reason": (it.get("reason") or "").strip()[:200]})
    missed = [str(s).strip()[:140] for s in (data.get("missed_symptoms") or [])[:4] if str(s).strip()]
    return {
        "investigations": investigations,
        "follow_up": (data.get("follow_up") or "").strip()[:280],
        "missed_symptoms": missed,
    }


@api_router.post("/prescriptions/quick")
async def quick_prescribe(payload: QuickRxBody, user: User = Depends(get_current_user)):
    if user.role == "patient":
        raise HTTPException(status_code=403, detail="Only doctors can prescribe")
    patient = await db.patients.find_one({"id": payload.patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    items = [i.model_dump() for i in payload.items]
    if not items:
        raise HTTPException(status_code=400, detail="At least one medication required")

    # Phase 21 — Clinical decision support: check confirmed allergies against
    # the medications about to be issued. Block on collisions unless the
    # doctor explicitly sets `override_allergy_warning=True`.
    collisions = _drug_allergy_collisions(items, patient)
    if collisions and not payload.override_allergy_warning:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "allergy_collision",
                "message": "One or more medications conflict with a recorded patient allergy.",
                "collisions": collisions,
                "hint": "Pass override_allergy_warning=true to issue anyway.",
            },
        )
    investigations = [i.model_dump() for i in (payload.investigations or [])]
    red_flags = [s for s in (payload.red_flags or []) if str(s).strip()]

    # Doctor-summary blends the structured sections into a SOAP-ish blurb so
    # the existing /pharmacy / consultation views still surface useful text.
    soap_lines = []
    if payload.chief_complaint: soap_lines.append(f"S: {payload.chief_complaint}")
    if payload.clinical_summary: soap_lines.append(f"O: {payload.clinical_summary}")
    if payload.provisional_diagnosis: soap_lines.append(f"A: {payload.provisional_diagnosis}")
    if payload.doctor_notes: soap_lines.append(f"P notes: {payload.doctor_notes}")
    if investigations: soap_lines.append("Tests: " + "; ".join(f"{i['name']} ({i.get('urgency','routine')})" for i in investigations))
    if payload.advice: soap_lines.append(f"Advice: {payload.advice}")
    if payload.follow_up: soap_lines.append(f"Follow-up: {payload.follow_up}")
    if red_flags: soap_lines.append("Red flags: " + "; ".join(red_flags))
    blended_doctor_summary = "\n".join(soap_lines) or f"Asynchronous prescription based on: {payload.reason or 'clinical review'}."

    # Archive as a lightweight consultation entry (async)
    entry = {
        "id": str(uuid.uuid4()),
        "session_id": None,
        "date": _now_iso(),
        "doctor_name": user.name,
        "doctor_id": user.user_id,
        "patient_summary": f"Dr. {user.name.split()[-1]} issued a prescription. Reason: {payload.reason or payload.provisional_diagnosis or 'clinical judgement'}.",
        "doctor_summary": blended_doctor_summary,
        "prescriptions": items,
        "investigations": investigations,
        "follow_up": payload.follow_up or "",
        "kind": "async_rx",
        "extracted_data": {
            "chief_complaint": payload.chief_complaint or "",
            "clinical_summary": payload.clinical_summary or "",
            "provisional_diagnosis": payload.provisional_diagnosis or "",
            "doctor_notes": payload.doctor_notes or "",
            "advice": payload.advice or "",
            "follow_up": payload.follow_up or "",
            "red_flags": red_flags,
            "investigations": investigations,
            "assessment": payload.provisional_diagnosis or payload.reason or "Async Rx",
        },
    }
    await db.patients.update_one(
        {"id": payload.patient_id},
        {"$push": {"consultations": entry}, "$inc": {"consultation_count": 1}},
    )

    # Auto-generate reminders
    created = await _auto_create_reminders_from_rx(payload.patient_id, items, source="async_rx", source_id=entry["id"])

    # If linked to an alert, resolve it
    if payload.alert_id:
        await db.doctor_alerts.update_one(
            {"id": payload.alert_id},
            {"$set": {"status": "resolved", "resolved_at": _now_iso(), "resolution": "async_prescription"}},
        )

    # Notify patient via the 24/7 follow-up thread so they hear from Care AI
    explanation = await _care_ai_explain_rx(patient, items)
    await db.followup_chats.insert_one({
        "id": str(uuid.uuid4()),
        "patient_id": payload.patient_id,
        "role": "assistant",
        "text": f"Dr. {user.name.split()[-1]} just issued you a new prescription.\n\n{explanation}",
        "urgency": None,
        "created_at": _now_iso(),
        "kind": "async_prescription",
    })

    # Phase 16 — Pre-treatment safety check kickoff
    required_vitals = _required_vitals_for_meds(items)
    if required_vitals:
        await db.patients.update_one(
            {"id": payload.patient_id, "consultations.id": entry["id"]},
            {"$set": {"consultations.$.safety_check": {
                "required": required_vitals,
                "status": "pending",
                "created_at": _now_iso(),
            }}},
        )
        # Phase 17 — set the WhatsApp session so inbound vitals route here
        await db.whatsapp_sessions.update_one(
            {"patient_id": payload.patient_id},
            {"$set": {
                "patient_id": payload.patient_id,
                "current_stage": "safety_check",
                "expected_input": [v["key"] for v in required_vitals],
                "active_rx_id": entry["id"],
                "updated_at": _now_iso(),
                "expires_at": (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat(),
            }},
            upsert=True,
        )
        ask_lines = "\n".join(f"• {v['ask']}" for v in required_vitals)
        prompt_msg = (
            "🩺 Quick safety check before you start this medication.\n\n"
            f"{ask_lines}\n\n"
            "Reply here with the values — I'll confirm it's safe to start, or hold it and alert Dr. Lahari if anything's off."
        )
        await db.followup_chats.insert_one({
            "id": str(uuid.uuid4()),
            "patient_id": payload.patient_id,
            "role": "assistant",
            "text": prompt_msg,
            "urgency": None,
            "created_at": _now_iso(),
            "kind": "safety_check_request",
            "meta": {"rx_id": entry["id"]},
        })
        # Push to WhatsApp if patient is linked + has alerts/summary on
        try:
            user_doc = await db.users.find_one(
                {"linked_patient_id": payload.patient_id, "whatsapp_number": {"$exists": True, "$ne": None}},
                {"_id": 0, "whatsapp_number": 1, "whatsapp_prefs": 1, "whatsapp_verified_at": 1},
            )
            if user_doc and _wa_can_send(user_doc, "send_summary"):
                from whatsapp_router import send_whatsapp as _wa_send_sc
                await _wa_send_sc(user_doc["whatsapp_number"], prompt_msg)
        except Exception:
            logger.exception("safety_check WA prompt failed")

    return {"ok": True, "entry": entry, "reminders_created": created, "safety_check_required": bool(required_vitals)}




# ============================================================
# Phase 16 — Pre-Treatment Validation Gate (CRITICAL safety)
# ============================================================
# After a doctor finalises an Rx, Care AI proactively asks the patient
# for the vitals required by the medications they're about to take
# (e.g., insulin → blood glucose; antihypertensives → BP; antipyretics → temp).
# If the values are unsafe, the Rx is HELD and the doctor is alerted.

# Lightweight rules: medication name (case-insensitive substring) → required vitals
# Each vital: {key, label, unit, safe_range:[low,high], unsafe_low?, unsafe_high?}
_VITAL_RULES = [
    {
        "match": ["insulin", "glargine", "lispro", "novolog", "humalog"],
        "required": [{
            "key": "blood_glucose", "label": "Current blood glucose",
            "unit": "mg/dL", "safe_low": 80, "safe_high": 250,
            "hold_below": 70, "hold_above": 400,
            "ask": "What's your current blood glucose reading (mg/dL)?",
        }],
    },
    {
        "match": ["metformin", "glimepiride", "gliclazide", "sitagliptin", "sulfonyl"],
        "required": [{
            "key": "blood_glucose", "label": "Fasting blood glucose",
            "unit": "mg/dL", "safe_low": 70, "safe_high": 300,
            "hold_below": 60, "hold_above": 400,
            "ask": "What's your latest fasting blood sugar (mg/dL)?",
        }],
    },
    {
        "match": ["amlodipine", "lisinopril", "ramipril", "losartan", "telmisartan", "metoprolol", "atenolol", "enalapril", "valsartan"],
        "required": [{
            "key": "bp", "label": "Current blood pressure",
            "unit": "mmHg", "safe_low": 95, "safe_high": 160,
            "hold_below": 90, "hold_above": 180,
            "ask": "What's your current blood pressure (e.g. 120/80)?",
        }],
    },
    {
        "match": ["paracetamol", "ibuprofen", "acetaminophen", "naproxen", "diclofenac"],
        "required": [{
            "key": "temperature", "label": "Current temperature",
            "unit": "°F", "safe_low": 96.0, "safe_high": 104.0,
            "hold_below": 95.0, "hold_above": 105.5,
            "ask": "What's your current temperature in °F (or just say 'no fever')?",
        }],
    },
    {
        "match": ["warfarin", "apixaban", "rivaroxaban", "dabigatran", "heparin"],
        "required": [{
            "key": "bleeding", "label": "Active bleeding screen",
            "unit": "yes/no", "safe_low": None, "safe_high": None,
            "hold_below": None, "hold_above": None,
            "ask": "Any new bleeding (gums, urine, stool, or unexpected bruising)?",
        }],
    },
]


def _required_vitals_for_meds(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen_keys: set = set()
    for it in items or []:
        med = (it.get("medication") or "").lower()
        if not med:
            continue
        for rule in _VITAL_RULES:
            if any(m in med for m in rule["match"]):
                for v in rule["required"]:
                    if v["key"] not in seen_keys:
                        out.append(v)
                        seen_keys.add(v["key"])
    return out


def _classify_vital(vital_def: Dict[str, Any], raw: Any) -> Dict[str, Any]:
    """Returns {ok, status:'safe|hold|unclear', reason}.
    Accepts numeric values, '120/80' BP, or 'yes/no' for bleeding screen.
    """
    key = vital_def.get("key")
    val = raw
    if val is None:
        return {"ok": False, "status": "unclear", "reason": "No value provided"}

    if key == "bp":
        # Parse "120/80"
        s = str(val).strip()
        m = re.match(r"^\s*(\d{2,3})\s*[/\-]\s*(\d{2,3})\s*$", s)
        if not m:
            return {"ok": False, "status": "unclear", "reason": "BP format expected like 120/80"}
        sys, dia = int(m.group(1)), int(m.group(2))
        if sys < (vital_def.get("hold_below") or 0) or sys > (vital_def.get("hold_above") or 99999):
            return {"ok": False, "status": "hold", "reason": f"Systolic {sys} is outside the safe window"}
        if dia < 50 or dia > 110:
            return {"ok": False, "status": "hold", "reason": f"Diastolic {dia} is outside the safe window"}
        return {"ok": True, "status": "safe", "reason": f"BP {sys}/{dia} is in range"}

    if key == "bleeding":
        s = str(val).lower().strip()
        if any(w in s for w in ["yes", "blood", "bleed", "bruis"]):
            return {"ok": False, "status": "hold", "reason": "Patient reports active bleeding"}
        return {"ok": True, "status": "safe", "reason": "No active bleeding reported"}

    # Numeric (glucose / temperature)
    try:
        n = float(str(val).split("/")[0].split()[0])
    except Exception:
        return {"ok": False, "status": "unclear", "reason": "Could not parse a numeric value"}
    hb = vital_def.get("hold_below")
    ha = vital_def.get("hold_above")
    if hb is not None and n < hb:
        return {"ok": False, "status": "hold", "reason": f"{vital_def['label']} {n} is below the safe floor ({hb})"}
    if ha is not None and n > ha:
        return {"ok": False, "status": "hold", "reason": f"{vital_def['label']} {n} is above the safe ceiling ({ha})"}
    return {"ok": True, "status": "safe", "reason": f"{vital_def['label']} {n} is in range"}


class SafetyCheckSubmit(BaseModel):
    values: Dict[str, Any]  # {vital_key: numeric_or_string}


@api_router.get("/prescriptions/{rx_id}/safety-check")
async def get_safety_check(rx_id: str, user: User = Depends(get_current_user)):
    """Returns the required vitals + current status for a prescription's pre-treatment gate.
    Patients can read their own; doctors can read any."""
    pdoc = await db.patients.find_one(
        {"consultations.id": rx_id},
        {"_id": 0, "id": 1, "consultations": 1, "personal_info": 1},
    )
    if not pdoc:
        raise HTTPException(status_code=404, detail="Prescription not found")
    if user.role == "patient" and user.linked_patient_id != pdoc["id"]:
        raise HTTPException(status_code=403, detail="Not your prescription")
    rx = next((c for c in (pdoc.get("consultations") or []) if c.get("id") == rx_id), None)
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found")
    sc = rx.get("safety_check") or {}
    required = sc.get("required") or _required_vitals_for_meds(rx.get("prescriptions") or [])
    return {
        "rx_id": rx_id,
        "patient_id": pdoc["id"],
        "patient_name": (pdoc.get("personal_info") or {}).get("name"),
        "status": sc.get("status") or ("not_required" if not required else "pending"),
        "required": required,
        "submitted": sc.get("submitted") or {},
        "result": sc.get("result") or {},
        "submitted_at": sc.get("submitted_at"),
    }


@api_router.post("/prescriptions/{rx_id}/safety-check/submit")
async def submit_safety_check(rx_id: str, payload: SafetyCheckSubmit, user: User = Depends(get_current_user)):
    """Patient submits current vital values. Each value classified as safe/hold/unclear.
    If ANY hold → status='hold', auto-create a doctor alert and notify patient via Care AI.
    If ALL safe → status='cleared'. Else status='partial' (need more values)."""
    pdoc = await db.patients.find_one(
        {"consultations.id": rx_id},
        {"_id": 0, "id": 1, "consultations": 1, "personal_info": 1},
    )
    if not pdoc:
        raise HTTPException(status_code=404, detail="Prescription not found")
    if user.role == "patient" and user.linked_patient_id != pdoc["id"]:
        raise HTTPException(status_code=403, detail="Not your prescription")

    rx = next((c for c in (pdoc.get("consultations") or []) if c.get("id") == rx_id), None)
    if not rx:
        raise HTTPException(status_code=404, detail="Prescription not found")

    required = (rx.get("safety_check") or {}).get("required") or _required_vitals_for_meds(rx.get("prescriptions") or [])
    if not required:
        return {"status": "not_required"}

    by_key = {v["key"]: v for v in required}
    result: Dict[str, Any] = {}
    any_hold = False
    any_unclear = False
    for k, raw in (payload.values or {}).items():
        if k not in by_key:
            continue
        c = _classify_vital(by_key[k], raw)
        result[k] = c
        if c["status"] == "hold":
            any_hold = True
        elif c["status"] == "unclear":
            any_unclear = True

    missing = [k for k in by_key.keys() if k not in result]

    if any_hold:
        status = "hold"
    elif missing or any_unclear:
        status = "partial"
    else:
        status = "cleared"

    sc_doc = {
        "required": required,
        "submitted": payload.values,
        "result": result,
        "status": status,
        "submitted_at": _now_iso(),
        "submitted_by": user.user_id,
    }
    await db.patients.update_one(
        {"id": pdoc["id"], "consultations.id": rx_id},
        {"$set": {"consultations.$.safety_check": sc_doc}},
    )

    # If hold: alert doctor + send Care AI hold message
    if status == "hold":
        hold_reasons = [v["reason"] for v in result.values() if v.get("status") == "hold"]
        topic = "Pre-treatment safety hold"
        summary = "; ".join(hold_reasons)[:240]
        alert_doc = {
            "id": str(uuid.uuid4()),
            "patient_id": pdoc["id"],
            "patient_name": (pdoc.get("personal_info") or {}).get("name"),
            "topic": topic,
            "summary": summary,
            "patient_message": f"Vitals: {payload.values}",
            "ai_reply": "",
            "urgency": "high",
            "initial_severity": "high",
            "status": "open",
            "kind": "safety_hold",
            "rx_id": rx_id,
            "created_at": _now_iso(),
            "events": [{"event": "created", "at": _now_iso(), "by": "safety-check", "note": summary}],
        }
        await db.doctor_alerts.insert_one(alert_doc.copy())

        # Care AI notice in the followup thread (read by web + WA)
        meds = ", ".join(it.get("medication", "") for it in (rx.get("prescriptions") or []) if it.get("medication"))
        hold_msg = (
            f"⚠️ Hold the new prescription ({meds}) for now.\n\n"
            f"Reason: {summary}\n\n"
            "Dr. Lahari has been alerted and will reach out shortly. "
            "If you feel unwell — chest pain, breathlessness, severe dizziness — go to the nearest ER or call emergency services right away."
        )
        await db.followup_chats.insert_one({
            "id": str(uuid.uuid4()),
            "patient_id": pdoc["id"],
            "role": "assistant",
            "text": hold_msg,
            "urgency": "high",
            "created_at": _now_iso(),
            "kind": "safety_hold",
        })
        # Push to WhatsApp if linked
        try:
            user_doc = await db.users.find_one(
                {"linked_patient_id": pdoc["id"], "whatsapp_number": {"$exists": True, "$ne": None}},
                {"_id": 0, "whatsapp_number": 1, "whatsapp_prefs": 1, "whatsapp_verified_at": 1},
            )
            if user_doc and _wa_can_send(user_doc, "send_alerts"):
                from whatsapp_router import send_whatsapp as _wa_send
                await _wa_send(user_doc["whatsapp_number"], hold_msg)
        except Exception:
            logger.exception("safety hold WA push failed")

    elif status == "cleared":
        meds = ", ".join(it.get("medication", "") for it in (rx.get("prescriptions") or []) if it.get("medication"))
        await db.followup_chats.insert_one({
            "id": str(uuid.uuid4()),
            "patient_id": pdoc["id"],
            "role": "assistant",
            "text": f"✅ All vitals look safe. You can start {meds or 'your prescription'} as directed by Dr. Lahari.",
            "urgency": None,
            "created_at": _now_iso(),
            "kind": "safety_clear",
        })
        # Phase 17 — clear the WA session so generic LLM resumes
        await db.whatsapp_sessions.update_one(
            {"patient_id": pdoc["id"]},
            {"$set": {"current_stage": "idle", "expected_input": None, "active_rx_id": None, "updated_at": _now_iso()}},
        )
        # Phase 17 — schedule Day 1/3/5 Care AI check-ins for this Rx
        await _schedule_followup_checkins(pdoc["id"], rx_id)

    return {
        "status": status,
        "result": result,
        "missing": missing,
    }


# ============================================================
# Phase 17 — Day 1/3/5 follow-up scheduler
# ============================================================
# Stores per-Rx scheduled Care AI check-ins; a tick endpoint (cron-driven)
# processes due entries and posts WhatsApp + chat messages.

# ============================================================
# Phase 19 — Condition-aware follow-up templates
# ============================================================
# Rules: substring match against chief_complaint/assessment (case-insensitive).
# First rule that matches wins. If no rule matches → generic templates.

_CONDITION_TEMPLATES = [
    {
        "name": "fever",
        "match": ["fever", "pyrex", "viral fever", "temperature", "febrile"],
        "day1": "🌡️ Day 1 — How's your fever today? Please share your current temperature (e.g. 99.8 F) and whether you're taking your medication on time.",
        "day3": "🌡️ Day 3 — Is the fever settling? Reply with today's temperature reading. If it's still above 101 F, we'll need to flag Dr. Lahari.",
        "day5": "🩺 Day 5 — If fever has cleared, great. If it's still there or new symptoms (breathlessness, rash, severe weakness) have appeared, reply here and I'll book a follow-up consult.",
    },
    {
        "name": "diabetes",
        "match": ["diabetes", "diabetic", "t2dm", "t1dm", "hyperglycem", "hba1c", "metformin"],
        "day1": "🩸 Day 1 — What's your fasting blood sugar this morning? Please share the reading (mg/dL). Also: have you taken every dose as prescribed?",
        "day3": "🩸 Day 3 — Share today's fasting + post-meal sugar readings. Any dizziness, shakiness, or unusual thirst? Those can signal highs or lows.",
        "day5": "🩸 Day 5 — Share this week's average sugar if you've been logging. If values are trending >250 mg/dL or <70 mg/dL, I'll loop in Dr. Lahari.",
    },
    {
        "name": "hypertension",
        "match": ["hypertension", "htn", "high blood pressure", "bp elevated", "amlodipine", "losartan", "telmisartan", "ramipril"],
        "day1": "🩺 Day 1 — What's your blood pressure this morning? Reply in 120/80 format. Also: did you take your BP medicine at the scheduled time?",
        "day3": "🩺 Day 3 — Share today's BP reading. Any headaches, chest heaviness, or vision changes? Those matter.",
        "day5": "🩺 Day 5 — Share the BP average this week. If the top number has been above 160 or below 95 on multiple days, we'll adjust the plan with Dr. Lahari.",
    },
    {
        "name": "cough_uri",
        "match": ["cough", "uri", "upper respiratory", "cold", "sore throat", "throat pain"],
        "day1": "😷 Day 1 — How's the cough today? Better, same, or worse? Any new breathlessness or chest discomfort?",
        "day3": "😷 Day 3 — Is the cough improving? Any coloured sputum, fever, or breathing difficulty? Tell me how you slept.",
        "day5": "😷 Day 5 — If the cough is still bad, we should book a review. If breathlessness or chest pain has appeared, tell me right now.",
    },
    {
        "name": "gastritis",
        "match": ["gastritis", "acid", "gerd", "reflux", "heartburn", "pantoprazole", "rabeprazole"],
        "day1": "🩹 Day 1 — How's the acidity/heartburn today? Did you avoid spicy/late meals? Any nausea or vomiting?",
        "day3": "🩹 Day 3 — Is the acidity settling? Any black stools, vomiting blood, or severe abdominal pain? Those need urgent attention.",
        "day5": "🩹 Day 5 — If symptoms are improving, continue as prescribed. If not, we'll book a follow-up with Dr. Lahari.",
    },
]

_FOLLOWUP_TEMPLATES = [
    {"day": 1, "key": "day1", "text":
        "👋 Just checking in — how are you feeling today?\n\n"
        "Reply with a quick word: 'better', 'same', 'worse', or describe how you feel.\n"
        "I'll flag anything concerning to Dr. Lahari."},
    {"day": 3, "key": "day3", "text":
        "🩺 Day 3 check-in. Are your symptoms improving?\n\n"
        "If yes — great, keep going as prescribed.\n"
        "If not — tell me what's still bothering you and I'll help."},
    {"day": 5, "key": "day5", "text":
        "📅 It's been 5 days. Do you think you need a follow-up consultation with Dr. Lahari?\n\n"
        "Reply 'yes' to book one, or describe how you're doing if you'd like my take first."},
]


def _resolve_condition_template(haystack: str, day_key: str) -> Optional[str]:
    """Return the condition-specific day text, or None for generic fallback."""
    if not haystack:
        return None
    hs = haystack.lower()
    for rule in _CONDITION_TEMPLATES:
        if any(m in hs for m in rule["match"]):
            return rule.get(day_key)
    return None


async def _schedule_followup_checkins(patient_id: str, rx_id: str) -> int:
    """Idempotently schedule Day 1/3/5 follow-up check-ins for a cleared Rx.
    Phase 19: picks condition-aware text when the consultation's
    chief_complaint or assessment matches a known template family.
    """
    now = datetime.now(timezone.utc)
    created = 0
    # Build the haystack from the consultation once
    pdoc = await db.patients.find_one(
        {"id": patient_id, "consultations.id": rx_id},
        {"_id": 0, "consultations.$": 1},
    )
    haystack = ""
    if pdoc and pdoc.get("consultations"):
        c = pdoc["consultations"][0] or {}
        chief = c.get("chief_complaint") or ""
        assessment = (c.get("extracted_data") or {}).get("assessment") or c.get("assessment") or ""
        reason = c.get("reason") or ""
        meds = " ".join((p.get("medication") or "") for p in (c.get("prescriptions") or []))
        haystack = f"{chief} {assessment} {reason} {meds}".strip()

    for t in _FOLLOWUP_TEMPLATES:
        existing = await db.followup_schedule.find_one(
            {"rx_id": rx_id, "key": t["key"]},
            {"_id": 0, "id": 1},
        )
        if existing:
            continue
        text = _resolve_condition_template(haystack, t["key"]) or t["text"]
        await db.followup_schedule.insert_one({
            "id": str(uuid.uuid4()),
            "patient_id": patient_id,
            "rx_id": rx_id,
            "key": t["key"],
            "day": t["day"],
            "text": text,
            "condition_aware": bool(_resolve_condition_template(haystack, t["key"])),
            "due_at": (now + timedelta(days=t["day"])).isoformat(),
            "status": "pending",
            "created_at": _now_iso(),
        })
        created += 1
    return created


@api_router.post("/followup/scheduler/tick")
async def followup_scheduler_tick(
    user: User = Depends(get_current_user),
    test_due_within_seconds: int = 0,  # for testing — process entries due in <= N secs from now
):
    """Process due follow-up check-ins. Doctor/admin-only.
    For each pending entry whose `due_at` <= now, post a Care AI message into
    the patient's followup_chats and push to WhatsApp if linked + opted in.
    """
    if user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Doctors/admins only")

    cutoff = (datetime.now(timezone.utc) + timedelta(seconds=test_due_within_seconds)).isoformat()
    due = await db.followup_schedule.find(
        {"status": "pending", "due_at": {"$lte": cutoff}},
        {"_id": 0},
    ).to_list(200)

    sent = 0
    failures = 0
    for d in due:
        try:
            # Skip if patient has had a hold raised — don't pile on
            hold_alert = await db.doctor_alerts.find_one(
                {"patient_id": d["patient_id"], "rx_id": d["rx_id"], "kind": "safety_hold", "status": "open"},
                {"_id": 0, "id": 1},
            )
            if hold_alert:
                await db.followup_schedule.update_one(
                    {"id": d["id"]},
                    {"$set": {"status": "skipped", "reason": "open_safety_hold", "processed_at": _now_iso()}},
                )
                continue

            await db.followup_chats.insert_one({
                "id": str(uuid.uuid4()),
                "patient_id": d["patient_id"],
                "role": "assistant",
                "text": d["text"],
                "urgency": None,
                "created_at": _now_iso(),
                "kind": f"followup_{d['key']}",
                "meta": {"rx_id": d["rx_id"]},
            })

            # Push to WhatsApp if linked + reminders/summary enabled
            try:
                user_doc = await db.users.find_one(
                    {"linked_patient_id": d["patient_id"], "whatsapp_number": {"$exists": True, "$ne": None}},
                    {"_id": 0, "whatsapp_number": 1, "whatsapp_prefs": 1, "whatsapp_verified_at": 1},
                )
                if user_doc and _wa_can_send(user_doc, "send_reminders"):
                    from whatsapp_router import send_whatsapp as _wa_send_fu
                    await _wa_send_fu(user_doc["whatsapp_number"], d["text"])
            except Exception:
                logger.exception("followup WA push failed")

            await db.followup_schedule.update_one(
                {"id": d["id"]},
                {"$set": {"status": "sent", "processed_at": _now_iso()}},
            )
            sent += 1
        except Exception:
            logger.exception("followup tick item failed: %s", d.get("id"))
            failures += 1

    return {"processed": len(due), "sent": sent, "failures": failures}


@api_router.get("/followup/scheduler/queue")
async def followup_scheduler_queue(user: User = Depends(get_current_user)):
    """Doctor-only: read pending follow-up check-ins (debug + dashboard)."""
    if user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Doctors/admins only")
    items = await db.followup_schedule.find(
        {"status": {"$in": ["pending", "sent"]}},
        {"_id": 0},
    ).sort("due_at", 1).to_list(200)
    return {"items": items}


# ============================================================
# Seed
# ============================================================

@api_router.post("/seed")
async def seed_demo_data():
    """Public: seed demo patients, appointments, messages, lab results."""
    await db.patients.delete_many({"is_demo": True})
    await db.appointments.delete_many({"is_demo": True})
    await db.messages.delete_many({"is_demo": True})
    await db.lab_results.delete_many({"is_demo": True})

    demo = [
        {
            "personal_info": {"name": "Sarah Johnson", "age": 34, "gender": "Female", "phone": "+1-555-0101", "email": "sarah.j@example.com", "emergency_contact_name": "Mark Johnson", "emergency_contact_phone": "+1-555-0102"},
            "chief_complaint": "Intermittent chest pain for 2 days, radiating to left arm",
            "conditions": ["Hypertension"], "medications": [{"name": "Amlodipine 5mg", "frequency": "daily"}],
            "allergies": ["Penicillin"], "family_history": ["Father: MI at 55"],
        },
        {
            "personal_info": {"name": "Michael Chen", "age": 28, "gender": "Male", "phone": "+1-555-0201", "email": "mchen@example.com", "emergency_contact_name": "Lisa Chen", "emergency_contact_phone": "+1-555-0202"},
            "chief_complaint": "High fever (101°F), dry cough, body ache for 3 days",
            "conditions": [], "medications": [], "allergies": [], "family_history": [],
        },
        {
            "personal_info": {"name": "Emma Rodriguez", "age": 45, "gender": "Female", "phone": "+1-555-0301", "email": "emma.r@example.com", "emergency_contact_name": "Carlos Rodriguez", "emergency_contact_phone": "+1-555-0302"},
            "chief_complaint": "Type 2 Diabetes follow-up — HbA1c review",
            "conditions": ["Type 2 Diabetes Mellitus", "Obesity"],
            "medications": [{"name": "Metformin 1000mg", "frequency": "twice daily"}, {"name": "Lisinopril 10mg", "frequency": "daily"}],
            "allergies": ["Sulfa drugs"], "family_history": ["Mother: T2DM", "Sister: T2DM"],
        },
        {
            "personal_info": {"name": "David Kim", "age": 52, "gender": "Male", "phone": "+1-555-0401", "email": "dkim@example.com", "emergency_contact_name": "Jenny Kim", "emergency_contact_phone": "+1-555-0402"},
            "chief_complaint": "Hypertension follow-up, BP monitoring",
            "conditions": ["Essential Hypertension", "Hyperlipidemia"],
            "medications": [{"name": "Losartan 50mg", "frequency": "daily"}, {"name": "Atorvastatin 20mg", "frequency": "nightly"}],
            "allergies": [], "family_history": ["Father: HTN, CAD"],
        },
        {
            "personal_info": {"name": "Lisa Thompson", "age": 29, "gender": "Female", "phone": "+1-555-0501", "email": "lisa.t@example.com", "emergency_contact_name": "James Thompson", "emergency_contact_phone": "+1-555-0502"},
            "chief_complaint": "Prenatal consultation — 24 weeks gestation",
            "conditions": ["Pregnancy - G1P0 24 weeks"],
            "medications": [{"name": "Prenatal vitamins", "frequency": "daily"}, {"name": "Folic acid 400mcg", "frequency": "daily"}],
            "allergies": [], "family_history": [],
        },
    ]
    patients_created = []
    for p in demo:
        doc = {
            "id": str(uuid.uuid4()),
            "is_demo": True,
            "personal_info": p["personal_info"],
            "medical_history": {
                "chief_complaint": p["chief_complaint"],
                "current_conditions": p["conditions"], "past_conditions": [],
                "medications": p["medications"], "allergies": p["allergies"],
                "family_history": p["family_history"], "social_history": [],
            },
            "onboarding": {"questions": [], "answers": [], "completed": True, "completed_at": _now_iso()},
            "consultations": [],
            "timeline": [{"date": _now_iso(), "type": "registration", "summary": "Demo patient seeded"}],
            "risk_factors": [], "profile_completeness": 80,
            "created_at": _now_iso(), "updated_at": _now_iso(),
        }
        await db.patients.insert_one(doc.copy())
        doc.pop("_id", None)
        patients_created.append(doc)

    # Appointments for today + this week
    today = _now().date()
    appt_specs = [
        (0, "07:45", patients_created[0]["id"], "consultation", "Chest pain follow-up"),
        (0, "09:30", patients_created[1]["id"], "consultation", "Fever workup"),
        (0, "11:00", patients_created[2]["id"], "follow_up", "T2DM quarterly review"),
        (1, "08:15", patients_created[3]["id"], "follow_up", "HTN BP check"),
        (2, "10:00", patients_created[4]["id"], "consultation", "Prenatal visit 24w"),
        (3, "14:30", patients_created[0]["id"], "follow_up", "Cardiology referral review"),
    ]
    for dd, tm, pid, typ, reason in appt_specs:
        d = today + timedelta(days=dd)
        p = next(x for x in patients_created if x["id"] == pid)
        await db.appointments.insert_one({
            "id": str(uuid.uuid4()), "is_demo": True,
            "patient_id": pid, "patient_name": p["personal_info"]["name"],
            "doctor_id": "demo", "doctor_name": "Dr. Lahari",
            "date": d.isoformat(), "time": tm, "duration_min": 30,
            "type": typ, "reason": reason, "status": "scheduled",
            "created_at": _now_iso(),
        })

    # Messages
    msg_specs = [
        (patients_created[0]["id"], "patient", "Sarah Johnson", "Hi doctor, the chest pain came back this morning. Should I be worried?", True),
        (patients_created[0]["id"], "doctor", "Dr. Lahari", "Please take aspirin 75mg if not already done and come in today if it persists > 15 min.", True),
        (patients_created[2]["id"], "patient", "Emma Rodriguez", "My last HbA1c was 7.4 — is that improvement?", False),
        (patients_created[4]["id"], "patient", "Lisa Thompson", "Is it safe to take paracetamol during pregnancy?", False),
    ]
    for pid, sender, name, text, read in msg_specs:
        await db.messages.insert_one({
            "id": str(uuid.uuid4()), "is_demo": True,
            "patient_id": pid, "sender": sender, "sender_name": name,
            "text": text, "read": read, "created_at": _now_iso(),
        })

    # Lab results
    lab_specs = [
        (patients_created[0]["id"], "Troponin I", 0.02, "ng/mL", 0, 0.04),
        (patients_created[0]["id"], "LDL Cholesterol", 162, "mg/dL", 0, 130),
        (patients_created[2]["id"], "HbA1c", 7.4, "%", 4.0, 5.6),
        (patients_created[2]["id"], "Fasting Glucose", 142, "mg/dL", 70, 99),
        (patients_created[3]["id"], "Systolic BP", 148, "mmHg", 90, 130),
        (patients_created[4]["id"], "Hemoglobin", 11.8, "g/dL", 11.6, 15.0),
        (patients_created[1]["id"], "WBC", 12.5, "10^3/µL", 4.5, 11.0),
    ]
    for pid, test, val, unit, lo, hi in lab_specs:
        await db.lab_results.insert_one({
            "id": str(uuid.uuid4()), "is_demo": True,
            "patient_id": pid, "test_name": test, "value": val, "unit": unit,
            "ref_low": lo, "ref_high": hi, "flag": _flag(val, lo, hi),
            "date": _now_iso(), "ordered_by": "demo",
        })

    return {"patients": len(patients_created), "appointments": len(appt_specs), "messages": len(msg_specs), "lab_results": len(lab_specs)}


# ============================================================
# Phase 12 — Prescription Templates (doctor-owned reusable Rx packs)
# ============================================================

class TemplateMedItem(BaseModel):
    medication: str
    dose: str = ""
    frequency: str = ""
    duration: str = ""
    instructions: str = ""
    reason: str = ""


class TemplateTestItem(BaseModel):
    name: str
    urgency: str = "routine"  # routine | urgent | stat
    reason: str = ""


class TemplateBody(BaseModel):
    name: str
    icon: Optional[str] = "📋"
    condition_tags: List[str] = []
    medications: List[TemplateMedItem] = []
    tests: List[TemplateTestItem] = []
    advice: str = ""
    follow_up: str = ""


def _doctor_only(user: User) -> None:
    if user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Doctors only")


def _normalize_template_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc.pop("_id", None)
    return doc


@api_router.get("/templates")
async def list_templates(user: User = Depends(get_current_user)):
    _doctor_only(user)
    items = await db.rx_templates.find(
        {"doctor_id": user.user_id},
        {"_id": 0},
    ).sort([("usage_count", -1), ("updated_at", -1)]).to_list(200)
    return items


@api_router.post("/templates")
async def create_template(payload: TemplateBody, user: User = Depends(get_current_user)):
    _doctor_only(user)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name required")
    now = _now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "doctor_id": user.user_id,
        "name": name[:80],
        "icon": (payload.icon or "📋")[:6],
        "condition_tags": [str(t).strip()[:40] for t in (payload.condition_tags or []) if str(t).strip()][:8],
        "medications": [m.model_dump() for m in payload.medications],
        "tests": [t.model_dump() for t in payload.tests],
        "advice": (payload.advice or "")[:600],
        "follow_up": (payload.follow_up or "")[:200],
        "usage_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    await db.rx_templates.insert_one(doc.copy())
    return _normalize_template_doc(doc)


@api_router.get("/templates/{template_id}")
async def get_template(template_id: str, user: User = Depends(get_current_user)):
    _doctor_only(user)
    doc = await db.rx_templates.find_one({"id": template_id, "doctor_id": user.user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Template not found")
    return doc


@api_router.patch("/templates/{template_id}")
async def update_template(template_id: str, payload: TemplateBody, user: User = Depends(get_current_user)):
    _doctor_only(user)
    existing = await db.rx_templates.find_one({"id": template_id, "doctor_id": user.user_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name required")
    update = {
        "name": name[:80],
        "icon": (payload.icon or existing.get("icon") or "📋")[:6],
        "condition_tags": [str(t).strip()[:40] for t in (payload.condition_tags or []) if str(t).strip()][:8],
        "medications": [m.model_dump() for m in payload.medications],
        "tests": [t.model_dump() for t in payload.tests],
        "advice": (payload.advice or "")[:600],
        "follow_up": (payload.follow_up or "")[:200],
        "updated_at": _now_iso(),
    }
    await db.rx_templates.update_one({"id": template_id, "doctor_id": user.user_id}, {"$set": update})
    fresh = await db.rx_templates.find_one({"id": template_id, "doctor_id": user.user_id}, {"_id": 0})
    return fresh


@api_router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user: User = Depends(get_current_user)):
    _doctor_only(user)
    res = await db.rx_templates.delete_one({"id": template_id, "doctor_id": user.user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


@api_router.post("/templates/{template_id}/apply")
async def apply_template(template_id: str, user: User = Depends(get_current_user)):
    """Increment usage_count so 'most used' surfaces personalised templates first.
    Returns the updated template body so the client can pre-fill the Rx form.
    """
    _doctor_only(user)
    res = await db.rx_templates.find_one_and_update(
        {"id": template_id, "doctor_id": user.user_id},
        {"$inc": {"usage_count": 1}, "$set": {"last_used_at": _now_iso()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not res:
        raise HTTPException(status_code=404, detail="Template not found")
    return res


# ============================================================
# Phase 13 — Autonomous Co-Pilot (per-alert suggested actions)
# ============================================================

class AlertCopilotResp(BaseModel):
    actions: List[Dict[str, Any]] = []
    summary: str = ""


@api_router.post("/followup/alerts/{alert_id}/copilot")
async def alert_copilot(alert_id: str, user: User = Depends(get_current_user)):
    """Returns 1-3 AI-suggested next actions for an open alert.
    Each action: {kind: "draft_reply"|"order_lab"|"escalate"|"prescribe"|"schedule_followup",
                  title, why, suggested_text?, suggested_lab?, urgency?}.
    """
    if user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Doctors only")
    alert = await db.doctor_alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    patient = None
    if alert.get("patient_id"):
        patient = await db.patients.find_one({"id": alert["patient_id"]}, {"_id": 0})
    pi = (patient or {}).get("personal_info") or {}
    mh = (patient or {}).get("medical_history") or {}

    # Pull recent followup chat for context
    recent_msgs = await db.followup_chats.find(
        {"patient_id": alert.get("patient_id")}, {"_id": 0}
    ).sort("created_at", -1).limit(10).to_list(10)
    recent_msgs.reverse()
    chat_dump = "\n".join(f"{m.get('role','user').upper()}: {m.get('text','')}" for m in recent_msgs)[:2000]

    profile = json.dumps({
        "age": pi.get("age"), "gender": pi.get("gender"),
        "allergies": mh.get("allergies", []),
        "current_conditions": mh.get("current_conditions", []),
    }, default=str)

    system = (
        "You are a clinical decision-support assistant. The doctor sees an OPEN ALERT from Care AI. "
        "Suggest 1-3 next actions the doctor should consider, ordered by urgency. "
        "Output ONLY a JSON object with this shape:\n"
        '{"summary":"one-line situation read","actions":[{'
        '"kind":"draft_reply|order_lab|escalate|prescribe|schedule_followup",'
        '"title":"short action label","why":"plain-language reason (max 140 chars)",'
        '"suggested_text":"optional pre-drafted message to the patient (max 200 chars)",'
        '"suggested_lab":"optional lab/test name if kind=order_lab",'
        '"urgency":"routine|urgent|stat"}]}\n'
        "Rules: be conservative. Never recommend diagnostic conclusions. Max 3 actions. "
        "If the alert is low/info urgency, suggesting one 'draft_reply' is enough. "
        "If the alert is emergency/high, include at least one escalate or order_lab."
    )
    user_text = (
        f"PATIENT: {profile}\n"
        f"ALERT: urgency={alert.get('urgency')} · topic={alert.get('topic')} · summary={alert.get('summary','')}\n"
        f"PATIENT_MESSAGE_TRIGGER: {alert.get('patient_message','')}\n"
        f"AI_REPLY_SO_FAR: {alert.get('ai_reply','')}\n\n"
        f"RECENT CHAT (most recent last):\n{chat_dump or '(none)'}\n\n"
        "Return JSON per the contract."
    )

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"alert-copilot-{uuid.uuid4().hex[:8]}",
            system_message=system,
        ).with_model("openai", "gpt-4o")
        raw = await chat.send_message(UserMessage(text=user_text))
        raw = _strip_json_fence(raw or "")
        data = json.loads(raw)
    except Exception:
        logger.exception("alert-copilot LLM failed")
        data = {"summary": "", "actions": []}

    actions = []
    for it in (data.get("actions") or [])[:3]:
        if not isinstance(it, dict):
            continue
        kind = (it.get("kind") or "draft_reply").lower()
        if kind not in {"draft_reply", "order_lab", "escalate", "prescribe", "schedule_followup"}:
            kind = "draft_reply"
        urgency = (it.get("urgency") or "routine").lower()
        if urgency not in {"routine", "urgent", "stat"}:
            urgency = "routine"
        actions.append({
            "kind": kind,
            "title": (it.get("title") or "").strip()[:60],
            "why": (it.get("why") or "").strip()[:140],
            "suggested_text": (it.get("suggested_text") or "").strip()[:240],
            "suggested_lab": (it.get("suggested_lab") or "").strip()[:80],
            "urgency": urgency,
        })
    return {"summary": (data.get("summary") or "").strip()[:160], "actions": actions}


@api_router.get("/whatsapp/activity")
async def whatsapp_activity(user: User = Depends(get_current_user)):
    """Doctor-only — last 24h WhatsApp follow-up activity grouped by patient.
    Phase 19: sorts safety/escalation mode threads to the top (real-time triage)."""
    if user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Doctors only")
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    msgs = await db.followup_chats.find(
        {"source": "whatsapp", "created_at": {"$gte": since}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    # Group by patient
    by_pid: Dict[str, Dict[str, Any]] = {}
    for m in msgs:
        pid = m.get("patient_id")
        if not pid:
            continue
        if pid not in by_pid:
            by_pid[pid] = {
                "patient_id": pid,
                "last_message": m.get("text", "")[:120],
                "last_role": m.get("role"),
                "last_at": m.get("created_at"),
                "has_voice": False,
                "messages_24h": 0,
                "urgency": None,
                "mode": None,
                "risk": None,
            }
        e = by_pid[pid]
        e["messages_24h"] += 1
        if m.get("media_type") == "voice":
            e["has_voice"] = True
        if m.get("urgency") and not e["urgency"]:
            e["urgency"] = m.get("urgency")
        # Phase 19 — pick the most recent AI mode/risk for this thread
        if m.get("role") == "assistant" and not e["mode"] and m.get("mode"):
            e["mode"] = m.get("mode")
            e["risk"] = m.get("risk")

    if not by_pid:
        return {"threads": [], "total_messages": 0}

    patients = await db.patients.find(
        {"id": {"$in": list(by_pid.keys())}},
        {"_id": 0, "id": 1, "personal_info": 1},
    ).to_list(200)
    patient_map = {p["id"]: (p.get("personal_info") or {}).get("name", "Patient") for p in patients}
    threads = []
    for pid, e in by_pid.items():
        e["patient_name"] = patient_map.get(pid, "Patient")
        threads.append(e)

    # Triage sort: safety/escalation first → risk=unsafe → emergency/high urgency → most recent
    _MODE_PRIORITY = {"safety": 0, "escalation": 1, "inquiry": 2, "reasoning": 3, "action": 4, "delay": 5}
    _URG_PRIORITY = {"emergency": 0, "high": 1, "medium": 2, "low": 3, None: 4}
    _RISK_PRIORITY = {"unsafe": 0, "caution": 1, "safe": 2, None: 3}
    threads.sort(key=lambda t: (
        _MODE_PRIORITY.get(t.get("mode"), 9),
        _RISK_PRIORITY.get(t.get("risk"), 9),
        _URG_PRIORITY.get(t.get("urgency"), 9),
        -(t["last_at"] or "").__hash__(),  # stable tie-break on recency (string reverse)
    ))
    # Final recency sort within same mode bucket
    threads.sort(key=lambda t: (
        _MODE_PRIORITY.get(t.get("mode"), 9),
        t.get("last_at") or "",
    ), reverse=False)
    # Simpler — keep recency within bucket
    threads.sort(key=lambda t: _MODE_PRIORITY.get(t.get("mode"), 9))
    return {"threads": threads, "total_messages": len(msgs)}


# ============================================================
# App setup
# ============================================================

app.include_router(api_router)

# WhatsApp adapter (thin) — reuses the existing Care AI brain, language, triage, alerts.
from whatsapp_router import build_whatsapp_router as _build_wa
app.include_router(
    _build_wa(
        db=db,
        get_current_user=get_current_user,
        followup_llm_call=_followup_llm_call,
        parse_triage=_parse_triage,
        now_iso=_now_iso,
        language_names=LANGUAGE_NAMES,
        stt_transcribe=_whisper_transcribe_bytes,
        tts_synth=_tts_synth_bytes,
        vision_interpret=_vision_interpret_image,
    ),
    prefix="/api/whatsapp",
)

# CORS — explicit origin list. NEVER use "*" with allow_credentials=True (browsers reject it).
# Override via CORS_ORIGINS env (comma-separated) per deploy. Wildcards are stripped.
_DEFAULT_CORS_ORIGINS = ",".join([
    "https://projectcareai.net",
    "https://www.projectcareai.net",
    "https://patient-care-121.emergent.host",
   
    "http://localhost:3000",
])
_cors_raw = os.environ.get("CORS_ORIGINS", _DEFAULT_CORS_ORIGINS)
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip() and o.strip() != "*"]
if not _cors_origins:
    _cors_origins = [o.strip() for o in _DEFAULT_CORS_ORIGINS.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_scheduler():
    """Phase 19 — Background task: tick the follow-up scheduler every 15 min."""
    async def _tick_loop():
        await asyncio.sleep(30)  # let the app finish warming
        while True:
            try:
                cutoff = datetime.now(timezone.utc).isoformat()
                due = await db.followup_schedule.find(
                    {"status": "pending", "due_at": {"$lte": cutoff}},
                    {"_id": 0},
                ).to_list(200)
                for d in due:
                    try:
                        hold_alert = await db.doctor_alerts.find_one(
                            {"patient_id": d["patient_id"], "rx_id": d.get("rx_id"),
                             "kind": "safety_hold", "status": "open"},
                            {"_id": 0, "id": 1},
                        )
                        if hold_alert:
                            await db.followup_schedule.update_one(
                                {"id": d["id"]},
                                {"$set": {"status": "skipped", "reason": "open_safety_hold",
                                          "processed_at": _now_iso()}},
                            )
                            continue
                        await db.followup_chats.insert_one({
                            "id": str(uuid.uuid4()),
                            "patient_id": d["patient_id"],
                            "role": "assistant",
                            "text": d["text"],
                            "urgency": None,
                            "created_at": _now_iso(),
                            "kind": f"followup_{d['key']}",
                            "meta": {"rx_id": d.get("rx_id")},
                        })
                        user_doc = await db.users.find_one(
                            {"linked_patient_id": d["patient_id"],
                             "whatsapp_number": {"$exists": True, "$ne": None}},
                            {"_id": 0, "whatsapp_number": 1, "whatsapp_prefs": 1,
                             "whatsapp_verified_at": 1},
                        )
                        if user_doc and _wa_can_send(user_doc, "send_reminders"):
                            try:
                                from whatsapp_router import send_whatsapp as _wa_send_fu
                                await _wa_send_fu(user_doc["whatsapp_number"], d["text"])
                            except Exception:
                                logger.exception("scheduler WA push failed")
                        await db.followup_schedule.update_one(
                            {"id": d["id"]},
                            {"$set": {"status": "sent", "processed_at": _now_iso()}},
                        )
                    except Exception:
                        logger.exception("scheduler item failed: %s", d.get("id"))
                if due:
                    logger.info("[followup-scheduler] processed %d items", len(due))
            except Exception:
                logger.exception("follow-up scheduler tick failed")
            await asyncio.sleep(15 * 60)  # 15 minutes

    asyncio.create_task(_tick_loop())
    logger.info("[followup-scheduler] background task started (15-min interval)")


@app.on_event("startup")
async def startup_seed():
    try:
        count = await db.patients.count_documents({})
        if count == 0:
            logger.info("DB empty — running seed")
            await seed_demo_data()
    except Exception as e:
        logger.warning(f"Startup seed failed: {e}")
    try:
        await ensure_canonical_accounts()
    except Exception as e:
        logger.warning(f"Canonical account seed failed: {e}")


async def ensure_canonical_accounts():
    """Idempotent: guarantees the demo doctor and demo patient accounts exist
    AND have the canonical password (123456). Runs on every backend startup so
    a fresh deploy / fresh DB / stale DB never breaks sign-in for the PM demo.

    Force-resets the password hash on every startup so even if the account exists
    in prod Mongo with an older hash (e.g. password was once changed), login
    with 123456 always works after a redeploy.
    """
    canonical_password = "123456"

    # ---- Doctor: idrlapt@gmail.com ----
    doc_email = DOCTOR_EMAIL  # "idrlapt@gmail.com"
    doctor = await db.users.find_one({"email": doc_email}, {"_id": 0})
    if not doctor:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": doc_email,
            "name": "Dr. Lahari",
            "picture": "",
            "role": "doctor",
            "linked_patient_id": None,
            "password_hash": pwd_ctx.hash(canonical_password),
            "bio": "Internal medicine specialist focusing on preventive care, chronic conditions, and AI-assisted triage. 24/7 follow-up via Care AI.",
            "department": "general",
            "experience_years": 12,
            "languages": ["English", "Hindi", "Telugu", "Tamil"],
            "rating": 4.9,
            "specialization": "General Physician",
            "created_at": _now_iso(),
        })
        logger.info(f"Seeded canonical doctor account: {doc_email}")
    else:
        # Force-reset password + role on every startup so the demo login is bulletproof.
        await db.users.update_one(
            {"email": doc_email},
            {"$set": {
                "password_hash": pwd_ctx.hash(canonical_password),
                "role": "doctor",
                "name": doctor.get("name") or "Dr. Lahari",
            }},
        )
        logger.info(f"Reset canonical doctor password: {doc_email}")

    # ---- Demo patient: drgapt@gmail.com ----
    pat_email = "drgapt@gmail.com"
    patient_user = await db.users.find_one({"email": pat_email}, {"_id": 0})
    if not patient_user:
        # Auto-create a linked patient record so /portal works immediately.
        linked_pid = str(uuid.uuid4())
        await db.patients.insert_one({
            "id": linked_pid,
            "personal_info": {"name": "Demo", "email": pat_email},
            "medical_history": {"allergies": [], "current_medications": [], "current_conditions": []},
            "chief_complaint": "",
            "consultations": [],
            "consultation_count": 0,
            "profile_completeness": 10,
            "onboarding": {},
            "created_at": _now_iso(),
            "is_demo": False,
        })
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": pat_email,
            "name": "Demo",
            "picture": "",
            "role": "patient",
            "linked_patient_id": linked_pid,
            "password_hash": pwd_ctx.hash(canonical_password),
            "created_at": _now_iso(),
        })
        logger.info(f"Seeded canonical demo patient account: {pat_email}")
    else:
        # Ensure password works AND that the user has a linked patient record.
        update_doc = {
            "password_hash": pwd_ctx.hash(canonical_password),
            "role": "patient",
        }
        if not patient_user.get("linked_patient_id"):
            linked_pid = str(uuid.uuid4())
            await db.patients.insert_one({
                "id": linked_pid,
                "personal_info": {"name": patient_user.get("name") or "Demo", "email": pat_email},
                "medical_history": {"allergies": [], "current_medications": [], "current_conditions": []},
                "chief_complaint": "",
                "consultations": [],
                "consultation_count": 0,
                "profile_completeness": 10,
                "onboarding": {},
                "created_at": _now_iso(),
                "is_demo": False,
            })
            update_doc["linked_patient_id"] = linked_pid
        await db.users.update_one({"email": pat_email}, {"$set": update_doc})
        logger.info(f"Reset canonical demo patient password: {pat_email}")
    # ---- Admin: admin@careai.dev ----
    admin_email = "admin@careai.dev"

    admin_user = await db.users.find_one(
        {"email": admin_email},
        {"_id": 0}
    )

    if not admin_user:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": admin_email,
            "name": "CARE Admin",
            "picture": "",
            "role": "admin",
            "linked_patient_id": None,
            "password_hash": pwd_ctx.hash("admin123"),
            "created_at": _now_iso(),
        })

        logger.info(f"Seeded canonical admin account: {admin_email}")

    else:
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {
                "password_hash": pwd_ctx.hash("admin123"),
                "role": "admin",
                "name": admin_user.get("name") or "CARE Admin",
            }},
        )

        logger.info(f"Reset canonical admin password: {admin_email}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
import uvicorn

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
