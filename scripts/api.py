from fastapi import FastAPI, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from scripts.chatbot import chain
from scripts.assessment import evaluate_answers, get_questions, router as assessment_router
from scripts.websocket_chat import router as ws_router
# scripts/api.py (or main entrypoint)
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

app = FastAPI()
app.include_router(assessment_router)
app.include_router(ws_router)

@app.get("/")
def read_root():
    return {"message": "Kimi Chatbot API is up and running!"}

# Enable CORS so frontend can talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  # change to your frontend origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str

@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    try:
        response = chain.invoke({"question": req.message})
        return {"response": response["answer"]}
    except Exception as e:
        return {"error": str(e)}

# ✅ New endpoint to get test questions
@app.get("/assessment/questions")
def fetch_questions():
    return {"questions": get_questions()}

# ✅ Endpoint to submit answers and get learner type
@app.post("/assessment/submit")
def submit_assessment(answers: list[str]):
    result = evaluate_answers(answers)
    return {"learner_type": result}