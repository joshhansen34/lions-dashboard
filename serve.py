#!/usr/bin/env python3
"""
Shakopee Lions Club - Dashboard Server
Serves local HTML files AND proxies /v2/ requests to Neon CRM API.
Run: python3 serve.py
Open: http://localhost:8765/lions-dashboard.html
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error
import json
import sys
import os

NEON_BASE = "https://api.neoncrm.com"
PORT = 8765
SERVE_DIR = os.path.dirname(os.path.abspath(__file__))

MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
}

class Handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"  {args[0]} {args[1]}")

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        # Proxy Neon API calls
        if self.path.startswith('/v2/'):
            self.proxy_request("GET", None)
            return
        # Serve local files
        self.serve_file()

    def do_PATCH(self):
        if self.path.startswith('/v2/'):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else None
            self.proxy_request("PATCH", body)

    def do_POST(self):
        if self.path.startswith('/v2/'):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else None
            self.proxy_request("POST", body)

    def serve_file(self):
        # Strip query string
        path = self.path.split('?')[0]
        if path == '/':
            path = '/lions-dashboard.html'

        filepath = os.path.join(SERVE_DIR, path.lstrip('/'))

        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')
            return

        ext = os.path.splitext(filepath)[1]
        mime = MIME_TYPES.get(ext, 'text/plain')

        with open(filepath, 'rb') as f:
            data = f.read()

        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', len(data))
        self.end_headers()
        self.wfile.write(data)

    def proxy_request(self, method, body):
        target = NEON_BASE + self.path
        auth = self.headers.get("Authorization", "")
        print(f"\n  -> {method} {self.path}")

        req = urllib.request.Request(target, data=body, method=method)
        req.add_header("Authorization", auth)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")

        try:
            with urllib.request.urlopen(req) as resp:
                data = resp.read()
                print(f"  OK {resp.status}")
                self.send_response(resp.status)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            print(f"  ERROR {e.code}: {data.decode('utf-8','replace')[:200]}")
            self.send_response(e.code)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            print(f"  EXCEPTION: {e}")
            self.send_response(500)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

if __name__ == "__main__":
    print()
    print("  Shakopee Lions Club - Dashboard Server")
    print(f"  Open http://localhost:{PORT}/lions-dashboard.html in Safari")
    print(f"  Serving files from: {SERVE_DIR}")
    print("  Press Ctrl+C to stop")
    print()
    try:
        HTTPServer(("localhost", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        sys.exit(0)
