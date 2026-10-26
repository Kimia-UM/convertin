"""
LibreOffice headless converter — the no-Microsoft-Word engine for
Word -> PDF. LibreOffice renders .docx/.doc with high fidelity and keeps the
document's margins/template/styles, and it is a separate free application (not
MS Word), so nothing here depends on Word or COM.

find_soffice()   -> path to the soffice executable (or None)
convert_to_pdf() -> run a headless batch conversion and return output paths
"""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path


class LibreOfficeNotFound(RuntimeError):
    """Raised when no LibreOffice installation can be located."""


def find_soffice():
    """Locate the LibreOffice (soffice) executable across Windows/macOS/Linux."""
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found

    candidates = [
        os.path.expandvars(r"%ProgramFiles%\LibreOffice\program\soffice.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\LibreOffice\program\soffice.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\LibreOffice\program\soffice.exe"),
        os.path.expandvars(r"%ProgramFiles%\LibreOffice\program\soffice.com"),
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
        "/usr/lib/libreoffice/program/soffice",
        "/snap/bin/libreoffice",
        "/opt/libreoffice/program/soffice",
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def _expected_output(out_dir, input_path):
    base = os.path.splitext(os.path.basename(input_path))[0]
    return os.path.join(out_dir, base + ".pdf")


def convert_to_pdf(input_paths, out_dir, timeout=180):
    """
    Convert a list of documents to PDF with a single headless LibreOffice run.

    Returns {input_path: output_pdf_path_or_None}. A private, throwaway user
    profile is used so concurrent/queued conversions never clash with an open
    LibreOffice window, and so no Word/COM is ever involved.
    """
    soffice = find_soffice()
    if not soffice:
        raise LibreOfficeNotFound(
            "LibreOffice tidak ditemukan di mesin ini. Instal dulu, lalu jalankan ulang aplikasi."
        )

    input_paths = [os.path.abspath(p) for p in input_paths]
    os.makedirs(out_dir, exist_ok=True)

    profile_dir = tempfile.mkdtemp(prefix="lo_profile_")
    user_env = "-env:UserInstallation=" + Path(profile_dir).as_uri()

    cmd = [
        soffice, user_env,
        "--headless", "--invisible", "--norestore",
        "--nolockcheck", "--nodefault", "--nofirststartwizard",
        "--convert-to", "pdf", "--outdir", os.path.abspath(out_dir),
    ] + input_paths

    expected = [_expected_output(out_dir, p) for p in input_paths]

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
    except OSError as e:
        shutil.rmtree(profile_dir, ignore_errors=True)
        raise LibreOfficeNotFound("Gagal menjalankan LibreOffice: %s" % e)

    # On Windows soffice.exe can return immediately while a background instance
    # keeps converting, so poll for the produced PDFs up to the timeout.
    deadline = time.time() + timeout
    while time.time() < deadline:
        if all(os.path.exists(p) for p in expected):
            time.sleep(0.3)  # let the writer flush the last bytes
            break
        time.sleep(0.3)

    if proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    shutil.rmtree(profile_dir, ignore_errors=True)
    return {p: (o if os.path.exists(o) else None) for p, o in zip(input_paths, expected)}
