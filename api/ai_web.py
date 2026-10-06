from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from .cchan_runtime import chat as chat_character

router = APIRouter(prefix="/api/ai", tags=["ai"])

class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=2000)
    user_id: str | None = Field(default=None, max_length=120)

@router.post("/chat")
async def chat(payload: ChatRequest):
    try:
        user_id = (payload.user_id or f"local:{payload.session_id}").strip()
        return await chat_character(payload.session_id.strip(), payload.message.strip(), user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=503, detail="AI unavailable")
