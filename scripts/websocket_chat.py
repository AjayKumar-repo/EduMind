# scripts/websocket_chat.py
import logging
from fastapi import APIRouter, WebSocket
from scripts.chatbot import chain

router = APIRouter()
logger = logging.getLogger(__name__)

@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connection accepted.")
    while True:
        try:
            data = await websocket.receive_text()
            logger.info(f"Received message: {data}")
            response = chain.invoke({"question": data})
            logger.info(f"Responding with: {response['answer']}")
            await websocket.send_text(response["answer"])
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            await websocket.send_text(f"Error: {str(e)}")
            break
