import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "hermes" / "tools" / "video_clipper.py"
spec = importlib.util.spec_from_file_location("video_clipper", MODULE_PATH)
clipper = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(clipper)


def test_parse_time_formats():
    assert clipper.parse_time("75") == 75
    assert clipper.parse_time("01:15") == 75
    assert clipper.parse_time("00:01:15") == 75


def test_manual_segments():
    segments = clipper.manual_segments(["00:01:00-00:01:30", "90-120"])
    assert segments[0]["start"] == 60
    assert segments[0]["end"] == 90
    assert segments[1]["start"] == 90


def test_transcript_selection_avoids_overlap():
    source = [
        {"start": 10, "end": 16, "text": "This is an amazing and incredible result!"},
        {"start": 12, "end": 18, "text": "An unbelievable result that changed everything!"},
        {"start": 60, "end": 68, "text": "Here is the important truth and proof."},
    ]
    chosen = clipper.transcript_segments(source, 8, 30, 3)
    assert len(chosen) == 2
    assert chosen[0]["start"] < chosen[1]["start"]


def test_safe_name():
    assert clipper.safe_name("A great moment! #1") == "a-great-moment-1"
