# scripts/websocket_chat.py
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from scripts.chatbot import answer_question

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connection accepted.")
    try:
        while True:
            data = await websocket.receive_text()
            try:
                answer = await answer_question(data)
            except Exception as e:
                logger.error(f"WebSocket chat error: {e}")
                answer = f"Error: {e}"
            await websocket.send_text(answer)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected.")
