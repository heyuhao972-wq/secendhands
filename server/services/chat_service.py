# backend/services/chat_service.py

from typing import Dict, List, Tuple
from db.chats import insert_message, get_messages

# 房间管理: trade_id -> list of (connection, identity_pubkey, chat_pubkey)
_rooms: Dict[str, List[Tuple]] = {}

# -----------------------------
# 加入聊天室
# -----------------------------

async def join_room(trade_id: str, conn, identity_pubkey: str, chat_pubkey: str = None):
    """
    将一个连接加入指定 trade_id 的聊天室
    """
    if trade_id not in _rooms:
        _rooms[trade_id] = []
    
    # 检查是否已经存在相同的连接
    for i, (existing_conn, existing_identity, existing_chat) in enumerate(_rooms[trade_id]):
        if existing_conn == conn:
            # 更新现有连接的信息
            _rooms[trade_id][i] = (conn, identity_pubkey, chat_pubkey)
            return
    
    _rooms[trade_id].append((conn, identity_pubkey, chat_pubkey))
    
    # 向房间内的其他人广播 JOIN 消息
    await broadcast_join(trade_id, identity_pubkey, chat_pubkey)

# -----------------------------
#  离开聊天室
# -----------------------------

def leave_room(trade_id: str, conn):
    """
    将一个连接从聊天室中移除
    """
    if trade_id not in _rooms:
        return
    
    # 查找并移除匹配的连接
    _rooms[trade_id] = [
        item for item in _rooms[trade_id]
        if item[0] != conn
    ]
    
    # 如果房间空了，清理掉
    if not _rooms[trade_id]:
        del _rooms[trade_id]

# -----------------------------
# 广播 JOIN 消息
# -----------------------------

async def broadcast_join(trade_id: str, identity_pubkey: str, chat_pubkey: str = None):
    """
    广播用户加入消息
    """
    if trade_id not in _rooms:
        return
    
    join_message = {
        "type": "JOIN",
        "trade_id": trade_id,
        "identity_pubkey": identity_pubkey,
        "chat_pubkey": chat_pubkey,
        "timestamp": get_current_timestamp()
    }
    
    for conn, _, _ in _rooms[trade_id]:
        try:
            await conn.send_json(join_message)
        except Exception:
            pass

# -----------------------------
# 中继密文消息
# -----------------------------

async def relay(trade_id: str, ciphertext: str, sender_chat_pubkey: str, buyer_chat_pubkey: str):
    """
    将密文消息广播给同一 trade_id 下的所有连接
    同时将消息保存到数据库
    """
    if trade_id not in _rooms:
        return
    
    # 保存消息到数据库
    try:
        # 存储发送者身份公钥，用于前端识别消息发送者
        insert_message(trade_id, buyer_chat_pubkey, sender_chat_pubkey, ciphertext)
    except Exception as e:
        print(f"[chat_service] 保存消息失败: {e}")
    
    # 构建消息
    message = {
        "type": "CHAT",
        "trade_id": trade_id,
        "sender_chat_pubkey": sender_chat_pubkey,
        "ciphertext": ciphertext,
        "timestamp": get_current_timestamp()
    }
    
    dead_conns = []
    
    # 广播给房间内的所有连接
    for conn, _, _ in _rooms[trade_id]:
        try:
            await conn.send_json(message)
        except Exception:
            dead_conns.append(conn)
    
    # 清理失效连接
    for conn in dead_conns:
        leave_room(trade_id, conn)

# -----------------------------
# 获取房间信息
# -----------------------------

def get_room_info(trade_id: str):
    """
    获取房间信息
    """
    if trade_id not in _rooms:
        return []
    
    return [
        {
            "identity_pubkey": identity_pubkey,
            "chat_pubkey": chat_pubkey,
            "connected": True
        }
        for _, identity_pubkey, chat_pubkey in _rooms[trade_id]
    ]

# -----------------------------
# 获取历史消息
# -----------------------------

def get_chat_history(trade_id: str, limit: int = 100):
    """
    获取聊天历史
    """
    return get_messages(trade_id, limit)

# -----------------------------
# 工具函数
# -----------------------------

def get_current_timestamp():
    """
    获取当前时间戳
    """
    import time
    return int(time.time())
