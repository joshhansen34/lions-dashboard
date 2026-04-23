#!/usr/bin/env python3
"""
Shakopee Lions Club - Dashboard Server
Serves local HTML files AND proxies /v2/ requests to Neon CRM API.
Also caches member data server-side so every browser gets a fast load.
Run: python3 serve.py
Open: http://localhost:8765/lions-dashboard.html
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
from concurrent.futures import ThreadPoolExecutor
import urllib.request
import urllib.error
import threading
import json
import time
import sys
import os
import base64

# ── Credentials ───────────────────────────────────────────────────────────────

try:
    import config as _config
    NEON_ORG_ID = getattr(_config, 'NEON_ORG_ID', None)
    NEON_API_KEY = getattr(_config, 'NEON_API_KEY', None)
    USERS = getattr(_config, 'USERS', {})
except ImportError:
    NEON_ORG_ID = None
    NEON_API_KEY = None
    USERS = {}

NEON_ORG_ID  = os.environ.get("NEON_ORG_ID",  NEON_ORG_ID)
NEON_API_KEY = os.environ.get("NEON_API_KEY", NEON_API_KEY)

for i in range(1, 10):
    pair = os.environ.get(f"APP_USER_{i}", "").strip()
    if pair and ":" in pair:
        u, p = pair.split(":", 1)
        u = u.strip().lstrip("=")
        if u:
            USERS[u] = p.strip()

if not NEON_ORG_ID or not NEON_API_KEY:
    print("\n  ERROR: NEON_ORG_ID and NEON_API_KEY must be set.\n")
    sys.exit(1)

if not USERS:
    user_vars = {k: v for k, v in os.environ.items() if 'USER' in k or 'APP' in k}
    print(f"\n  DEBUG env vars: {user_vars}")
    print("\n  ERROR: No users configured. Set APP_USER_1=username:password.\n")
    sys.exit(1)

NEON_BASE  = "https://api.neoncrm.com"
NEON_AUTH  = base64.b64encode(f"{NEON_ORG_ID}:{NEON_API_KEY}".encode()).decode()
PORT       = int(os.environ.get("PORT", 8765))
SERVE_DIR  = os.path.dirname(os.path.abspath(__file__))

MIME_TYPES = {
    '.html':  'text/html',
    '.css':   'text/css',
    '.js':    'application/javascript',
    '.mjs':   'application/javascript',
    '.json':  'application/json',
    '.ico':   'image/x-icon',
    '.png':   'image/png',
    '.svg':   'image/svg+xml',
    '.woff':  'font/woff',
    '.woff2': 'font/woff2',
    '.ttf':   'font/ttf',
}

# ── Field Options Cache ────────────────────────────────────────────────────────
# Maps field_id (str) -> {option_name (str) -> option_id (int)}
# Populated at startup from GET /v2/customFields and augmented as members load.
_field_options = {}
_field_options_lock = threading.Lock()

def _parse_fields_response(data):
    """Extract {field_id: {option_name: option_id}} from any Neon customFields response shape."""
    fields = []
    if isinstance(data, dict):
        for key in ('customFields', 'data', 'results', 'items'):
            if key in data:
                fields = data[key]; break
        if not fields:
            # Single field response
            if data.get('id') and (data.get('listOfValues') or data.get('optionValues')):
                fields = [data]
    elif isinstance(data, list):
        fields = data
    result = {}
    for f in fields:
        fid = str(f.get('id', ''))
        if not fid:
            continue
        opts = f.get('listOfValues') or f.get('optionValues') or []
        if opts:
            result[fid] = {str(o.get('name', '')): int(o['id']) for o in opts if o.get('id') is not None}
    return result

def fetch_field_options():
    """Fetch custom field definitions from Neon to get option IDs."""
    result = {}
    # Try list endpoint with various param combinations
    for path in ['/v2/customFields', '/v2/customFields?currentPage=0&pageSize=200',
                 '/v2/customFields?category=Account&currentPage=0&pageSize=200']:
        data = neon_get(path)
        print(f"  [fields] GET {path} -> {type(data).__name__}: {str(data)[:300]}")
        if data:
            result.update(_parse_fields_response(data))
            if result:
                break
    # Also try fetching our specific fields individually as fallback
    for fid in ['138', '139', '140', '141']:
        if fid not in result:
            data = neon_get(f'/v2/customFields/{fid}')
            print(f"  [fields] GET /v2/customFields/{fid} -> {str(data)[:300]}")
            if data:
                result.update(_parse_fields_response(data))
    with _field_options_lock:
        _field_options.update(result)
    print(f"  [fields] Final options: {result}")
    return result

def record_option_ids(cfs):
    """Capture option IDs seen in a live account response."""
    updates = {}
    for cf in (cfs or []):
        fid = str(cf.get('id', ''))
        for opt in (cf.get('optionValues') or []):
            if opt.get('id') is not None and opt.get('name'):
                updates.setdefault(fid, {})[str(opt['name'])] = int(opt['id'])
    if updates:
        with _field_options_lock:
            for fid, opts in updates.items():
                _field_options.setdefault(fid, {}).update(opts)

def get_field_options():
    with _field_options_lock:
        return dict(_field_options)

# ── Member Cache ───────────────────────────────────────────────────────────────

CACHE_TTL = 12 * 60 * 60  # 12 hours

CUSTOM_FIELD_IDS = {
    '138': 'hardship',
    '139': 'cash',
    '140': 'exitStatus',
    '141': 'exitDate',
    '81':  'joinDate',
    '82':  'partner',
    '84':  'lionsNumber',
    '86':  'sponsor',
}

_cache = {'members': None, 'loaded_at': None, 'loading': False, 'error': None}
_cache_lock = threading.Lock()
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'members_cache.json')


def save_cache_to_disk(members, loaded_at):
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump({'members': members, 'loaded_at': loaded_at}, f)
        print(f"  [cache] Saved {len(members)} members to disk")
    except Exception as e:
        print(f"  [cache] Failed to save to disk: {e}")


def load_cache_from_disk():
    try:
        if not os.path.exists(CACHE_FILE):
            return None, None
        with open(CACHE_FILE) as f:
            data = json.load(f)
        return data.get('members'), data.get('loaded_at')
    except Exception as e:
        print(f"  [cache] Failed to load from disk: {e}")
        return None, None


def neon_get(path):
    url = NEON_BASE + path
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Basic {NEON_AUTH}")
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  [neon] HTTP {e.code} {path}")
        return None
    except Exception as e:
        print(f"  [neon] Error {path}: {e}")
        return None


def fetch_account_ids():
    ids = []
    page, total = 0, 1
    while page < total:
        data = neon_get(f"/v2/accounts?userType=INDIVIDUAL&pageSize=200&currentPage={page}")
        if not data:
            break
        total = int((data.get('pagination') or {}).get('totalPages', 1))
        for a in data.get('accounts') or []:
            ids.append(str(a['accountId']))
        page += 1
    return ids


def fetch_one_account(aid):
    return neon_get(f"/v2/accounts/{aid}")


def fetch_one_memberships(aid):
    data = neon_get(f"/v2/accounts/{aid}/memberships")
    return (data or {}).get('memberships') or []


def parse_custom_fields(cfs):
    result = {}
    for cf in (cfs or []):
        key = CUSTOM_FIELD_IDS.get(str(cf.get('id', '')))
        if not key:
            continue
        val = cf.get('value') or ''
        if not val:
            opts = cf.get('optionValues') or []
            val = opts[0].get('name', '') if opts else ''
        result[key] = val or ''
    record_option_ids(cfs)  # capture any option IDs we see
    return result


def build_raw_member(data):
    acct = data.get('individualAccount') or data
    contact = acct.get('primaryContact') or {}

    first = (contact.get('firstName') or acct.get('firstName') or '').strip()
    last  = (contact.get('lastName')  or acct.get('lastName')  or '').strip()
    email = (contact.get('email1')    or acct.get('email')     or '').strip().lower()

    addresses = contact.get('addresses') or []
    addr = next((a for a in addresses if a.get('isPrimary')), addresses[0] if addresses else {})
    state_val = addr.get('stateProvince') or ''
    if isinstance(state_val, dict):
        state_val = state_val.get('code', '')

    phones = contact.get('phones') or []
    phone_obj = next((p for p in phones if p.get('isPrimary')), phones[0] if phones else {})

    cf = parse_custom_fields(acct.get('accountCustomFields') or [])
    mem_status = (acct.get('accountCurrentMembershipStatus') or '').lower()

    return {
        'id':           str(acct.get('accountId', '')),
        'firstName':    first,
        'lastName':     last,
        'email':        email,
        'phone':        phone_obj.get('phoneNumber', '') or '',
        'addressLine1': addr.get('addressLine1', '') or '',
        'addressLine2': addr.get('addressLine2', '') or '',
        'city':         addr.get('city', '') or '',
        'state':        state_val,
        'zip':          addr.get('zipCode', '') or '',
        'membershipStatus': 'current' if mem_status == 'active' else ('expired' if mem_status == 'lapsed' else ''),
        'membershipType':   '',
        'membershipExpiry': '',
        'hardship':     cf.get('hardship', '') == 'Yes',
        'cash':         cf.get('cash', '') == 'Yes',
        'exitStatus':   cf.get('exitStatus', ''),
        'exitDate':     cf.get('exitDate', ''),
        'joinDate':     cf.get('joinDate', ''),
        'partner':      cf.get('partner', ''),
        'lionsNumber':  cf.get('lionsNumber', ''),
        'sponsor':      cf.get('sponsor', ''),
        'autoRenewal':  False,  # populated after membership fetch
        'loaded':       True,
        '_status':      mem_status,
        '_active':      mem_status == 'active',
    }


def do_load_members():
    try:
        print("  [cache] Starting member load from Neon...")
        t0 = time.time()

        # Step 1: All account IDs
        all_ids = fetch_account_ids()
        print(f"  [cache] {len(all_ids)} account IDs ({time.time()-t0:.0f}s)")

        # Step 2: Fetch all accounts in batches of 10
        raw_accounts = []
        for i in range(0, len(all_ids), 10):
            batch = all_ids[i:i+10]
            with ThreadPoolExecutor(max_workers=10) as ex:
                results = list(ex.map(fetch_one_account, batch))
            raw_accounts.extend(r for r in results if r)
            time.sleep(0.15)
        print(f"  [cache] {len(raw_accounts)} accounts fetched ({time.time()-t0:.0f}s)")

        # Step 3: Parse, filter to members, deduplicate
        raw_members = []
        seen = {}
        for data in raw_accounts:
            m = build_raw_member(data)
            if not m['_status']:
                continue
            key = f"{m['firstName'].lower()}|{m['lastName'].lower()}|{m['email']}"
            if key not in seen:
                seen[key] = len(raw_members)
                raw_members.append(m)
            elif m['_active'] and not raw_members[seen[key]]['_active']:
                raw_members[seen[key]] = m
        print(f"  [cache] {len(raw_members)} members after filter/dedup ({time.time()-t0:.0f}s)")

        # Step 4: Fetch memberships, finalize
        confirmed = []
        for i in range(0, len(raw_members), 10):
            batch = raw_members[i:i+10]
            aids = [m['id'] for m in batch]
            with ThreadPoolExecutor(max_workers=10) as ex:
                memberships_list = list(ex.map(fetch_one_memberships, aids))
            for j, mems in enumerate(memberships_list):
                if not mems:
                    continue
                active = next((m for m in mems if m.get('isActive') and m.get('primaryActiveMembership')), None)
                if not active:
                    active = next((m for m in mems if m.get('isActive')), None)
                latest = sorted(mems, key=lambda m: m.get('termEndDate') or '', reverse=True)[0]
                target = active or latest
                batch[j]['membershipType']   = (target.get('membershipLevel') or {}).get('name', '') or ''
                batch[j]['membershipExpiry'] = target.get('termEndDate', '') or ''
                batch[j]['membershipStatus'] = 'current' if active else 'expired'
                batch[j]['autoRenewal']      = bool((active or target).get('autoRenewal', False))
                del batch[j]['_status']
                del batch[j]['_active']
                confirmed.append(batch[j])
            time.sleep(0.15)

        confirmed.sort(key=lambda m: (m['lastName'] + m['firstName']).lower())
        print(f"  [cache] Done. {len(confirmed)} members in {time.time()-t0:.0f}s")

        loaded_at = time.time()
        with _cache_lock:
            _cache['members']   = confirmed
            _cache['loaded_at'] = loaded_at
            _cache['loading']   = False
            _cache['error']     = None
        save_cache_to_disk(confirmed, loaded_at)

    except Exception as e:
        import traceback
        traceback.print_exc()
        with _cache_lock:
            _cache['loading'] = False
            _cache['error']   = str(e)


def get_cache_state():
    with _cache_lock:
        now = time.time()
        loaded_at = _cache['loaded_at']
        valid = loaded_at and (now - loaded_at) < CACHE_TTL and _cache['members'] is not None
        if valid:
            return 'ready', _cache['members'], loaded_at
        # Try disk cache before hitting Neon
        if _cache['members'] is None and not _cache['loading']:
            members, disk_loaded_at = load_cache_from_disk()
            if members and disk_loaded_at and (now - disk_loaded_at) < CACHE_TTL:
                print("  [cache] Loaded from disk cache")
                _cache['members']   = members
                _cache['loaded_at'] = disk_loaded_at
                return 'ready', members, disk_loaded_at
        if not _cache['loading']:
            _cache['loading'] = True
            threading.Thread(target=do_load_members, daemon=True).start()
        return 'loading', None, None


def invalidate_cache():
    with _cache_lock:
        _cache['members']   = None
        _cache['loaded_at'] = None
        _cache['error']     = None
        _cache['loading']   = False
    try:
        if os.path.exists(CACHE_FILE):
            os.remove(CACHE_FILE)
            print("  [cache] Disk cache cleared")
    except Exception as e:
        print(f"  [cache] Failed to clear disk cache: {e}")


# ── HTTP Handler ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"  {args[0]} {args[1]}")

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")

    def check_auth(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Basic "):
            self._demand_auth()
            return False
        try:
            decoded = base64.b64decode(auth[6:]).decode("utf-8")
            username, password = decoded.split(":", 1)
        except Exception:
            self._demand_auth()
            return False
        if USERS.get(username) == password:
            return True
        self._demand_auth()
        return False

    def _demand_auth(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Shakopee Lions Club"')
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Login required")

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        # checkin.shakopeelions.com → redirect to /attendance/
        host = self.headers.get('Host', '')
        if host.startswith('checkin.') and self.path == '/':
            self.send_response(302)
            self.send_header('Location', '/attendance/')
            self.end_headers()
            return

        # Attendance app — no auth required (static files + limited member data only)
        if self.path == '/attendance/members':
            self.handle_attendance_members()
            return
        if self.path in ('/attendance', '/attendance/') or self.path.startswith('/attendance/'):
            self.serve_file()
            return
        if not self.check_auth():
            return
        if self.path == '/members' or self.path.startswith('/members?'):
            self.handle_members_get()
            return
        if self.path == '/field-options':
            opts = get_field_options()
            if not opts:
                opts = fetch_field_options()
            self.send_json(opts)
            return
        if self.path.startswith('/debug/account/'):
            aid = self.path.split('/')[-1]
            raw = {
                'account':     neon_get(f'/v2/accounts/{aid}'),
                'memberships': neon_get(f'/v2/accounts/{aid}/memberships'),
            }
            self.send_json(raw)
            return
        if self.path == '/debug/customfields':
            raw = {}
            for path in ['/v2/customFields', '/v2/customFields?currentPage=0&pageSize=200']:
                raw[path] = neon_get(path)
            for fid in ['138', '139', '140', '141']:
                raw[f'/v2/customFields/{fid}'] = neon_get(f'/v2/customFields/{fid}')
            raw['_parsed_options'] = get_field_options()
            self.send_json(raw)
            return
        if self.path.startswith('/v2/'):
            self.proxy_request("GET", None)
            return
        self.serve_file()

    def do_POST(self):
        if not self.check_auth():
            return
        if self.path == '/members/refresh':
            invalidate_cache()
            get_cache_state()  # triggers reload
            self.send_json({'status': 'loading'})
            return
        if self.path.startswith('/v2/'):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else None
            self.proxy_request("POST", body)

    def do_PATCH(self):
        if not self.check_auth():
            return
        if self.path.startswith('/v2/'):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else None
            self.proxy_request("PATCH", body)

    def handle_attendance_members(self):
        status, members, loaded_at = get_cache_state()
        if status == 'loading':
            self.send_json({'status': 'loading'})
            return
        slim = []
        for m in members:
            if m.get('exitStatus'):
                continue
            slim.append({
                'id':               m['id'],
                'firstName':        m['firstName'],
                'lastName':         m['lastName'],
                'cash':             m.get('cash', False),
                'membershipStatus': m.get('membershipStatus', ''),
            })
        self.send_json({'status': 'ready', 'members': slim, 'count': len(slim)})

    def handle_members_get(self):
        status, members, loaded_at = get_cache_state()
        if status == 'loading':
            self.send_json({'status': 'loading'})
        else:
            self.send_json({
                'status': 'ready',
                'members': members,
                'loadedAt': loaded_at,
                'count': len(members),
            })

    def serve_file(self):
        path = self.path.split('?')[0]
        if path == '/':
            path = '/lions-dashboard.html'
        # Route attendance app to its built dist folder
        if path in ('/attendance', '/attendance/'):
            path = '/attendance/dist/index.html'
        elif path.startswith('/attendance/'):
            path = '/attendance/dist/' + path[len('/attendance/'):]
        filepath = os.path.join(SERVE_DIR, path.lstrip('/'))
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')
            return
        ext  = os.path.splitext(filepath)[1]
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
        print(f"\n  -> {method} {self.path}")
        req = urllib.request.Request(target, data=body, method=method)
        req.add_header("Authorization", f"Basic {NEON_AUTH}")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                data = resp.read()
                print(f"  OK {resp.status}")
                if method in ('PATCH', 'POST', 'PUT'):
                    print(f"  Body sent: {body.decode('utf-8','replace') if body else '(none)'}")
                    print(f"  Response: {data.decode('utf-8','replace')[:500]}")
                self.send_response(resp.status)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            print(f"  ERROR {e.code}: {data.decode('utf-8','replace')[:500]}")
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
    print(f"  Open http://localhost:{PORT}/lions-dashboard.html")
    print(f"  Users: {', '.join(USERS.keys())}")
    print("  Press Ctrl+C to stop")
    print()
    # Warm the cache and fetch field option IDs on startup
    threading.Thread(target=fetch_field_options, daemon=True).start()
    get_cache_state()
    try:
        HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        sys.exit(0)
