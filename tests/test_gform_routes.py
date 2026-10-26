import io
import json
import subprocess
import unittest
from pathlib import Path

from app import app


ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = "Bahan_AutoGForm_Uji_Keterbacaan_Instrumen_Regulasi_Diri.xlsx"


class GFormRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (ROOT / WORKBOOK).is_file():
            raise unittest.SkipTest("Workbook penelitian lokal tidak disertakan di repository.")
        app.config.update(TESTING=True)
        cls.client = app.test_client()
        cls.workbook_bytes = (ROOT / WORKBOOK).read_bytes()

    def upload(self, endpoint, extra=None):
        data = {
            "file": (io.BytesIO(self.workbook_bytes), WORKBOOK),
        }
        if extra:
            data.update(extra)
        return self.client.post(endpoint, data=data, content_type="multipart/form-data")

    def test_page_and_complete_workflow(self):
        page = self.client.get("/gform")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"Universal GForm Builder", page.data)

        inspected = self.upload("/gform/inspect")
        self.assertEqual(inspected.status_code, 200)
        metadata = inspected.get_json()
        sheet = next(
            item
            for item in metadata["sheets"]
            if item["index"] == metadata["selected_sheet"]
        )
        self.assertEqual(sheet["name"], "GForm_Builder")

        configuration = {
            "sheet_index": str(sheet["index"]),
            "header_row": str(sheet["header_row"]),
            "mapping": json.dumps(sheet["mapping"]),
            "form_options": json.dumps(
                {
                    "title": metadata["detected_title"],
                    "description": metadata["detected_description"],
                    "progress_bar": True,
                }
            ),
        }
        preview = self.upload("/gform/preview", configuration)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.get_json()["summary"]["question_count"], 66)

        generated = self.upload("/gform/generate", configuration)
        self.assertEqual(generated.status_code, 200)
        self.assertIn("attachment", generated.headers["Content-Disposition"])
        script = generated.data.decode("utf-8")
        self.assertIn("function buatGoogleForm()", script)
        syntax = subprocess.run(
            ["node", "--check", "-"],
            input=script,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)


if __name__ == "__main__":
    unittest.main()
