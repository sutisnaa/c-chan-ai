import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from .ai_web import router

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="C-chan AI", version="1.0.0")
app.include_router(router)
app.mount("/vrm", StaticFiles(directory="web/vrm"), name="vrm")

@app.get("/health")
async def health():
    return {"ok": True, "name": "C-chan AI"}

@app.get("/")
async def index():
    return FileResponse("web/index.html")
