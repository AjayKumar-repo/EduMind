import os
import logging
import asyncio
from typing import List, Optional
import requests # Added for daily quote feature
import json # Added for daily quote feature

from fastapi import FastAPI, UploadFile, File, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pypdf

# Import from your scripts
from scripts.chatbot import chain, get_retriever_with_filter
from scripts.assessment import evaluate_answers, get_questions, router as assessment_router
from scripts.websocket_chat import router as ws_router
from scripts.ingest import rebuild_vectorstore, PDF_DIRECTORY
from scripts.test_feature import create_mcq_test
# Import the new reports router
from scripts.reports_feature import router as reports_router

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

# FastAPI app
app = FastAPI()

# Include routers
app.include_router(assessment_router)
app.include_router(ws_router)
# Include the new reports router with a specific prefix for modularity
app.include_router(reports_router, prefix="/api/reports", tags=["reports"])


@app.get("/")
def read_root():
    return {"message": "Kimi Chatbot API is up and running with Chroma!"}

# Enable CORS so frontend can call backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Models
class ChatRequest(BaseModel):
    message: str
    active_documents: Optional[List[str]] = None

class GenerateTestRequest(BaseModel):
    document_chunks: List[str]


@app.post("/chat/")
async def chat_endpoint(req: ChatRequest):
    logging.info(f"Received chat request. Message: '{req.message}', Active Documents: {req.active_documents}")
    try:
        filtered_retriever = await get_retriever_with_filter(req.active_documents)
        response = await chain.ainvoke(
            {"question": req.message},
            config={"retriever": filtered_retriever}
        )
        return {"answer": response["answer"]}
    except Exception as e:
        logging.error(f"Chat endpoint error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing chat: {str(e)}")


@app.post("/generate-test")
async def generate_test_endpoint(req: GenerateTestRequest):
    """
    Receives document chunks and generates a test using the imported logic.
    """
    logging.info(f"Received test generation request with {len(req.document_chunks)} chunks.")
    if not req.document_chunks:
        raise HTTPException(status_code=400, detail="No document chunks provided.")
    try:
        generated_test = create_mcq_test(req.document_chunks)
        if not generated_test or not generated_test.get("questions"):
             raise HTTPException(status_code=500, detail="Failed to generate a valid test from the provided content.")
        return generated_test
    except Exception as e:
        logging.error(f"Error during test generation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An internal error occurred while generating the test: {str(e)}")


# New Endpoint for Daily Motivational Quote
@app.get("/quote/daily")
async def get_daily_quote():
    """
    Generates and returns a single, learning-related motivational quote.
    """
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        logging.error("OPENROUTER_API_KEY not set for daily quote generation.")
        raise HTTPException(status_code=500, detail="API key for quote generation is not configured.")
    
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    prompt = "Generate a single, short, inspirational quote about learning or studying. The quote should be concise and motivational. Return only the quote as a plain string, without any extra text like 'Here is a quote:' or quotation marks."
    
    data = {
        "model": "mistralai/mistral-7b-instruct",
        "messages": [{"role": "user", "content": prompt}]
    }

    try:
        response = requests.post(url, headers=headers, data=json.dumps(data), timeout=30)
        response.raise_for_status()
        content = response.json()['choices'][0]['message']['content']
        # Clean up the response to ensure it's just the quote
        cleaned_quote = content.strip().strip('"')
        return {"quote": cleaned_quote}
    except Exception as e:
        logging.error(f"Error fetching daily quote from AI service: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate daily quote.")


# Assessment Endpoints
@app.get("/assessment/questions")
def fetch_questions():
    return {"questions": get_questions()}

@app.post("/assessment/submit")
def assess_learner(answers: list[str]):
    result = evaluate_answers(answers)
    return {"learner_type": result}

# Document Upload Endpoint
@app.post("/upload-document/")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    file_location = os.path.join(PDF_DIRECTORY, file.filename)
    try:
        os.makedirs(PDF_DIRECTORY, exist_ok=True)
        with open(file_location, "wb+") as file_object:
            file_object.write(await file.read())
        logging.info(f"Uploaded file saved to {file_location}")
        await rebuild_vectorstore()
        return {"message": f"File '{file.filename}' uploaded successfully. Knowledge base updated."}
    except Exception as e:
        logging.error(f"Error uploading file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not upload file: {str(e)}")


# Document Delete Endpoint
@app.delete("/delete-document/{doc_name:path}")
async def delete_document_endpoint(doc_name: str = Path(..., description="The name of the document to delete")):
    logging.info(f"Received request to delete document: '{doc_name}'")
    file_path = os.path.join(PDF_DIRECTORY, doc_name)
    if not os.path.exists(file_path):
        logging.error(f"Document not found for deletion: {file_path}")
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        os.remove(file_path)
        logging.info(f"Successfully deleted file: {file_path}")
        await rebuild_vectorstore()
        return {"message": f"File '{doc_name}' deleted successfully. Knowledge base updated."}
    except Exception as e:
        logging.error(f"Error deleting file '{doc_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not delete file: {str(e)}")


@app.get("/document-text/{doc_name:path}")
async def get_document_text(doc_name: str):
    """
    Extracts and returns the full text content from a specified PDF document.
    This new endpoint solves the "404 Not Found" error for the test feature.
    """
    file_path = os.path.join(PDF_DIRECTORY, doc_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found.")
    
    try:
        text_content = ""
        with open(file_path, "rb") as f:
            reader = pypdf.PdfReader(f)
            for page in reader.pages:
                text_content += page.extract_text() or ""
        return {"content": text_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract text from PDF: {e}")


# Document List Endpoint
@app.get("/documents")
async def list_documents():
    try:
        if not os.path.exists(PDF_DIRECTORY):
            return {"documents": []}
        pdf_files = [f for f in os.listdir(PDF_DIRECTORY) if f.endswith(".pdf")]
        logging.info(f"Listed documents: {pdf_files}")
        return {"documents": pdf_files}
    except Exception as e:
        logging.error(f"Error listing documents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not list documents: {str(e)}")

# Startup Event
@app.on_event("startup")
async def startup_event():
    logging.info("Startup: Triggered initial Chroma vector store build.")
    await rebuild_vectorstore()