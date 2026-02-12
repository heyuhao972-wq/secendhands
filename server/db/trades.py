
 # db/trades.py - 交易数据库操作模块
  
 #提供交易相关的数据库CRUD操作
 

import json
import logging
from db.mysql import get_cursor

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def insert_trade(trade: dict):
    """
    创建新交易记录
    """
    logger.info("开始插入新交易，交易ID: %s", trade.get("trade_id"))

    sql = """
    INSERT INTO trades (
        trade_id,
        seller_pubkey,
        buyer_pubkey,
        status,
        content_hash,
        description,
        price,
        created_at,
        updated_at
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
    """

    with get_cursor() as cursor:
        try:
            cursor.execute(
                sql,
                (
                    trade["trade_id"],
                    trade["seller_pubkey"],
                    trade.get("buyer_pubkey"),
                    trade["status"],
                    trade["content_hash"],
                    trade.get("description"),
                    trade.get("price"),
                )
            )
            logger.info("交易插入成功，交易ID: %s", trade.get("trade_id"))
        except Exception as e:
            error_msg = str(e)
            if "seller_chat_pubkey" in error_msg or "buyer_chat_pubkey" in error_msg:
                logger.error("数据库表结构错误：chat_pubkey 字段类型/约束异常")
                raise Exception(
                    "数据库表结构错误：chat_pubkey 字段不兼容当前代码，请检查 trades 表字段定义"
                ) from e
            logger.error("交易插入失败: %s", error_msg)
            raise


def update_trade_status(trade_id: str, status: str, buyer_pubkey: str = None):
    """
    更新交易状态
    
    在交易完成(COMPLETE)或取消(CANCEL)时调用
    
    @param trade_id: 交易ID
    @param status: 新状态
    @param buyer_pubkey: 买家公钥
    """
    logger.info("更新交易状态，交易ID: %s, 新状态: %s", trade_id, status)
    
    sql = """
    UPDATE trades
    SET status = %s,
        buyer_pubkey = COALESCE(%s, buyer_pubkey),
        updated_at = NOW()
    WHERE trade_id = %s
    """

    with get_cursor() as cursor:
        cursor.execute(sql, (status, buyer_pubkey, trade_id))
        logger.info("交易状态更新成功，影响行数: %s", cursor.rowcount)


def get_trade(trade_id: str):
    """
    获取交易详情
    
    @param trade_id: 交易ID
    @return: 交易信息字典，如果不存在则返回None
    """
    logger.info("获取交易详情，交易ID: %s", trade_id)
    
    sql = "SELECT * FROM trades WHERE trade_id = %s"

    with get_cursor() as cursor:
        cursor.execute(sql, (trade_id,))
        result = cursor.fetchone()
        logger.info("交易详情获取成功: %s", result is not None)
        return result


def list_trades(limit: int = 50):
    """
    获取交易列表
    
    @param limit: 返回的最大交易数量，默认50
    @return: 交易列表
    """
    logger.info("获取交易列表，限制: %s", limit)
    
    sql = """
    SELECT * FROM trades
    ORDER BY created_at DESC
    LIMIT %s
    """

    with get_cursor() as cursor:
        cursor.execute(sql, (limit,))
        result = cursor.fetchall()
        logger.info("交易列表获取成功，数量: %s", len(result))
        return result


def clear_trades():
    """
    清空交易表
    """
    logger.warning("清空交易表")

    sql = "DELETE FROM trades"

    with get_cursor() as cursor:
        cursor.execute(sql)
        logger.warning("交易表已清空，影响行数: %s", cursor.rowcount)


def update_trade_join(trade_id: str, buyer_pubkey: str, buyer_chat_pubkey: dict):
    """
    更新交易信息，记录买家加入
    
    @param trade_id: 交易ID
    @param buyer_pubkey: 买家身份公钥
    @param buyer_chat_pubkey: 买家聊天公钥
    """
    logger.info("更新交易，买家加入，交易ID: %s", trade_id)
    
    sql = """
    UPDATE trades
    SET buyer_pubkey = %s,
        buyer_chat_pubkey = %s,
        status = 'OPEN'
    WHERE trade_id = %s
    """

    with get_cursor() as cursor:
        cursor.execute(
            sql,
            (
                buyer_pubkey,
                json.dumps(buyer_chat_pubkey),
                trade_id,
            )
        )
        logger.info("买家加入交易更新成功，影响行数: %s", cursor.rowcount)


def update_trade_chat_pubkey(
    trade_id: str,
    identity_pubkey: str,
    chat_pubkey: str,
    is_seller: bool
):
    """
    更新交易的聊天公钥
    """
    logger.info(
        "更新交易聊天公钥，交易ID: %s, 用户角色: %s",
        trade_id,
        "卖家" if is_seller else "买家",
    )

    if is_seller:
        sql = """
        UPDATE trades
        SET seller_chat_pubkey = %s,
            updated_at = NOW()
        WHERE trade_id = %s AND seller_pubkey = %s
        """
    else:
        sql = """
        UPDATE trades
        SET buyer_chat_pubkey = %s,
            updated_at = NOW()
        WHERE trade_id = %s
        """

    value = json.dumps({"pubkey": chat_pubkey})

    with get_cursor() as cursor:
        if is_seller:
            cursor.execute(sql, (value, trade_id, identity_pubkey))
        else:
            cursor.execute(sql, (value, trade_id))
        logger.info("聊天公钥更新成功，影响行数: %s", cursor.rowcount)

def get_trade_with_chat_info(trade_id: str):
    """
    获取包含聊天信息的交易详情
    """
    logger.info("获取包含聊天信息的交易详情，交易ID: %s", trade_id)

    sql = """
    SELECT
        t.*,
        COALESCE(t.seller_chat_pubkey, '{}') AS seller_chat_pubkey,
        COALESCE(t.buyer_chat_pubkey, '{}') AS buyer_chat_pubkey
    FROM trades t
    WHERE t.trade_id = %s
    """

    with get_cursor() as cursor:
        cursor.execute(sql, (trade_id,))
        row = cursor.fetchone()

    if not row:
        logger.info("未找到交易，交易ID: %s", trade_id)
        return None

    def _parse_pubkey_field(v):
        if not v:
            return None
        if isinstance(v, dict):
            return v.get("pubkey")
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return None
            if s.startswith("{"):
                try:
                    obj = json.loads(s)
                    if isinstance(obj, dict):
                        return obj.get("pubkey")
                except Exception:
                    return None
            return s
        return None

    result = {
        "trade_id": row["trade_id"],
        "seller_pubkey": row["seller_pubkey"],
        "buyer_pubkey": row.get("buyer_pubkey"),
        "seller_chat_pubkey": _parse_pubkey_field(row.get("seller_chat_pubkey")),
        "buyer_chat_pubkey": _parse_pubkey_field(row.get("buyer_chat_pubkey")),
        "content_hash": row.get("content_hash"),
        "description": row.get("description"),
        "price": row.get("price"),
        "status": row.get("status"),
        "created_at": row.get("created_at"),
    }

    logger.info("交易详情获取成功，包含聊天信息")
    return result
