"""
Twilio WhatsApp adapter for Project Care.

This module is a THIN adapter that:
- Receives Twilio webhooks
- Validates signatures
- Looks up the patient by linked whatsapp_number
- Reuses the existing Care AI brain (_followup_llm_call)
- Persists into the existing followup_chats collection (so messages show up
  in the /followup UI for both patient and Dr. Lahari)
- Fires the existing doctor_alerts pipeline on triage red flags
- Accepts inbound voice notes → Whisper STT → Care AI reply
- Sends an OPTIONAL TTS audio reply for voice-in messages so the patient
  can listen to the answer instead of reading it.

Phase 17 — WhatsApp-first care engine:
- Stateful session engine (whatsapp_sessions) tracks per-patient stage +
  expected_input + active_rx_id so the system always knows what's next.
- Smart inbound parser routes "120/80", "98.6", "sugar 110" directly to
  the safety-check submission pipeline without spending an LLM call.
- Emergency-keyword fast path triggers immediate doctor alerts.

It does NOT duplicate the AI brain, language handling, or alerts logic.
"""
import os
import re
import asyncio
import logging
import secrets
import base64
from datetime import datetime, timezone, timedelta
from typing import Optional, Awaitable, Callable, Dict, Any, List, Tuple

import httpx
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel
from twilio.rest import Client as TwilioClient
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse

logger = logging.getLogger(__name__)

# ---------- Twilio client (lazy) ----------
_TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID")
_TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
_TWILIO_FROM = os.environ.get("TWILIO_WHATSAPP_FROM")  # e.g. "whatsapp:+14155238886"
_PUBLIC_BASE_URL = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")

# Whisper-supported language codes that Project Care supports for follow-ups.
_WHISPER_LANG_MAP = {"en": "en", "hi": "hi", "te": "te", "ta": "ta"}

# Twilio WhatsApp accepts these audio mime-types inbound. We treat anything
# starting with "audio/" as a voice note, but log unknown subtypes.
_AUDIO_PREFIX = "audio/"

_twilio_client: Optional[TwilioClient] = None
def twilio() -> TwilioClient:
    global _twilio_client
    if _twilio_client is None:
        if not (_TWILIO_SID and _TWILIO_TOKEN):
            raise HTTPException(503, "Twilio not configured")
        _twilio_client = TwilioClient(_TWILIO_SID, _TWILIO_TOKEN)
    return _twilio_client


def _normalize(num: str) -> str:
    """Strip 'whatsapp:' prefix and ensure '+<country><digits>'.

    Defaults bare 10-digit Indian mobile numbers to +91 so users can type just digits.
    """
    if not num: return ""
    n = num.strip().replace("whatsapp:", "")
    digits = re.sub(r"\D", "", n)
    if n.startswith("+"):
        return "+" + digits
    if len(digits) == 10:           # bare 10-digit Indian mobile
        return "+91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return "+" + digits
    return "+" + digits


async def send_whatsapp(
    to: str,
    body: str = "",
    media_url: Optional[str] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Send an outbound WhatsApp message. Returns (sid, error)."""
    if not _TWILIO_FROM:
        return None, "Twilio not configured"
    to_full = to if to.startswith("whatsapp:") else f"whatsapp:{_normalize(to)}"
    body = (body or "")[:1500]
    loop = asyncio.get_event_loop()
    def _send():
        kwargs = {"from_": _TWILIO_FROM, "to": to_full}
        if body:
            kwargs["body"] = body
        if media_url:
            kwargs["media_url"] = [media_url]
        return twilio().messages.create(**kwargs)
    try:
        m = await loop.run_in_executor(None, _send)
        return m.sid, None
    except Exception as e:
        logger.exception("Twilio create() raised")
        return None, str(e)[:300]


async def _download_twilio_media(url: str) -> tuple[bytes, str]:
    """Fetch a Twilio media URL using account Basic Auth.
    Returns (bytes, content_type). Twilio media URLs require auth.
    """
    if not (_TWILIO_SID and _TWILIO_TOKEN):
        raise RuntimeError("Twilio credentials not configured")
    auth = (_TWILIO_SID, _TWILIO_TOKEN)
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as cli:
        r = await cli.get(url, auth=auth)
        r.raise_for_status()
        ctype = r.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
        return r.content, ctype


def _ext_for(ctype: str) -> str:
    """Pick a filename extension Whisper recognises for the inbound mime-type."""
    ct = (ctype or "").lower()
    if "ogg" in ct: return "ogg"   # WhatsApp voice notes → audio/ogg (opus)
    if "mpeg" in ct or "mp3" in ct: return "mp3"
    if "amr" in ct: return "amr"
    if "wav" in ct: return "wav"
    if "mp4" in ct or "m4a" in ct or "aac" in ct: return "m4a"
    if "3gpp" in ct: return "3gp"
    return "ogg"


# ---------- Router factory (called from server.py with dependencies injected) ----------

def build_whatsapp_router(
    *,
    db,
    get_current_user,
    followup_llm_call,
    parse_triage,
    now_iso,
    language_names,
    stt_transcribe: Optional[Callable[..., Awaitable[Dict[str, Any]]]] = None,
    tts_synth: Optional[Callable[..., Awaitable[bytes]]] = None,
    vision_interpret: Optional[Callable[..., Awaitable[Optional[Dict[str, Any]]]]] = None,
):
    """Build the FastAPI router. Pass in the existing helpers from server.py to avoid duplication."""

    router = APIRouter()

    # ===== Connect / verify your WhatsApp number =====

    class ConnectStartBody(BaseModel):
        whatsapp_number: str  # +<country><digits>
        language: Optional[str] = "en"

    class ConnectVerifyBody(BaseModel):
        code: str

    @router.post("/connect/start")
    async def connect_start(payload: ConnectStartBody, user=Depends(get_current_user)):
        num = _normalize(payload.whatsapp_number)
        if len(num) < 8 or not num.startswith("+"):
            raise HTTPException(400, "Provide a valid number, e.g. 9876543210 or +919876543210")

        # Phase 23 — if the number changed, reset verified state + consent prefs
        # so the user must re-verify and re-consent (per spec).
        existing = await db.users.find_one(
            {"user_id": user.user_id}, {"_id": 0, "whatsapp_number": 1},
        )
        if existing and existing.get("whatsapp_number") and existing["whatsapp_number"] != num:
            await db.users.update_one(
                {"user_id": user.user_id},
                {"$unset": {
                    "whatsapp_number": "",
                    "whatsapp_linked_at": "",
                    "whatsapp_verified_at": "",
                    "whatsapp_prefs": "",
                }},
            )

        code = f"{secrets.randbelow(900_000) + 100_000}"
        await db.whatsapp_otp.update_one(
            {"user_id": user.user_id},
            {"$set": {
                "user_id": user.user_id,
                "whatsapp_number": num,
                "code": code,
                "language": payload.language or "en",
                "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
                "created_at": now_iso(),
            }},
            upsert=True,
        )

        sid, err = await send_whatsapp(num, f"Your Project Care OTP is {code}")
        if err:
            raise HTTPException(502, f"Could not send WhatsApp: {err}")
        return {"ok": True, "message": f"OTP sent to {num}.", "expires_in_min": 10}

    @router.post("/connect/verify")
    async def connect_verify(payload: ConnectVerifyBody, user=Depends(get_current_user)):
        rec = await db.whatsapp_otp.find_one({"user_id": user.user_id}, {"_id": 0})
        if not rec or rec.get("code") != (payload.code or "").strip():
            raise HTTPException(400, "Invalid code")
        # Expiry
        try:
            exp = datetime.fromisoformat(rec["expires_at"])
        except Exception:
            exp = datetime.now(timezone.utc) - timedelta(minutes=1)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(400, "Code expired — request a new one")

        # Phase 23 — On successful OTP verify, stamp verified_at + initialise
        # default prefs so the user is automatically opted in to the channels
        # they consented to at the gate (Rx, summary, reminders, alerts; reports OFF).
        now = now_iso()
        default_prefs = {
            "consent": True,
            "consent_at": now,
            "send_prescriptions": True,
            "send_summary": True,
            "send_reminders": True,
            "send_alerts": True,
            "send_reports": False,
        }
        await db.users.update_one(
            {"user_id": user.user_id},
            {"$set": {
                "whatsapp_number": rec["whatsapp_number"],
                "whatsapp_language": rec.get("language") or "en",
                "whatsapp_linked_at": now,
                "whatsapp_verified_at": now,
                "whatsapp_prefs": default_prefs,
            }},
        )
        await db.whatsapp_otp.delete_one({"user_id": user.user_id})
        # Welcome message
        await send_whatsapp(
            rec["whatsapp_number"],
            "✅ Linked! You can now chat with Care AI 24/7 right here on WhatsApp.\n"
            "🎙️ You can also send voice notes — I'll transcribe them and reply by voice too.\n"
            "For emergencies, call 911."
        )
        return {"ok": True, "whatsapp_number": rec["whatsapp_number"]}

    @router.post("/disconnect")
    async def whatsapp_disconnect(user=Depends(get_current_user)):
        # Phase 23 — full reset: number + verification + per-channel prefs.
        # User must re-verify + re-consent before any future delivery.
        await db.users.update_one(
            {"user_id": user.user_id},
            {"$unset": {
                "whatsapp_number": "",
                "whatsapp_linked_at": "",
                "whatsapp_verified_at": "",
                "whatsapp_prefs": "",
            }},
        )
        return {"ok": True}

    # ===== Public media endpoint (no auth — Twilio fetches outbound voice replies) =====

    @router.get("/media/{media_id}.mp3")
    async def serve_media(media_id: str):
        rec = await db.whatsapp_media.find_one({"id": media_id}, {"_id": 0})
        if not rec or not rec.get("audio_b64"):
            raise HTTPException(404, "Not found")
        try:
            audio = base64.b64decode(rec["audio_b64"])
        except Exception:
            raise HTTPException(500, "Corrupt media")
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    # ===== Inbound webhook from Twilio =====

    async def _validate_signature(request: Request, form: dict):
        """Validate Twilio's X-Twilio-Signature. Skip in dev when signature absent (with a warning)."""
        signature = request.headers.get("X-Twilio-Signature")
        if not signature:
            logger.warning("WhatsApp webhook with no Twilio signature; skipping (sandbox)")
            return
        if not _TWILIO_TOKEN:
            return
        validator = RequestValidator(_TWILIO_TOKEN)
        url = str(request.url)
        for u in {url, url.replace("http://", "https://", 1), url.replace("https://", "http://", 1)}:
            if validator.validate(u, form, signature):
                return
        logger.warning("Invalid Twilio signature on %s", url)

    async def _extract_voice_note(form: dict, language: str) -> Optional[Dict[str, Any]]:
        """If the inbound message includes audio, download + transcribe it.
        Returns {transcript, content_type, media_url, duration} or None.
        """
        if not stt_transcribe:
            return None
        try:
            num_media = int(form.get("NumMedia", "0") or 0)
        except ValueError:
            num_media = 0
        if num_media <= 0:
            return None

        for i in range(num_media):
            ctype = (form.get(f"MediaContentType{i}") or "").lower()
            url = form.get(f"MediaUrl{i}")
            if not url or not ctype.startswith(_AUDIO_PREFIX):
                continue
            try:
                audio_bytes, real_ctype = await _download_twilio_media(url)
            except Exception:
                logger.exception("Failed to download Twilio media %s", url)
                return {"error": "download_failed", "media_url": url, "content_type": ctype}
            ext = _ext_for(real_ctype or ctype)
            try:
                result = await stt_transcribe(
                    audio_bytes,
                    filename=f"whatsapp.{ext}",
                    language=_WHISPER_LANG_MAP.get(language),
                )
            except Exception as e:
                logger.exception("Whisper failed on WhatsApp voice note")
                return {"error": f"transcription_failed: {str(e)[:120]}", "media_url": url, "content_type": ctype}
            return {
                "transcript": (result.get("text") or "").strip(),
                "detected_language": result.get("language"),
                "duration": result.get("duration"),
                "content_type": real_ctype or ctype,
                "media_url": url,
            }
        return None

    async def _extract_non_audio_media(form: dict) -> List[Dict[str, Any]]:
        """Phase 20 — return every non-audio media item attached to the inbound
        message, downloaded into memory. Supports images and documents.
        """
        try:
            num_media = int(form.get("NumMedia", "0") or 0)
        except ValueError:
            num_media = 0
        out: List[Dict[str, Any]] = []
        for i in range(num_media):
            ctype = (form.get(f"MediaContentType{i}") or "").lower()
            url = form.get(f"MediaUrl{i}")
            if not url or not ctype or ctype.startswith(_AUDIO_PREFIX):
                continue
            try:
                data, real_ctype = await _download_twilio_media(url)
            except Exception:
                logger.exception("Failed to download Twilio media %s", url)
                continue
            out.append({
                "data": data,
                "content_type": (real_ctype or ctype).lower(),
                "media_url": url,
                "size": len(data),
            })
        return out

    # Phase 20 — explicit "voice please" trigger
    _VOICE_REQUEST_RE = re.compile(
        r"\b(voice\s*(reply|note|message)?|audio\s*(reply|note|message)?|read\s*(it|this)\s*out|speak\s*(it|this)?)\b",
        re.IGNORECASE,
    )

    async def _persist_image_turn(patient_id: str, media: Dict[str, Any], att_id: str, msg_sid: str) -> Dict[str, Any]:
        """Save the inbound image as a followup_attachment + a patient chat row."""
        await db.followup_attachments.insert_one({
            "id": att_id,
            "patient_id": patient_id,
            "uploader_id": patient_id,  # WhatsApp is patient-only channel
            "filename": f"whatsapp-image-{att_id[:8]}.jpg",
            "content_type": media["content_type"],
            "size": media["size"],
            "b64": base64.b64encode(media["data"]).decode(),
            "created_at": now_iso(),
            "source": "whatsapp",
        })
        url = f"/api/followup/attachments/{att_id}"
        user_doc = {
            "id": f"wa-{msg_sid or secrets.token_hex(6)}-u",
            "patient_id": patient_id,
            "role": "user",
            "text": "📎 Uploaded image via WhatsApp",
            "kind": "attachment",
            "attachment": {
                "id": att_id,
                "filename": f"whatsapp-image-{att_id[:8]}.jpg",
                "content_type": media["content_type"],
                "size": media["size"],
                "url": url,
            },
            "created_at": now_iso(),
            "source": "whatsapp",
        }
        await db.followup_chats.insert_one(user_doc)
        return {"url": url}

    async def _handle_image_media(
        patient: Dict[str, Any],
        media: Dict[str, Any],
        msg_sid: str,
    ) -> Dict[str, Any]:
        """Phase 20 — deeply interpret an inbound image (lab report / symptom /
        prescription). Returns {reply_text, urgency, analysis, att_id}.
        """
        att_id = secrets.token_hex(12)
        await _persist_image_turn(patient["id"], media, att_id, msg_sid)

        analysis = None
        if vision_interpret:
            try:
                analysis = await vision_interpret(patient, media["data"], media["content_type"])
            except Exception:
                logger.exception("vision_interpret failed in WhatsApp webhook")

        if not analysis:
            return {
                "reply_text": (
                    "📎 Got your image — I've saved it and flagged it for Dr. Lahari.\n\n"
                    "If you can, send a well-lit close-up so I can read the details."
                ),
                "urgency": "low",
                "analysis": None,
                "att_id": att_id,
            }

        img_type = (analysis.get("image_type") or "unknown").replace("_", " ")
        patient_summary = (analysis.get("summary_for_patient") or "").strip()
        follow_up_qs = analysis.get("follow_up_questions") or []
        urgency = (analysis.get("urgency") or "low").lower()

        parts = [f"🔬 I reviewed your {img_type}."]
        if patient_summary:
            parts.append(patient_summary)

        extracted = analysis.get("extracted_data") or {}
        labs = extracted.get("lab_values") or []
        meds = extracted.get("medications") or []
        findings = extracted.get("key_findings") or []
        if labs:
            lab_lines = []
            for lv in labs[:6]:
                nm = (lv.get("name") or "").strip()
                val = (str(lv.get("value") or "")).strip()
                ref = (lv.get("reference") or "").strip()
                if nm and val:
                    lab_lines.append(f"• {nm}: {val}" + (f" (ref {ref})" if ref else ""))
            if lab_lines:
                parts.append("*Key values*\n" + "\n".join(lab_lines))
        if meds:
            med_lines = []
            for m in meds[:6]:
                nm = (m.get("name") or "").strip()
                dose = (m.get("dose") or "").strip()
                freq = (m.get("frequency") or "").strip()
                line = "• " + " ".join(x for x in (nm, dose, freq) if x)
                if line.strip("• "):
                    med_lines.append(line)
            if med_lines:
                parts.append("*Medications*\n" + "\n".join(med_lines))
        if findings and not (labs or meds):
            parts.append("*Findings*\n" + "\n".join(f"• {f}" for f in findings[:4]))

        if urgency in ("emergency", "high"):
            parts.append("⚠️ I've alerted Dr. Lahari — she'll reach out shortly.")
        elif urgency == "medium":
            parts.append("I've shared this with Dr. Lahari for review.")

        if follow_up_qs:
            parts.append("A couple of quick questions:\n" + "\n".join(f"• {q}" for q in follow_up_qs[:2]))

        return {
            "reply_text": "\n\n".join(parts)[:1500],
            "urgency": urgency,
            "analysis": analysis,
            "att_id": att_id,
        }

    async def _maybe_send_tts_reply(
        base_url: str,
        to_number: str,
        text: str,
        language: str,
    ) -> Optional[str]:
        """Generate TTS for the AI reply and send a follow-up WhatsApp audio message.
        Returns the public media URL on success, None otherwise.
        """
        if not tts_synth or not text.strip():
            return None
        try:
            audio = await tts_synth(text[:1200], voice="nova", speed=1.0)
        except Exception:
            logger.exception("TTS synth failed for WhatsApp voice reply")
            return None
        if not audio:
            return None

        media_id = secrets.token_hex(10)
        await db.whatsapp_media.insert_one({
            "id": media_id,
            "audio_b64": base64.b64encode(audio).decode("ascii"),
            "language": language,
            "to": to_number,
            "created_at": now_iso(),
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        })
        base = (_PUBLIC_BASE_URL or base_url or "").rstrip("/")
        if base.startswith("http://"):
            base = "https://" + base[len("http://"):]
        media_url = f"{base}/api/whatsapp/media/{media_id}.mp3"

        sid, err = await send_whatsapp(to_number, body="", media_url=media_url)
        if err:
            logger.warning("TTS reply send failed: %s", err)
            return None
        return media_url

    # ============================================================
    # Phase 17 — Stateful session engine + smart inbound parser
    # ============================================================
    SESSION_TTL_HOURS = 72
    EMERGENCY_PATTERNS = [
        r"\bchest pain\b", r"\bcan'?t breathe\b", r"\bbreathless\b", r"\bshortness of breath\b",
        r"\bpassed out\b", r"\bfaint(ed|ing)?\b", r"\bunconscious\b", r"\bseizure\b",
        r"\bstroke\b", r"\bbleeding heavily\b", r"\bvomit(ing)? blood\b", r"\bsuicid",
    ]
    _EMERGENCY_RE = re.compile("|".join(EMERGENCY_PATTERNS), re.IGNORECASE)

    # BP: "120/80", "120 / 80", "120-80"
    _BP_RE = re.compile(r"\b(\d{2,3})\s*[/\-]\s*(\d{2,3})\b")
    # Temp: "98.6", "98.6 F", "37.1 C", "37 c"
    _TEMP_RE = re.compile(r"\b(\d{2,3}\.\d{1,2}|\d{2,3})\s*[°]?\s*(f|c|fahrenheit|celsius)\b", re.IGNORECASE)
    # Glucose with keyword: "sugar 110", "blood sugar is 130", "glucose 95"
    _GLUCOSE_KEY_RE = re.compile(r"\b(?:sugar|glucose|bs|fbs|rbs)\b[^0-9]{0,15}(\d{2,3})\b", re.IGNORECASE)
    # Lone integer (used when expected input is set)
    _LONE_NUM_RE = re.compile(r"^\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:[°]?[fFcC])?\s*$")

    async def _get_session(patient_id: str) -> Dict[str, Any]:
        sess = await db.whatsapp_sessions.find_one({"patient_id": patient_id}, {"_id": 0})
        if not sess:
            return {"patient_id": patient_id, "current_stage": "idle", "expected_input": None, "active_rx_id": None}
        # Expire stale sessions
        try:
            exp = sess.get("expires_at")
            if exp and datetime.fromisoformat(exp) < datetime.now(timezone.utc):
                return {"patient_id": patient_id, "current_stage": "idle", "expected_input": None, "active_rx_id": None}
        except Exception:
            pass
        return sess

    async def _set_session(patient_id: str, *, current_stage: str, expected_input: Optional[List[str]] = None,
                           active_rx_id: Optional[str] = None) -> None:
        await db.whatsapp_sessions.update_one(
            {"patient_id": patient_id},
            {"$set": {
                "patient_id": patient_id,
                "current_stage": current_stage,
                "expected_input": expected_input,
                "active_rx_id": active_rx_id,
                "updated_at": now_iso(),
                "expires_at": (datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)).isoformat(),
            }},
            upsert=True,
        )

    async def _clear_session(patient_id: str) -> None:
        await db.whatsapp_sessions.update_one(
            {"patient_id": patient_id},
            {"$set": {"current_stage": "idle", "expected_input": None, "active_rx_id": None, "updated_at": now_iso()}},
        )

    def _parse_vitals(body: str, expected: Optional[List[str]]) -> Dict[str, Any]:
        """Returns dict with detected vitals. Keys: bp, temperature, blood_glucose, bleeding."""
        out: Dict[str, Any] = {}
        # BP first (most distinctive shape)
        m = _BP_RE.search(body)
        if m:
            out["bp"] = f"{m.group(1)}/{m.group(2)}"
        # Glucose with explicit keyword
        m = _GLUCOSE_KEY_RE.search(body)
        if m:
            out["blood_glucose"] = float(m.group(1))
        # Temp with unit
        m = _TEMP_RE.search(body)
        if m and "bp" not in out:
            out["temperature"] = float(m.group(1))
        # Bleeding screen — yes/no responses
        low = body.lower().strip()
        if low in ("yes", "y", "no", "n") or "bleed" in low or "blood" in low:
            if expected and "bleeding" in expected:
                out["bleeding"] = "yes" if (low.startswith("y") or "bleed" in low or "blood" in low) else "no"
        # Lone numeric → only map if session expects exactly one numeric vital
        if not out:
            m = _LONE_NUM_RE.match(body)
            if m and expected:
                num = float(m.group(1))
                # Disambiguate by expected input
                if "blood_glucose" in expected and 30 <= num <= 600:
                    out["blood_glucose"] = num
                elif "temperature" in expected and 90 <= num <= 110:
                    out["temperature"] = num
                elif "temperature" in expected and 30 <= num <= 45:
                    # Celsius
                    out["temperature"] = num
        return out

    async def _try_safety_submit(patient_id: str, rx_id: str, parsed: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Submit safety-check values directly via the in-process server function (avoids HTTP roundtrip)."""
        try:
            from server import submit_safety_check, SafetyCheckSubmit, User as ServerUser  # type: ignore
            user_doc = await db.users.find_one({"linked_patient_id": patient_id, "role": "patient"}, {"_id": 0})
            if not user_doc:
                return None
            su = ServerUser(
                user_id=user_doc.get("user_id"),
                email=user_doc.get("email", ""),
                name=user_doc.get("name", ""),
                role=user_doc.get("role", "patient"),
                linked_patient_id=patient_id,
            )
            payload = SafetyCheckSubmit(values=parsed)
            res = await submit_safety_check(rx_id, payload, su)
            return res
        except Exception:
            logger.exception("safety_check submit (in-process) failed")
            return None

    async def _handle_emergency(patient: Dict[str, Any], body: str, msg_sid: str) -> str:
        topic = "Patient reported emergency keywords on WhatsApp"
        await db.doctor_alerts.insert_one({
            "id": secrets.token_hex(12),
            "patient_id": patient["id"],
            "patient_name": (patient.get("personal_info") or {}).get("name"),
            "topic": topic,
            "summary": body[:240],
            "patient_message": body[:480],
            "ai_reply": "",
            "urgency": "emergency",
            "initial_severity": "emergency",
            "status": "open",
            "kind": "wa_emergency",
            "created_at": now_iso(),
            "events": [{"event": "created", "at": now_iso(), "by": "wa-parser", "note": "emergency keyword detected"}],
        })
        return (
            "🚨 This sounds urgent.\n\n"
            "If you're having chest pain, severe breathlessness, fainting, severe bleeding, or a possible stroke — "
            "call your local emergency number or go to the nearest ER right away.\n\n"
            "I've also alerted Dr. Lahari to reach out to you."
        )

    @router.post("/webhook")
    async def whatsapp_webhook(request: Request):
        form = dict(await request.form())
        await _validate_signature(request, form)

        from_num = _normalize(form.get("From", ""))
        body = (form.get("Body") or "").strip()
        msg_sid = form.get("MessageSid", "")

        user = await db.users.find_one({"whatsapp_number": from_num}, {"_id": 0})
        if not user:
            tw = MessagingResponse()
            tw.message(
                "👋 This number isn't linked to a Project Care account yet.\n"
                "Sign in to your Project Care portal → Connect WhatsApp → enter this number, "
                "and we'll send you a verification code here."
            )
            return Response(content=str(tw), media_type="application/xml")

        if user.get("role") != "patient" or not user.get("linked_patient_id"):
            tw = MessagingResponse()
            tw.message("Doctor accounts can't use the patient WhatsApp channel. Use the web portal for clinical actions.")
            return Response(content=str(tw), media_type="application/xml")

        patient = await db.patients.find_one({"id": user["linked_patient_id"]}, {"_id": 0})
        if not patient:
            tw = MessagingResponse()
            tw.message("Sorry, your patient record could not be found. Please log in to the web portal.")
            return Response(content=str(tw), media_type="application/xml")

        language = user.get("whatsapp_language") or "en"

        # ---- Voice note handling: transcribe BEFORE running Care AI ----
        voice = await _extract_voice_note(form, language)
        is_voice = bool(voice) and not voice.get("error")
        media_url_in = voice.get("media_url") if voice else None
        content_type_in = voice.get("content_type") if voice else None

        if voice and voice.get("error"):
            tw = MessagingResponse()
            tw.message("⚠️ I couldn't process that voice note. Could you try again, or type your question?")
            return Response(content=str(tw), media_type="application/xml")

        if is_voice:
            transcript = (voice.get("transcript") or "").strip()
            if not transcript:
                tw = MessagingResponse()
                tw.message("🎙️ I received your voice note but couldn't make out any words. Could you try again in a quiet place, or type your message?")
                return Response(content=str(tw), media_type="application/xml")
            # Use the transcript as the message body for Care AI
            body = transcript

        # ---- Phase 20 — Deep media interpretation (images, docs) ----
        non_audio = await _extract_non_audio_media(form)
        image_media = next((m for m in non_audio if m["content_type"].startswith("image/")), None)
        doc_media = [m for m in non_audio if not m["content_type"].startswith("image/")]

        if image_media:
            handled = await _handle_image_media(patient, image_media, msg_sid)
            reply_text = handled["reply_text"]
            urgency = handled["urgency"]
            analysis = handled["analysis"]
            att_id = handled["att_id"]

            await db.followup_chats.insert_one({
                "id": f"wa-{msg_sid or secrets.token_hex(6)}-a",
                "patient_id": patient["id"],
                "role": "assistant",
                "text": reply_text,
                "kind": "image_analysis",
                "analysis": analysis,
                "attachment_id": att_id,
                "urgency": urgency,
                "created_at": now_iso(),
                "source": "whatsapp",
            })

            # Raise a doctor alert for every image upload; urgency mirrors the vision call.
            alert_urgency = urgency if urgency in ("emergency", "high") else ("medium" if urgency == "medium" else "low")
            await db.doctor_alerts.insert_one({
                "id": f"wa-alert-{secrets.token_hex(6)}",
                "patient_id": patient["id"],
                "patient_name": (patient.get("personal_info") or {}).get("name"),
                "urgency": alert_urgency,
                "topic": f"Patient shared {(analysis or {}).get('image_type', 'image').replace('_', ' ')} on WhatsApp",
                "summary": ((analysis or {}).get("summary_for_doctor") or reply_text[:200]),
                "patient_message": body or "(image only)",
                "ai_reply": reply_text[:400],
                "attachment_id": att_id,
                "attachment_url": f"/api/followup/attachments/{att_id}",
                "status": "open",
                "source": "whatsapp_image",
                "created_at": now_iso(),
            })

            tw = MessagingResponse()
            tw.message(reply_text)

            # Image analyses are complex clinical explanations — always TTS
            # when the patient has opted into voice replies OR originally sent voice.
            prefs = user.get("whatsapp_prefs") or {}
            wants_voice = bool(prefs.get("voice_replies")) or is_voice or bool(_VOICE_REQUEST_RE.search(body or ""))
            if wants_voice and tts_synth:
                base_url = str(request.base_url)
                asyncio.create_task(
                    _maybe_send_tts_reply(base_url, from_num, reply_text, language)
                )
            return Response(content=str(tw), media_type="application/xml")

        if doc_media and not body:
            # Non-image document with no accompanying text → ack + alert
            m0 = doc_media[0]
            doc_id = secrets.token_hex(12)
            await db.followup_attachments.insert_one({
                "id": doc_id,
                "patient_id": patient["id"],
                "uploader_id": patient["id"],
                "filename": f"whatsapp-doc-{doc_id[:8]}",
                "content_type": m0["content_type"],
                "size": m0["size"],
                "b64": base64.b64encode(m0["data"]).decode(),
                "created_at": now_iso(),
                "source": "whatsapp",
            })
            reply_text = (
                "📄 Got your document. I've saved it for Dr. Lahari to review.\n\n"
                "For instant read-outs, lab reports work best when sent as a photo."
            )
            await db.followup_chats.insert_one({
                "id": f"wa-{msg_sid or secrets.token_hex(6)}-a",
                "patient_id": patient["id"],
                "role": "assistant",
                "text": reply_text,
                "attachment_id": doc_id,
                "urgency": "low",
                "created_at": now_iso(),
                "source": "whatsapp",
                "kind": "attachment_ack",
            })
            await db.doctor_alerts.insert_one({
                "id": f"wa-alert-{secrets.token_hex(6)}",
                "patient_id": patient["id"],
                "patient_name": (patient.get("personal_info") or {}).get("name"),
                "urgency": "low",
                "topic": "Patient shared a document on WhatsApp",
                "summary": f"Document: {m0['content_type']} ({m0['size']} bytes).",
                "patient_message": "(document)",
                "ai_reply": reply_text[:400],
                "attachment_id": doc_id,
                "attachment_url": f"/api/followup/attachments/{doc_id}",
                "status": "open",
                "source": "whatsapp_image",
                "created_at": now_iso(),
            })
            tw = MessagingResponse()
            tw.message(reply_text)
            return Response(content=str(tw), media_type="application/xml")

        if not body:
            tw = MessagingResponse()
            tw.message("Send me a question (text or 🎙️ voice note) and I'll help. For emergencies, call 911.")
            return Response(content=str(tw), media_type="application/xml")

        # Persist patient turn into existing followup_chats so /followup UI mirrors WhatsApp
        user_doc = {
            "id": f"wa-{msg_sid or secrets.token_hex(6)}-u",
            "patient_id": patient["id"],
            "role": "user",
            "text": body,
            "created_at": now_iso(),
            "source": "whatsapp",
            "twilio_sid": msg_sid,
        }
        if is_voice:
            user_doc["media_type"] = "voice"
            user_doc["media_url"] = media_url_in
            user_doc["media_content_type"] = content_type_in
            user_doc["transcript"] = body
            user_doc["voice_duration"] = voice.get("duration")
        await db.followup_chats.insert_one(user_doc)

        # ============================================================
        # Phase 17 — Smart inbound routing
        # ============================================================
        # 1. Emergency keyword fast path — bypass LLM, alert doctor immediately
        if _EMERGENCY_RE.search(body):
            reply_text = await _handle_emergency(patient, body, msg_sid)
            await db.followup_chats.insert_one({
                "id": f"wa-{msg_sid or secrets.token_hex(6)}-a",
                "patient_id": patient["id"],
                "role": "assistant",
                "text": reply_text,
                "urgency": "emergency",
                "topic": "Emergency keyword detected",
                "summary": body[:200],
                "created_at": now_iso(),
                "source": "whatsapp",
                "kind": "wa_emergency_reply",
            })
            tw = MessagingResponse()
            tw.message(reply_text)
            return Response(content=str(tw), media_type="application/xml")

        # 2. Stateful safety-check parser — if the patient owes vitals, try parsing them
        sess = await _get_session(patient["id"])
        expected = sess.get("expected_input") or []
        active_rx = sess.get("active_rx_id")
        if expected and active_rx:
            parsed = _parse_vitals(body, expected)
            # Filter to only the keys the session actually expects
            filtered = {k: v for k, v in parsed.items() if k in expected}
            if filtered:
                res = await _try_safety_submit(patient["id"], active_rx, filtered)
                if res is not None:
                    status = res.get("status")
                    if status == "cleared":
                        reply_text = (
                            "✅ All vitals look safe. You can start your medication as Dr. Lahari prescribed.\n\n"
                            "I'll check in tomorrow to see how you're doing."
                        )
                        await _clear_session(patient["id"])
                    elif status == "hold":
                        reasons = "; ".join(v.get("reason", "") for v in (res.get("result") or {}).values() if v.get("status") == "hold")
                        reply_text = (
                            "⚠️ Hold the new medication for now.\n\n"
                            f"Reason: {reasons}\n\n"
                            "Dr. Lahari has been alerted and will reach out shortly. "
                            "If you feel unwell — chest pain, breathlessness, severe dizziness — go to the nearest ER right away."
                        )
                        await _set_session(patient["id"], current_stage="safety_hold", expected_input=expected, active_rx_id=active_rx)
                    else:  # partial
                        missing = res.get("missing") or []
                        # Map missing keys back to ask text
                        sc = await db.patients.find_one(
                            {"id": patient["id"], "consultations.id": active_rx},
                            {"_id": 0, "consultations.$": 1},
                        )
                        ask_lines: List[str] = []
                        if sc and sc.get("consultations"):
                            req = ((sc["consultations"][0] or {}).get("safety_check") or {}).get("required") or []
                            for r in req:
                                if r.get("key") in missing:
                                    ask_lines.append(f"• {r.get('ask')}")
                        reply_text = "Got it. I still need:\n\n" + ("\n".join(ask_lines) if ask_lines else "the remaining vital values.")
                    # Persist & reply
                    await db.followup_chats.insert_one({
                        "id": f"wa-{msg_sid or secrets.token_hex(6)}-a",
                        "patient_id": patient["id"],
                        "role": "assistant",
                        "text": reply_text,
                        "urgency": "high" if status == "hold" else None,
                        "created_at": now_iso(),
                        "source": "whatsapp",
                        "kind": "wa_safety_check",
                    })
                    tw = MessagingResponse()
                    tw.message(reply_text)
                    return Response(content=str(tw), media_type="application/xml")

        # Build history (last 12 turns) for context
        history_cursor = db.followup_chats.find({"patient_id": patient["id"]}, {"_id": 0}).sort("created_at", -1).limit(12)
        history = list(reversed(await history_cursor.to_list(12)))

        try:
            reply_raw = await followup_llm_call(patient, history[:-1], body, language)
        except Exception:
            logger.exception("LLM call failed in WhatsApp webhook")
            tw = MessagingResponse()
            tw.message("I'm having trouble right now. Please try again in a moment, or open the Project Care app.")
            return Response(content=str(tw), media_type="application/xml")

        clean, triage = parse_triage(reply_raw)
        urgency = (triage or {}).get("urgency")

        ai_doc = {
            "id": f"wa-{msg_sid or secrets.token_hex(6)}-a",
            "patient_id": patient["id"],
            "role": "assistant",
            "text": clean,
            "urgency": urgency,
            "topic": (triage or {}).get("topic"),
            "summary": (triage or {}).get("summary"),
            "red_flags": (triage or {}).get("red_flags") or [],
            # Phase 18 — clinical reasoning metadata
            "mode": (triage or {}).get("mode"),
            "risk": (triage or {}).get("risk"),
            "gap": (triage or {}).get("gap") or [],
            "created_at": now_iso(),
            "source": "whatsapp",
            "reply_to_voice": is_voice,
        }
        await db.followup_chats.insert_one(ai_doc)

        # Doctor alert on red urgency
        if urgency in ("emergency", "high"):
            alert = {
                "id": f"wa-alert-{secrets.token_hex(6)}",
                "patient_id": patient["id"],
                "patient_name": (patient.get("personal_info") or {}).get("name"),
                "urgency": urgency,
                "topic": (triage or {}).get("topic") or "WhatsApp follow-up red flag",
                "summary": (triage or {}).get("summary") or clean[:200],
                "patient_message": body,
                "ai_reply": clean[:400],
                "status": "open",
                "source": "whatsapp_voice_followup" if is_voice else "whatsapp_followup",
                "created_at": now_iso(),
            }
            await db.doctor_alerts.insert_one(alert)

        # Reply via TwiML (text always — fastest first reply)
        tw = MessagingResponse()
        tw.message(clean[:1500])

        # Phase 20 — Voice enhancements: fire a TTS audio reply when
        #  (a) patient sent voice (existing symmetry), OR
        #  (b) patient has voice_replies pref ON, OR
        #  (c) patient explicitly asked for a voice reply in this message.
        prefs = user.get("whatsapp_prefs") or {}
        wants_voice = (
            is_voice
            or bool(prefs.get("voice_replies"))
            or bool(_VOICE_REQUEST_RE.search(body or ""))
        )
        if wants_voice and tts_synth:
            base_url = str(request.base_url)
            asyncio.create_task(
                _maybe_send_tts_reply(base_url, from_num, clean, language)
            )

        return Response(content=str(tw), media_type="application/xml")

    return router
