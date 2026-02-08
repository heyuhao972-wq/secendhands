# db/mysql.py - 添加连接池

#与mysql主连接

import pymysql
from contextlib import contextmanager
from threading import Lock
from queue import Queue

# 数据库配置
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "root",
    "database": "second_hands",
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": False,
}

# 连接池
connection_pool = None
pool_lock = Lock()

class ConnectionPool:
    def __init__(self, max_connections=10):
        self.max_connections = max_connections
        self.pool = Queue(max_connections)
        self.current_connections = 0
        
    def get_connection(self):
        with pool_lock:
            if not self.pool.empty():
                return self.pool.get()
            elif self.current_connections < self.max_connections:
                self.current_connections += 1
                return self._create_connection()
            else:
                raise Exception("Connection pool exhausted")
    
    def return_connection(self, conn):
        with pool_lock:
            self.pool.put(conn)
    
    def _create_connection(self):
        return pymysql.connect(**DB_CONFIG)

def init_connection_pool(max_connections=10):
    global connection_pool
    connection_pool = ConnectionPool(max_connections)

def get_connection():
    """
    获取数据库连接（从连接池）
    """
    if connection_pool is None:
        # 初始化连接池
        init_connection_pool()
    
    return connection_pool.get_connection()

def close_connection(conn):
    """
    关闭数据库连接（放回连接池）
    """
    if connection_pool and conn:
        connection_pool.return_connection(conn)

@contextmanager
def get_cursor():
    """
    提供 cursor 的上下文管理器
    自动处理 commit / rollback 和连接管理
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        yield cursor
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        if cursor:
            cursor.close()
        close_connection(conn)