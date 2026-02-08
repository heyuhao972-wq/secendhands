# backend/services/blockchain.py

import time
import hashlib
import json

from db.blocks import (
    get_last_block,
    insert_block,
    get_all_blocks as db_get_all_blocks,
)


# -----------------------------
#  获取最新区块
# -----------------------------

def get_latest_block():
    """
    返回链上的最后一个区块
    """
    block = get_last_block()
    if block is None:
        return None
    
    # 转换数据库格式为内部格式
    return {
        "index": block["block_index"],
        "prev_hash": block["prev_hash"],
        "hash": block["block_hash"],
        "timestamp": block["timestamp"],
        "type": block["type"],
        "payload": json.loads(block["payload_json"]),
    }


def get_all_blocks():
    """
    获取所有区块（用于 rebuild_state）
    """
    blocks = []
    for block in db_get_all_blocks():
        payload = json.loads(block["payload_json"])
        blocks.append({
            "type": block["type"],
            "trade_id": payload["trade_id"],
            "payload": payload["payload"],
            "signatures": payload.get("signatures", {}),
        })
    
    return blocks

# -----------------------------
#  计算区块 hash
# -----------------------------

def compute_block_hash(block):
    """
    hash(index + prev_hash + payload + timestamp)
    """
    block_string = (
        str(block["index"]) +
        block["prev_hash"] +
        json.dumps(block["payload"], sort_keys=True) +
        str(block["timestamp"])
    )

    return hashlib.sha256(block_string.encode()).hexdigest()


# -----------------------------
# 追加新区块
# -----------------------------

def append_block(block_data):
    """
    校验 prev_hash
    写入 blocks 表
    
    block_data 格式：
    {
        "type": "CREATE" | "COMPLETE" | "CANCEL",
        "trade_id": "...",
        "payload": {...},
        "signatures": {...}
    }
    """
    last_block = get_latest_block()

    if last_block is None:
        # 创世区块
        index = 0
        prev_hash = "0" * 64
    else:
        index = last_block["index"] + 1
        prev_hash = last_block["hash"]

    # 构造完整的区块 payload（包含 type, trade_id, payload, signatures）
    full_payload = {
        "type": block_data["type"],
        "trade_id": block_data["trade_id"],
        "payload": block_data["payload"],
        "signatures": block_data.get("signatures", {}),
    }

    # 计算区块 hash
    block_for_hash = {
        "index": index,
        "prev_hash": prev_hash,
        "payload": full_payload,
        "timestamp": int(time.time())
    }
    block_hash = compute_block_hash(block_for_hash)

    # 构造要写入数据库的区块
    db_block = {
        "index": index,
        "prev_hash": prev_hash,
        "hash": block_hash,
        "timestamp": int(time.time()),
        "type": block_data["type"],
        "payload_json": json.dumps(full_payload, ensure_ascii=False),
    }

    #  prev_hash 必须对得上
    if last_block is not None and db_block["prev_hash"] != last_block["hash"]:
        raise Exception("Blockchain broken: prev_hash mismatch")

    insert_block(db_block)

    return db_block
