"""Notes: saved to a JSON file on disk, plus AI helpers that work on note text."""
import json
import os
import tempfile
import threading
import time
import uuid
from typing import Dict, List, Optional

from scripts.llm_config import CHAT_MODEL, openrouter_chat

NOTES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_data")
NOTES_FILE = os.path.join(NOTES_DIR, "notes.json")
MAX_TITLE = 200
MAX_BODY = 200_000

_lock = threading.Lock()


def _load() -> List[Dict]:
    if not os.path.exists(NOTES_FILE):
        return []
    try:
        with open(NOTES_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        # Keep the unreadable file for recovery instead of overwriting it.
        os.replace(NOTES_FILE, f"{NOTES_FILE}.corrupt-{int(time.time())}")
        return []


def _save(notes: List[Dict]) -> None:
    os.makedirs(NOTES_DIR, exist_ok=True)
    # Write to a temp file, then swap it in, so a crash never leaves a half-written file.
    fd, tmp = tempfile.mkstemp(dir=NOTES_DIR, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(notes, f, ensure_ascii=False, indent=1)
    os.replace(tmp, NOTES_FILE)


def _clean(title: Optional[str], body: Optional[str]) -> Dict[str, str]:
    return {"title": (title or "").strip()[:MAX_TITLE], "body": (body or "")[:MAX_BODY]}


def list_notes() -> List[Dict]:
    with _lock:
        return sorted(_load(), key=lambda n: n.get("updatedAt", 0), reverse=True)


def create_note(title: str = "", body: str = "", source: Optional[str] = None) -> Dict:
    now = int(time.time() * 1000)
    note = {"id": uuid.uuid4().hex[:12], **_clean(title, body), "createdAt": now, "updatedAt": now}
    if source:
        note["source"] = source[:80]
    with _lock:
        notes = _load()
        notes.append(note)
        _save(notes)
    return note


def update_note(note_id: str, title: Optional[str], body: Optional[str]) -> Optional[Dict]:
    with _lock:
        notes = _load()
        for note in notes:
            if note["id"] == note_id:
                if title is not None:
                    note["title"] = title.strip()[:MAX_TITLE]
                if body is not None:
                    note["body"] = body[:MAX_BODY]
                note["updatedAt"] = int(time.time() * 1000)
                _save(notes)
                return note
    return None


def delete_note(note_id: str) -> bool:
    with _lock:
        notes = _load()
        kept = [n for n in notes if n["id"] != note_id]
        if len(kept) == len(notes):
            return False
        _save(kept)
        return True


ASSIST_PROMPTS = {
    "summarize": "Summarize these study notes in a few tight bullet points that keep every key fact, term and number. Return only the bullets.",
    "explain": "Explain the idea in these notes simply, as a patient tutor would to a first-year student: plain words, one concrete example or analogy, no more than two short paragraphs.",
    "key_terms": "List the key terms and concepts from these notes as a Markdown list, each as **Term**: a one-line definition based on the notes.",
    "flashcards": "Turn these notes into 5 to 8 flashcards for active recall. Format each as:\n**Q:** question\n**A:** short answer\n\nSeparate cards with a blank line. Cover the most important ideas first.",
    "quiz": "Write 4 short quiz questions that test understanding (not just recall) of these notes, then an **Answers** section with brief answers.",
    "improve": "Rewrite these notes so they are clearer and better organized: fix spelling and grammar, add short Markdown headings and bullet points where helpful, keep all of the original information and the author's meaning. Return only the rewritten notes.",
}


def assist(text: str, action: str) -> str:
    instruction = ASSIST_PROMPTS[action]
    messages = [
        {"role": "system", "content": "You help a student work with their own study notes. Follow the instruction exactly, use Markdown, and add no preamble or closing remarks."},
        {"role": "user", "content": f"{instruction}\n\nNotes:\n---\n{text}\n---"},
    ]
    return openrouter_chat(messages, model=CHAT_MODEL, timeout=120, max_tokens=3000).strip()
