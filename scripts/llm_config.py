"""Shared settings and a small OpenRouter client used by every backend feature."""
import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

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
CHAT_MODEL = os.getenv("OPENROUTER_CHAT_MODEL", "mistralai/mistral-small-3.2-24b-instruct")
TEST_MODEL = os.getenv("OPENROUTER_TEST_MODEL", CHAT_MODEL)
UTILITY_MODEL = os.getenv("OPENROUTER_UTILITY_MODEL", CHAT_MODEL)  # quotes, summaries


class LLMError(RuntimeError):
    """Raised when the OpenRouter call fails; the message is safe to show to users."""


def get_api_key() -> Optional[str]:
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    return key or None


def openrouter_chat(
    messages: List[Dict[str, str]],
    model: str,
    timeout: int = 60,
    response_format: Optional[dict] = None,
) -> str:
    """Send a chat completion request to OpenRouter and return the reply text."""
    api_key = get_api_key()
    if not api_key:
        raise LLMError("OPENROUTER_API_KEY is not set in the .env file.")

    payload: dict = {"model": model, "messages": messages}
    if response_format:
        payload["response_format"] = response_format

    try:
        response = requests.post(
            OPENROUTER_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=timeout,
        )
    except requests.RequestException as e:
        raise LLMError(f"Could not reach OpenRouter: {e}") from e

    if response.status_code == 401:
        raise LLMError("OpenRouter rejected the API key (401). Put a valid OPENROUTER_API_KEY in .env and restart the backend.")
    if response.status_code == 402:
        raise LLMError("OpenRouter account has insufficient credits (402).")
    if not response.ok:
        try:
            detail = response.json().get("error", {}).get("message", response.text)
        except ValueError:
            detail = response.text
        raise LLMError(f"OpenRouter error {response.status_code} for model '{model}': {detail}")

    try:
        return response.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as e:
        raise LLMError(f"Unexpected response from OpenRouter: {e}") from e
