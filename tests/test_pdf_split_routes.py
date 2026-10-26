import io
import unittest
import zipfile
from unittest.mock import patch

import pymupdf as fitz

from app import app
from pdf_splitter import PdfSplitError, parse_page_ranges, split_pdf_bytes


def make_pdf(page_count=7, *, encrypted=False):
    with fitz.open() as document:
        for number in range(1, page_count + 1):
            page = document.new_page(width=320 + number, height=500 + number)
            page.insert_text((35, 50), f'Page {number}')
            if number == 2:
                page.set_rotation(90)
                page.add_text_annot((60, 75), 'Keep this annotation')
        document.set_metadata({'title': 'Split fixture', 'author': 'DocForge'})
        options = {'encryption': fitz.PDF_ENCRYPT_AES_256, 'owner_pw': 'owner', 'user_pw': 'secret'} if encrypted else {}
        return document.tobytes(**options)


def read_pages(data):
    with fitz.open(stream=data, filetype='pdf') as document:
        return [page.get_text().strip() for page in document]


class PdfSplitRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config.update(TESTING=True)
        cls.client = app.test_client()
        cls.pdf = make_pdf()

    def upload(self, endpoint='/split-pdf', *, data=None, filename='artikel.pdf', content=None):
        fields = {'file': (io.BytesIO(self.pdf if content is None else content), filename)}
        fields.update(data or {})
        return self.client.post(endpoint, data=fields, content_type='multipart/form-data')

    def test_inspection_reads_page_count(self):
        response = self.upload('/split-pdf/inspect')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'filename': 'artikel.pdf', 'page_count': 7})
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_ranges_create_ordered_archive_with_preserved_pages(self):
        response = self.upload(data={'mode': 'ranges', 'ranges': ' 2-3, 7, 1-2 '})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/zip')
        self.assertEqual(response.headers['X-Output-Count'], '3')
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
            names = archive.namelist()
            self.assertEqual(len(names), 3)
            self.assertTrue(names[0].endswith('halaman-2-3.pdf'))
            self.assertEqual([read_pages(archive.read(name)) for name in names],
                             [['Page 2', 'Page 3'], ['Page 7'], ['Page 1', 'Page 2']])
            with fitz.open(stream=archive.read(names[0]), filetype='pdf') as extracted:
                self.assertEqual(extracted[0].rotation, 90)
                self.assertEqual(extracted[0].mediabox.width, 322)
                self.assertEqual(extracted.metadata['title'], 'Split fixture')
                self.assertEqual(next(extracted[0].annots()).info['content'], 'Keep this annotation')

    def test_one_range_is_direct_pdf(self):
        response = self.upload(data={'mode': 'ranges', 'ranges': '3-5'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/pdf')
        self.assertEqual(response.headers['X-Output-Count'], '1')
        self.assertIn('artikel_halaman-3-5.pdf', response.headers['Content-Disposition'])
        self.assertEqual(read_pages(response.data), ['Page 3', 'Page 4', 'Page 5'])

    def test_selected_pages_are_combined_in_input_order(self):
        response = self.upload(data={'mode': 'selected', 'ranges': '7, 2-3, 1'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/pdf')
        self.assertEqual(read_pages(response.data), ['Page 7', 'Page 2', 'Page 3', 'Page 1'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_every_mode_includes_final_remainder(self):
        response = self.upload(data={'mode': 'every', 'every': '3'})
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
            self.assertEqual([read_pages(archive.read(name)) for name in archive.namelist()],
                             [['Page 1', 'Page 2', 'Page 3'], ['Page 4', 'Page 5', 'Page 6'], ['Page 7']])

    def test_repeated_ranges_have_unique_archive_names(self):
        response = self.upload(data={'mode': 'ranges', 'ranges': '1, 1'})
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
            self.assertEqual(len(set(archive.namelist())), 2)

    def test_rejects_invalid_split_configuration(self):
        cases = (
            ({'mode': 'ranges', 'ranges': ''}, 'Isi halaman'),
            ({'mode': 'ranges', 'ranges': '0'}, 'antara 1 dan 7'),
            ({'mode': 'ranges', 'ranges': '1-8'}, 'antara 1 dan 7'),
            ({'mode': 'ranges', 'ranges': '4-2'}, 'terbalik'),
            ({'mode': 'ranges', 'ranges': '1,,2'}, 'Format halaman'),
            ({'mode': 'ranges', 'ranges': '1.5'}, 'Format halaman'),
            ({'mode': 'ranges', 'ranges': '-1'}, 'Format halaman'),
            ({'mode': 'selected', 'ranges': '1-3, 3'}, 'lebih dari sekali'),
            ({'mode': 'every', 'every': '0'}, 'antara 1 dan 7'),
            ({'mode': 'every', 'every': '8'}, 'antara 1 dan 7'),
            ({'mode': 'every', 'every': '2.5'}, 'bilangan bulat'),
            ({'mode': 'every', 'every': '-1'}, 'bilangan bulat'),
            ({'mode': 'unknown'}, 'metode'),
        )
        for data, message in cases:
            with self.subTest(data=data):
                response = self.upload(data=data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(message, response.get_json()['error'])

    def test_rejects_missing_multiple_empty_non_pdf_and_corrupt_uploads(self):
        for endpoint in ('/split-pdf/inspect', '/split-pdf'):
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.client.post(endpoint).status_code, 400)
                multiple = self.client.post(endpoint, data={'file': [(io.BytesIO(self.pdf), 'one.pdf'), (io.BytesIO(self.pdf), 'two.pdf')]})
                self.assertEqual(multiple.status_code, 400)
                self.assertEqual(self.upload(endpoint, content=b'').status_code, 400)
                self.assertEqual(self.upload(endpoint, filename='fake.txt').status_code, 400)
                corrupt = self.upload(endpoint, content=b'not a pdf')
                self.assertEqual(corrupt.status_code, 400)
                self.assertIn('tidak dapat dibaca', corrupt.get_json()['error'])

    def test_rejects_password_protected_pdf(self):
        response = self.upload('/split-pdf/inspect', content=make_pdf(encrypted=True))
        self.assertEqual(response.status_code, 400)
        self.assertIn('kata sandi', response.get_json()['error'])

    def test_resource_limits(self):
        with patch('app.MAX_SPLIT_FILE_SIZE', 10):
            response = self.upload('/split-pdf/inspect')
            self.assertEqual(response.status_code, 400)
            self.assertIn('100 MB', response.get_json()['error'])
        with patch('pdf_splitter.MAX_SPLIT_PAGES', 3):
            response = self.upload('/split-pdf/inspect')
            self.assertEqual(response.status_code, 400)
            self.assertIn('1.000 halaman', response.get_json()['error'])
        with patch('pdf_splitter.MAX_SPLIT_OUTPUTS', 2):
            response = self.upload(data={'mode': 'every', 'every': '2'})
            self.assertEqual(response.status_code, 400)
            self.assertIn('500 file', response.get_json()['error'])
        with patch('pdf_splitter.MAX_SPLIT_OUTPUT_SIZE', 100):
            with self.assertRaisesRegex(PdfSplitError, '250 MB'):
                split_pdf_bytes(self.pdf, 'test.pdf', mode='selected', ranges='1')
        with self.assertRaises(PdfSplitError):
            parse_page_ranges(','.join(['1'] * 501), 7)


if __name__ == '__main__':
    unittest.main()
