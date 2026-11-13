"""Build a self-contained Pages artifact using only Python's standard library."""
import argparse
import json
import shutil
from pathlib import Path

from build_catalog import ROOT, main as build_catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='_site')
    args = parser.parse_args()
    output = Path(args.output).resolve()
    # A build must never overwrite source documents, dependencies or repository metadata.
    reserved = [ROOT / name for name in ('RM', 'DS', 'vendor', 'tools', '.github', '.git', '.agents', '.codex')]
    if not output.is_relative_to(ROOT) or output == ROOT or any(output == path or output.is_relative_to(path) for path in reserved):
        parser.error('Output must be a separate build directory inside the project, such as _site.')
    if output.exists() and any(output.iterdir()):
        parser.error(f'Output is not empty: {output}. Choose a new directory or remove the previous build yourself.')

    build_catalog()
    catalog = (ROOT / 'documents.js').read_text(encoding='utf-8')
    documents = json.loads(catalog.split('window.DOCUMENTS = ', 1)[1].rstrip().removesuffix(';'))
    output.mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'styles.css', 'app.js', 'reader.js', 'documents.js'):
        shutil.copy2(ROOT / name, output / name)
    for folder in ('DS', 'RM', 'vendor'):
        shutil.copytree(ROOT / folder, output / folder)
    (output / '.nojekyll').write_text('', encoding='utf-8')
    for doc in documents:
        path = output / doc['type'] / doc['filename']
        if not path.is_file() or path.stat().st_size != doc['bytes']:
            raise SystemExit(f'Missing or incorrect PDF: {path}')
    files = list(path for path in output.rglob('*') if path.is_file())
    oversized = [path.name for path in files if path.stat().st_size >= 100 * 1024 * 1024]
    if oversized:
        raise SystemExit(f'Files exceed the regular Git upload limit: {oversized}')
    total = sum(path.stat().st_size for path in files)
    if total > 1024 ** 3:
        raise SystemExit('Site exceeds the GitHub Pages 1 GiB published-site limit.')
    print(f'Pages artifact: {output}')
    print(f'{len(documents)} PDFs, {len(files)} files, {total / 1024**2:.1f} MiB. No backend or build dependencies required.')


if __name__ == '__main__':
    main()
