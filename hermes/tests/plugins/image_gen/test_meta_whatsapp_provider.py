
"""Tests for the Meta AI WhatsApp image-generation provider."""

from __future__ import annotations

import importlib
from unittest.mock import patch

import pytest

plugin = importlib.import_module("plugins.image_gen.meta-whatsapp")


@pytest.fixture(autouse=True)
def _bridge_env(monkeypatch):
    monkeypatch.setenv("SOPHIE_META_AI_BRIDGE_URL", "http://127.0.0.1:8788/v1")


def test_metadata():
    provider = plugin.MetaWhatsAppImageGenProvider()
    assert provider.name == "meta-whatsapp"
    assert provider.default_model() == "meta-ai"
    assert provider.get_setup_schema()["env_vars"] == []


def test_generate_returns_existing_bridge_artifact(tmp_path):
    image = tmp_path / "meta-ai-test.webp"
    image.write_bytes(b"webp")
    response = {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": "meta-ai",
        "images": [{
            "path": str(image),
            "url": "/v1/media/meta-ai-test.webp",
            "mime_type": "image/webp",
            "width": 1920,
            "height": 1280,
        }],
    }

    with patch.object(plugin, "post_json", return_value=(response, None)) as post:
        result = plugin.MetaWhatsAppImageGenProvider().generate("a black sports car")

    assert result["success"] is True
    assert result["provider"] == "meta-whatsapp"
    assert result["image"] == str(image)
    assert result["mime_type"] == "image/webp"
    assert result["width"] == 1920
    assert result["height"] == 1280
    post.assert_called_once()
    assert post.call_args.kwargs["payload"]["messages"] == [{
        "role": "user", "content": "a black sports car",
    }]


def test_generate_rejects_missing_image():
    with patch.object(plugin, "post_json", return_value=({"images": []}, None)):
        result = plugin.MetaWhatsAppImageGenProvider().generate("a cat")
    assert result["success"] is False
    assert result["error_type"] == "empty_response"


def test_generate_rejects_missing_artifact(tmp_path):
    response = {"images": [{"path": str(tmp_path / "missing.webp")}]}
    with patch.object(plugin, "post_json", return_value=(response, None)):
        result = plugin.MetaWhatsAppImageGenProvider().generate("a cat")
    assert result["success"] is False
    assert result["error_type"] == "artifact_missing"


def test_generate_rejects_image_editing():
    result = plugin.MetaWhatsAppImageGenProvider().generate(
        "edit this image", image_url="/tmp/source.webp")
    assert result["success"] is False
    assert result["error_type"] == "modality_unsupported"


def test_generate_requires_prompt():
    result = plugin.MetaWhatsAppImageGenProvider().generate("")
    assert result["success"] is False
    assert result["error_type"] == "invalid_input"
