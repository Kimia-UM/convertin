"""Downloads remain readable after request-owned temporary files are removed."""

import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import pymupdf

from app import app
from libreoffice import LibreOfficeNotFound


def sample_pdf(text):
    with pymupdf.open() as document:
        page = document.new_page()
        page.insert_text((30, 40), text)
        return document.tobytes()


class HostingTemporaryFileTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()
        self.workspace = tempfile.TemporaryDirectory(prefix='docforge_cleanup_test_')
        self.created = []
        original_mkdtemp = tempfile.mkdtemp

        def tracked_mkdtemp(*args, **kwargs):
            kwargs['dir'] = self.workspace.name
            directory = original_mkdtemp(*args, **kwargs)
            self.created.append(Path(directory))
            return directory

        self.patch = patch('app.tempfile.mkdtemp', side_effect=tracked_mkdtemp)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        try:
            self.assertTrue(self.created, 'The request must exercise temporary storage')
            self.assertEqual([path.name for path in self.created if path.exists()], [])
        finally:
            self.workspace.cleanup()

    def upload(self, endpoint, files):
        return self.client.post(endpoint, data={
            'file': [(io.BytesIO(content), name) for name, content in files],
        }, content_type='multipart/form-data')

    def test_markdown_download_survives_cleanup(self):
        with patch('app.pymupdf4llm.to_markdown', return_value='# Hasil\nTeks PDF.'):
            response = self.upload('/convert', [('artikel.pdf', sample_pdf('First'))])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'text/markdown')
        self.assertIn('artikel.md', response.headers['Content-Disposition'])
        self.assertEqual(response.data.decode('utf-8').splitlines(), ['# Hasil', 'Teks PDF.'])

    def test_markdown_archive_survives_cleanup(self):
        with patch('app.pymupdf4llm.to_markdown', side_effect=['# Satu', '# Dua']):
            response = self.upload('/convert', [
                ('satu.pdf', sample_pdf('First')), ('dua.pdf', sample_pdf('Second')),
            ])
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as bundle:
            self.assertEqual(bundle.namelist(), ['satu.md', 'dua.md'])
            self.assertEqual(bundle.read('dua.md'), b'# Dua')

    def test_markdown_failure_removes_uploaded_file(self):
        with patch('app.pymupdf4llm.to_markdown', side_effect=RuntimeError('cannot convert')):
            response = self.upload('/convert', [('artikel.pdf', b'broken PDF')])
        self.assertEqual(response.status_code, 500)
        self.assertIn('cannot convert', response.get_json()['error'])

    def test_merged_download_preserves_page_order_after_cleanup(self):
        response = self.upload('/merge-pdf', [
            ('satu.pdf', sample_pdf('First')), ('dua.pdf', sample_pdf('Second')),
        ])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/pdf')
        with pymupdf.open(stream=response.data, filetype='pdf') as document:
            self.assertEqual([page.get_text().strip() for page in document], ['First', 'Second'])

    def test_merge_failure_closes_documents_before_cleanup(self):
        response = self.upload('/merge-pdf', [
            ('satu.pdf', sample_pdf('First')), ('rusak.pdf', b'broken PDF'),
        ])
        self.assertEqual(response.status_code, 500)
        self.assertIn('error', response.get_json())

    def test_invalid_merge_batch_also_removes_temporary_directory(self):
        response = self.upload('/merge-pdf', [('satu.txt', b'one'), ('dua.txt', b'two')])
        self.assertEqual(response.status_code, 400)

    def test_word_pdf_download_survives_cleanup(self):
        pdf = sample_pdf('Word output')

        def convert_fixture(inputs, out_dir):
            result = {}
            for source in inputs:
                output = Path(out_dir) / (Path(source).stem + '.pdf')
                output.write_bytes(pdf)
                result[source] = str(output)
            return result

        with patch('app.convert_to_pdf', side_effect=convert_fixture):
            response = self.upload('/convert-word', [('artikel.docx', b'Word fixture')])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/pdf')
        self.assertEqual(response.data, pdf)
        self.assertIn('artikel.pdf', response.headers['Content-Disposition'])

    def test_word_failure_removes_both_work_directories(self):
        with patch('app.convert_to_pdf', side_effect=LibreOfficeNotFound('LibreOffice unavailable')):
            response = self.upload('/convert-word', [('artikel.docx', b'Word fixture')])
        self.assertEqual(response.status_code, 503)
        self.assertEqual(len(self.created), 2)


if __name__ == '__main__':
    unittest.main()
