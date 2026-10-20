import tempfile
import unittest
from pathlib import Path

from PIL import Image

from engine import generate


class EngineSmokeTests(unittest.TestCase):
    def test_png_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cat.png"
            generate("cute orange cat with green eyes", str(path), size=256)
            self.assertTrue(path.exists())
            with Image.open(path) as image:
                self.assertEqual(image.size, (256, 256))
                self.assertEqual(image.format, "PNG")

    def test_gif_has_multiple_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "running.gif"
            generate("running orange cat", str(path), size=256, frames=6, fps=6)
            self.assertTrue(path.exists())
            with Image.open(path) as image:
                self.assertEqual(image.format, "GIF")
                self.assertEqual(image.size, (256, 256))
                self.assertGreaterEqual(image.n_frames, 2)


if __name__ == "__main__":
    unittest.main()
