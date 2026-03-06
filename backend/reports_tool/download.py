#!/usr/bin/env python3
"""Download all conversation reports from Supabase into local JSON files.

Usage:
    python download.py [--out downloads/]

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env (or environment).
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not url or not key:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    sys.exit(1)

default_out = Path(__file__).resolve().parent / "downloads"
out_dir = Path(sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else default_out)
out_dir.mkdir(parents=True, exist_ok=True)

sb = create_client(url, key)

# Fetch all reports
reports = sb.table("conversation_reports") \
    .select("*") \
    .order("created_at", desc=True) \
    .execute().data or []

if not reports:
    print("No reports found.")
    sys.exit(0)

# Fetch user emails for enrichment
user_ids = list({r["user_id"] for r in reports})
profiles = sb.table("profiles") \
    .select("id, email") \
    .in_("id", user_ids) \
    .execute().data or []
emails = {p["id"]: p.get("email", "") for p in profiles}

ids = []
for r in reports:
    r["email"] = emails.get(r["user_id"], "")
    ts = datetime.fromisoformat(r["created_at"]).strftime("%Y%m%d_%H%M%S")
    slug = r["email"].split("@")[0] if r["email"] else r["user_id"][:8]
    filename = f"{ts}_{slug}_{r['id'][:8]}.json"
    path = out_dir / filename
    with open(path, "w") as f:
        json.dump(r, f, indent=2, default=str)
    ids.append(r["id"])

# Clear downloaded reports from the database
sb.table("conversation_reports").delete().in_("id", ids).execute()
print(f"Downloaded and cleared {len(reports)} report(s) to {out_dir}/")
