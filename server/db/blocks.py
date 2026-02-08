# db/blocks.py


#sql命令以后要优化
#1. 添加合适的索引
#2. 分页查询优化（避免SELECT *）
#3. 读写分离（如有需要）
#4. 定期清理日志和优化表


from db.mysql import get_cursor


def insert_block(block: dict):
    """
    写入新区块（append-only）
    """
    sql = """
    INSERT INTO blocks (
        block_index,
        prev_hash,
        block_hash,
        timestamp,
        type,
        payload_json
    ) VALUES (%s, %s, %s, %s, %s, %s)
    """

    with get_cursor() as cursor:
        cursor.execute(
            sql,
            (
                block["index"],
                block["prev_hash"],
                block["hash"],
                block["timestamp"],
                block["type"],
                block["payload_json"],
            )
        )


def get_last_block():
    sql = """
    SELECT * FROM blocks
    ORDER BY block_index DESC
    LIMIT 1
    """

#sql命令是以后要优化的

    with get_cursor() as cursor:
        cursor.execute(sql)
        return cursor.fetchone()


def get_blocks_since(index: int):
    sql = """
    SELECT * FROM blocks
    WHERE block_index > %s
    ORDER BY block_index ASC
    """

    with get_cursor() as cursor:
        cursor.execute(sql, (index,))
        return cursor.fetchall()


def get_all_blocks():
    """
    获取所有区块（按 block_index 升序）
    """
    sql = """
    SELECT * FROM blocks
    ORDER BY block_index ASC
    """

    with get_cursor() as cursor:
        cursor.execute(sql)
        return cursor.fetchall()
