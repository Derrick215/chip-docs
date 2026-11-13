"""Static preview server with byte ranges for PDF.js. No business backend."""
import argparse
import functools
import os
import re
import socket
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class StaticHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".bcmap": "application/octet-stream"}

    def send_head(self):
        self.byte_range = None
        path = Path(self.translate_path(self.path))
        # Match common static-host behavior: honor Range only for GET.
        if self.command != "GET" or not path.is_file() or "Range" not in self.headers:
            return super().send_head()
        header = self.headers["Range"]
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
        # Unknown or multipart ranges can legally fall back to a full response.
        if not match or not any(match.groups()):
            return super().send_head()
        try:
            file = path.open("rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        stat = os.fstat(file.fileno())
        length = stat.st_size
        start = int(match[1]) if match[1] else max(0, length - int(match[2]))
        end = min(int(match[2]), length - 1) if match[1] and match[2] else length - 1
        if start >= length or start > end:
            file.close()
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{length}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{length}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        file.seek(start)
        self.byte_range = end - start + 1
        return file

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def copyfile(self, source, outputfile):
        if self.byte_range is None:
            return super().copyfile(source, outputfile)
        remaining = self.byte_range
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def do_GET(self):
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Reader cancellation is expected during page changes.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    handler = functools.partial(StaticHandler, directory=str(ROOT))
    try:
        server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    except OSError as error:
        raise SystemExit(f"Cannot start preview on port {args.port}: {error}\nTry: python tools/preview.py --port 8001")
    print(f"\nComputer: http://localhost:{args.port}", flush=True)
    addresses = sorted({item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET) if not item[4][0].startswith("127.")})
    for address in addresses:
        print(f"Phone (same Wi-Fi): http://{address}:{args.port}", flush=True)
    print("\nKeep this window open. Ctrl+C to stop.\n", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
