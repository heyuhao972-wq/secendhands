from fastapi import APIRouter

from db.blocks import get_all_blocks

router = APIRouter(prefix="/blocks")


@router.get("/export")
async def export_blocks():
    """
    导出区块链全部数据（原始 blocks 表）
    """
    blocks = get_all_blocks()
    return {"blocks": blocks}
