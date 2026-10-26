# Publish DocForge ke internet

Aplikasi sudah disiapkan untuk **Render Web Service memakai Docker**. Docker
menyertakan Python, Gunicorn, LibreOffice, dan font pengganti agar fitur Word ke
PDF juga tersedia. Komputer pribadi tidak perlu tetap menyala setelah deploy.

Konfigurasi ini belum membuat layanan atau akun hosting. Anda memerlukan akun
GitHub dan Render untuk langkah berikut.

## Deploy dari repository convertin

Kode tersedia di [Kimia-UM/convertin](https://github.com/Kimia-UM/convertin).
Klik [Deploy to Render](https://render.com/deploy?repo=https://github.com/Kimia-UM/convertin),
masuk ke akun Render, lalu pilih repository tersebut. Jika repository private,
berikan integrasi GitHub Render akses ke repository yang dipilih. Periksa paket
**Free** pada konfigurasi, lalu klik **Deploy Blueprint**. Tidak perlu mengunggah
ulang file dari komputer.

Setelah layanan berstatus **Live**, buka URL HTTPS yang ditampilkan di dashboard.
GitHub menyimpan kode; website dijalankan oleh layanan Render tersebut.

## Cara termudah: upload paket yang sudah bersih

1. Jalankan `py prepare_publish.py` untuk memperbarui
   `output/publish/docforge-render.zip`, lalu ekstrak ZIP tersebut.
2. Masuk ke [GitHub](https://github.com/new) dan buat repository, misalnya
   `docforge`. Repository boleh **Private**. Centang **Add a README file** agar
   halaman repository menampilkan menu upload.
3. Di repository, pilih **Add file > Upload files**. Masukkan **isi folder hasil
   ekstraksi**, termasuk folder `static` dan `templates`. Jangan unggah ZIP
   sebagai satu file. `Dockerfile`, `app.py`, dan `render.yaml` harus terlihat
   langsung di root repository. Commit perubahan. Jika README awal sama, ganti
   dengan README dari paket.
4. Masuk ke [Render Dashboard](https://dashboard.render.com/), lalu pilih
   **New > Blueprint**. Hubungkan akun GitHub dan pilih repository tadi. Berikan
   Render akses ke repository yang dipilih jika diminta.
5. Render membaca `render.yaml`. Periksa bahwa layanan menggunakan **Docker** dan
   paket **Free**, lalu konfirmasi pembuatan/deploy. File konfigurasi secara
   eksplisit memilih paket gratis.
6. Tunggu build/deploy berhasil. Buka URL HTTPS yang muncul di dashboard, seperti
   `https://nama-layanan.onrender.com`. Alat pisah PDF berada di `/#split`,
   misalnya `https://nama-layanan.onrender.com/#split`.

Jika memakai **New > Web Service**: pilih repository yang sama, Language
**Docker**, Dockerfile Path `./Dockerfile`, dan paket yang Anda inginkan.
Biarkan **Docker Command** kosong karena perintah sudah ada di Dockerfile.
Tidak perlu mengisi Python Build Command atau menjalankan `python app.py`.

Paket ZIP hanya memuat kode aplikasi dan konfigurasi deploy. Dokumen PDF/Word,
dua workbook penelitian lokal, log server, direktori sementara, dan dependency
pengujian tidak ikut dikemas.

## Pilihan kapasitas

- **Free** dipilih sebagai awal untuk uji coba file kecil, bukan jaminan semua
  fitur dapat berjalan dengan RAM terbatas. Render menyebut RAM
  512 MB dan layanan tidur setelah 15 menit tanpa trafik. Permintaan pertama
  sesudah tidur bisa membutuhkan sekitar satu menit untuk membangunkannya.
- Untuk penggunaan rutin, Word ke PDF, atau dokumen besar, mulai dari **2 GB RAM**
  adalah perkiraan kapasitas yang lebih masuk akal. Ini rekomendasi untuk
  aplikasi ini, bukan jaminan bahwa semua dokumen pasti berhasil. Pilih paket
  berbayar hanya jika Anda menyetujui biaya yang ditampilkan di dashboard.
- Batas aplikasi 500 MB per permintaan dan batas pisah PDF 100 MB adalah batas
  validasi. Kemampuan nyata juga dibatasi RAM, waktu proses, dan batas hosting;
  paket gratis tidak dijamin dapat memproses file mendekati batas tersebut.

Filesystem Render bersifat sementara. Aplikasi memproses dan mengembalikan hasil
untuk diunduh, tidak menyediakan riwayat atau penyimpanan dokumen permanen.

## Akses dan dokumen

URL Web Service dapat dibuka melalui internet. Aplikasi ini belum memiliki login;
repository GitHub yang private hanya menyembunyikan kode, bukan membatasi akses
ke website. Saat dipakai online, file diunggah dan diproses di server hosting.

## Pembaruan sesudah publish

Setiap perubahan yang di-commit ke branch GitHub yang terhubung akan membangun
ulang layanan sesuai pengaturan auto-deploy Render. Jika mengubah paket melalui
dashboard dan juga menggunakan Blueprint, sesuaikan `plan` dalam `render.yaml`
agar sinkronisasi Blueprint berikutnya tidak mengembalikan paket sebelumnya.

Gunicorn mendengarkan `0.0.0.0:$PORT`, memakai satu worker sinkron, dan memberi
waktu proses 300 detik. Pengaturan `WEB_CONCURRENCY` dapat ditingkatkan setelah
kapasitas RAM mencukupi. Pertahankan satu thread per worker karena PyMuPDF tidak
mendukung penggunaan bersamaan dari banyak thread.

## Cek Docker sebelum deploy (opsional)

Jika Docker sudah terpasang:

```powershell
docker build -t docforge .
docker run --rm -p 10000:10000 docforge
```

Buka `http://localhost:10000` dan coba dokumen kecil. Tidak perlu memasang Docker
di komputer pribadi bila langsung membangun image melalui Render. Image Docker
belum dibangun di workspace ini karena Docker tidak tersedia.

## Rujukan resmi

- [Docker on Render](https://render.com/docs/docker)
- [Web Services dan port](https://render.com/docs/web-services)
- [Batas paket gratis](https://render.com/docs/free)
- [Blueprint YAML](https://render.com/docs/blueprint-spec)
- [PyMuPDF: batas multithreading](https://pymupdf.readthedocs.io/en/latest/recipes-multiprocessing.html)
