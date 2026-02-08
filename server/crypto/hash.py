# crypto/hash.py

import json
import hashlib
from typing import Any


def canonical_json(obj: Any) -> str:
    """
    将 Python 对象序列化为“确定性 JSON 字符串”

    规则：
    - key 排序
    - 禁止多余空格
    - 禁止非标准类型
    """

    try:
        return json.dumps(
            obj,
            sort_keys=True,           #  key 顺序固定
            separators=(",", ":"),    #  去掉所有空格
            ensure_ascii=False        #  保留 UTF-8与前端必须一致
        )
    except (TypeError, ValueError) as e:
        # 不允许不确定序列化的对象
        raise ValueError("Object is not JSON-serializable in canonical form") from e


def hash_object(obj: Any) -> str:
    """
    对任意 Python 对象进行 SHA-256 hash
    返回 hex string
    """

    canonical = canonical_json(obj)        #  规范化 JSON
    data = canonical.encode("utf-8")       #  明确转为 bytes
    digest = hashlib.sha256(data).hexdigest()  #  SHA-256
    return digest
