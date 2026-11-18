"""Retrieval-augmented chat over the uploaded PDFs."""
import asyncio
import logging
import threading
from collections import deque
from typing import Deque, Dict, Iterator, List, Optional

from scripts.ingest import get_vectorstore
from scripts.llm_config import CHAT_MODEL, openrouter_chat, openrouter_stream

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Kimi, the study companion inside EduMind. You help students understand their course material and think clearly about it.

How you answer:
- Lead with the answer. No preamble ("Great question!", "Sure, here's..."), no restating the question, no closing offers of more help.
- Match length to the question: a quick fact gets a sentence or two; a concept gets a clear explanation with an example; a worked problem gets its steps.
- Write in plain, warm, precise prose. Use Markdown structure (short headings, lists, tables, bold for key terms) only when it genuinely helps the student scan or compare; never decorate a short answer with headings.
- Put code, formulas and commands in fenced code blocks with a language tag. Use LaTeX-free plain notation for maths (e.g. x^2, sqrt(n)).
- When you're unsure or the material doesn't cover something, say so plainly instead of guessing.
- Teach, don't just tell: when it helps, add one concrete example, analogy, or a quick check-yourself question at the end.

Using the student's documents:
- Excerpts from the student's uploaded documents appear below, each tagged with its file name and page.
- When an excerpt answers the question, ground your answer in it and cite it inline like (Biology Notes.pdf, p. 3).
- When the excerpts are irrelevant, answer from general knowledge without mentioning them.
{style_note}
Document excerpts:
{context}"""

LEARNING_STYLE_NOTES = {
    "pictorial": "This student learns best visually: favour diagrams described in words, tables, spatial analogies and step-by-step visual structure.",
    "kinesthetic": "This student learns by doing: favour hands-on examples, small exercises to try, and real-world applications.",
    "vocal": "This student learns by listening and discussing: favour conversational explanations, verbal mnemonics, and phrasing that reads well aloud.",
    "memorizer": "This student learns through repetition and structure: favour concise summaries, numbered key points, and memorable definitions.",
}

MAX_HISTORY_TURNS = 8  # question/answer pairs kept for follow-up questions
RETRIEVE_K = 5
MAX_ANSWER_TOKENS = 4096

# Conversation history for this (single-user) local server.
_history: Deque[Dict[str, str]] = deque(maxlen=MAX_HISTORY_TURNS * 2)
_history_lock = threading.Lock()


def _retrieve_context(question: str, active_documents: Optional[List[str]]) -> str:
    store = get_vectorstore()
    search_kwargs = {"k": RETRIEVE_K}
    if active_documents:
        search_kwargs["filter"] = {"source": {"$in": active_documents}}
    try:
        docs = store.similarity_search(question, **search_kwargs)
    except Exception as e:
        logger.warning(f"Retrieval failed, answering without document context: {e}")
        return "(none)"
    if not docs:
        return "(none)"
    return "\n\n".join(
        f"[{d.metadata.get('source', 'unknown')}, p. {int(d.metadata.get('page', 0)) + 1}]\n{d.page_content}"
        for d in docs
    )


def _build_messages(question: str, active_documents: Optional[List[str]], learning_style: Optional[str]) -> List[Dict[str, str]]:
    note = LEARNING_STYLE_NOTES.get((learning_style or "").lower())
    style_note = f"\nAbout this student: {note}\n" if note else ""
    system = SYSTEM_PROMPT.format(context=_retrieve_context(question, active_documents), style_note=style_note)
    with _history_lock:
        history = list(_history)
    return [{"role": "system", "content": system}, *history, {"role": "user", "content": question}]


def _remember(question: str, answer: str) -> None:
    if not answer.strip():
        return
    with _history_lock:
        _history.append({"role": "user", "content": question})
        _history.append({"role": "assistant", "content": answer})


def stream_answer(
    question: str,
    active_documents: Optional[List[str]] = None,
    learning_style: Optional[str] = None,
) -> Iterator[str]:
    """Yield the answer as it is generated; the full answer is saved to history at the end."""
    messages = _build_messages(question, active_documents, learning_style)
    parts: List[str] = []
    try:
        for delta in openrouter_stream(messages, model=CHAT_MODEL, max_tokens=MAX_ANSWER_TOKENS):
            parts.append(delta)
            yield delta
    finally:
        # Save whatever was produced, even if the client stopped the stream early.
        _remember(question, "".join(parts))


def _answer_sync(question: str, active_documents: Optional[List[str]], learning_style: Optional[str]) -> str:
    messages = _build_messages(question, active_documents, learning_style)
    answer = openrouter_chat(messages, model=CHAT_MODEL, timeout=120, max_tokens=MAX_ANSWER_TOKENS).strip()
    _remember(question, answer)
    return answer


async def answer_question(
    question: str,
    active_documents: Optional[List[str]] = None,
    learning_style: Optional[str] = None,
) -> str:
    """Answer a chat message in one piece (used by the non-streaming endpoint and WebSocket)."""
    return await asyncio.to_thread(_answer_sync, question, active_documents, learning_style)


def clear_history() -> None:
    with _history_lock:
        _history.clear()
