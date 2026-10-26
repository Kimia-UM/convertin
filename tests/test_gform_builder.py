import unittest
from pathlib import Path

from gform_builder import generate_apps_script, inspect_upload, normalize_upload


ROOT = Path(__file__).resolve().parents[1]


def selected_sheet(inspection):
    return next(
        sheet
        for sheet in inspection["sheets"]
        if sheet["index"] == inspection["selected_sheet"]
    )


class GFormBuilderTests(unittest.TestCase):
    def normalize_file(self, filename):
        data = (ROOT / filename).read_bytes()
        inspection = inspect_upload(data, filename)
        sheet = selected_sheet(inspection)
        definition = normalize_upload(
            data,
            filename,
            sheet_index=sheet["index"],
            header_row=sheet["header_row"],
            mapping=sheet["mapping"],
            form_options={
                "title": inspection["detected_title"],
                "description": inspection["detected_description"],
                "progress_bar": True,
            },
        )
        return inspection, sheet, definition

    @unittest.skipUnless(
        (ROOT / "Bahan_Auto_GForm_Instrumen_Regulasi_Diri.xlsx").is_file(),
        "Workbook penelitian lokal tidak disertakan di repository.",
    )
    def test_regulasi_diri_workbook(self):
        inspection, sheet, definition = self.normalize_file(
            "Bahan_Auto_GForm_Instrumen_Regulasi_Diri.xlsx"
        )
        self.assertEqual(sheet["name"], "Questions")
        self.assertEqual(definition["summary"]["question_count"], 31)
        self.assertEqual(definition["summary"]["counts"]["section"], 5)
        self.assertEqual(definition["summary"]["counts"]["linear_scale"], 31)
        self.assertFalse(definition["warnings"])
        self.assertIn("Instrumen Regulasi Diri", inspection["detected_title"])

    @unittest.skipUnless(
        (ROOT / "Bahan_AutoGForm_Uji_Keterbacaan_Instrumen_Regulasi_Diri.xlsx").is_file(),
        "Workbook penelitian lokal tidak disertakan di repository.",
    )
    def test_readability_workbook(self):
        _, sheet, definition = self.normalize_file(
            "Bahan_AutoGForm_Uji_Keterbacaan_Instrumen_Regulasi_Diri.xlsx"
        )
        self.assertEqual(sheet["name"], "GForm_Builder")
        self.assertEqual(definition["summary"]["question_count"], 66)
        self.assertEqual(definition["summary"]["counts"]["section"], 6)
        self.assertEqual(definition["summary"]["counts"]["header"], 31)
        self.assertEqual(definition["summary"]["counts"]["multiple_choice"], 33)
        self.assertEqual(definition["summary"]["counts"]["paragraph"], 31)
        self.assertEqual(definition["summary"]["counts"]["short_text"], 2)
        self.assertFalse(definition["warnings"])

    def test_generic_csv_with_repeated_section_column(self):
        filename = "contoh.csv"
        data = (
            "Bagian,Pertanyaan,Tipe,Pilihan,Wajib\n"
            "Identitas,Nama,Jawaban singkat,,Ya\n"
            "Evaluasi,Apakah materinya jelas?,Pilihan ganda,Ya|Tidak,Ya\n"
            "Evaluasi,Saran,Paragraf,,Tidak\n"
        ).encode("utf-8")
        inspection = inspect_upload(data, filename)
        sheet = selected_sheet(inspection)
        definition = normalize_upload(
            data,
            filename,
            sheet_index=sheet["index"],
            header_row=sheet["header_row"],
            mapping=sheet["mapping"],
            form_options={"title": "Contoh", "option_separator": "auto"},
        )
        self.assertEqual(definition["summary"]["question_count"], 3)
        self.assertEqual(definition["summary"]["counts"]["section"], 2)
        self.assertFalse(definition["warnings"])
        script = generate_apps_script(definition)
        self.assertIn("function buatGoogleForm()", script)
        self.assertIn("Apakah materinya jelas?", script)


if __name__ == "__main__":
    unittest.main()
