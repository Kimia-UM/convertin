"""
DOCX compressor that reduces file size WITHOUT touching document structure.

A .docx is an OOXML ZIP package. Most of its weight comes from embedded images
under word/media/. This module recompresses only those image parts (downscale +
re-encode) and copies every other part byte-for-byte, so margins, styles,
templates, headers, and layout are preserved.

Why layout is safe: Word renders an image using its declared extents (EMU) in
document.xml, not its native pixel dimensions. Reducing the pixel data therefore
does not move or resize anything on the page.
"""

import io
import os
import zipfile

try:
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None  # allow large images; this is a trusted local tool
    _HAS_PIL = True
except Exception:  # pragma: no cover
    _HAS_PIL = False

IMAGE_EXTS = {"png", "jpg", "jpeg", "bmp", "gif", "tif", "tiff", "webp"}
# Vector metafiles are skipped (not raster, PIL can't reliably open them).


def _is_media_image(name):
    base = os.path.basename(name).lower()
    ext = base.rsplit(".", 1)[-1] if "." in base else ""
    return name.startswith("word/media/") and ext in IMAGE_EXTS


def _min_dim_for(ext):
    # Only bother recompressing parts above this size (bytes).
    return 30 * 1024


def _recompress_image(raw, ext, max_dim, jpeg_quality):
    """Return (new_bytes, saved_bool). Never returns a larger image than input."""
    if not _HAS_PIL or len(raw) < _min_dim_for(ext):
        return raw, False
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        return raw, False

    w, h = img.size
    if max_dim and max(w, h) > max_dim:
        scale = max_dim / float(max(w, h))
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        try:
            img = img.resize((nw, nh), Image.LANCZOS)
        except Exception:
            img = img.resize((nw, nh))

    out = io.BytesIO()
    fmt = img.format.upper() if img.format else ext.upper()
    try:
        if fmt in ("JPEG", "JPG"):
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.save(out, "JPEG", quality=int(jpeg_quality), optimize=True, progressive=True)
        elif fmt == "PNG":
            has_alpha = img.mode in ("RGBA", "LA", "P") and (
                "transparency" in img.info or img.mode in ("RGBA", "LA"))
            save = img.convert("RGBA") if has_alpha else img
            save.save(out, "PNG", optimize=True)
        elif fmt == "GIF":
            img.save(out, "GIF", optimize=True)
        elif fmt in ("WEBP",):
            img.save(out, "WEBP", quality=int(jpeg_quality), method=6)
        elif fmt in ("BMP", "TIFF"):
            # Re-encode within the same container to stay format-safe.
            if fmt == "BMP":
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGB")
                img.save(out, "BMP")
            else:
                img.save(out, "TIFF", compression="jpeg", quality=int(jpeg_quality))
        else:
            return raw, False
    except Exception:
        return raw, False

    data = out.getvalue()
    if data and len(data) < len(raw):
        return data, True
    return raw, False


def compress_docx_bytes(data, max_dim=1500, jpeg_quality=78, strip_thumbnail=False):
    """
    Compress a .docx (given as bytes).
    Returns dict: {bytes, original_size, compressed_size, images_optimized}
    Falls back to the original bytes if the result is not smaller.
    """
    original_size = len(data)
    images_optimized = 0

    try:
        zin = zipfile.ZipFile(io.BytesIO(data), "r")
    except zipfile.BadZipFile:
        raise ValueError("File bukan DOCX yang valid (bukan arsip OOXML).")

    names = set(zin.namelist())
    buf = io.BytesIO()
    with zin, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            raw = zin.read(info.filename)

            if strip_thumbnail and info.filename.lower().startswith("docprops/thumbnail"):
                # Drop the preview image; harmless to document integrity.
                continue

            if _is_media_image(info.filename):
                ext = os.path.basename(info.filename).rsplit(".", 1)[-1].lower()
                new_raw, saved = _recompress_image(raw, ext, max_dim, jpeg_quality)
                if saved:
                    images_optimized += 1
                    raw = new_raw

            # Copy with the same metadata to keep the package intact.
            new_info = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            new_info.compress_type = zipfile.ZIP_DEFLATED
            new_info.external_attr = info.external_attr
            zout.writestr(new_info, raw)

    result = buf.getvalue()
    if len(result) >= original_size:
        return {
            "bytes": data,
            "original_size": original_size,
            "compressed_size": original_size,
            "images_optimized": 0,
        }
    return {
        "bytes": result,
        "original_size": original_size,
        "compressed_size": len(result),
        "images_optimized": images_optimized,
    }
