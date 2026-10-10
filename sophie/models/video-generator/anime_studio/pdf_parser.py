"""
pdf_parser.py - PDF upload + text extraction (stdlib only).

We deliberately depend on NOTHING but the Python standard library here
(requirement: "provide a local or free alternative when technically feasible"
and we cannot pip install in this sandbox).  `zlib` decompresses FlateDecode
streams — the encoding virtually every text PDF uses.

Capabilities:
  * extract_text(path) -> str        : whole-document text
  * split_sections(text) -> dict     : split Character Bible vs Screenplay
  * extract_text_segments(path) -> list[str] : preserve line blocks

Limitations (documented honestly per spec 15):
  * Only FlateDecode / uncompressed streams are supported.  ASCII85 / LZW /
    JPEG-encoded streams are not (rare for screenplay PDFs).
  * ToUnicode font CMaps are not parsed; ASCII content renders correctly,
    high-byte glyph ids fall back to latin-1.
  * Layout order is best-effort (text is returned in content-stream
    discovery order, which for simple PDFs matches reading order).
"""
from __future__ import annotations
import re
import zlib
from typing import List, Optional, Tuple

# ---------------------------------------------------------------------------
# Low-level PDF token helpers
# ---------------------------------------------------------------------------

_WS = b" \t\r\n\f\x00"
_DELIM = b"()<>[]{}/%"


def _is_delim(b: int) -> bool:
    return b in _DELIM


def _is_ws(b: int) -> bool:
    return b in _WS


def _read_token(stream: bytes, pos: int) -> Tuple[str, int]:
    """Read one PDF token (keyword or name) starting at pos; skip leading ws."""
    n = len(stream)
    while pos < n and _is_ws(stream[pos]):
        pos += 1
    if pos >= n:
        return "", pos
    if _is_delim(stream[pos]):
        # single-char delimiter token
        return chr(stream[pos]), pos + 1
    start = pos
    while pos < n and not _is_ws(stream[pos]) and not _is_delim(stream[pos]):
        pos += 1
    return stream[start:pos].decode("latin-1", "replace"), pos


def _read_string(stream: bytes, pos: int) -> Tuple[str, int]:
    """Read a parenthesised PDF string, honouring parentheses balance + \\ escapes."""
    n = len(stream)
    out = []
    depth = 1
    while pos < n and depth > 0:
        b = stream[pos]
        if b == ord("\\") and pos + 1 < n:
            nxt = stream[pos + 1]
            if nxt in b"nrtbf()\\":  # standard escapes
                out.append({"n": "\n", "r": "\r", "t": "\t",
                            "b": "\b", "f": "\f", "(": "(", ")": ")",
                            "\\": "\\"}[chr(nxt)])
                pos += 2
                continue
            if nxt in b"01234567":  # octal \ddd
                oct_digits = chr(nxt)
                j = pos + 2
                cnt = 1
                while j < n and cnt < 3 and stream[j] in b"01234567":
                    oct_digits += chr(stream[j]); j += 1; cnt += 1
                out.append(chr(int(oct_digits, 8) & 0xFF))
                pos = j
                continue
            # unknown escape -> literal next char
            out.append(chr(nxt)); pos += 2; continue
        if b == ord("("):
            depth += 1; out.append("("); pos += 1; continue
        if b == ord(")"):
            depth -= 1
            if depth == 0:
                pos += 1; break
            out.append(")"); pos += 1; continue
        out.append(chr(b)); pos += 1
    return "".join(out), pos


# ---------------------------------------------------------------------------
# Stream / object walking
# ---------------------------------------------------------------------------

_STREAM_RE = re.compile(rb"stream[\r\n]{1,2}(.*?)endstream", re.DOTALL)
_LENGTH_RE = re.compile(rb"/Length\s+(\d+)", re.DOTALL)


def _iter_objects(data: bytes):
    """Yield (obj_num, generation, body_bytes) for every `N G 0 obj ... endobj`."""
    for m in re.finditer(rb"(\d+)\s+(\d+)\s+obj\b(.*?)\bendobj", data, re.DOTALL):
        num = int(m.group(1))
        gen = int(m.group(2))
        body = m.group(3)
        yield num, gen, body


def _extract_stream_bytes(body: bytes) -> Optional[bytes]:
    """Return the (decoded) bytes of a stream object's payload, honouring /Length.

    Tries the /Length field first (correct PDF behaviour), then falls back to a
    regex between `stream` and `endstream`.  Uses a decompressobj so trailing
    whitespace bytes never raise.
    """
    m = _LENGTH_RE.search(body)
    if m:
        length = int(m.group(1))
        km = re.search(rb"stream[\r\n]{1,2}", body)
        if km:
            start = km.end()
            raw = body[start:start + length]
            return _decode_stream(raw)
    m = _STREAM_RE.search(body)
    if not m:
        return None
    raw = m.group(1)
    return _decode_stream(raw)


def _decode_stream(raw: bytes) -> bytes:
    """Decode a raw FlateDecode payload; tolerate trailing bytes."""
    try:
        return zlib.decompressobj().decompress(raw)
    except Exception:
        try:
            return zlib.decompress(raw)
        except Exception:
            return raw


def _extract_stream_text(payload: bytes) -> str:
    """Pull human text from a (already-decompressed) content-stream payload.

    Reconstructs reading order approximately by emitting a newline at every
    text-positioning operator (Tm/Td/TD) and after every text-showing operator
    (Tj/TJ/'/\").  Parenthesised strings are collected and flushed in order.
    """
    out: List[str] = []
    pending: List[str] = []     # strings seen since last positioning op
    n = len(payload)
    pos = 0

    def flush() -> None:
        if pending:
            out.append("".join(pending)); pending.clear()

    while pos < n:
        tok, pos = _read_token(payload, pos)
        if not tok:
            break
        if tok == "(":
            s, pos = _read_string(payload, pos)
            pending.append(s)
        elif tok == "<":
            end = payload.find(b">", pos)
            if end == -1:
                break
            hexed = payload[pos:end].strip()
            pos = end + 1
            try:
                b = bytes.fromhex(hexed.decode("latin-1"))
                pending.append(b.decode("latin-1", "replace"))
            except Exception:
                pass
        elif tok in ("Tm", "Td", "TD", "T*", "'"):
            # positioning / move-to-next-line: flush current line + newline
            flush(); out.append("\n")
        elif tok in ("Tj", "TJ", '"'):
            # show text: the string(s) are already in `pending`
            flush(); out.append("\n")
        elif tok == "BT":
            flush(); out.append("\n")
        elif tok == "ET":
            flush(); out.append("\n")
        # numbers, names, other ops: ignore but flush nothing (kerning nums
        # between strings in a TJ array are skipped by _read_token naturally)
    flush()
    return "".join(out)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_text(pdf_path: str) -> str:
    """Extract printable text from a PDF (whole document)."""
    with open(pdf_path, "rb") as f:
        data = f.read()

    text_parts: List[str] = []
    seen_payloads = set()
    for _num, _gen, body in _iter_objects(data):
        payload = _extract_stream_bytes(body)
        if not payload:
            continue
        key = (payload[:40], len(payload))
        if key in seen_payloads:
            continue
        seen_payloads.add(key)
        text_parts.append(_extract_stream_text(payload))

    doc = "\n".join(text_parts).strip()
    # collapse runs of newlines/whitespace into single newlines per line,
    # and collapse 3+ newlines into a single blank-line paragraph separator
    doc = re.sub(r"[ \t]+", " ", doc)
    doc = re.sub(r"\n{3,}", "\n\n", doc)
    return doc


def extract_text_blocks(pdf_path: str) -> List[str]:
    """Return text in larger blocks (double-newline separated)."""
    text = extract_text(pdf_path)
    return [b.strip() for b in text.split("\n\n") if b.strip()]


_SECTION_HEADERS = {
    "CHARACTER BIBLE", "CHARACTER_BIBLE", "CHARACTERS",
    "SECTION A", "CHARACTER REFERENCE",
}
_SCRIPT_HEADERS = {
    "SCREENPLAY", "SECTION B", "SCENES", "SCENE INSTRUCTIONS",
}


def split_sections(text: str) -> dict:
    """
    Split extracted PDF text into 'character_bible' and 'screenplay' regions.

    Strategy: scan for well-known headers (CHARACTER: / SCENE: markers also
    counted).  If no explicit header is found, assume the first ~half of the
    document before the first `SCENE_`/`CHARACTER:` block is the bible region.
    This is intentionally tolerant because user PDFs vary in layout.
    """
    lines = text.split("\n")
    bible_lines: List[str] = []
    script_lines: List[str] = []
    mode = "bible"  # assume bible opens the doc
    found_scene_start = False

    for ln in lines:
        up = ln.strip().upper()
        # Switch to script once we hit a scene marker or script header
        if (up.startswith("SCENE_") or up.startswith("SCENE ") or
                any(h in up for h in _SCRIPT_HEADERS) or
                re.match(r"SCENE\s*#\d+", up)):
            found_scene_start = True
            mode = "script"
        # A CHARACTER: line is bible content regardless of position
        elif up.startswith("CHARACTER:") or re.match(r"CHARACTER\s*[:\|]", up):
            mode = "bible"
        if mode == "bible":
            bible_lines.append(ln)
        else:
            script_lines.append(ln)

    # Fallback: if we never saw a scene, split at first CHARACTER: that is the
    # end of any preamble; everything from the first CHARACTER: onward is bible,
    # and we treat the tail as script.  If no characters either, hand all to script.
    bible_text = "\n".join(bible_lines).strip()
    script_text = "\n".join(script_lines).strip()

    if not found_scene_start and not script_text:
        # no scene marker found: everything is potentially script+bible
        if bible_text:
            script_text = bible_text
        return {"character_bible": "", "screenplay": bible_text}

    return {"character_bible": bible_text, "screenplay": script_text}


def read_pdf(pdf_path: str) -> dict:
    """Convenience: return both raw text and a section split."""
    text = extract_text(pdf_path)
    return {"text": text, "sections": split_sections(text)}
