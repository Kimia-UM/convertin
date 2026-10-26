"""Package the deployable application without local documents or test data."""

from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parent
FILES = (
    'app.py', 'docx_compressor.py', 'pdf_compressor.py', 'pdf_splitter.py',
    'libreoffice.py', 'gform_builder.py', 'pdf_to_md.py',
    'requirements.txt', 'requirements-production.txt', 'gunicorn.conf.py',
    'Dockerfile', 'render.yaml', '.dockerignore', '.gitignore', '.gitattributes',
    'README.md', 'PUBLISH.md', 'prepare_publish.py',
)
DIRECTORIES = ('templates', 'static')


def create_publish_archive():
    files = [ROOT / name for name in FILES]
    for directory in DIRECTORIES:
        files.extend(path for path in (ROOT / directory).rglob('*') if path.is_file())
    missing = [path.name for path in files if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Deployment files missing: {', '.join(missing)}")
    target = ROOT / 'output' / 'publish' / 'docforge-render.zip'
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.write(path, path.relative_to(ROOT).as_posix())
    return target


if __name__ == '__main__':
    print(create_publish_archive())
