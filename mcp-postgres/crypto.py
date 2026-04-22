"""AES-256-GCM compatível com api/src/services/encryptionService.js.

Formato do valor armazenado: ``iv:authTag:ciphertext`` (todos em hex).
IV de 12 bytes, tag de 16 bytes. Chave vem de ENCRYPTION_KEY (32 bytes em hex).
"""

import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _key() -> bytes:
    raw = os.environ.get("ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("ENCRYPTION_KEY não definido no ambiente")
    key = bytes.fromhex(raw)
    if len(key) != 32:
        raise RuntimeError(f"ENCRYPTION_KEY deve ter 32 bytes (64 hex), recebido {len(key)} bytes")
    return key


def encrypt_password(plaintext: str) -> str:
    aesgcm = AESGCM(_key())
    iv = os.urandom(12)
    ct_and_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    # AESGCM retorna ciphertext || tag (tag nos últimos 16 bytes)
    ciphertext, tag = ct_and_tag[:-16], ct_and_tag[-16:]
    return f"{iv.hex()}:{tag.hex()}:{ciphertext.hex()}"


def decrypt_password(stored: str) -> str:
    iv_hex, tag_hex, data_hex = stored.split(":")
    iv = bytes.fromhex(iv_hex)
    tag = bytes.fromhex(tag_hex)
    data = bytes.fromhex(data_hex)
    aesgcm = AESGCM(_key())
    plaintext = aesgcm.decrypt(iv, data + tag, None)
    return plaintext.decode("utf-8")
