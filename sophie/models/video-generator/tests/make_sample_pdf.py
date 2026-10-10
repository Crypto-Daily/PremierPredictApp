"""
Minimal pure-Python PDF text writer (stdlib only) - for generating test
fixtures without reportlab.  Produces a valid PDF with FlateDecode-compressed
content streams, so it exercises the real decoder path.

Usage:  python3 make_sample_pdf.py out.pdf
"""
import sys, zlib, os

def _ascii85(s: str) -> str:
    # not used; we FlateDecode everything
    return ""


def build_text_pdf(text: str, title: str = "Screenplay") -> bytes:
    """
    Build a single-page-ish PDF from `text`.  Splits on '\n' into lines and
    renders them top-to-bottom.  Uses a small built-in Type1 font subset dict.
    """
    lines = text.split("\n")

    # content stream: for each line, position cursor and show text
    ops = []
    ops.append("BT")
    ops.append("/F1 14 Tf")
    # page height 792, start at top
    y = 720
    leading = 18
    for ln in lines:
        safe = ln.replace(")", "\\)").replace("(", "\\(").replace("\\", "\\\\")
        ops.append(f"1 0 0 1 72 {y} Tm ({safe}) Tj")
        y -= leading
    ops.append("ET")
    content = "\n".join(ops).encode("latin-1", "replace")

    # compressed stream payload
    comp = zlib.compress(content)

    # Object 4 = page's content stream.  It MUST be one contiguous blob:
    # dict, stream keyword, EOL, data, EOL, endstream.  /Length is byte length
    # of the data only.
    stream_obj = b"<< /Length %d >>\nstream\n" % len(comp) + comp + b"\nendstream"

    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
    objs.append(stream_obj)
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray()
    out += b"%PDF-1.4\n"
    offsets = []
    for i, body in enumerate(objs):
        offsets.append(len(out))
        if isinstance(body, (bytes, bytearray)):
            out += b"%d 0 obj\n" % (i + 1)
            out += body + b"\nendobj\n"
    # xref
    xref_off = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer << /Size %d /Root 1 0 R >>\n" % (len(objs) + 1)
    out += b"startxref\n%d\n" % xref_off
    out += b"%%EOF"
    return bytes(out)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "sample_screenplay.pdf"
    sample = """CHARACTER: KAI | ID: CHAR_001
Kai is a 16-year-old anime protagonist with dark skin, short black hair,
expressive brown eyes, a slim athletic build, and a small scar above his
left eyebrow. He wears a dark-blue jacket, black trousers, and brown boots.

CHARACTER: AMARA | ID: CHAR_002
Amara, age 17, long wavy auburn hair, green eyes, slender. Wears a white
and red school uniform. Calm but sharp-tongued expression.

CHARACTER: REN | ID: CHAR_003
Ren, 18, tall, lean, black hair in a high ponytail, pale skin, cold gray
eyes. Black battle coat with red trim, combat boots. Expression: cold focus.

SCENE_001 INT. RUINED VILLAGE - NIGHT
KAI / Kai slowly walks forward, his fists clenched, looking nervous and
glancing toward the dark doorway / // A ruined village at night, broken
wooden houses, smoke drifting through the streets, moonlight illuminating
the ground, cinematic anime background //
AMARA / Amara steps beside Kai, places a hand on his shoulder, says "We
shouldn't be here." / // The same ruined village, smoke and moonlight,
warm lantern glow from a broken sign //
SCENE_002 INT. TRAINING ARENA - DAY
KAI / Kai jumps backward to dodge an incoming punch, twists his body in
midair, and lands in a defensive stance / // A destroyed training arena
with cracked stone flooring, dust clouds, scattered rocks, dramatic
sunset lighting //
AMARA / Amara charges forward, throws a straight punch / // Dust clouds
swirling, sunset lighting casting long shadows //
"""
    with open(out, "wb") as f:
        f.write(build_text_pdf(sample))
    print(f"Wrote {out} ({os.path.getsize(out)} bytes)")
