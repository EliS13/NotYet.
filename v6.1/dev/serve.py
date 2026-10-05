# serve.py: serves the extension folder for design previews, slipping the
# fake chrome API into every page's <head>. Not shipped.
import http.server, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = b'<script src="/dev/mock-chrome.js"></script>'

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        path = self.translate_path(self.path.split('?')[0].split('#')[0])
        if path.endswith('.html') and os.path.isfile(path):
            with open(path, 'rb') as f:
                body = f.read().replace(b'<head>', b'<head>' + TAG, 1)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def log_message(self, *a):
        pass

class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128          # the default of 5 drops a browser's burst of script requests
    daemon_threads = True

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
Server(('127.0.0.1', port), Handler).serve_forever()
