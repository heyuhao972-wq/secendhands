# backend/services/trade_service.py

"""

 验证交易合法性
 维护交易状态机
 决定是否写新区块

 前端生成 hash + signature
 后端只做 verify + state machine
"""

from crypto.verify import verify_signature
from crypto.hash import hash_object, canonical_json
from services.blockchain import append_block

from db.trades import (
    get_trade,
    insert_trade,
    update_trade_status,
    update_trade_chat_pubkey,
    update_trade_join,
)

from db.blocks import get_all_blocks

# ============================================================
#  CREATE —— 创建交易
# ============================================================

def verify_create(trade_id: str, content_hash: str, seller_pubkey: str, signature: str, description=None, price=None):
    """
    验证创建交易是否合法

    前端保证：
    - trade_id = hash(CreateTradeBody)
    - signature = Sign(trade_id, seller_sk)
    """

    # 1. trade_id 必须唯一
    if get_trade(trade_id):
        raise Exception("Trade already exists")

    # 2. 验证卖家签名（签名对象就是 trade_id）
    if not verify_signature(
        pubkey=seller_pubkey,
        hash=trade_id,
        signature=signature,
    ):
        raise Exception("Invalid seller signature")

    # 3. 构造 CREATE 区块（不写状态）
    block = {
        "type": "CREATE",
        "trade_id": trade_id,
        "payload": {
            "content_hash": content_hash,
            "seller_pubkey": seller_pubkey,
            "description": description,
            "price": price,
        },
        "signatures": {
            "seller": signature,
        },
    }

    return block


# ============================================================
#  COMPLETE —— 完成交易（双签）
# ============================================================

def verify_complete(
    trade_id: str,
    complete_hash: str,
    seller_sig: str,
    buyer_sig: str,
    buyer_pubkey: str = None,
):
    """
    验证完成交易是否合法（双签）
    支持前端显式传 buyer_pubkey，避免多买家并发时签名归属错位。
    """
    trade = get_trade(trade_id)
    if trade is None:
        raise Exception("Trade not found")

    if trade["status"] != "OPEN":
        raise Exception("Trade is not open")

    seller_pubkey = trade["seller_pubkey"]
    target_buyer_pubkey = buyer_pubkey or trade.get("buyer_pubkey")

    if not target_buyer_pubkey:
        raise Exception("Buyer pubkey not set")

    if target_buyer_pubkey == seller_pubkey:
        raise Exception("Invalid trade participants")

    if not verify_signature(
        pubkey=seller_pubkey,
        hash=complete_hash,
        signature=seller_sig,
    ):
        raise Exception("Invalid seller signature")

    if not verify_signature(
        pubkey=target_buyer_pubkey,
        hash=complete_hash,
        signature=buyer_sig,
    ):
        raise Exception("Invalid buyer signature")

    block = {
        "type": "COMPLETE",
        "trade_id": trade_id,
        "payload": {
            "trade_id": trade_id,
            "result": "COMPLETED",
            "seller_pubkey": seller_pubkey,
            "buyer_pubkey": target_buyer_pubkey,
        },
        "hash": complete_hash,
        "signatures": {
            "seller": seller_sig,
            "buyer": buyer_sig,
        },
    }

    return block



# ============================================================
#  CANCEL —— 取消交易（卖家单签）
# ============================================================

def verify_cancel(
    trade_id: str,
    cancel_hash: str,
    seller_sig: str,
):
    """
    验证取消交易是否合法
    """

    trade = get_trade(trade_id)
    if trade is None:
        raise Exception("Trade not found")

    # 1. 状态机检查
    if trade["status"] != "OPEN":
        raise Exception("Trade is not open")

    seller_pubkey = trade["seller_pubkey"]

    # 2. 只有卖家可以取消
    if not verify_signature(
        pubkey=seller_pubkey,
        hash=cancel_hash,
        signature=seller_sig,
    ):
        raise Exception("Invalid seller signature")

    # 3. 构造相同的body结构来验证hash一致性
    #import time
    body = {
        "trade_id": trade_id,
        "result": "CANCELLED",
    #    "timestamp": int(time.time()),
    }
    
    # 验证hash与body的一致性
    #local_hash = hash_object(body)
    #if local_hash != cancel_hash:
     #   raise Exception("Hash mismatch")

    # 4. 构造 CANCEL 区块
    block = {
        "type": "CANCEL",
        "trade_id": trade_id,
        "payload": body,
        "hash": cancel_hash,
        "signatures": {
            "seller": seller_sig,
        },
    }

    return block


# ============================================================
#  写区块 & 更新状态（唯一的状态变更入口）
# ============================================================

def apply_block(block: dict):
    """
    写新区块，并同步更新 trades 状态快照表
    """
    # 1) 追加区块（append-only）
    append_block(block)

    block_type = block["type"]
    trade_id = block["trade_id"]

    # 2) 更新状态快照表
    if block_type == "CREATE":
        insert_trade({
            "trade_id": trade_id,
            "seller_pubkey": block["payload"]["seller_pubkey"],
            "content_hash": block["payload"]["content_hash"],
            "description": block["payload"].get("description"),
            "price": block["payload"].get("price"),
            "status": "OPEN",
        })

    elif block_type == "COMPLETE":
        buyer_snapshot = block.get("payload", {}).get("buyer_pubkey")
        update_trade_status(trade_id, "COMPLETED", buyer_pubkey=buyer_snapshot)

    elif block_type == "CANCEL":
        update_trade_status(trade_id, "CANCELLED")



# ============================================================
#  从区块重建状态（只用于初始化 / 修复）
# ============================================================

def rebuild_state():
    """
    从 blocks 表重建 trades 状态

     重要：
    - 只更新 trades
    - 绝不重新 append_block
    """
    from db.trades import clear_trades

    clear_trades()

    for block in get_all_blocks():
        block_type = block["type"]
        trade_id = block["trade_id"]

        if block_type == "CREATE":
            insert_trade({
                "trade_id": trade_id,
                "seller_pubkey": block["payload"]["seller_pubkey"],
                "content_hash": block["payload"]["content_hash"],
                "status": "OPEN",
            })

        elif block_type == "COMPLETE":
            update_trade_status(trade_id, "COMPLETED")

        elif block_type == "CANCEL":
            update_trade_status(trade_id, "CANCELLED")


def join_trade(trade_id: str, buyer_pubkey: str, buyer_chat_pubkey: dict = None):
    """
    买家正式加入交易
    """
    if buyer_chat_pubkey is None:
        buyer_chat_pubkey = {}
    
    update_trade_join(
        trade_id=trade_id,
        buyer_pubkey=buyer_pubkey,
        buyer_chat_pubkey=buyer_chat_pubkey,
    )

def get_trade_detail(trade_id: str):
    sql = "SELECT * FROM trades WHERE trade_id = %s"
    with get_cursor() as cursor:
        cursor.execute(sql, (trade_id,))
        row = cursor.fetchone()

    if not row:
        return None

    return {
        "trade_id": row["trade_id"],
        "seller_pubkey": row["seller_pubkey"],
        "buyer_pubkey": row["buyer_pubkey"],
        "seller_chat_pubkey": json.loads(row["seller_chat_pubkey"]) if row["seller_chat_pubkey"] else None,
        "buyer_chat_pubkey": json.loads(row["buyer_chat_pubkey"]) if row["buyer_chat_pubkey"] else None,
        "status": row["status"],
    }


# 聊天相关功能
# ============================================================

def get_trade_chat_info(trade_id: str):
    """
    获取交易的聊天相关信息
    """
    trade = get_trade(trade_id)
    if trade is None:
        return None

    return {
        "trade_id": trade["trade_id"],
        "seller_pubkey": trade["seller_pubkey"],
        "buyer_pubkey": trade.get("buyer_pubkey"),
        "seller_chat_pubkey": trade.get("seller_chat_pubkey"),
        "buyer_chat_pubkey": trade.get("buyer_chat_pubkey"),
        "status": trade["status"],
    }


def update_chat_pubkey(trade_id: str, identity_pubkey: str, chat_pubkey: str):
    """
    更新用户聊天公钥
    目标：
    1) 卖家可更新 seller_chat_pubkey
    2) 当前买家可更新 buyer_chat_pubkey
    3) 若 buyer_pubkey 为空，允许当前 identity 占位为买家并写入 chat pubkey
    4) 非参与者不抛异常（避免前端初始化直接 500），返回 ignored
    """
    trade = get_trade(trade_id)
    if trade is None:
        raise Exception("Trade not found")

    # 卖家更新
    if trade["seller_pubkey"] == identity_pubkey:
        update_trade_chat_pubkey(
            trade_id=trade_id,
            identity_pubkey=identity_pubkey,
            chat_pubkey=chat_pubkey,
            is_seller=True,
        )
        return {"success": True, "role": "seller"}

    buyer_pubkey = trade.get("buyer_pubkey")

    # 买家为空：当前用户占位成为买家，并写入 buyer_chat_pubkey
    if not buyer_pubkey:
        update_trade_join(
            trade_id=trade_id,
            buyer_pubkey=identity_pubkey,
            buyer_chat_pubkey={"pubkey": chat_pubkey},
        )
        return {"success": True, "role": "buyer_joined"}

    # 当前买家更新
    if buyer_pubkey == identity_pubkey:
        update_trade_chat_pubkey(
            trade_id=trade_id,
            identity_pubkey=identity_pubkey,
            chat_pubkey=chat_pubkey,
            is_seller=False,
        )
        return {"success": True, "role": "buyer"}

    # 非参与者：不抛异常，避免聊天初始化被 500 打断
    return {
        "success": True,
        "ignored": True,
        "reason": "not_participant",
    }


def get_peer_chat_pubkey(trade_id: str, identity_pubkey: str):
    """
    获取对方聊天公钥
    """
    trade = get_trade(trade_id)
    if trade is None:
        return None

    if trade["seller_pubkey"] == identity_pubkey:
        return trade.get("buyer_chat_pubkey")

    if trade.get("buyer_pubkey") == identity_pubkey:
        return trade.get("seller_chat_pubkey")

    return None
