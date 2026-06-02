"""Focused tests for the WhatsApp voice-note pipeline.

Exercises:
  1. _whisper_transcribe_bytes with a TTS-generated patient utterance
  2. _tts_synth_bytes returns valid mp3 bytes
  3. /api/whatsapp/media/{id}.mp3 serves stored audio without auth (Twilio fetch path)
  4. The /api/whatsapp/webhook flow when a media URL is unreachable returns a graceful error
"""
import os
import sys
import asyncio
import base64
import secrets
import pytest

# Allow `import server`
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx  # noqa: E402

API = os.environ.get("API_BASE_URL") or "https://patient-care-121.preview.emergentagent.com"


@pytest.mark.asyncio
async def test_tts_then_whisper_round_trip():
    """Generate audio with TTS, transcribe back with Whisper, ensure key word survives."""
    from server import _tts_synth_bytes, _whisper_transcribe_bytes
    text = "I have had a high fever and a sore throat since yesterday."
    audio = await _tts_synth_bytes(text, voice="nova", speed=1.0)
    assert audio and len(audio) > 5_000, "TTS produced no/tiny audio"

    result = await _whisper_transcribe_bytes(audio, filename="round_trip.mp3", language="en")
    transcript = (result.get("text") or "").lower()
    assert "fever" in transcript, f"transcript missing 'fever': {transcript!r}"


@pytest.mark.asyncio
async def test_media_endpoint_serves_stored_audio():
    """The public /media/{id}.mp3 should return audio bytes without auth (Twilio fetch path)."""
    from server import db
    media_id = "test-" + secrets.token_hex(6)
    audio_bytes = b"ID3\x04\x00\x00\x00\x00\x00\x00fake-mp3-payload-for-test"
    await db.whatsapp_media.insert_one({
        "id": media_id,
        "audio_b64": base64.b64encode(audio_bytes).decode("ascii"),
        "language": "en",
        "to": "+10000000000",
        "created_at": "2026-02-01T00:00:00+00:00",
    })
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.get(f"{API}/api/whatsapp/media/{media_id}.mp3")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("audio/mpeg")
        assert r.content == audio_bytes
    finally:
        await db.whatsapp_media.delete_one({"id": media_id})


@pytest.mark.asyncio
async def test_webhook_handles_bad_media_url_gracefully():
    """When Twilio supplies an unreachable MediaUrl, the webhook should return a friendly error."""
    payload = {
        "From": "whatsapp:+919100336792",  # linked demo patient
        "Body": "",
        "MessageSid": "SMvoicebadurl1",
        "NumMedia": "1",
        "MediaContentType0": "audio/ogg",
        "MediaUrl0": "https://api.twilio.com/2010-04-01/Accounts/AC0/Messages/MM0/Media/ME-does-not-exist",
    }
    async with httpx.AsyncClient(timeout=30.0) as cli:
        r = await cli.post(
            f"{API}/api/whatsapp/webhook",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    assert r.status_code == 200, r.text
    assert "couldn't process that voice note" in r.text or "couldn" in r.text.lower()


if __name__ == "__main__":
    asyncio.run(test_tts_then_whisper_round_trip())
    print("OK: tts ↔ whisper")
    asyncio.run(test_media_endpoint_serves_stored_audio())
    print("OK: media endpoint")
    asyncio.run(test_webhook_handles_bad_media_url_gracefully())
    print("OK: webhook bad media")
