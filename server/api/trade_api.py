# backend/api/trade_api.py

from fastapi import APIRouter, Request, HTTPException

from services.trade_service import (
    verify_create,
    verify_complete,
    verify_cancel,
    apply_block,
    get_trade_chat_info,
    update_chat_pubkey,
    get_peer_chat_pubkey
)
from db.trades import get_trade, list_trades

router = APIRouter(prefix="/trade")



# GET —— 获取交易列表------list


@router.get("/list")
async def get_trade_list():
    """
    获取交易列表
    """
    trades = list_trades(limit=50)
    # 转换数据库格式为 API 格式
    result = []
    for trade in trades:
        result.append({
            "trade_id": trade["trade_id"],
            "seller_pubkey": trade["seller_pubkey"],
            "buyer_pubkey": trade.get("buyer_pubkey"),
            "status": trade["status"],
            "description": trade.get("description"),
            "price": trade.get("price"),

            "content_hash": trade.get("content_hash"),
            "created_at": trade.get("created_at").isoformat() if trade.get("created_at") else None,
        })
    return {"data": result}



# GET —— 获取单个交易 /id


@router.get("/{trade_id}")
async def get_single_trade(trade_id: str):
    """
    获取单个交易详情
    """
    trade = get_trade(trade_id)
    if trade is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    
    return {
        "trade_id": trade["trade_id"],
        "seller_pubkey": trade["seller_pubkey"],
        "buyer_pubkey": trade.get("buyer_pubkey"),
        "status": trade["status"],
        "description": trade.get("description"),
        "price": trade.get("price"),
        "content_hash": trade.get("content_hash"),
        "created_at": trade.get("created_at").isoformat() if trade.get("created_at") else None,
    }



# CREATE —— 创建交易
@router.post("/create")
async def create_trade(request: Request):
    """
    创建交易

    前端必须提供：
    - trade_id
    - content_hash
    - seller_pubkey
    - signature
    """

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # 支持两种格式：直接字段或嵌套在 body 中
    if "body" in data:
        # 客户端格式：{ trade_id, body: { trade_id, seller_pubkey, content_hash, timestamp }, signature }
        body = data["body"]
        trade_id = data.get("trade_id") or body.get("trade_id")
        content_hash = body.get("content_hash")
        seller_pubkey = body.get("seller_pubkey")
        description = body.get("description")
        price = body.get("price")

        signature = data.get("signature")
    else:
        # 直接格式：{ trade_id, content_hash, seller_pubkey, signature }
        trade_id = data.get("trade_id")
        content_hash = data.get("content_hash")
        seller_pubkey = data.get("seller_pubkey")
        signature = data.get("signature")

    required_fields = {
        "trade_id": trade_id,
        "content_hash": content_hash,
        "seller_pubkey": seller_pubkey,
        "signature": signature,
    }

    for field, value in required_fields.items():
        if value is None:
            raise HTTPException(
                status_code=400,
                detail=f"Missing field: {field}",
            )

    try:
        block = verify_create(
            trade_id=trade_id,
            content_hash=content_hash,
            seller_pubkey=seller_pubkey,
            description=description,
            price=price,
            signature=signature,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 合法才写链
    apply_block(block)

    return {"status": "ok"}



# 完成交易    双签


@router.post("/complete")
async def complete_trade(request: Request):
    """
    完成交易（卖家 + 买家双签）

    前端必须提供：
    - trade_id
    - complete_hash
    - seller_signature
    - buyer_signature
    """

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    required_fields = [
        "trade_id",
        "hash",
        "sig_seller",
        "sig_buyer",
    ]

    for field in required_fields:
        if field not in data:
            raise HTTPException(
                status_code=400,
                detail=f"Missing field: {field}",
            )

    try:
        block = verify_complete(
            trade_id=data["trade_id"],
            complete_hash=data["hash"],
            seller_sig=data["sig_seller"],
            buyer_sig=data["sig_buyer"],
            buyer_pubkey=data.get("buyer_pubkey"),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    apply_block(block)

    return {"status": "ok"}



# CANCEL —— 取消交易（卖家单签）


@router.post("/cancel")
async def cancel_trade(request: Request):
    """
    取消交易（仅卖家）

    前端必须提供：
    - trade_id
    - cancel_hash
    - seller_signature
    """

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    required_fields = [
        "trade_id",
        "hash",
        "signature",
    ]

    for field in required_fields:
        if field not in data:
            raise HTTPException(
                status_code=400,
                detail=f"Missing field: {field}",
            )

    try:
        block = verify_cancel(
            trade_id=data["trade_id"],
            cancel_hash=data["hash"],
            seller_sig=data["signature"],
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    apply_block(block)

    return {"status": "ok"}





# JOIN —— 买家加入交易


@router.post("/{trade_id}/join")
async def join_trade_api(trade_id: str, payload: dict):
    """
    买家加入交易（写入 buyer_pubkey）
    """
    buyer_pubkey = payload.get("buyer_pubkey")

    if not buyer_pubkey:
        raise HTTPException(400, "buyer_pubkey required")

    # 简单的实现：只更新buyer_pubkey，不处理聊天密钥
    from db.trades import update_trade_join
    try:
        update_trade_join(trade_id=trade_id, buyer_pubkey=buyer_pubkey, buyer_chat_pubkey={})
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

# 聊天相关API
# ============================================================

@router.get("/{trade_id}/chat-info")
async def get_trade_chat_info_api(trade_id: str):
    """
    获取交易的聊天相关信息
    """
    try:
        chat_info = get_trade_chat_info(trade_id)
        if not chat_info:
            raise HTTPException(status_code=404, detail="Trade not found")
        return chat_info
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{trade_id}/update-chat-pubkey")
async def update_chat_pubkey_api(trade_id: str, request: Request):
    """
    更新用户的聊天公钥
    """
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    
    identity_pubkey = data.get("identity_pubkey")
    chat_pubkey = data.get("chat_pubkey")
    
    if not identity_pubkey or not chat_pubkey:
        raise HTTPException(400, "identity_pubkey and chat_pubkey required")
    
    try:
        result = update_chat_pubkey(trade_id, identity_pubkey, chat_pubkey)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/{trade_id}/peer-chat-pubkey/{identity_pubkey}")
async def get_peer_chat_pubkey_api(trade_id: str, identity_pubkey: str):
    """
    获取对方的聊天公钥
    """
    try:
        peer_chat_pubkey = get_peer_chat_pubkey(trade_id, identity_pubkey)
        return {
            "success": True,
            "peer_chat_pubkey": peer_chat_pubkey
        }
    except Exception as e:
        raise HTTPException(500, str(e))