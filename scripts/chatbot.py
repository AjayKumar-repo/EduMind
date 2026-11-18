"""Retrieval-augmented chat over the uploaded PDFs."""
import asyncio
import logging
from collections import deque
from typing import Deque, Dict, List, Optional

from scripts.ingest import get_vectorstore
from scripts.llm_config import CHAT_MODEL, openrouter_chat

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Kimi, the friendly study assistant inside EduMind.
Answer the student's question clearly. When the context below is relevant, base your
answer on it and mention which document it came from; otherwise use your general knowledge
and say so. Use Markdown for structure when it helps.

Context from the student's documents:
{context}"""

MAX_HISTORY_TURNS = 6  # question/answer pairs kept for follow-up questions
RETRIEVE_K = 4

# Conversation history for this (single-user) local server.
_history: Deque[Dict[str, str]] = deque(maxlen=MAX_HISTORY_TURNS * 2)


def _retrieve_context(question: str, active_documents: Optional[List[str]]) -> str:
    store = get_vectorstore()
    search_kwargs = {"k": RETRIEVE_K}
    if active_documents:
        search_kwargs["filter"] = {"source": {"$in": active_documents}}
    try:
        docs = store.similarity_search(question, **search_kwargs)
    except Exception as e:
        logger.warning(f"Retrieval failed, answering without document context: {e}")
        return "No document context available."
    if not docs:
        return "No document context available."
    return "\n\n".join(
        f"[{d.metadata.get('source', 'unknown')}, page {int(d.metadata.get('page', 0)) + 1}]\n{d.page_content}"
        for d in docs
    )


def _answer_sync(question: str, active_documents: Optional[List[str]]) -> str:
    context = _retrieve_context(question, active_documents)
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context)}]
    messages.extend(_history)
    messages.append({"role": "user", "content": question})

    answer = openrouter_chat(messages, model=CHAT_MODEL, timeout=90).strip()

    _history.append({"role": "user", "content": question})
    _history.append({"role": "assistant", "content": answer})
    return answer


async def answer_question(question: str, active_documents: Optional[List[str]] = None) -> str:
    """Answer a chat message, optionally restricted to the given document names."""
    return await asyncio.to_thread(_answer_sync, question, active_documents)


def clear_history() -> None:
    _history.clear()
