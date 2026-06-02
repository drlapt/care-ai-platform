"""E2E voice-note webhook test using a self-hosted media URL.

We can't easily mock Twilio's authenticated media CDN, so we test the full
pipeline by:
  1. Generating a TTS audio clip (a patient utterance)
  2. Hosting it via the existing public /api/whatsapp/media/{id}.mp3 endpoint
  3. Patching whatsapp_router._download_twilio_media to bypass Twilio auth and
     use a plain GET against the preview URL
  4. Posting a synthetic Twilio webhook with the hosted URL
  5. Verifying the followup_chats record has media_type="voice" + transcript

This proves: STT → Care AI → followup_chats persistence → triage → TwiML reply.
"""
import os, sys, asyncio, base64, secrets

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx

API = os.environ.get("API_BASE_URL") or "https://patient-care-121.preview.emergentagent.com"


async def main():
    from server import _tts_synth_bytes, db
    import whatsapp_router as wr

    # --- 1. Make a patient voice note: "I have a sore throat and a fever for two days."
    text = "I have a sore throat and a fever for two days."
    audio = await _tts_synth_bytes(text, voice="nova", speed=1.0)
    media_id = "voice-" + secrets.token_hex(6)
    await db.whatsapp_media.insert_one({
        "id": media_id,
        "audio_b64": base64.b64encode(audio).decode("ascii"),
        "language": "en",
        "to": "+919100336792",
        "created_at": "2026-02-01T00:00:00+00:00",
    })
    media_url = f"{API}/api/whatsapp/media/{media_id}.mp3"

    # --- 2. Patch _download_twilio_media to plain-GET (no Twilio auth) for this test
    orig = wr._download_twilio_media
    async def _fake_dl(url):
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as cli:
            r = await cli.get(url)
            r.raise_for_status()
            ctype = r.headers.get("content-type", "audio/mpeg").split(";")[0]
            return r.content, ctype
    wr._download_twilio_media = _fake_dl
    try:
        # --- 3. Look up the demo patient and snapshot their followup count
        user = await db.users.find_one({"whatsapp_number": "+919100336792"}, {"_id": 0})
        assert user, "linked demo patient not found in users"
        patient_id = user["linked_patient_id"]
        before = await db.followup_chats.count_documents({"patient_id": patient_id, "source": "whatsapp"})

        # --- 4. POST a synthetic Twilio voice-note webhook
        msg_sid = "SM" + secrets.token_hex(8)
        async with httpx.AsyncClient(timeout=60.0) as cli:
            r = await cli.post(
                f"{API}/api/whatsapp/webhook",
                data={
                    "From": "whatsapp:+919100336792",
                    "Body": "",
                    "MessageSid": msg_sid,
                    "NumMedia": "1",
                    "MediaContentType0": "audio/mpeg",
                    "MediaUrl0": media_url,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        assert r.status_code == 200, r.text
        assert "<Message>" in r.text, r.text[:300]
        assert "couldn't process" not in r.text, "voice note path failed: " + r.text[:300]

        # --- 5. Verify a voice-tagged record was inserted
        after = await db.followup_chats.count_documents({"patient_id": patient_id, "source": "whatsapp"})
        assert after >= before + 2, f"expected user+assistant rows, got delta={after-before}"

        voice_row = await db.followup_chats.find_one(
            {"patient_id": patient_id, "media_type": "voice"},
            {"_id": 0}, sort=[("created_at", -1)]
        )
        assert voice_row, "no voice-tagged followup_chats row"
        transcript = (voice_row.get("transcript") or "").lower()
        assert "throat" in transcript or "fever" in transcript, f"transcript looks wrong: {transcript!r}"
        print(f"OK: voice flow stored transcript = {transcript!r}")
        print(f"OK: TwiML reply preview = {r.text[:160]}")
    finally:
        wr._download_twilio_media = orig
        await db.whatsapp_media.delete_one({"id": media_id})


if __name__ == "__main__":
    asyncio.run(main())
    print("E2E voice flow: PASS")
