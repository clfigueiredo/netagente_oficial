import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import secrets


ENCRYPTION_KEY = bytes.fromhex(os.getenv("ENCRYPTION_KEY", "0" * 64))


def encrypt_password(plaintext: str) -> str:
    """AES-256-GCM encrypt — returns iv:ciphertext as hex string."""
    iv = secrets.token_bytes(12)
    aesgcm = AESGCM(ENCRYPTION_KEY)
    ct = aesgcm.encrypt(iv, plaintext.encode(), None)
    # ct includes 16-byte auth tag at the end (GCM)
    return f"{iv.hex()}:{ct.hex()}"


def decrypt_password(stored: str) -> str:
    """Decrypts AES-256-GCM encrypted string from Node.js encryptionService format."""
    parts = stored.split(":")
    if len(parts) == 3:
        # Node.js format: iv:authTag:ciphertext
        iv = bytes.fromhex(parts[0])
        auth_tag = bytes.fromhex(parts[1])
        ct = bytes.fromhex(parts[2])
        ciphertext_with_tag = ct + auth_tag
    elif len(parts) == 2:
        # Python format: iv:ciphertext+tag
        iv = bytes.fromhex(parts[0])
        ciphertext_with_tag = bytes.fromhex(parts[1])
    else:
        raise ValueError(f"Formato de criptografia inválido: {stored[:20]}...")

    aesgcm = AESGCM(ENCRYPTION_KEY)
    return aesgcm.decrypt(iv, ciphertext_with_tag, None).decode()
