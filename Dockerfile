FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=10000

# LibreOffice is needed by Word -> PDF; fonts provide common document fallbacks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libreoffice-writer fonts-liberation fonts-dejavu-core libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 docforge

WORKDIR /app
COPY requirements.txt requirements-production.txt ./
RUN pip install --no-cache-dir -r requirements-production.txt

# Copy only application code, never local uploads, spreadsheets, or logs.
COPY --chown=docforge:docforge app.py docx_compressor.py pdf_compressor.py pdf_splitter.py libreoffice.py gform_builder.py gunicorn.conf.py ./
COPY --chown=docforge:docforge templates/ ./templates/
COPY --chown=docforge:docforge static/ ./static/

USER docforge
EXPOSE 10000
CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:app"]
