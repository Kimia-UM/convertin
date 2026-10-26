import os
import shutil
import zipfile
import io
import json
from urllib.parse import urlsplit

import qrcode
from PIL import Image
from flask import Flask, request, send_file, render_template, jsonify
import pymupdf4llm
from werkzeug.utils import secure_filename
import tempfile
from docx_compressor import compress_docx_bytes
from pdf_compressor import compress_pdf_bytes
from pdf_splitter import (
    MAX_SPLIT_FILE_SIZE,
    PdfSplitError,
    inspect_pdf_bytes,
    split_pdf_bytes,
)
from libreoffice import convert_to_pdf, LibreOfficeNotFound
from gform_builder import (
    GFormImportError,
    generate_apps_script,
    inspect_upload,
    normalize_upload,
    public_preview,
)

app = Flask(__name__)
# Allow up to 500MB for multiple PDF uploads
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/gform')
def gform_builder_page():
    return render_template('gform.html')


GFORM_MAX_FILE_SIZE = 25 * 1024 * 1024
QR_MAX_BYTES = 1200


def normalize_qr_url(value):
    """Return a scannable HTTP(S) URL or raise ValueError."""
    url = str(value or '').strip()
    if not url:
        raise ValueError('Masukkan link yang ingin dijadikan QR code.')
    if any(char.isspace() for char in url):
        raise ValueError('Link tidak boleh mengandung spasi atau baris baru.')
    if '://' not in url:
        url = f'https://{url}'

    try:
        parsed = urlsplit(url)
        # Accessing port also validates malformed and out-of-range port values.
        parsed.port
    except ValueError as exc:
        raise ValueError('Format link tidak valid.') from exc

    if parsed.scheme.lower() not in ('http', 'https') or not parsed.hostname:
        raise ValueError('Gunakan link HTTP atau HTTPS yang valid.')
    if len(url.encode('utf-8')) > QR_MAX_BYTES:
        raise ValueError('Link terlalu panjang. Maksimum 1.200 byte.')
    return url


def _read_gform_file():
    upload = request.files.get('file')
    if not upload or not upload.filename:
        raise GFormImportError('Pilih satu file XLSX, XLSM, CSV, TSV, atau TXT.')

    filename = secure_filename(upload.filename)
    data = upload.read(GFORM_MAX_FILE_SIZE + 1)
    if len(data) > GFORM_MAX_FILE_SIZE:
        raise GFormImportError('Ukuran file maksimum untuk GForm Builder adalah 25 MB.')
    if not data:
        raise GFormImportError('File yang diunggah kosong.')
    return data, filename


def _read_gform_configuration():
    try:
        sheet_index = int(request.form.get('sheet_index', '0'))
        header_row = int(request.form.get('header_row', '1'))
        mapping = json.loads(request.form.get('mapping', '{}'))
        form_options = json.loads(request.form.get('form_options', '{}'))
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise GFormImportError('Konfigurasi pemetaan tidak valid.') from exc

    if not isinstance(mapping, dict) or not isinstance(form_options, dict):
        raise GFormImportError('Konfigurasi pemetaan harus berbentuk objek.')
    return sheet_index, header_row, mapping, form_options


@app.route('/gform/inspect', methods=['POST'])
def inspect_gform_source():
    try:
        data, filename = _read_gform_file()
        return jsonify(inspect_upload(data, filename))
    except GFormImportError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'error': f'Gagal membaca file: {exc}'}), 500


@app.route('/gform/preview', methods=['POST'])
def preview_gform_source():
    try:
        data, filename = _read_gform_file()
        sheet_index, header_row, mapping, form_options = _read_gform_configuration()
        definition = normalize_upload(
            data,
            filename,
            sheet_index=sheet_index,
            header_row=header_row,
            mapping=mapping,
            form_options=form_options,
        )
        return jsonify(public_preview(definition))
    except GFormImportError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'error': f'Gagal membuat pratinjau: {exc}'}), 500


@app.route('/gform/generate', methods=['POST'])
def generate_gform_script():
    try:
        data, filename = _read_gform_file()
        sheet_index, header_row, mapping, form_options = _read_gform_configuration()
        definition = normalize_upload(
            data,
            filename,
            sheet_index=sheet_index,
            header_row=header_row,
            mapping=mapping,
            form_options=form_options,
        )
        script = generate_apps_script(definition).encode('utf-8')
        stem = os.path.splitext(filename)[0] or 'form'
        download_name = f'{stem}_gform_generator.gs'
        return send_file(
            io.BytesIO(script),
            as_attachment=True,
            download_name=download_name,
            mimetype='text/javascript; charset=utf-8',
        )
    except GFormImportError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'error': f'Gagal membuat generator: {exc}'}), 500


@app.route('/generate-qr', methods=['POST'])
def generate_qr_code():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = request.form

    try:
        url = normalize_qr_url(payload.get('url'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    try:
        size = int(payload.get('size', 512))
    except (TypeError, ValueError):
        return jsonify({'error': 'Ukuran QR code tidak valid.'}), 400

    if size not in (256, 512, 1024):
        return jsonify({'error': 'Ukuran QR code harus 256, 512, atau 1024 px.'}), 400

    error_level = str(payload.get('error_correction', 'M')).upper()
    error_corrections = {
        'L': qrcode.constants.ERROR_CORRECT_L,
        'M': qrcode.constants.ERROR_CORRECT_M,
        'Q': qrcode.constants.ERROR_CORRECT_Q,
        'H': qrcode.constants.ERROR_CORRECT_H,
    }
    if error_level not in error_corrections:
        return jsonify({'error': 'Level koreksi QR code tidak valid.'}), 400

    try:
        qr = qrcode.QRCode(
            version=None,
            error_correction=error_corrections[error_level],
            box_size=1,
            border=4,
        )
        qr.add_data(url)
        qr.make(fit=True)
        base_image = qr.make_image(fill_color='#111827', back_color='white').convert('RGB')

        # Preserve perfectly square QR modules while producing the selected canvas size.
        scale = max(1, size // base_image.width)
        rendered_size = base_image.width * scale
        qr_image = base_image.resize((rendered_size, rendered_size), Image.Resampling.NEAREST)
        output_image = Image.new('RGB', (size, size), 'white')
        offset = (size - rendered_size) // 2
        output_image.paste(qr_image, (offset, offset))

        output = io.BytesIO()
        output_image.save(output, format='PNG', optimize=True)
        output.seek(0)
    except qrcode.exceptions.DataOverflowError:
        return jsonify({'error': 'Link terlalu panjang untuk level koreksi yang dipilih.'}), 400

    response = send_file(
        output,
        as_attachment=True,
        download_name='link-qrcode.png',
        mimetype='image/png',
    )
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

@app.route('/convert', methods=['POST'])
def convert_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400

    files = request.files.getlist('file')

    if not files or files[0].filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if len(files) > 100:
        return jsonify({'error': 'Maximum 100 files allowed per request.'}), 400

    # Temporary directory for this batch
    temp_dir = tempfile.mkdtemp()

    converted_files = []

    try:
        for file in files:
            if file and file.filename.lower().endswith('.pdf'):
                filename = secure_filename(file.filename)
                pdf_path = os.path.join(temp_dir, filename)
                file.save(pdf_path)

                md_filename = os.path.splitext(filename)[0] + '.md'
                md_path = os.path.join(temp_dir, md_filename)

                # Convert PDF to Markdown
                md_text = pymupdf4llm.to_markdown(pdf_path)

                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(md_text)

                converted_files.append((md_filename, md_path))

        if len(converted_files) == 0:
             return jsonify({'error': 'No valid PDFs were converted.'}), 400

        # If only 1 file, return it directly
        if len(converted_files) == 1:
            with open(converted_files[0][1], 'rb') as output:
                download = io.BytesIO(output.read())
            return send_file(
                download,
                as_attachment=True,
                download_name=converted_files[0][0],
                mimetype='text/markdown'
            )

        # If multiple files, create a ZIP
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for md_filename, md_path in converted_files:
                zf.write(md_path, arcname=md_filename)

        memory_file.seek(0)

        return send_file(
            memory_file,
            as_attachment=True,
            download_name='converted_markdowns.zip',
            mimetype='application/zip'
        )

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

@app.route('/convert-word', methods=['POST'])
def convert_word():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400

    files = request.files.getlist('file')

    if not files or files[0].filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if len(files) > 100:
        return jsonify({'error': 'Maximum 100 files allowed per request.'}), 400

    in_dir = tempfile.mkdtemp(prefix='word_in_')
    out_dir = tempfile.mkdtemp(prefix='word_out_')

    try:
        saved_files = []
        for file in files:
            if file and file.filename.lower().endswith(('.docx', '.doc')):
                word_path = os.path.join(in_dir, secure_filename(file.filename))
                file.save(word_path)
                saved_files.append(word_path)

        if not saved_files:
            return jsonify({'error': 'No valid Word files were uploaded (.docx/.doc).'}), 400

        try:
            results = convert_to_pdf(saved_files, out_dir)
        except LibreOfficeNotFound as e:
            return jsonify({'error': str(e)}), 503

        converted_files = []
        failed = []
        for word_path in saved_files:
            pdf_path = results.get(word_path)
            if pdf_path:
                converted_files.append((os.path.basename(pdf_path), pdf_path))
            else:
                failed.append(os.path.basename(word_path))

        if not converted_files:
            return jsonify({'error': 'Konversi gagal untuk semua file. Pastikan file tidak rusak/terkunci.'}), 400

        if len(converted_files) == 1:
            with open(converted_files[0][1], 'rb') as output:
                download = io.BytesIO(output.read())
            return send_file(
                download,
                as_attachment=True,
                download_name=converted_files[0][0],
                mimetype='application/pdf',
            )

        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for pdf_filename, pdf_path in converted_files:
                zf.write(pdf_path, arcname=pdf_filename)
        memory_file.seek(0)
        resp = send_file(
            memory_file,
            as_attachment=True,
            download_name='converted_pdfs.zip',
            mimetype='application/zip',
        )
        if failed:
            resp.headers['X-Failed-Files'] = str(len(failed))
        return resp

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(in_dir, ignore_errors=True)
        shutil.rmtree(out_dir, ignore_errors=True)

@app.route('/merge-pdf', methods=['POST'])
def merge_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400

    files = request.files.getlist('file')

    if not files or files[0].filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if len(files) < 2:
        return jsonify({'error': 'Please select at least 2 PDF files to merge.'}), 400

    if len(files) > 100:
        return jsonify({'error': 'Maximum 100 files allowed per request.'}), 400

    temp_dir = tempfile.mkdtemp()
    merged_pdf_path = os.path.join(temp_dir, 'merged.pdf')

    try:
        import pymupdf as fitz
        with fitz.open() as result_pdf:
            for file in files:
                if file and file.filename.lower().endswith('.pdf'):
                    filename = secure_filename(file.filename)
                    pdf_path = os.path.join(temp_dir, filename)
                    file.save(pdf_path)

                    with fitz.open(pdf_path) as doc:
                        result_pdf.insert_pdf(doc)

            if result_pdf.page_count == 0:
                return jsonify({'error': 'No valid PDFs were provided for merging.'}), 400

            result_pdf.save(merged_pdf_path)

        with open(merged_pdf_path, 'rb') as output:
            download = io.BytesIO(output.read())

        return send_file(
            download,
            as_attachment=True,
            download_name='merged.pdf',
            mimetype='application/pdf'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def _read_split_pdf_file():
    files = request.files.getlist('file')
    if len(files) != 1 or not files[0].filename:
        raise PdfSplitError('Pilih satu file PDF yang ingin dipisahkan.')
    upload = files[0]
    if not upload.filename.lower().endswith('.pdf'):
        raise PdfSplitError('Gunakan file dengan format PDF (.pdf).')
    data = upload.read(MAX_SPLIT_FILE_SIZE + 1)
    if len(data) > MAX_SPLIT_FILE_SIZE:
        raise PdfSplitError('Ukuran PDF maksimum 100 MB.')
    return data, secure_filename(upload.filename) or 'dokumen.pdf'


@app.route('/split-pdf/inspect', methods=['POST'])
def inspect_split_pdf():
    try:
        data, filename = _read_split_pdf_file()
        response = jsonify(inspect_pdf_bytes(data, filename))
        response.headers['Cache-Control'] = 'no-store'
        return response
    except PdfSplitError as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/split-pdf', methods=['POST'])
def split_pdf():
    try:
        data, filename = _read_split_pdf_file()
        result = split_pdf_bytes(
            data, filename,
            mode=request.form.get('mode', 'ranges'),
            ranges=request.form.get('ranges', ''),
            every=request.form.get('every', '1'),
        )
        response = send_file(
            io.BytesIO(result['bytes']),
            as_attachment=True,
            download_name=result['filename'],
            mimetype=result['mimetype'],
        )
        response.headers['X-Output-Count'] = str(result['output_count'])
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response
    except PdfSplitError as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/compress-docx', methods=['POST'])
def compress_docx():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400

    files = request.files.getlist('file')
    if not files or files[0].filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if len(files) > 100:
        return jsonify({'error': 'Maximum 100 files allowed per request.'}), 400

    try:
        max_dim = int(request.form.get('max_dim', 1500))
    except (TypeError, ValueError):
        max_dim = 1500
    max_dim = max(0, min(max_dim, 6000))
    try:
        jpeg_quality = int(request.form.get('jpeg_quality', 78))
    except (TypeError, ValueError):
        jpeg_quality = 78
    jpeg_quality = max(30, min(jpeg_quality, 95))
    strip_thumb = str(request.form.get('strip_thumbnail', '')).lower() in ('1', 'true', 'on', 'yes')

    results = []  # (out_name, bytes, orig, comp)
    for file in files:
        if not file or not file.filename.lower().endswith('.docx'):
            continue
        original_name = secure_filename(file.filename)
        out_name = os.path.splitext(original_name)[0] + '.compressed.docx'
        try:
            info = compress_docx_bytes(
                file.read(),
                max_dim=max_dim,
                jpeg_quality=jpeg_quality,
                strip_thumbnail=strip_thumb,
            )
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        results.append((out_name, info['bytes'], info['original_size'], info['compressed_size']))

    if not results:
        return jsonify({'error': 'No valid .docx files were provided.'}), 400

    total_orig = sum(r[2] for r in results)
    total_comp = sum(r[3] for r in results)

    if len(results) == 1:
        out_name, blob, _, _ = results[0]
        resp = send_file(
            io.BytesIO(blob),
            as_attachment=True,
            download_name=out_name,
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
        resp.headers['X-Original-Size'] = str(total_orig)
        resp.headers['X-Compressed-Size'] = str(total_comp)
        return resp

    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for out_name, blob, _, _ in results:
            zf.writestr(out_name, blob)
    memory_file.seek(0)
    resp = send_file(
        memory_file,
        as_attachment=True,
        download_name='compressed_docx.zip',
        mimetype='application/zip',
    )
    resp.headers['X-Original-Size'] = str(total_orig)
    resp.headers['X-Compressed-Size'] = str(total_comp)
    return resp


@app.route('/compress-pdf', methods=['POST'])
def compress_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400

    files = request.files.getlist('file')
    if not files or files[0].filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if len(files) > 100:
        return jsonify({'error': 'Maximum 100 files allowed per request.'}), 400

    try:
        max_dim = int(request.form.get('max_dim', 1500))
    except (TypeError, ValueError):
        max_dim = 1500
    max_dim = max(0, min(max_dim, 6000))
    try:
        jpeg_quality = int(request.form.get('jpeg_quality', 78))
    except (TypeError, ValueError):
        jpeg_quality = 78
    jpeg_quality = max(30, min(jpeg_quality, 95))
    subset_fonts = str(request.form.get('subset_fonts', '')).lower() in ('1', 'true', 'on', 'yes')
    optimize = str(request.form.get('optimize', '1')).lower() in ('1', 'true', 'on', 'yes')

    results = []  # (out_name, bytes, orig, comp)
    for file in files:
        if not file or not file.filename.lower().endswith('.pdf'):
            continue
        original_name = secure_filename(file.filename)
        out_name = os.path.splitext(original_name)[0] + '.compressed.pdf'
        try:
            info = compress_pdf_bytes(
                file.read(),
                max_dim=max_dim,
                jpeg_quality=jpeg_quality,
                optimize=optimize,
                subset_fonts=subset_fonts,
            )
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        results.append((out_name, info['bytes'], info['original_size'], info['compressed_size']))

    if not results:
        return jsonify({'error': 'No valid .pdf files were provided.'}), 400

    total_orig = sum(r[2] for r in results)
    total_comp = sum(r[3] for r in results)

    if len(results) == 1:
        out_name, blob, _, _ = results[0]
        resp = send_file(
            io.BytesIO(blob),
            as_attachment=True,
            download_name=out_name,
            mimetype='application/pdf',
        )
        resp.headers['X-Original-Size'] = str(total_orig)
        resp.headers['X-Compressed-Size'] = str(total_comp)
        return resp

    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for out_name, blob, _, _ in results:
            zf.writestr(out_name, blob)
    memory_file.seek(0)
    resp = send_file(
        memory_file,
        as_attachment=True,
        download_name='compressed_pdf.zip',
        mimetype='application/zip',
    )
    resp.headers['X-Original-Size'] = str(total_orig)
    resp.headers['X-Compressed-Size'] = str(total_comp)
    return resp


if __name__ == '__main__':
    # Run the Flask app on port 5000
    print("Starting server... Open http://127.0.0.1:5000 in your browser.")
    app.run(debug=True, port=5000)
