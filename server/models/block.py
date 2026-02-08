# models/block.py

import time
from typing import Dict, Optional
from crypto.hash import hash_object


class Block:
    """
    Block 是共识数据的最小不可变单元
    """

    def __init__(
        self,
        index: int,
        prev_hash: str,
        block_type: str,
        payload: Dict,
        timestamp: Optional[int] = None,
        block_hash: Optional[str] = None,
    ):
        self.index = index
        self.prev_hash = prev_hash
        self.type = block_type
        self.payload = payload
        self.timestamp = timestamp or int(time.time())
        self.block_hash = block_hash

    # ---------- 核心：Hash 计算 ----------

    def calculate_hash(self) -> str:
        """
        计算当前 Block 的 hash
        """
        data = {
            "index": self.index,
            "prev_hash": self.prev_hash,
            "timestamp": self.timestamp,
            "type": self.type,
            "payload": self.payload,
        }
        return hash_object(data)

    def seal(self):
        """
        固化区块（生成 block_hash）
        """
        self.block_hash = self.calculate_hash()

    # ---------- 验证逻辑（非常关键） ----------

    def verify(self, prev_block: Optional["Block"]) -> bool:
        """
        验证该区块是否有效
        """
        # 创世区块
        if prev_block is None:
            return self.index == 0 and self.prev_hash == "0" * 64

        if self.index != prev_block.index + 1:
            return False

        if self.prev_hash != prev_block.block_hash:
            return False

        if self.calculate_hash() != self.block_hash:
            return False

        return True

    # ---------- 序列化 ----------

    def to_dict(self) -> Dict:
        return {
            "index": self.index,
            "prev_hash": self.prev_hash,
            "timestamp": self.timestamp,
            "type": self.type,
            "payload": self.payload,
            "hash": self.block_hash,
        }

    @staticmethod
    def from_dict(data: Dict) -> "Block":
        return Block(
            index=data["index"],
            prev_hash=data["prev_hash"],
            block_type=data["type"],
            payload=data["payload"],
            timestamp=data["timestamp"],
            block_hash=data["hash"],
        )
