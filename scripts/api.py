import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import List, Optional

import pypdf
from fastapi import FastAPI, File, HTTPException, Path, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# llm_config loads .env, so import it before anything that reads settings.
from scripts.llm_config import CHAT_MODEL, TEST_MODEL, UTILITY_MODEL, LLMError, get_api_key, openrouter_chat
from scripts.assessment import router as assessment_router
from scripts.chatbot import answer_question, clear_history, stream_answer
from scripts.studio import build_audio_script, build_mindmap
from scripts.ingest import PDF_DIRECTORY, rebuild_vectorstore
from scripts.reports_feature import router as reports_router
from scripts.test_feature import create_mcq_test
from scripts.websocket_chat import router as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_SUMMARY_CHARS = 8000


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not get_api_key():
        logging.warning("OPENROUTER_API_KEY is not set: chat, quotes, summaries and tests will fail.")
    logging.info(f"Models: chat={CHAT_MODEL}, tests={TEST_MODEL}, utility={UTILITY_MODEL}")
    await rebuild_vectorstore()
    yield


app = FastAPI(title="EduMind API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(assessment_router)
app.include_router(ws_router)
app.include_router(reports_router, prefix="/api/reports", tags=["reports"])


# --- Helpers ---

def safe_pdf_path(doc_name: str) -> str:
    """Resolve a document name to a path inside PDF_DIRECTORY, rejecting path tricks."""
    name = os.path.basename(doc_name or "")
    if not name or name != doc_name or name in (".", "..") or not name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Invalid document name.")
    return os.path.join(PDF_DIRECTORY, name)


def llm_http_error(e: Exception) -> HTTPException:
    if isinstance(e, LLMError):
        return HTTPException(status_code=502, detail=str(e))
    return HTTPException(status_code=500, detail=f"Internal error: {e}")


# --- Models ---

class ChatRequest(BaseModel):
    message: str
    active_documents: Optional[List[str]] = None
    learning_style: Optional[str] = None


class StudioRequest(BaseModel):
    documents: List[str]


class GenerateTestRequest(BaseModel):
    document_chunks: List[str]


class SummarizeRequest(BaseModel):
    text: str


# --- Routes ---

@app.get("/")
def read_root():
    return {"message": "EduMind API is up and running.", "api_key_configured": bool(get_api_key())}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "api_key_configured": bool(get_api_key()),
        "models": {"chat": CHAT_MODEL, "tests": TEST_MODEL, "utility": UTILITY_MODEL},
    }


@app.post("/chat/")
async def chat_endpoint(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message is empty.")
    logging.info(f"Chat request (documents: {req.active_documents})")
    try:
        answer = await answer_question(req.message, req.active_documents, req.learning_style)
        return {"answer": answer}
    except Exception as e:
        logging.error(f"Chat endpoint error: {e}", exc_info=not isinstance(e, LLMError))
        raise llm_http_error(e)


_STREAM_END = object()


@app.post("/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    """Stream the answer as plain text chunks while it is being written."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message is empty.")
    logging.info(f"Streaming chat request (documents: {req.active_documents})")
    generator = stream_answer(req.message, req.active_documents, req.learning_style)

    # Pull the first chunk before responding, so a bad key or model surfaces as a proper HTTP error.
    try:
        first = await asyncio.to_thread(next, generator, _STREAM_END)
    except Exception as e:
        logging.error(f"Chat stream error: {e}", exc_info=not isinstance(e, LLMError))
        raise llm_http_error(e)

    def rest():
        if first is _STREAM_END:
            return
        yield first
        try:
            yield from generator
        except LLMError as e:
            yield f"\n\n⚠️ {e}"
        except Exception as e:
            logging.error(f"Chat stream interrupted: {e}", exc_info=True)
            yield "\n\n⚠️ The answer was interrupted. Please try again."

    return StreamingResponse(
        rest(),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/chat/reset")
def reset_chat():
    clear_history()
    return {"message": "Chat history cleared."}


@app.post("/generate-test")
async def generate_test_endpoint(req: GenerateTestRequest):
    logging.info(f"Test generation request with {len(req.document_chunks)} chunks.")
    if not req.document_chunks:
        raise HTTPException(status_code=400, detail="No document chunks provided.")
    try:
        generated_test = await asyncio.to_thread(create_mcq_test, req.document_chunks)
    except Exception as e:
        logging.error(f"Error during test generation: {e}", exc_info=not isinstance(e, LLMError))
        raise llm_http_error(e)
    if not generated_test.get("questions"):
        raise HTTPException(status_code=502, detail="The AI did not return any valid questions. Please try again.")
    return generated_test


@app.get("/quote/daily")
async def get_daily_quote():
    prompt = (
        "Generate a single, short, inspirational quote about learning or studying. "
        "Return only the quote as plain text, without quotation marks or any extra text."
    )
    try:
        content = await asyncio.to_thread(
            openrouter_chat, [{"role": "user", "content": prompt}], UTILITY_MODEL, 30
        )
        return {"quote": content.strip().strip('"').strip()}
    except Exception as e:
        logging.error(f"Error fetching daily quote: {e}")
        raise llm_http_error(e)


@app.post("/summarize")
async def summarize_text(req: SummarizeRequest):
    """Summarize highlighted text. Keeps the OpenRouter key on the server."""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text provided.")
    if len(text) > MAX_SUMMARY_CHARS:
        raise HTTPException(status_code=400, detail=f"Text is too long to summarize (max {MAX_SUMMARY_CHARS} characters).")
    messages = [{"role": "user", "content": f'Provide a concise summary or definition for the following: "{text}"'}]
    try:
        summary = await asyncio.to_thread(openrouter_chat, messages, UTILITY_MODEL, 60)
        return {"summary": summary.strip()}
    except Exception as e:
        logging.error(f"Error summarizing text: {e}")
        raise llm_http_error(e)


# --- Documents ---

@app.post("/upload-document/")
async def upload_document(file: UploadFile = File(...)):
    file_location = safe_pdf_path(file.filename or "")
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File is larger than 50 MB.")
    if not contents.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="That file is not a valid PDF.")
    try:
        os.makedirs(PDF_DIRECTORY, exist_ok=True)
        with open(file_location, "wb") as f:
            f.write(contents)
        logging.info(f"Uploaded file saved to {file_location}")
        await rebuild_vectorstore()
        return {"message": f"File '{file.filename}' uploaded successfully. Knowledge base updated."}
    except Exception as e:
        logging.error(f"Error uploading file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not upload file: {e}")


@app.delete("/delete-document/{doc_name:path}")
async def delete_document_endpoint(doc_name: str = Path(..., description="The name of the document to delete")):
    file_path = safe_pdf_path(doc_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        os.remove(file_path)
        logging.info(f"Deleted file: {file_path}")
        await rebuild_vectorstore()
        return {"message": f"File '{doc_name}' deleted successfully. Knowledge base updated."}
    except Exception as e:
        logging.error(f"Error deleting file '{doc_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not delete file: {e}")


def _extract_pdf_text(file_path: str) -> str:
    with open(file_path, "rb") as f:
        reader = pypdf.PdfReader(f)
        return "\n".join(page.extract_text() or "" for page in reader.pages)


@app.get("/document-text/{doc_name:path}")
async def get_document_text(doc_name: str):
    """Return the full text of a PDF (used by the test generator)."""
    file_path = safe_pdf_path(doc_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        text_content = await asyncio.to_thread(_extract_pdf_text, file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract text from PDF: {e}")
    if not text_content.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from this PDF (it may be scanned images).")
    return {"content": text_content}


def _gather_documents_text(names: List[str]) -> str:
    parts = []
    for name in names:
        path = safe_pdf_path(name)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail=f"Document not found: {name}")
        parts.append(f"## {name}\n{_extract_pdf_text(path)}")
    text = "\n\n".join(parts)
    if not text.replace("#", "").strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from the selected documents.")
    return text


async def _run_studio(req: StudioRequest, builder, label: str):
    if not req.documents:
        raise HTTPException(status_code=400, detail="Select at least one document in Sources first.")
    text = await asyncio.to_thread(_gather_documents_text, req.documents)
    try:
        return await asyncio.to_thread(builder, text, req.documents)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logging.error(f"{label} error: {e}", exc_info=not isinstance(e, LLMError))
        raise llm_http_error(e)


@app.post("/studio/mindmap")
async def mindmap_endpoint(req: StudioRequest):
    """Build a hierarchical mind map of the selected documents."""
    return await _run_studio(req, build_mindmap, "Mind map")


@app.post("/studio/audio-overview")
async def audio_overview_endpoint(req: StudioRequest):
    """Write a two-host podcast script about the selected documents (spoken in the browser)."""
    return await _run_studio(req, build_audio_script, "Audio overview")


@app.get("/documents")
async def list_documents():
    if not os.path.exists(PDF_DIRECTORY):
        return {"documents": []}
    pdf_files = sorted(f for f in os.listdir(PDF_DIRECTORY) if f.lower().endswith(".pdf"))
    return {"documents": pdf_files}
