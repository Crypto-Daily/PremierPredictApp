
## Meta AI via WhatsApp bridge

Hermes can use the local Sophie Meta AI bridge as an image-generation backend without a paid
image-generation API key.

The bridge must already be running at:

http://127.0.0.1:8788/v1

Select it in Hermes config:

image_gen:
  provider: meta-whatsapp
  model: meta-ai

Optional override:

export SOPHIE_META_AI_BRIDGE_URL=http://127.0.0.1:8788/v1

The provider sends the image prompt to /v1/chat/completions. The bridge handles WhatsApp,
Meta AI, temporary CDN URLs, and local media persistence. Hermes consumes the bridge's returned
absolute images[0].path as its image artifact, so the temporary Meta CDN URL is never used as
the permanent image reference.

This backend is text-to-image only for now; image editing is intentionally not advertised until
the WhatsApp bridge supports a verified source-image flow.
