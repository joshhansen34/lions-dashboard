# Shakopee Lions Club — Project Context

Use this file to orient Claude (or any AI assistant) to the full state of this project.

---

## What Was Built

Two web apps hosted together on a single Railway deployment, serving the Shakopee Lions Club:

1. **Member Dashboard** — officer/treasurer tool for viewing the full membership roster, managing member flags, and printing billing statements for overdue cash/check members.
2. **Check-In App** — iPad app used at the door of board and general meetings. Members tap their name to check in.

Both apps share the same server and the same Neon CRM member data.

---

## Who Built What

- **Dashboard** — built by Josh Hansen (admin/developer)
- **Check-In App** — originally built by John Muir (Lions member), later integrated into the shared Railway deployment and connected to live Neon CRM data by Josh Hansen

---

## Live URLs

| What | URL |
|---|---|
| Member Dashboard | https://dashboard.shakopeelions.com |
| Check-In App | https://checkin.shakopeelions.com |
| Technical Reference | https://dashboard.shakopeelions.com/docs/technical-reference.html |
| User Guide | https://dashboard.shakopeelions.com/docs/user-guide.html |
| Raw Railway URL | https://lions-dashboard-production.up.railway.app |

- Dashboard and docs require HTTP Basic Auth (shared credentials for officers)
- Check-in app has no authentication

---

## Repository

GitHub: `joshhansen34/lions-dashboard`
Local: `~/Documents/LionsClub/dashboard/`

---

## File Structure

```
dashboard/
├── lions-dashboard.html       # Dashboard — single-file HTML/CSS/JS app
├── serve.py                   # Python HTTP server — serves both apps, proxies Neon CRM API
├── config.py                  # DASHBOARD_USER, DASHBOARD_PASS, NEON_API_KEY (not in git)
├── config.py.example          # Template for config.py
├── Procfile                   # Railway start command: python serve.py
├── railway.json               # Railway config
├── requirements.txt           # Python dependencies (none beyond stdlib)
├── members_cache.json         # Disk cache of Neon CRM data (auto-generated, gitignored)
├── billing-mockup.html        # Design mockup for billing statements (reference only)
├── docs/
│   ├── technical-reference.html   # Full technical documentation
│   └── user-guide.html            # Non-technical user guide for members/officers
└── attendance/                # Check-in app (React/Vite)
    ├── src/App.jsx            # Main app component
    ├── vite.config.js         # base: '/attendance/', dev proxy for /attendance/members
    └── dist/                  # Built static files — committed to repo (no build on Railway)
```

---

## Architecture

```
Browser/iPad
    │
    ├── dashboard.shakopeelions.com  ──┐
    └── checkin.shakopeelions.com   ──┤
                                       ▼
                              GoDaddy DNS (CNAME)
                                       │
                                       ▼
                              Railway (single service)
                              serve.py on port 8765
                                       │
                     ┌─────────────────┼─────────────────┐
                     ▼                 ▼                   ▼
              lions-dashboard.html  /attendance/dist/   /v2/* proxy
              (dashboard app)       (check-in app)           │
                                                             ▼
                                                       Neon CRM API
                                                  api.neoncrm.com/v2
```

**Host header routing in serve.py:**
- `checkin.*` → redirects to `/attendance/`
- All other hosts → dashboard

---

## serve.py — Key Behaviors

- Serves `lions-dashboard.html` at `/`
- Serves `attendance/dist/` at `/attendance/`
- Proxies `/v2/*` requests to `https://api.neoncrm.com/v2` (injects Neon API key)
- `/attendance/` and `/attendance/members` — **no auth required**
- All other routes — HTTP Basic Auth required
- `/attendance/members` — returns slim member list for check-in app (filtered, no sensitive fields)
- `/members/refresh` (POST) — invalidates server cache, triggers fresh Neon CRM pull

**Server-side member cache:**
- In-memory + disk (`members_cache.json`)
- TTL: 12 hours
- Disk cache survives process restarts within same Railway deployment
- Wiped on new deployments (Railway ephemeral filesystem)
- First load after wipe: ~2–3 minutes (fetches all ~615 accounts from Neon CRM individually)

---

## Neon CRM Connection

- **Org ID:** `shakopeelionsclub`
- **API Base:** `https://api.neoncrm.com/v2`
- **Auth:** HTTP Basic (`shakopeelionsclub` / API key)
- **API Key:** stored in `config.py` as `NEON_API_KEY`; also stored in browser `localStorage` as `lc_key` for direct calls from dashboard JS

**Member load strategy:**
1. Fetch all account IDs (`GET /v2/accounts`, paginated 200/page)
2. Fetch each account individually in batches of 10 concurrent requests
3. Filter to accounts where `accountCurrentMembershipStatus` is non-empty
4. Deduplicate by firstName+lastName+email
5. Fetch memberships (`GET /v2/accounts/{id}/memberships`) for type + expiry

---

## Neon CRM Custom Fields

| Field Name | Neon Field ID | Type | Values |
|---|---|---|---|
| Pays Cash/Check | 14 | Checkbox | "Yes" |
| Hardship Waiver | 15 | Checkbox | "Yes" |
| Exit Status | 16 | Dropdown | "Deceased", "Resigned" |
| Exit Date | 17 | Text | Date string |

Field IDs are discovered dynamically at load via `GET /v2/customFields?category=Account`.

---

## Membership Types & Dues Rates

| Type | Rate |
|---|---|
| Standard Member | $151 / 6 months |
| At Large | $55 / 6 months |
| Standard Member - No Meals | $55 / 6 months |
| Honorary / Life | $0 |

---

## Dashboard Features

- Full member roster with search and filter (by status, type)
- Read/write: flags (Cash/Check, Hardship, Exit Status) saved back to Neon CRM via PATCH
- Billing statement printing: one click generates print-ready letters for all overdue Cash/Check members
  - Format: letter-size, #8 double-window envelope layout
  - One statement per printed page (no blank pages between)
  - Treasurer address: Joe Witt, 14160 Autumn Trail, Shakopee, MN 55379

---

## Check-In App Display Rules

At check-in, these rules are enforced on member data:

- **Hardship Waiver** — hidden (never shown at check-in)
- **Exit Status members** — excluded from the list entirely
- **Overdue dues** — shows overdue badge, but NO dollar amount or cycle count
- **Cash/Check flag** — shown (so check-in staff can identify cash payers)

---

## DNS Records (GoDaddy)

| Type | Name | Value |
|---|---|---|
| CNAME | dashboard | x4ftx3m3.up.railway.app |
| TXT | _railway-verify.dashboard | railway-verify=42d8bdb1... |
| CNAME | checkin | 8cbpnat3.up.railway.app |
| TXT | _railway-verify.checkin | railway-verify=7a5564ae... |

TTL: 1/2 hour (default GoDaddy)

---

## Environment Variables (Railway)

| Variable | Purpose |
|---|---|
| `DASHBOARD_USER` | HTTP Basic Auth username for dashboard |
| `DASHBOARD_PASS` | HTTP Basic Auth password for dashboard |
| `NEON_API_KEY` | Neon CRM API key |

Set in Railway → Service → Variables. Also mirrored in local `config.py` (not committed to git).

---

## Club Context

- ~120 active members
- Dues billed every 6 months
- Some members on hardship waiver (pay $0)
- Some pay treasurer directly by cash/check (Joe Witt handles manually)
- Members who leave are marked via Exit Status field (Deceased or Resigned)
- Josh Hansen is the developer and system admin
- John Muir built the original check-in app
