import os
import base64
from openai import AsyncOpenAI

_client = None

def _get_client():
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=os.getenv("OPENAI_KEY"))
    return _client


async def transcribe_audio(audio_base64: str) -> str:
    """
    Transcribes a base64-encoded audio message using OpenAI Whisper.
    Returns the transcribed text or an error message.
    """
    try:
        audio_bytes = base64.b64decode(audio_base64)

        import io
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = "audio.ogg"

        transcript = await _get_client().audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="pt",
            response_format="text"
        )
        return transcript.strip()
    except Exception as e:
        return f"[Erro na transcrição de áudio: {e}]"

