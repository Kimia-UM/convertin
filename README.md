# DocForge — Document Toolkit & Universal GForm Builder

Selain alat PDF/DOCX, aplikasi ini menyediakan **Universal GForm Builder** untuk
mengubah data tabular menjadi Google Forms asli.

## Akses online / publish

Konfigurasi Docker + Render tersedia, termasuk LibreOffice untuk Word ke PDF.
Repository: [Kimia-UM/convertin](https://github.com/Kimia-UM/convertin).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Kimia-UM/convertin)

Ikuti [panduan publish](PUBLISH.md). Paket siap unggah dapat dibuat ulang dengan
`py prepare_publish.py`; hasilnya ada di `output/publish/docforge-render.zip`.

## Pengujian

Jalankan `python -m unittest discover -s tests -v`. Tes yang memerlukan workbook
penelitian lokal dilewati bila workbook tidak tersedia; dokumen tersebut tidak
disertakan di repository. Tes alur UI dan petunjuk dependency-nya tersedia di
`tests/test_split_ui.cjs`.

## Link ke QR Code

Buka aplikasi utama di `http://127.0.0.1:5000`, lalu pilih **Link → QR Code**.
Tempel link HTTP/HTTPS, pilih ukuran gambar dan tingkat koreksi kerusakan, kemudian
klik **Buat QR Code**. Hasil dapat dipindai dari pratinjau atau diunduh sebagai
PNG. Pembuatan QR dilakukan secara lokal tanpa mengirim link ke layanan pihak
ketiga.

## Pisahkan PDF

Pilih **Pisahkan PDF** pada aplikasi utama (atau buka `http://127.0.0.1:5000/#split`), lalu unggah satu PDF. Jumlah halaman
dibaca otomatis sebelum Anda menentukan hasilnya:

- **Rentang halaman**: `1-3, 5, 7-9` menghasilkan tiga PDF terpisah.
- **Setiap beberapa halaman**: bagi seluruh dokumen menjadi kelompok dengan
  jumlah halaman yang sama; halaman tersisa masuk ke file terakhir.
- **Ambil halaman pilihan**: `7, 2-3, 1` menjadi satu PDF sesuai urutan tersebut.

Satu hasil diunduh sebagai PDF; beberapa hasil dikemas dalam ZIP dengan nama
dan urutan yang jelas. Teks, gambar, ukuran, dan rotasi halaman dipertahankan
tanpa mengubah halaman menjadi gambar. File diproses di server aplikasi tanpa
disimpan permanen. Batas unggahan 100 MB, 1.000 halaman, dan maksimum 500 file
hasil per proses. PDF yang memerlukan kata sandi perlu dibuka proteksinya dahulu.

## Universal GForm Builder

Buka `http://127.0.0.1:5000/gform` setelah server dijalankan. Alurnya:

1. Unggah XLSX, XLSM, CSV, TSV, atau TXT tabular (maksimum 25 MB).
2. Pilih sheet dan baris header.
3. Periksa hasil deteksi atau petakan kolom secara manual.
4. Tinjau struktur form.
5. Unduh generator Google Apps Script (`.gs`).
6. Tempelkan generator ke proyek baru di `script.google.com`, lalu jalankan
   fungsi `buatGoogleForm`.

Tipe yang didukung:

- Bagian/page break dan header informasi
- Jawaban singkat dan paragraf
- Pilihan ganda, checkbox, dan dropdown
- Skala linear
- Tanggal dan waktu
- Multiple-choice grid dan checkbox grid

Nama kolom tidak harus sama dengan template. Sistem mencoba mendeteksi padanan
Indonesia/Inggris; bila format sumber berbeda, pengguna dapat memilih kolom yang
sesuai dari layar pemetaan. Format lama `.xls` perlu disimpan ulang sebagai
`.xlsx` atau `.csv`.

Google tidak mengizinkan sebuah web menulis ke akun pengguna tanpa OAuth. Karena
itu mode bawaan menghasilkan Apps Script yang dijalankan oleh pengguna pada akun
Google sendiri. Form akhirnya tetap berupa Google Forms asli.

## Menjalankan aplikasi

```bash
pip install -r requirements.txt
python app.py
```

py app.py

Kemudian buka `http://127.0.0.1:5000`.

## PDF to Markdown Converter

Tools sederhana untuk mengonversi file PDF menjadi file Markdown (.md) dengan mengekstrak teks serta mempertahankan pemformatan dasar (jika didukung oleh PDF). Tools ini menggunakan library `pymupdf4llm` yang sangat bagus untuk mengurai PDF menjadi format Markdown.

## Persiapan

Sebelum menggunakan tools ini, pastikan Anda telah menginstal dependensi yang dibutuhkan:

1. Buka terminal atau Command Prompt.
2. Navigasikan ke folder ini.
3. Jalankan perintah berikut untuk menginstal library:

```bash
pip install -r requirements.txt
```

## Cara Penggunaan

Jalankan script Python melalui terminal dengan menyertakan path (lokasi) file PDF yang ingin dikonversi.

```bash
python pdf_to_md.py <path_to_pdf> [output_directory]
```

- `<path_to_pdf>`: (Wajib) Lokasi file PDF yang ingin dikonversi. Contoh: `dokumen.pdf` atau `C:\Users\Nama\dokumen.pdf`
- `[output_directory]`: (Opsional) Folder tempat menyimpan hasil Markdown. Jika dikosongkan, file `.md` akan disimpan di folder yang sama dengan file PDF aslinya.

### Contoh

Mengonversi file `artikel.pdf` yang berada di folder yang sama:

```bash
python pdf_to_md.py artikel.pdf
```

Hasilnya akan berupa file `artikel.md` di folder ini.

Mengonversi file `jurnal.pdf` dan menyimpannya di folder `D:\Hasil`:

```bash
python pdf_to_md.py jurnal.pdf "D:\Hasil"
```
