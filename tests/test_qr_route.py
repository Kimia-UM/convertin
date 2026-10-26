import io
import unittest

from PIL import Image

from app import app, normalize_qr_url


class QrRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config.update(TESTING=True)
        cls.client = app.test_client()

    def test_home_page_contains_qr_tool(self):
        response = self.client.get('/')

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Konversi Link ke QR Code', response.data)
        self.assertIn(b'id="qrForm"', response.data)

    def test_generate_qr_png(self):
        response = self.client.post(
            '/generate-qr',
            json={
                'url': 'example.com/artikel?id=42',
                'size': 512,
                'error_correction': 'M',
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'image/png')
        self.assertIn('attachment', response.headers['Content-Disposition'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertTrue(response.data.startswith(b'\x89PNG\r\n\x1a\n'))
        with Image.open(io.BytesIO(response.data)) as image:
            self.assertEqual(image.size, (512, 512))
            self.assertEqual(image.format, 'PNG')

    def test_normalize_adds_https(self):
        self.assertEqual(
            normalize_qr_url('contoh.id/path'),
            'https://contoh.id/path',
        )

    def test_rejects_invalid_input(self):
        cases = (
            ({}, 'Masukkan link'),
            ({'url': 'ftp://example.com'}, 'HTTP atau HTTPS'),
            ({'url': 'https://example.com/a b'}, 'spasi'),
            ({'url': 'https://example.com', 'size': 300}, 'Ukuran'),
            ({'url': 'https://example.com', 'size': 'besar'}, 'Ukuran'),
            ({'url': 'https://example.com', 'error_correction': 'Z'}, 'koreksi'),
            ([], 'Masukkan link'),
        )
        for payload, expected in cases:
            with self.subTest(payload=payload):
                response = self.client.post('/generate-qr', json=payload)
                self.assertEqual(response.status_code, 400)
                self.assertIn(expected, response.get_json()['error'])


if __name__ == '__main__':
    unittest.main()
