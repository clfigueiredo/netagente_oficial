import os
import httpx
from typing import Optional


class WhatsAppClient:
    """Client for Evolution API v1 — sends messages via WhatsApp."""

    def __init__(self):
        self.base_url = os.getenv("EVOLUTION_BASE_URL", "https://agenteevo.forumtelecom.com.br")

    async def send_message(self, instance: str, api_key: str, number: str, text: str) -> bool:
        """Send a text message via Evolution API v2.
        number: normalized (DDD + 9 digits, e.g. '55999493554')
        Evolution v2 expects country code prefix: '5555999493554'
        """
        import re
        # Strip non-digits if any
        clean = re.sub(r'\D', '', number)
        # Prepend Brazil country code 55 (normalized number doesn't have it)
        wa_number = '55' + clean
        url = f"{self.base_url}/message/sendText/{instance}"
        payload = {
            "number": wa_number,
            "text": text
        }
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={"apikey": api_key, "Content-Type": "application/json"}
                )
                if resp.status_code not in (200, 201):
                    import logging
                    logging.error(f"[whatsapp] send_message failed {resp.status_code}: {resp.text[:200]}")
                    return False
                return True
            except Exception as e:
                import logging
                logging.error(f"[whatsapp] Erro ao enviar mensagem: {e}")
                return False

    async def get_instance_status(self, instance: str, api_key: str) -> dict:
        """Check Evolution API instance connection status."""
        url = f"{self.base_url}/instance/connectionState/{instance}"
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(url, headers={"apikey": api_key})
                return resp.json()
            except Exception:
                return {"state": "unknown"}

    async def get_media_base64(self, instance: str, api_key: str, message_key: dict) -> str:
        """
        Fetch base64 of a media message (audio/image/video) via Evolution v2 API.
        Evolution v2 does NOT include base64 in the webhook payload —
        must call /chat/getBase64FromMediaMessage/{instance} to retrieve it.
        Returns base64 string or empty string on failure.
        """
        import logging
        url = f"{self.base_url}/chat/getBase64FromMediaMessage/{instance}"
        payload = {
            "message": {"key": message_key},
            "convertToMp4": False,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={"apikey": api_key, "Content-Type": "application/json"},
                )
                if resp.status_code in (200, 201):
                    result = resp.json()
                    # Response: {"base64": "...", "mediaType": "audio"}
                    b64 = result.get("base64") or result.get("data", {}).get("base64", "")
                    logging.warning(f"[WA] get_media_base64: got {len(b64)} chars")
                    return b64
                else:
                    logging.error(f"[WA] get_media_base64 failed {resp.status_code}: {resp.text[:200]}")
                    return ""
            except Exception as e:
                logging.error(f"[WA] get_media_base64 error: {e}")
                return ""

