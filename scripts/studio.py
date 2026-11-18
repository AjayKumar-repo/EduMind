"""Studio generators: mind maps and two-host audio overviews built from the student's PDFs."""
import json
import logging
from typing import Dict, List

from scripts.llm_config import CHAT_MODEL, openrouter_chat, parse_json_object

logger = logging.getLogger(__name__)

MAX_SOURCE_CHARS = 40_000  # ~10k tokens of document text per generation

MINDMAP_PROMPT = """Build a study mind map of the material below.

Return ONLY a JSON object, no prose and no code fences, with this shape:
{{"title": "central topic, 2-5 words",
  "children": [
    {{"title": "main branch, 1-4 words", "note": "one short sentence explaining it",
      "children": [{{"title": "sub-point, 1-5 words", "note": "one short sentence", "children": []}}]}}
  ]}}

Rules:
- 4 to 7 main branches covering the material's major themes, in a logical teaching order.
- Each main branch has 2 to 5 sub-points; go one level deeper only where it clarifies a key idea.
- Titles are short noun phrases a student would put on a flashcard. Notes are factual and specific to the material.
- Use only information in the material.

Material ({source_names}):
---
{text}
---"""

AUDIO_PROMPT = """Write the script for a short, engaging study podcast that walks a student through the material below.

Two hosts:
- Maya: the guide. Explains clearly, uses concrete examples and analogies.
- Leo: the curious learner. Asks the questions a student would ask, summarises in his own words, occasionally gets something slightly wrong so Maya can correct it.

Return ONLY a JSON object, no prose and no code fences:
{{"title": "episode title, under 8 words",
  "segments": [{{"speaker": "Maya", "text": "..."}}, {{"speaker": "Leo", "text": "..."}}]}}

Rules:
- 14 to 22 segments, roughly 3 to 4 minutes when read aloud. Each segment 1 to 4 sentences.
- Open with a one-line hook about why this topic matters, cover the most important ideas in a logical order, and close with a quick recap of 3 key takeaways.
- Write for the ear: natural spoken sentences, no Markdown, no bullet points, no emoji, no stage directions, no URLs. Spell out symbols (say "percent", not "%").
- Use only information in the material.

Material ({source_names}):
---
{text}
---"""


def _clip(text: str) -> str:
    text = text.strip()
    if len(text) <= MAX_SOURCE_CHARS:
        return text
    return text[:MAX_SOURCE_CHARS] + "\n[...material truncated for length...]"


def _clean_node(node: dict, depth: int = 0) -> Dict:
    title = str(node.get("title", "")).strip() or "Untitled"
    cleaned = {"title": title[:80], "note": str(node.get("note", "")).strip()[:240], "children": []}
    if depth < 3:
        for child in node.get("children") or []:
            if isinstance(child, dict):
                cleaned["children"].append(_clean_node(child, depth + 1))
    return cleaned


def build_mindmap(text: str, source_names: List[str]) -> Dict:
    prompt = MINDMAP_PROMPT.format(text=_clip(text), source_names=", ".join(source_names))
    for attempt in range(2):
        raw = openrouter_chat([{"role": "user", "content": prompt}], model=CHAT_MODEL, timeout=180, max_tokens=6000)
        try:
            tree = _clean_node(parse_json_object(raw))
            if tree["children"]:
                return tree
        except (ValueError, json.JSONDecodeError) as e:
            logger.warning(f"Mind map JSON unusable (attempt {attempt + 1}): {e}")
    raise ValueError("The AI did not return a usable mind map. Please try again.")


def build_audio_script(text: str, source_names: List[str]) -> Dict:
    prompt = AUDIO_PROMPT.format(text=_clip(text), source_names=", ".join(source_names))
    for attempt in range(2):
        raw = openrouter_chat([{"role": "user", "content": prompt}], model=CHAT_MODEL, timeout=180, max_tokens=6000)
        try:
            data = parse_json_object(raw)
            segments = [
                {"speaker": "Leo" if str(s.get("speaker", "")).strip().lower().startswith("leo") else "Maya",
                 "text": str(s.get("text", "")).strip()}
                for s in data.get("segments") or []
                if isinstance(s, dict) and str(s.get("text", "")).strip()
            ]
            if len(segments) >= 4:
                return {"title": str(data.get("title", "Audio overview")).strip()[:80], "segments": segments}
        except (ValueError, json.JSONDecodeError) as e:
            logger.warning(f"Audio script JSON unusable (attempt {attempt + 1}): {e}")
    raise ValueError("The AI did not return a usable audio script. Please try again.")
