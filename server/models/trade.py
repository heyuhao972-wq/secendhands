# models/trade.py

from typing import Optional, Dict
import time


class Trade:
    """
    Trade 是“交易在系统中的逻辑形态”
    不等同于数据库表
    """

    def __init__(
        self,
        trade_id: str,
        seller_pubkey: str,
        content: Dict,
        status: str = "OPEN",
        buyer_pubkey: Optional[str] = None,
        created_at: Optional[int] = None,
    ):
        self.trade_id = trade_id
        self.seller_pubkey = seller_pubkey
        self.buyer_pubkey = buyer_pubkey
        self.status = status
        self.content = content
        self.created_at = created_at or int(time.time())

    # ---------- 统一结构 ----------

    def to_dict(self) -> Dict:
        """
        将 Trade 转为标准 dict 形式
        用途：
        - API 返回
        - 区块 payload
        - 写入 DB 前的统一格式
        """
        return {
            "trade_id": self.trade_id,
            "seller_pubkey": self.seller_pubkey,
            "buyer_pubkey": self.buyer_pubkey,
            "status": self.status,
            "content": self.content,
            "created_at": self.created_at,
        }

    @staticmethod
    def from_dict(data: Dict) -> "Trade":
        """
        从 dict 构造 Trade
        """
        return Trade(
            trade_id=data["trade_id"],
            seller_pubkey=data["seller_pubkey"],
            buyer_pubkey=data.get("buyer_pubkey"),
            status=data["status"],
            content=data["content"],
            created_at=data.get("created_at"),
        )

    # ---------- 轻量一致性校验 ----------

    def basic_validate(self):
        """
        只检查“形态是否正确”
        不检查：
        - 签名
        - 状态跳转
        - 是否允许创建
        """
        if not isinstance(self.trade_id, str):
            raise ValueError("trade_id must be str")

        if not isinstance(self.seller_pubkey, str):
            raise ValueError("seller_pubkey must be str")

        if self.buyer_pubkey is not None and not isinstance(self.buyer_pubkey, str):
            raise ValueError("buyer_pubkey must be str or None")

        if not isinstance(self.status, str):
            raise ValueError("status must be str")

        if not isinstance(self.content, dict):
            raise ValueError("content must be dict")

        if not isinstance(self.created_at, int):
            raise ValueError("created_at must be int")
