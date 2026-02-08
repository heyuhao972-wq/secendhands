from db.mysql import get_cursor

def insert_message(trade_id: str, buyer_chat_pubkey: str, sender_pubkey: str, ciphertext: str):
    """
    
    """
    new_sql = """
    INSERT INTO chats (
        trade_id,
        buyer_chat_pubkey,
        sender_pubkey,
        ciphertext,
        timestamp
    ) VALUES (%s, %s, %s, %s, UNIX_TIMESTAMP(NOW()))
    """
    old_sql = """
    INSERT INTO chats (
        trade_id,
        ciphertext,
        timestamp,
        sender_chat_pubkey
    ) VALUES (%s, %s, UNIX_TIMESTAMP(NOW()), %s)
    """

    with get_cursor() as cursor:
        try:
            cursor.execute(new_sql, (trade_id, buyer_chat_pubkey, sender_pubkey, ciphertext))
        except Exception:
            #  buyer_chat_pubkey / sender_pubkey
            cursor.execute(old_sql, (trade_id, ciphertext, sender_pubkey))

def get_messages(trade_id: str, limit: int = 100):
    """
   
    """
    new_sql = """
    SELECT 
        id,
        trade_id,
        buyer_chat_pubkey,
        sender_pubkey,
        ciphertext,
        timestamp
    FROM chats
    WHERE trade_id = %s
    ORDER BY timestamp ASC
    LIMIT %s
    """
    old_sql = """
    SELECT 
        id,
        trade_id,
        ciphertext,
        timestamp,
        sender_chat_pubkey
    FROM chats
    WHERE trade_id = %s
    ORDER BY timestamp ASC
    LIMIT %s
    """

    with get_cursor() as cursor:
        try:
            cursor.execute(new_sql, (trade_id, limit))
            rows = cursor.fetchall()
        except Exception:
            cursor.execute(old_sql, (trade_id, limit))
            rows = cursor.fetchall()

    
    normalized = []
    for row in rows:
        if "sender_pubkey" not in row and "sender_chat_pubkey" in row:
            row["sender_pubkey"] = row.get("sender_chat_pubkey")
        if "buyer_chat_pubkey" not in row:
            row["buyer_chat_pubkey"] = None
        normalized.append(row)
    return normalized