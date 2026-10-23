import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("parse_anime_script.py")
SPEC = importlib.util.spec_from_file_location("parse_anime_script", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class ParserTests(unittest.TestCase):
    def test_markers_and_dialogue(self):
        data = MODULE.parse(
            "CHARACTER: Aira — Silver hair\n\nSCENE 1: Station\n"
            "//Rainy platform//\n/Aira runs./\nAira: Hello.",
            fps=12, seconds=5)
        self.assertEqual(data["characters"][0]["name"], "Aira")
        self.assertEqual(len(data["scenes"]), 1)
        scene = data["scenes"][0]
        self.assertEqual(scene["environment"], "Rainy platform")
        self.assertEqual(scene["actions"], ["Aira runs."])
        self.assertEqual(scene["dialogue"][0]["text"], "Hello.")
        self.assertEqual(data["totalFrames"], 60)

    def test_multiple_scenes(self):
        data = MODULE.parse("SCENE 1: A\nNarration\nSCENE 2: B\n/Walks./", fps=24, seconds=3)
        self.assertEqual(len(data["scenes"]), 2)
        self.assertEqual(data["totalFrames"], 144)

    def test_invalid_fps_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.parse("Scene", fps=13)

if __name__ == "__main__":
    unittest.main()
