

"""
后端验签工具


 前端公钥：Base64（raw Ed25519 public key）
 前端私钥：Base64（PKCS8）
 前端 hash：十六进制字符串（SHA-256）
 前端签名：Base64（Ed25519 签名）

因此后端在验签时，需要：
 公钥：Base64 转 bytes
 签名：Base64 转 bytes
 hash：hex 转 bytes
"""

import base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature


def _b64_to_bytes(data: str) -> bytes:
    return base64.b64decode(data.encode("utf-8"))


def _hex_to_bytes(data: str) -> bytes:
    return bytes.fromhex(data)


def verify_signature(pubkey: str, hash: str, signature: str) -> bool:
    """
    验证：signature 是否是 pubkey 对 hash 的签名

    参数格式（与前端保持一致）：
    - pubkey: Base64 编码的 Ed25519 公钥（crypto.js 里的 publicKey）
    - hash: 十六进制字符串（crypto.js.hash 返回值）
    - signature: Base64 编码的签名（crypto.js.sign 返回值）
    """
    try:
        pk_bytes = _b64_to_bytes(pubkey)
        sig_bytes = _b64_to_bytes(signature)
        hash_bytes = _hex_to_bytes(hash)

        pk = Ed25519PublicKey.from_public_bytes(pk_bytes)
        pk.verify(sig_bytes, hash_bytes)
        return True

    except (InvalidSignature, ValueError):
        return False
