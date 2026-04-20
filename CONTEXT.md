# Shakopee Lions Club — Member Dashboard Context

## Project Overview
A member management dashboard for the Shakopee Lions Club built as a single HTML file served by a local Python proxy server. It connects to Neon CRM via their REST API.

## Files
- `lions-dashboard.html` — the dashboard UI (HTML/CSS/JS)
- `serve.py` — local Python server that serves the HTML file AND proxies all `/v2/` requests to Neon's API (`https://api.neoncrm.com`). This proxy is necessary because browsers block direct API calls from local files (CORS).
- `neon_debug.html` — debug tool for testing API endpoints directly

## How to Run
```
cd ~/Documents/LionsClub/dashboard
python3 serve.py
```
Then open `http://localhost:8765/lions-dashboard.html` in Safari.

## Neon CRM Connection
- **Org ID:** shakopeelionsclub
- **API Version:** v2
- **Auth:** HTTP Basic Auth (org ID as username, API key as password)
- **API Key:** stored in browser localStorage as `lc_key`
- **Base URL:** `https://api.neoncrm.com/v2`

## The Core Problem
Neon CRM has ~615 accounts (members, donors, event attendees, duplicates). We only want to show the ~120 actual club members. The challenge is that the list endpoint (`GET /v2/accounts`) returns minimal fields and does NOT include `accountCurrentMembershipStatus`. That field only appears on individual account detail calls (`GET /v2/accounts/{id}`).

## Current Load Strategy
1. Fetch all account IDs from the list endpoint (paginated, 200 per page)
2. Fetch each account individually in batches of 10 concurrent requests
3. Filter to only accounts where `accountCurrentMembershipStatus` is non-empty (Active or Lapsed)
4. Deduplicate by firstName+lastName+email, keeping the one with active membership
5. For each member, also fetch their memberships (`GET /v2/accounts/{id}/memberships`) to get type and expiry date

This is slow (~2-3 minutes) but works. It runs once per session.

## Neon API Response Structure

### List endpoint (`GET /v2/accounts?userType=INDIVIDUAL`)
Returns only: `accountId`, `firstName`, `lastName`, `companyName`, `email`, `userType`

### Individual account (`GET /v2/accounts/{id}`)
Returns full record including:
- `primaryContact.firstName`, `primaryContact.lastName`, `primaryContact.email1`
- `accountCurrentMembershipStatus` — "Active", "Lapsed", or empty (no membership ever)
- `accountCustomFields[]` — array of `{id, name, value, optionValues}`

### Memberships (`GET /v2/accounts/{id}/memberships`)
Returns array with:
- `membershipLevel.name` — e.g. "Standard Member", "At Large"
- `termEndDate` — expiry date
- `isActive` + `primaryActiveMembership` — true on the current active membership

## Custom Fields in Neon (Account level)
These were created today and are used to track info Neon doesn't natively support:

| Field Name | Type | Purpose |
|---|---|---|
| Hardship Waiver | Checkbox List (option: "Yes") | Member doesn't pay dues |
| Pays Cash/Check | Checkbox List (option: "Yes") | Treasurer handles payment manually |
| Exit Status | Dropdown ("Deceased", "Resigned") | Replaces last-name hacking |
| Exit Date | Text/Date | When they left |

Existing custom fields also in Neon:
- Join Date, Lions International Number, Membership Type, Partner/Spouse Name, Sponsor

## Custom Field IDs
The app dynamically discovers field IDs at load time by calling `GET /v2/customFields?category=Account` and matching by name. The new fields (Hardship Waiver, Pays Cash/Check, Exit Status, Exit Date) were NOT showing up in this endpoint during testing — this may be a bug or category mismatch that still needs investigation.

## Membership Types
- **Standard Member** — $151/6 months (covers international dues + meeting meals)
- **At Large** — $55/6 months (covers international dues only)
- **Standard Member - No Meals** — $55/6 months (active but doesn't eat at meetings)

## Known Issues / Next Steps
1. The 4 new custom fields don't appear in `GET /v2/customFields?category=Account` — need to investigate why and fix field ID discovery
2. Load time is slow due to individual account fetching — acceptable for now
3. Saving custom field values via PATCH hasn't been fully tested yet
4. New member intake workflow (paper → CRM → Constant Contact) is a future improvement

## Club Context
- ~120 active members
- Dues paid every 6 months
- Some members on hardship waiver (pay $0)
- Some old-timers pay treasurer directly by cash/check
- Members who leave are marked Deceased or Resigned (previously hacked into last name field)
- Josh Hansen is the admin and built this system
