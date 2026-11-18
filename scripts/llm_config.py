"""Shared settings and a small OpenRouter client used by every backend feature."""
import json
import logging
import os
from pathlib import Path
from typing import Dict, Iterator, List, Optional

import requests
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load the repo-root .env no matter which directory the server is started from.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Keep the local Chroma database from sending usage telemetry.
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Override any of these in .env. The defaults are models currently listed on OpenRouter.
# Chat, mind maps and audio overviews run on Claude; tests, quotes and summaries on a
# cheaper model that handles JSON test generation well.
CHAT_MODEL = os.getenv("OPENROUTER_CHAT_MODEL", "anthropic/claude-opus-5.5")
TEST_MODEL = os.getenv("OPENROUTER_TEST_MODEL", "mistralai/mistral-small-3.2-24b-instruct")
UTILITY_MODEL = os.getenv("OPENROUTER_UTILITY_MODEL", "mistralai/mistral-small-3.2-24b-instruct")  # quotes, summaries


class LLMError(RuntimeError):
    """Raised when the OpenRouter call fails; the message is safe to show to users."""


def get_api_key() -> Optional[str]:
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    return key or None


def _post(payload: dict, timeout: int, stream: bool = False) -> requests.Response:
    api_key = get_api_key()
    if not api_key:
        raise LLMError("OPENROUTER_API_KEY is not set in the .env file.")
    try:
        response = requests.post(
            OPENROUTER_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=timeout,
            stream=stream,
        )
    except requests.RequestException as e:
        raise LLMError(f"Could not reach OpenRouter: {e}") from e

    if response.status_code == 401:
        raise LLMError("OpenRouter rejected the API key (401). Put a valid OPENROUTER_API_KEY in .env and restart the backend.")
    if response.status_code == 402:
        raise LLMError("Your OpenRouter account is out of credits (402). Add credits at openrouter.ai, or switch to a cheaper model in .env.")
    if not response.ok:
        try:
            detail = response.json().get("error", {}).get("message", response.text)
        except ValueError:
            detail = response.text
        raise LLMError(f"OpenRouter error {response.status_code} for model '{payload.get('model')}': {detail}")
    return response


def openrouter_chat(
    messages: List[Dict[str, str]],
    model: str,
    timeout: int = 60,
    response_format: Optional[dict] = None,
    max_tokens: Optional[int] = None,
) -> str:
    """Send a chat completion request to OpenRouter and return the reply text."""
    payload: dict = {"model": model, "messages": messages}
    if response_format:
        payload["response_format"] = response_format
    if max_tokens:
        payload["max_tokens"] = max_tokens

    response = _post(payload, timeout)
    try:
        return response.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as e:
        raise LLMError(f"Unexpected response from OpenRouter: {e}") from e


def openrouter_stream(
    messages: List[Dict[str, str]],
    model: str,
    timeout: int = 120,
    max_tokens: Optional[int] = None,
) -> Iterator[str]:
    """Stream a chat completion from OpenRouter, yielding text deltas as they arrive."""
    payload: dict = {"model": model, "messages": messages, "stream": True}
    if max_tokens:
        payload["max_tokens"] = max_tokens

    response = _post(payload, timeout, stream=True)
    with response:
        for raw in response.iter_lines(decode_unicode=False):
            if not raw:
                continue
            line = raw.decode("utf-8", errors="replace")
            if not line.startswith("data:"):
                continue  # SSE comments such as ": OPENROUTER PROCESSING"
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                event = json.loads(data)
            except json.JSONDecodeError:
                continue
            if "error" in event:
                raise LLMError(f"OpenRouter stream error: {event['error'].get('message', event['error'])}")
            choices = event.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta", {}).get("content")
            if delta:
                yield delta


def parse_json_object(raw_text: str) -> dict:
    """Pull the first JSON object out of a model reply (tolerates code fences and prose)."""
    start, end = raw_text.find("{"), raw_text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in the AI response.")
    return json.loads(raw_text[start : end + 1])
