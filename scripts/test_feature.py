"""Generates a 16-question multiple-choice test from document text."""
import concurrent.futures
import json
import logging
import random
import uuid
from typing import Dict, List

from scripts.llm_config import TEST_MODEL, LLMError, openrouter_chat

logger = logging.getLogger(__name__)

CATEGORIES = ["Cognitive Memory", "Logical Reasoning", "Critical Thinking", "Creative Application"]
QUESTIONS_PER_CATEGORY = 4
MAX_ATTEMPTS_PER_CATEGORY = 6  # bounds the number of API calls per test


def _parse_questions(raw_text: str) -> List[Dict]:
    start, end = raw_text.find("{"), raw_text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in AI response.")
    content = json.loads(raw_text[start : end + 1])
    questions = content.get("questions")
    if not isinstance(questions, list):
        raise ValueError("AI response has no 'questions' list.")
    return questions


def generate_questions_from_chunk(chunk: str, category: str, num_questions: int) -> List[Dict]:
    """Ask the model for `num_questions` questions of one category from one chunk.

    Raises LLMError when the API itself fails (bad key, no credits, unknown model),
    so the caller can stop instead of retrying a request that can't succeed.
    Returns [] when the model replies but the JSON is unusable.
    """
    prompt_text = f"""
    You are an expert test creator. Based ONLY on the following document text, generate a JSON object.
    Your task is to create {num_questions} questions for the category: "{category}".

    The JSON object must contain a single key "questions", which is a list of exactly {num_questions} question objects.

    Each question object in the list must have the following keys:
    - "category": This must be exactly "{category}".
    - "questionText": A string containing the question based on the document.
    - "options": A list of exactly four unique strings representing the multiple-choice options.
    - "correctAnswer": A string that exactly matches one of the four options.

    Your entire output must be only the raw JSON object itself.

    Document Text Chunk:
    ---
    {chunk}
    ---
    """
    raw = openrouter_chat(
        [{"role": "user", "content": prompt_text}],
        model=TEST_MODEL,
        timeout=120,
        response_format={"type": "json_object"},
    )
    try:
        return _parse_questions(raw)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Unusable JSON for category {category}: {e}")
        return []


def _is_valid(q: Dict, category: str) -> bool:
    options = q.get("options")
    return (
        isinstance(q.get("questionText"), str)
        and q["questionText"].strip() != ""
        and isinstance(options, list)
        and len(options) == 4
        and len(set(map(str, options))) == 4
        and q.get("correctAnswer") in options
    )


def _questions_for_category(document_chunks: List[str], category: str) -> List[Dict]:
    collected: List[Dict] = []
    seen = set()
    for attempt in range(MAX_ATTEMPTS_PER_CATEGORY):
        needed = QUESTIONS_PER_CATEGORY - len(collected)
        if needed <= 0:
            break
        chunk = random.choice(document_chunks)
        for q in generate_questions_from_chunk(chunk, category, needed):
            if not isinstance(q, dict) or not _is_valid(q, category):
                continue
            text = q["questionText"].strip()
            if text in seen:
                continue
            seen.add(text)
            collected.append({
                "category": category,
                "questionText": text,
                "options": [str(o) for o in q["options"]],
                "correctAnswer": q["correctAnswer"],
            })
            if len(collected) >= QUESTIONS_PER_CATEGORY:
                break
    return collected


def create_mcq_test(document_chunks: List[str]) -> Dict:
    """Generate up to 16 questions (4 per category), with categories requested in parallel."""
    document_chunks = [c for c in document_chunks if c and c.strip()]
    if not document_chunks:
        return {"testId": None, "questions": []}

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(CATEGORIES)) as pool:
        futures = {pool.submit(_questions_for_category, document_chunks, cat): cat for cat in CATEGORIES}
        results: Dict[str, List[Dict]] = {}
        for future in concurrent.futures.as_completed(futures):
            results[futures[future]] = future.result()  # re-raises LLMError

    final_questions: List[Dict] = []
    seen_texts = set()
    for cat in CATEGORIES:
        for q in results.get(cat, []):
            if q["questionText"] not in seen_texts:
                seen_texts.add(q["questionText"])
                final_questions.append(q)

    total_needed = len(CATEGORIES) * QUESTIONS_PER_CATEGORY
    if len(final_questions) < total_needed:
        logger.warning(f"Generated only {len(final_questions)}/{total_needed} valid questions.")

    random.shuffle(final_questions)
    for i, question in enumerate(final_questions):
        question["id"] = i + 1

    logger.info(
        "Generated test distribution: %s",
        {cat: sum(q["category"] == cat for q in final_questions) for cat in CATEGORIES},
    )
    return {"testId": str(uuid.uuid4()), "questions": final_questions}


__all__ = ["create_mcq_test", "LLMError"]
