"""Split PDF pages without rasterizing their text, images, or page geometry."""

import io
import re
import zipfile

import pymupdf as fitz
from werkzeug.utils import secure_filename


MAX_SPLIT_FILE_SIZE = 100 * 1024 * 1024
MAX_SPLIT_PAGES = 1000
MAX_SPLIT_OUTPUTS = 500
MAX_COPIED_PAGES = 5000
MAX_SPLIT_OUTPUT_SIZE = 250 * 1024 * 1024


class PdfSplitError(ValueError):
    """A PDF or split configuration cannot be processed safely."""


def _open_pdf(data):
    if not data:
        raise PdfSplitError('File PDF kosong. Pilih file lain.')
    if len(data) > MAX_SPLIT_FILE_SIZE:
        raise PdfSplitError('Ukuran PDF maksimum 100 MB.')
    try:
        document = fitz.open(stream=data, filetype='pdf')
    except (RuntimeError, ValueError) as exc:
        raise PdfSplitError('PDF tidak dapat dibaca. Pastikan file tidak rusak.') from exc
    if not document.is_pdf:
        document.close()
        raise PdfSplitError('File yang dipilih bukan PDF yang valid.')
    if document.needs_pass:
        document.close()
        raise PdfSplitError('PDF dilindungi kata sandi. Buka proteksinya terlebih dahulu.')
    page_count = document.page_count
    if not page_count or page_count > MAX_SPLIT_PAGES:
        document.close()
        if not page_count:
            raise PdfSplitError('PDF tidak memiliki halaman.')
        raise PdfSplitError('PDF maksimum 1.000 halaman. Gunakan dokumen yang lebih kecil.')
    return document


def inspect_pdf_bytes(data, filename):
    with _open_pdf(data) as document:
        return {'filename': filename, 'page_count': document.page_count}


def parse_page_ranges(value, page_count):
    """Return inclusive, 1-based ranges in the order entered by the user."""
    text = str(value or '').strip()
    if not text:
        raise PdfSplitError('Isi halaman atau rentang, misalnya 1-3, 5, 7-9.')
    if len(text) > 10000:
        raise PdfSplitError('Daftar halaman terlalu panjang. Maksimum 500 rentang.')
    parts = text.split(',')
    if len(parts) > MAX_SPLIT_OUTPUTS:
        raise PdfSplitError('Maksimum 500 rentang halaman dalam satu proses.')
    ranges = []
    for part in parts:
        match = re.fullmatch(r'\s*([0-9]{1,6})\s*(?:-\s*([0-9]{1,6})\s*)?', part)
        if not match:
            raise PdfSplitError('Format halaman belum tepat. Gunakan angka dan rentang, misalnya 1-3, 5.')
        first = int(match.group(1))
        last = int(match.group(2) or first)
        if first < 1 or last < 1 or first > page_count or last > page_count:
            raise PdfSplitError(f'Nomor halaman harus antara 1 dan {page_count}.')
        if first > last:
            raise PdfSplitError(f'Rentang {first}-{last} terbalik. Tulis halaman awal lebih dahulu.')
        ranges.append((first, last))
    if sum(last - first + 1 for first, last in ranges) > MAX_COPIED_PAGES:
        raise PdfSplitError('Jumlah halaman hasil terlalu besar. Kurangi rentang yang tumpang tindih.')
    return ranges


def _split_groups(mode, ranges, every, page_count):
    if mode == 'every':
        if not re.fullmatch(r'[0-9]{1,6}', str(every or '').strip()):
            raise PdfSplitError('Jumlah halaman per file harus berupa bilangan bulat.')
        interval = int(every)
        if interval < 1 or interval > page_count:
            raise PdfSplitError(f'Jumlah halaman per file harus antara 1 dan {page_count}.')
        groups = [[(first, min(first + interval - 1, page_count))]
                  for first in range(1, page_count + 1, interval)]
    elif mode in ('ranges', 'selected'):
        parsed = parse_page_ranges(ranges, page_count)
        if mode == 'selected':
            seen = set()
            for first, last in parsed:
                pages = set(range(first, last + 1))
                if seen.intersection(pages):
                    raise PdfSplitError('Ada halaman yang dipilih lebih dari sekali. Hapus rentang yang tumpang tindih.')
                seen.update(pages)
            groups = [parsed]
        else:
            groups = [[page_range] for page_range in parsed]
    else:
        raise PdfSplitError('Pilih metode pemisahan PDF yang tersedia.')
    if len(groups) > MAX_SPLIT_OUTPUTS:
        raise PdfSplitError('Hasil maksimum 500 file. Tambah jumlah halaman per file.')
    return groups


def split_pdf_bytes(data, filename, *, mode='ranges', ranges='', every='1'):
    """Return download bytes and metadata; a single output is served as PDF."""
    stem = secure_filename(filename.rsplit('.', 1)[0])[:100] or 'dokumen'
    results = []
    total_size = 0
    try:
        with _open_pdf(data) as source:
            groups = _split_groups(mode, ranges, every, source.page_count)
            for index, group in enumerate(groups, 1):
                with fitz.open() as output:
                    for first, last in group:
                        output.insert_pdf(source, from_page=first - 1, to_page=last - 1)
                    metadata = {key: value for key, value in source.metadata.items()
                                if key not in ('format', 'encryption') and value}
                    if metadata:
                        output.set_metadata(metadata)
                    result = output.tobytes(garbage=3, deflate=True)
                total_size += len(result)
                if total_size > MAX_SPLIT_OUTPUT_SIZE:
                    raise PdfSplitError('Ukuran hasil melebihi 250 MB. Pisahkan lebih sedikit halaman sekaligus.')
                if mode == 'selected':
                    suffix = 'halaman-pilihan'
                else:
                    first, last = group[0]
                    suffix = f'halaman-{first}' if first == last else f'halaman-{first}-{last}'
                # Prefix keeps archive members unique, including repeated ranges.
                prefix = f'{index:03d}_' if len(groups) > 1 else ''
                results.append((f'{prefix}{stem}_{suffix}.pdf', result))
    except PdfSplitError:
        raise
    except (RuntimeError, ValueError) as exc:
        raise PdfSplitError('Halaman PDF tidak dapat dipisahkan. Pastikan dokumen tidak rusak.') from exc

    if len(results) == 1:
        name, result = results[0]
        return {'bytes': result, 'filename': name, 'mimetype': 'application/pdf', 'output_count': 1}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name, result in results:
            bundle.writestr(name, result)
    return {'bytes': archive.getvalue(), 'filename': f'{stem}_terpisah.zip',
            'mimetype': 'application/zip', 'output_count': len(results)}
