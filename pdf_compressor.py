"""
PDF compressor that shrinks file size WITHOUT altering page layout.

PyMuPDF draws every raster image through a fixed transformation matrix, so the
displayed position and size are independent of the image's pixel dimensions.
Reducing the pixel data / recompressing therefore does NOT move or resize
anything on the page. On top of image downsampling we also run garbage
collection + stream deflate + optional font subsetting to reclaim overhead.

Skipped (left byte-for-byte to avoid quality regressions):
  - images with an SMask (transparency)
  - 1-bit, palette ('P') and CMYK images
  - small images (< 20 KB) where recompression cannot win
"""

import io

import pymupdf as fitz  # PyMuPDF

try:
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    _HAS_PIL = True
except Exception:  # pragma: no cover
    _HAS_PIL = False

MIN_IMAGE_BYTES = 20 * 1024


def _collect_image_xrefs(doc):
    """Return list of unique image xrefs (order of first appearance) and a
    map xref -> a page index that references it."""
    xrefs = []
    seen = set()
    xref_page = {}
    for pno in range(doc.page_count):
        try:
            imgs = doc.get_page_images(pno, full=True)
        except Exception:
            imgs = []
        for im in imgs:
            x = im[0]
            if x not in seen:
                seen.add(x)
                xrefs.append(x)
                xref_page[x] = pno
    return xrefs, xref_page


def _has_smask(doc, xref):
    kind, val = doc.xref_get_key(xref, "SMask")
    if kind == "null":
        return False
    # kind == 'xref' with something like '12 0 R' and not '0 R'
    if val is None:
        return False
    return val.split(" ")[0] != "0"
def _recompress_image(img_bytes, max_dim, jpeg_quality):
    """Return new bytes that are smaller than img_bytes, or None if not worth it."""
    if not _HAS_PIL or len(img_bytes) < MIN_IMAGE_BYTES:
        return None
    try:
        im = Image.open(io.BytesIO(img_bytes))
        im.load()
    except Exception:
        return None

    mode = im.mode
    if mode in ("1", "P", "CMYK"):
        return None  # keep crisp 1-bit / palette / separation colours as-is
    if mode not in ("RGB", "L", "RGBA", "LA"):
        try:
            im = im.convert("RGB")
            mode = im.mode
        except Exception:
            return None

    has_alpha = mode in ("RGBA", "LA") or ("transparency" in im.info)

    w, h = im.size
    if max_dim and max(w, h) > max_dim:
        s = max_dim / float(max(w, h))
        nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
        try:
            im = im.resize((nw, nh), Image.LANCZOS)
        except Exception:
            im = im.resize((nw, nh))

    out = io.BytesIO()
    try:
        if has_alpha:
            im.save(out, "PNG", optimize=True)
        else:
            rgb = im if mode in ("RGB", "L") else im.convert("RGB")
            rgb.save(out, "JPEG", quality=int(jpeg_quality), optimize=True, progressive=True)
    except Exception:
        return None

    data = out.getvalue()
    if data and len(data) < len(img_bytes):
        return data
    return None


def compress_pdf_bytes(data, max_dim=1500, jpeg_quality=78, optimize=True, subset_fonts=False):
    """
    Compress a PDF given as bytes. Layout is preserved (images keep their
    placed rectangle). Falls back to the original bytes if nothing was gained.
    Returns dict: {bytes, original_size, compressed_size, images_optimized}
    """
    original_size = len(data)
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise ValueError("File bukan PDF yang valid.")

    if doc.needs_pass:
        doc.close()
        raise ValueError("PDF terkunci kata sandi — buka kuncinya terlebih dahulu.")

    images_optimized = 0
    try:
        xrefs, xref_page = _collect_image_xrefs(doc)
        if _HAS_PIL:
            for xref in xrefs:
                try:
                    if _has_smask(doc, xref):
                        continue
                    ex = doc.extract_image(xref)
                except Exception:
                    continue
                nb = _recompress_image(ex.get("image"), max_dim, jpeg_quality)
                if not nb:
                    continue
                try:
                    doc[xref_page[xref]].replace_image(xref, stream=nb)
                    images_optimized += 1
                except Exception:
                    pass

        if subset_fonts:
            try:
                doc.subset_fonts()
            except Exception:
                pass

        saved = doc.tobytes(garbage=4, deflate=True, deflate_images=True, clean=bool(optimize))
    finally:
        doc.close()

    if len(saved) >= original_size:
        return {
            "bytes": data,
            "original_size": original_size,
            "compressed_size": original_size,
            "images_optimized": 0,
        }
    return {
        "bytes": saved,
        "original_size": original_size,
        "compressed_size": len(saved),
        "images_optimized": images_optimized,
    }
