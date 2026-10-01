
"""Meta AI image generation through the local Sophie WhatsApp/whatsmeow bridge.

This provider does not use a Meta/OpenAI API key. It calls the already-running local
bridge at http://127.0.0.1:8788/v1; the bridge owns WhatsApp authentication,
Meta AI interaction, CDN download, and local media persistence.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.image_gen_provider import (
    DEFAULT_ASPECT_RATIO,
    ImageGenProvider,
    error_response,
    resolve_aspect_ratio,
    success_response,
)
from plugins.image_gen._common import post_json, requests_error_message

DEFAULT_BASE_URL = "http://127.0.0.1:8788/v1"
BRIDGE_URL_ENV = "SOPHIE_META_AI_BRIDGE_URL"
DEFAULT_MODEL = "meta-ai"
REQUEST_TIMEOUT = (5, 130)


def _base_url() -> str:
    return os.environ.get(BRIDGE_URL_ENV, DEFAULT_BASE_URL).strip().rstrip("/")


def _error(*, error: str, error_type: str, prompt: str, aspect_ratio: str,
           model: str = DEFAULT_MODEL) -> Dict[str, Any]:
    return error_response(
        error=error, error_type=error_type, provider="meta-whatsapp",
        model=model, prompt=prompt, aspect_ratio=aspect_ratio,
    )


class MetaWhatsAppImageGenProvider(ImageGenProvider):
    """Hermes image provider backed by the local Meta AI WhatsApp bridge."""

    @property
    def name(self) -> str:
        return "meta-whatsapp"

    @property
    def display_name(self) -> str:
        return "Meta AI (WhatsApp)"

    def is_available(self) -> bool:
        """Check whether the local bridge is reachable without requiring credentials."""
        import requests
        try:
            response = requests.get(f"{_base_url()}/models", timeout=1.5)
            return response.ok
        except requests.RequestException:
            return False

    def list_models(self) -> List[Dict[str, Any]]:
        return [{
            "id": DEFAULT_MODEL,
            "display": "Meta AI via WhatsApp",
            "speed": "~30–120s",
            "strengths": "No image API key; uses the linked Meta AI WhatsApp bridge",
            "price": "bridge/WhatsApp",
        }]

    def default_model(self) -> Optional[str]:
        return DEFAULT_MODEL

    def get_setup_schema(self) -> Dict[str, Any]:
        return {
            "name": "Meta AI (WhatsApp)",
            "badge": "local",
            "tag": "Image generation through the Sophie whatsmeow Meta AI bridge — no API key",
            "env_vars": [],
        }

    def capabilities(self) -> Dict[str, Any]:
        return {"modalities": ["text"], "max_reference_images": 0}

    def generate(
        self,
        prompt: str,
        aspect_ratio: str = DEFAULT_ASPECT_RATIO,
        *,
        image_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        prompt = (prompt or "").strip()
        aspect = resolve_aspect_ratio(aspect_ratio)

        if not prompt:
            return _error(error="Prompt is required", error_type="invalid_input",
                          prompt="", aspect_ratio=aspect)

        if image_url or reference_image_urls:
            return _error(
                error="Meta AI (WhatsApp) currently supports text-to-image only.",
                error_type="modality_unsupported", prompt=prompt, aspect_ratio=aspect,
            )

        payload = {
            "model": kwargs.get("model") or DEFAULT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        }

        try:
            response, failure = post_json(
                f"{_base_url()}/chat/completions",
                headers={"Content-Type": "application/json"},
                payload=payload,
                timeout=REQUEST_TIMEOUT,
                label="Meta AI WhatsApp",
                error_message=requests_error_message,
            )
        except Exception as exc:
            return _error(
                error=f"Meta AI WhatsApp bridge request failed: {exc}",
                error_type="connection_error", prompt=prompt, aspect_ratio=aspect,
            )

        if failure is not None:
            return _error(error=failure.error, error_type=failure.error_type,
                          prompt=prompt, aspect_ratio=aspect)

        if not isinstance(response, dict):
            return _error(
                error="Meta AI WhatsApp bridge returned an invalid response.",
                error_type="invalid_response", prompt=prompt, aspect_ratio=aspect,
            )

        images = response.get("images")
        first = images[0] if isinstance(images, list) and images else None
        if not isinstance(first, dict):
            return _error(
                error="Meta AI WhatsApp bridge returned no generated image.",
                error_type="empty_response", prompt=prompt, aspect_ratio=aspect,
            )

        image_path = first.get("path")
        if not isinstance(image_path, str) or not image_path.strip():
            return _error(
                error="Meta AI WhatsApp bridge returned an image without a local file path.",
                error_type="invalid_response", prompt=prompt, aspect_ratio=aspect,
            )

        path = Path(image_path).expanduser()
        if not path.is_file():
            return _error(
                error=f"Generated Meta AI image is not accessible at {path}.",
                error_type="artifact_missing", prompt=prompt, aspect_ratio=aspect,
            )

        extra: Dict[str, Any] = {
            "mime_type": first.get("mime_type"),
            "width": first.get("width"),
            "height": first.get("height"),
            "bridge_url": _base_url(),
        }
        return success_response(
            image=str(path), model=payload["model"], prompt=prompt,
            aspect_ratio=aspect, provider=self.name, modality="text", extra=extra,
        )


def register(ctx) -> None:
    """Register the Meta AI WhatsApp bridge as a Hermes image backend."""
    ctx.register_image_gen_provider(MetaWhatsAppImageGenProvider())
