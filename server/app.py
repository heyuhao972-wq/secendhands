# app.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.trade_api import router as trade_router
from api.chat_api import router as chat_ws_router, http_router as chat_http_router
from api.block_api import router as block_router

def create_app():
    """
    创建并配置 Web 应用
    """
    app = FastAPI(title="Second-hand Book Trading System", version="1.0")
    
    # 添加CORS中间件，确保在所有路由处理之前生效
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5500",
            "http://localhost:5500",
        ],
        allow_credentials=True,
        allow_methods=["*"],  # 允许所有HTTP方法
        allow_headers=["*"],  # 允许所有HTTP头
    )
    
    # 直接在创建应用时注册路由，确保路由正确添加
    register_routes(app)

    return app

def register_routes(app):
    """
    把 trade_api / chat_api 挂上去
    """
    app.include_router(trade_router)
    app.include_router(chat_ws_router)
    app.include_router(chat_http_router)
    app.include_router(block_router)

if __name__ == "__main__":
    import uvicorn

    app = create_app()
    register_routes(app)

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=True
    )
else:
    # 当作为模块导入时也要注册路由
    app = create_app()
    register_routes(app)


#uvicorn app:app --reload
#python -m http.server 5500
