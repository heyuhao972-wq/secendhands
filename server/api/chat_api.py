# backend/api/chat_api.py

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from services import chat_service
from db.trades import get_trade
import json
import time

router = APIRouter(prefix="/ws/chat")
http_router = APIRouter(prefix="/chat")

# WebSocket连接管理
active_connections = {}

@router.websocket("/{trade_id}")
async def chat_websocket(websocket: WebSocket, trade_id: str):
    """
    交易聊天的WebSocket端点
    """
    # 1. 接受WebSocket连接
    await websocket.accept()
    print(f"[chat_api] 新WebSocket连接: trade_id={trade_id}")
    
    # 2. 验证交易ID是否存在
    trade = get_trade(trade_id)
    if trade is None:
        print(f"[chat_api] 交易不存在: trade_id={trade_id}")
        await websocket.close(code=1008, reason="Trade not found")
        return
    
    # 3. 等待认证消息
    try:
        # 设置接收超时
        import asyncio
        try:
            data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
        except asyncio.TimeoutError:
            await websocket.close(code=1008, reason="Authentication timeout")
            return
        
        auth_data = json.loads(data)
        
        # 验证认证消息
        if auth_data.get('type') != 'auth':
            await websocket.close(code=1008, reason="Authentication required")
            return
        
        identity_pubkey = auth_data.get('identity_pubkey')
        chat_pubkey = auth_data.get('chat_pubkey')
        
        if not identity_pubkey:
            await websocket.close(code=1008, reason="Missing identity_pubkey")
            return
        if not chat_pubkey:
            await websocket.close(code=1008, reason="Missing chat_pubkey")
            return
        
        print(f"[chat_api] 用户认证成功: trade_id={trade_id}, identity={identity_pubkey[:16]}...")
        
        # 4. 加入聊天房间
        await chat_service.join_room(trade_id, websocket, identity_pubkey, chat_pubkey)
        print(f"[chat_api] 连接已加入房间: trade_id={trade_id}")
        
        # 5. 发送认证成功响应
        await websocket.send_json({
            "type": "auth_response",
            "success": True,
            "trade_id": trade_id,
            "timestamp": int(time.time())
        })
        
        # 6. 持续接收并转发消息
        while True:
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                message_type = message.get('type')
                
                if message_type == 'CHAT':
                    # 处理聊天消息
                    ciphertext = message.get('ciphertext')
                    buyer_chat_pubkey = message.get('buyer_chat_pubkey') or chat_pubkey
                    if ciphertext:
                        # 中继消息
                        await chat_service.relay(
                            trade_id, 
                            ciphertext, 
                            chat_pubkey,
                            buyer_chat_pubkey
                        )
                    else:
                        print(f"[chat_api] 收到无效的CHAT消息: 缺少ciphertext")
                
                elif message_type == 'JOIN':
                    # 重新广播JOIN消息
                    await chat_service.broadcast_join(trade_id, identity_pubkey, chat_pubkey)
                
                elif message_type == 'PING':
                    # 心跳响应
                    await websocket.send_json({
                        "type": "PONG",
                        "timestamp": int(time.time())
                    })
                
                else:
                    print(f"[chat_api] 未知消息类型: {message_type}")
                    
            except json.JSONDecodeError:
                print(f"[chat_api] 收到非JSON消息，长度: {len(data)}")
                # 尝试作为纯文本密文处理
                await chat_service.relay(
                    trade_id, 
                    data, 
                    chat_pubkey,
                    chat_pubkey
                )
            except Exception as e:
                print(f"[chat_api] 处理消息异常: {e}")
                
    except WebSocketDisconnect:
        print(f"[chat_api] WebSocket断开: trade_id={trade_id}")
        chat_service.leave_room(trade_id, websocket)
    except Exception as e:
        print(f"[chat_api] WebSocket错误: trade_id={trade_id}, 错误={e}")
        chat_service.leave_room(trade_id, websocket)
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass

@http_router.get("/history/{trade_id}")
async def get_chat_history(trade_id: str, limit: int = 100):
    """
    获取交易的历史聊天消息
    """
    try:
        print(f"[chat_api] 获取聊天历史: trade_id={trade_id}")
        
        # 直接获取历史消息，不验证交易ID存在性
        messages = chat_service.get_chat_history(trade_id, limit)
        print(f"[chat_api] 获取到 {len(messages)} 条消息")
        
        # 转换格式
        result = []
        for msg in messages:
            result.append({
                "id": msg["id"],
                "trade_id": msg["trade_id"],
                "ciphertext": msg["ciphertext"],
                "timestamp": msg["timestamp"],
                "buyer_chat_pubkey": msg.get("buyer_chat_pubkey"),
                "sender_pubkey": msg.get("sender_pubkey")
            })
        
        return {"success": True, "messages": result}
    except Exception as e:
        print(f"[chat_api] 获取聊天历史失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@http_router.get("/room/{trade_id}")
async def get_chat_room_info(trade_id: str):
    """
    获取聊天房间信息
    """
    try:
        room_info = chat_service.get_room_info(trade_id)
        return {
            "success": True,
            "trade_id": trade_id,
            "participants": room_info,
            "count": len(room_info)
        }
    except Exception as e:
        print(f"[chat_api] 获取房间信息失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
