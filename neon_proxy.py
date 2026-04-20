#!/usr/bin/env python3
"""
Shakopee Lions Club — Neon CRM Proxy
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error
import json
import sys

NEON_BASE = "https://api.neoncrm.com"
PORT = 8765

class ProxyHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        self.proxy_request("GET", None)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        self.proxy_request("POST", body)

    def do_PATCH(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        self.proxy_request("PATCH", body)

    def proxy_request(self, method, body):
        target = NEON_BASE + self.path
        auth = self.headers.get("Authorization", "")

        print(f"\n  -> {method} {self.path}")
        print(f"  Auth present: {'Yes' if auth else 'NO - MISSING'}")
        if auth:
            print(f"  Auth value: {auth[:40]}...")

        req = urllib.request.Request(target, data=body, method=method)
        req.add_header("Authorization", auth)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")

        try:
            with urllib.request.urlopen(req) as resp:
                data = resp.read()
                print(f"  OK: {resp.status}")
                self.send_response(resp.status)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            decoded = data.decode('utf-8', errors='replace')
            print(f"  ERROR {e.code}: {decoded}")
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
    print("  Shakopee Lions Club - Neon CRM Proxy")
    print(f"  Running on http://localhost:{PORT}")
    print("  Open lions-dashboard.html in your browser")
    print("  Press Ctrl+C to stop")
    print()
    try:
        HTTPServer(("localhost", PORT), ProxyHandler).serve_forever()
    except KeyboardInterrupt:
        print("\n  Proxy stopped.")
        sys.exit(0)
