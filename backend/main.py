import csv
import io
import json
import logging
import math
import os
import uuid
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, HTTPException, Depends, Header, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client
import stripe

from services import (
    supabase_admin,
    update_job,
    write_dataset_rows, write_original_rows,
    reset_dataset,
    get_pipeline_steps,
    undo_last_step,
    revert_to_step,
    get_pg_conn,
    clone_dataset,
)
from plan_limits import PLANS, SIMPLE_QUERY_COST, COMPLEX_QUERY_COST, STRIPE_PRO_PRICE_ID

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI()

# Supabase anon client (auth only)
supabase_url = os.getenv("SUPABASE_URL")
supabase_anon_key = os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(supabase_url, supabase_anon_key)

# Stripe
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB per single upload


def _get_user_storage(user_id: str, plan: str = "free") -> tuple[int, int]:
    """Get total storage used (including clones) and limit for a user."""
    result = supabase_admin.table("datasets").select("file_size_bytes").eq("user_id", user_id).execute()
    used = sum(d["file_size_bytes"] for d in (result.data or []))
    limit = PLANS[plan]["max_storage_bytes"]
    return used, limit


def _get_user_dataset_count(user_id: str) -> int:
    """Get count of library datasets (excludes clones)."""
    result = (
        supabase_admin.table("datasets")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .is_("source_dataset_id", "null")
        .execute()
    )
    return result.count or 0


async def get_current_user(authorization: str = Header(None)) -> dict:
    """Extract and validate user from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.replace("Bearer ", "")

    try:
        # Verify token with Supabase
        user_response = supabase.auth.get_user(token)
        user = user_response.user
        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Get user profile with plan info
        profile = supabase_admin.table("profiles").select("*").eq("id", user.id).single().execute()
        if not profile.data:
            raise HTTPException(status_code=404, detail="User profile not found")

        p = profile.data
        return {
            "id": user.id,
            "email": user.email,
            "plan": p.get("plan", "free"),
            "credits_used": p.get("credits_used", 0),
            "transform_rows_used": p.get("transform_rows_used", 0),
            "period_start": p.get("period_start"),
            "stripe_customer_id": p.get("stripe_customer_id"),
            "stripe_subscription_id": p.get("stripe_subscription_id"),
        }
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


# --- CSV helpers ---

def read_csv_bytes(contents: bytes, max_rows: int) -> pd.DataFrame:
    """Parse CSV from raw bytes."""
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")
    try:
        df = pd.read_csv(io.BytesIO(contents), sep=None, engine="python", encoding="utf-8-sig")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid CSV file")
    if len(df) > max_rows:
        raise HTTPException(status_code=400, detail=f"Too many rows ({len(df):,}). Max is {max_rows:,}")
    return df


# --- Endpoints ---

@app.post("/upload")
async def upload(file: UploadFile, user: dict = Depends(get_current_user)):
    log.info(f"Upload: {file.filename}")
    plan = user["plan"]
    limits = PLANS[plan]

    # Check dataset count limit
    max_datasets = limits["max_datasets"]
    if max_datasets is not None:
        count = _get_user_dataset_count(user["id"])
        if count >= max_datasets:
            raise HTTPException(status_code=400, detail=f"Dataset limit reached ({count}/{max_datasets}). Upgrade to Pro for unlimited datasets.")

    try:
        contents = file.file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to read file")

    df = read_csv_bytes(contents, max_rows=limits["max_rows_per_dataset"])
    if df.empty:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    # Check storage cap
    storage_limit = limits["max_storage_bytes"]
    existing = supabase_admin.table("datasets").select("file_size_bytes").eq("user_id", user["id"]).execute()
    used = sum(d["file_size_bytes"] for d in existing.data)
    if used + len(contents) > storage_limit:
        used_mb = used / (1024 * 1024)
        max_mb = storage_limit / (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"Storage limit exceeded ({used_mb:.0f}MB / {max_mb:.0f}MB)")

    # Compute metadata
    col_avg_chars = {}
    for col in df.columns:
        col_data = df[col].dropna().astype(str)
        col_avg_chars[col] = round(col_data.str.len().mean(), 1) if not col_data.empty else 0

    # Persist to storage and DB
    dataset_id = str(uuid.uuid4())
    storage_path = f"{user['id']}/{dataset_id}.csv"
    columns = list(df.columns)

    supabase_admin.storage.from_("datasets").upload(
        storage_path, contents,
        {"content-type": "text/csv"},
    )

    supabase_admin.table("datasets").insert({
        "id": dataset_id,
        "user_id": user["id"],
        "filename": file.filename,
        "storage_path": storage_path,
        "columns": columns,
        "original_columns": columns,
        "row_count": len(df),
        "col_avg_chars": col_avg_chars,
        "file_size_bytes": len(contents),
    }).execute()

    # Write rows to both dataset_rows and dataset_rows_original
    write_dataset_rows(dataset_id, df)
    write_original_rows(dataset_id, df)

    log.info(f"Dataset {dataset_id}: {file.filename}, {len(df)} rows, {len(contents)} bytes")

    return {
        "dataset_id": dataset_id,
        "columns": columns,
        "row_count": len(df),
        "col_avg_chars": col_avg_chars,
    }



@app.get("/account")
async def get_account(user: dict = Depends(get_current_user)):
    """Get current user's plan status and usage."""
    plan = user["plan"]
    limits = PLANS[plan]
    return {
        "plan": plan,
        "email": user["email"],
        "credits_used": user["credits_used"],
        "credits_limit": limits["credits_per_week"],
        "transform_rows_used": user["transform_rows_used"],
        "transform_rows_limit": limits["transform_rows_per_week"],
        "max_datasets": limits["max_datasets"],
        "max_rows_per_dataset": limits["max_rows_per_dataset"],
        "max_storage_bytes": limits["max_storage_bytes"],
        "period_start": user["period_start"],
    }



@app.get("/datasets")
async def list_datasets(user: dict = Depends(get_current_user)):
    """List user's library datasets (excludes session clones)."""
    result = (
        supabase_admin.table("datasets")
        .select("id, filename, columns, row_count, col_avg_chars, file_size_bytes, created_at")
        .eq("user_id", user["id"])
        .is_("source_dataset_id", "null")
        .order("created_at", desc=True)
        .execute()
    )
    # Storage includes ALL datasets (library + clones)
    storage_used, storage_limit = _get_user_storage(user["id"], user["plan"])
    return {
        "datasets": result.data,
        "storage_used_bytes": storage_used,
        "storage_limit_bytes": storage_limit,
    }


@app.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str, user: dict = Depends(get_current_user)):
    """Get a single dataset's metadata."""
    result = (
        supabase_admin.table("datasets")
        .select("id, filename, columns, row_count, col_avg_chars, file_size_bytes, created_at")
        .eq("id", dataset_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return result.data


@app.get("/datasets/{dataset_id}/rows")
async def get_dataset_rows(
    dataset_id: str,
    page: int = 1,
    per_page: int = 50,
    sort_col: str | None = None,
    sort_dir: str = "asc",
    user: dict = Depends(get_current_user),
):
    """Get paginated rows from a dataset (Postgres-backed)."""
    per_page = max(1, min(per_page, 100))
    page = max(1, page)

    # Verify ownership and get metadata
    ds = (
        supabase_admin.table("datasets")
        .select("columns, row_count")
        .eq("id", dataset_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not ds.data:
        raise HTTPException(status_code=404, detail="Dataset not found")

    columns = ds.data["columns"]
    total_rows = ds.data["row_count"]
    total_pages = max(1, math.ceil(total_rows / per_page))
    offset = (page - 1) * per_page

    if sort_col and sort_col in columns:
        # Use RPC for JSONB-field sorting
        result = supabase_admin.rpc("get_sorted_dataset_rows", {
            "p_dataset_id": dataset_id,
            "p_sort_col": sort_col,
            "p_direction": sort_dir.lower(),
            "p_limit": per_page,
            "p_offset": offset,
        }).execute()
        raw_rows = result.data or []
    else:
        result = (
            supabase_admin.table("dataset_rows")
            .select("data")
            .eq("dataset_id", dataset_id)
            .order("row_number")
            .range(offset, offset + per_page - 1)
            .execute()
        )
        raw_rows = result.data or []

    # Convert JSONB rows to [[val, val, ...], ...] format
    rows = []
    for r in raw_rows:
        data = r["data"]
        rows.append([data.get(col, "") if data.get(col) is not None else "" for col in columns])

    return {
        "columns": columns,
        "rows": rows,
        "total_rows": total_rows,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


@app.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str, user: dict = Depends(get_current_user)):
    """Delete a library dataset, its stored file, and all session clones."""
    result = (
        supabase_admin.table("datasets")
        .select("id, storage_path")
        .eq("id", dataset_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Delete all clones first (cascade handles their rows/steps/session_datasets)
    supabase_admin.table("datasets").delete().eq("source_dataset_id", dataset_id).execute()

    # Delete from storage (joined/clone datasets have no real file)
    sp = result.data["storage_path"]
    if sp and sp not in ("joined", "clone"):
        try:
            supabase_admin.storage.from_("datasets").remove([sp])
        except Exception as e:
            log.warning(f"Failed to delete dataset file from storage: {e}")

    # Delete DB record (cascades to dataset_rows, dataset_rows_original, pipeline_steps)
    supabase_admin.table("datasets").delete().eq("id", dataset_id).execute()
    log.info(f"Deleted dataset {dataset_id} and its clones")
    return {"deleted": True}


class RenameDatasetRequest(BaseModel):
    filename: str


@app.patch("/datasets/{dataset_id}")
async def rename_dataset(dataset_id: str, body: RenameDatasetRequest, user: dict = Depends(get_current_user)):
    """Rename a dataset."""
    name = body.filename.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    result = (
        supabase_admin.table("datasets")
        .select("id")
        .eq("id", dataset_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Dataset not found")

    supabase_admin.table("datasets").update({"filename": name}).eq("id", dataset_id).execute()
    return {"filename": name}


@app.post("/datasets/{dataset_id}/reset")
async def reset_dataset_endpoint(dataset_id: str, user: dict = Depends(get_current_user)):
    """Reset a dataset to its original uploaded state."""
    try:
        result = reset_dataset(dataset_id, user["id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    log.info(f"Reset dataset {dataset_id} to original upload")
    return {"reset": True, **result}


@app.get("/datasets/{dataset_id}/pipeline")
async def get_pipeline(dataset_id: str, user: dict = Depends(get_current_user)):
    """Get the pipeline steps for a dataset."""
    try:
        steps = get_pipeline_steps(dataset_id, user["id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"steps": steps}


@app.post("/datasets/{dataset_id}/undo")
async def undo_step(dataset_id: str, user: dict = Depends(get_current_user)):
    """Undo the last pipeline step."""
    try:
        result = undo_last_step(dataset_id, user["id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


class RevertRequest(BaseModel):
    step_number: int


@app.post("/datasets/{dataset_id}/revert")
async def revert_step(dataset_id: str, body: RevertRequest, user: dict = Depends(get_current_user)):
    """Revert dataset to a specific pipeline step, removing all later steps."""
    try:
        result = revert_to_step(dataset_id, user["id"], body.step_number)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@app.get("/datasets/{dataset_id}/download")
async def download_dataset(dataset_id: str, user: dict = Depends(get_current_user)):
    """Download the current state of the dataset as streaming CSV."""
    ds = (
        supabase_admin.table("datasets")
        .select("filename, columns")
        .eq("id", dataset_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not ds.data:
        raise HTTPException(status_code=404, detail="Dataset not found")

    columns = ds.data["columns"]
    filename = ds.data["filename"]

    def csv_stream():
        """Stream CSV rows from SQL in batches."""
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_NONNUMERIC)

        # Header
        writer.writerow(columns)
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        # Rows in batches
        batch_size = 1000
        offset = 0
        while True:
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT data FROM dataset_rows WHERE dataset_id = %s "
                        "ORDER BY row_number LIMIT %s OFFSET %s",
                        (dataset_id, batch_size, offset),
                    )
                    batch = cur.fetchall()

            if not batch:
                break

            for (data,) in batch:
                row = [data.get(col, "") if data.get(col) is not None else "" for col in columns]
                writer.writerow(row)

            yield output.getvalue()
            output.seek(0)
            output.truncate(0)
            offset += batch_size

    return StreamingResponse(
        csv_stream(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/create-checkout-session")
async def create_checkout_session(user: dict = Depends(get_current_user)):
    """Create a Stripe Checkout session for Pro subscription."""
    if user["plan"] == "pro":
        raise HTTPException(status_code=400, detail="Already on Pro plan")

    try:
        customer_id = user.get("stripe_customer_id")
        if not customer_id:
            customer = stripe.Customer.create(
                email=user["email"],
                metadata={"user_id": str(user["id"])},
            )
            customer_id = customer.id
            supabase_admin.table("profiles").update(
                {"stripe_customer_id": customer_id}
            ).eq("id", user["id"]).execute()

        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=["card"],
            line_items=[{"price": STRIPE_PRO_PRICE_ID, "quantity": 1}],
            mode="subscription",
            success_url=f"{FRONTEND_URL}/credits/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{FRONTEND_URL}/credits",
            metadata={"user_id": str(user["id"])},
        )
        return {"url": session.url}
    except Exception as e:
        log.error(f"Stripe checkout error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create checkout session")


@app.post("/create-portal-session")
async def create_portal_session(user: dict = Depends(get_current_user)):
    """Create a Stripe Customer Portal session for managing subscription."""
    if not user.get("stripe_customer_id"):
        raise HTTPException(status_code=400, detail="No billing account")
    try:
        session = stripe.billing_portal.Session.create(
            customer=user["stripe_customer_id"],
            return_url=f"{FRONTEND_URL}/credits",
        )
        return {"url": session.url}
    except Exception as e:
        log.error(f"Stripe portal error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create portal session")


@app.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events. No auth — verified via signature."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_id = event["id"]
    event_type = event["type"]

    # Idempotency check via stripe_events table
    try:
        existing = supabase_admin.table("stripe_events").select("event_id").eq("event_id", event_id).maybe_single().execute()
        if existing.data:
            log.info(f"Stripe: event {event_id} already processed, skipping")
            return {"status": "duplicate"}
        supabase_admin.table("stripe_events").insert({
            "event_id": event_id,
            "event_type": event_type,
        }).execute()
    except Exception as e:
        log.warning(f"Stripe idempotency check failed: {e}")

    try:
        if event_type == "checkout.session.completed":
            session_obj = event["data"]["object"]
            if session_obj.get("mode") == "subscription" and session_obj.get("payment_status") == "paid":
                user_id = session_obj["metadata"]["user_id"]
                subscription_id = session_obj.get("subscription")
                supabase_admin.table("profiles").update({
                    "plan": "pro",
                    "stripe_subscription_id": subscription_id,
                    "credits_used": 0,
                    "transform_rows_used": 0,
                    "period_start": "now()",
                }).eq("id", user_id).execute()
                log.info(f"Stripe: user {user_id} upgraded to Pro (sub={subscription_id})")

        elif event_type == "customer.subscription.deleted":
            sub_obj = event["data"]["object"]
            customer_id = sub_obj.get("customer")
            # Find user by stripe_customer_id
            profile = (
                supabase_admin.table("profiles")
                .select("id")
                .eq("stripe_customer_id", customer_id)
                .maybe_single()
                .execute()
            )
            if profile.data:
                supabase_admin.table("profiles").update({
                    "plan": "free",
                    "stripe_subscription_id": None,
                }).eq("id", profile.data["id"]).execute()
                log.info(f"Stripe: user {profile.data['id']} downgraded to Free (sub cancelled)")

        elif event_type == "invoice.payment_failed":
            log.warning(f"Stripe: invoice payment failed for event {event_id}")

    except Exception as e:
        log.error(f"Stripe webhook processing failed: {e}")
        raise HTTPException(status_code=500, detail="Processing failed")

    return {"status": "received"}


## --- Session endpoints ---


class CreateSessionRequest(BaseModel):
    dataset_ids: list[str] | None = None
    name: str | None = None


@app.post("/sessions")
async def create_session(body: CreateSessionRequest, user: dict = Depends(get_current_user)):
    """Create a new session, cloning attached datasets for isolation."""
    session_name = body.name or "Untitled session"

    # Validate all datasets belong to user
    validated = []
    if body.dataset_ids:
        for did in body.dataset_ids:
            ds = (
                supabase_admin.table("datasets")
                .select("id, filename")
                .eq("id", did)
                .eq("user_id", user["id"])
                .maybe_single()
                .execute()
            )
            if not ds.data:
                raise HTTPException(status_code=404, detail=f"Dataset {did} not found")
            validated.append(ds.data)
        # If exactly one dataset and no explicit name, use its filename
        if len(validated) == 1 and not body.name:
            session_name = validated[0]["filename"]

    result = (
        supabase_admin.table("sessions")
        .insert({"user_id": user["id"], "name": session_name})
        .execute()
    )
    session_data = result.data[0]

    if body.dataset_ids:
        for i, did in enumerate(body.dataset_ids):
            clone_id = clone_dataset(did, user["id"])
            supabase_admin.table("session_datasets").insert({
                "session_id": session_data["id"],
                "dataset_id": clone_id,
                "display_order": i,
            }).execute()

    return {"id": session_data["id"], "name": session_data["name"]}


@app.get("/sessions")
async def list_sessions(user: dict = Depends(get_current_user)):
    """List user's sessions with dataset counts."""
    result = (
        supabase_admin.table("sessions")
        .select("id, name, created_at, updated_at")
        .eq("user_id", user["id"])
        .order("updated_at", desc=True)
        .execute()
    )
    sessions = result.data or []

    # Get dataset counts and names for all sessions
    if sessions:
        session_ids = [s["id"] for s in sessions]
        sd_result = (
            supabase_admin.table("session_datasets")
            .select("session_id, dataset_id")
            .in_("session_id", session_ids)
            .execute()
        )
        # Collect dataset IDs per session
        session_dataset_ids: dict[str, list[str]] = {}
        for sd in (sd_result.data or []):
            session_dataset_ids.setdefault(sd["session_id"], []).append(sd["dataset_id"])

        # Fetch filenames for all referenced datasets
        all_dataset_ids = list({did for dids in session_dataset_ids.values() for did in dids})
        dataset_names_map: dict[str, str] = {}
        if all_dataset_ids:
            ds_result = (
                supabase_admin.table("datasets")
                .select("id, filename")
                .in_("id", all_dataset_ids)
                .execute()
            )
            for d in (ds_result.data or []):
                dataset_names_map[d["id"]] = d["filename"]

        for s in sessions:
            dids = session_dataset_ids.get(s["id"], [])
            s["dataset_count"] = len(dids)
            s["dataset_names"] = [dataset_names_map[did] for did in dids if did in dataset_names_map]

    storage_used, storage_limit = _get_user_storage(user["id"], user["plan"])
    return {
        "sessions": sessions,
        "storage_used_bytes": storage_used,
        "storage_limit_bytes": storage_limit,
    }


@app.get("/sessions/{session_id}")
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    """Get session detail with ordered dataset list."""
    sess = (
        supabase_admin.table("sessions")
        .select("id, name, created_at, updated_at")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get ordered datasets
    sd_result = (
        supabase_admin.table("session_datasets")
        .select("dataset_id, display_order")
        .eq("session_id", session_id)
        .order("display_order")
        .execute()
    )
    ds_ids = [r["dataset_id"] for r in (sd_result.data or [])]
    datasets: list[dict] = []
    if ds_ids:
        ds_result = (
            supabase_admin.table("datasets")
            .select("id, filename, columns, row_count, col_avg_chars, file_size_bytes, created_at")
            .in_("id", ds_ids)
            .execute()
        )
        ds_map = {d["id"]: d for d in (ds_result.data or [])}
        datasets = [ds_map[did] for did in ds_ids if did in ds_map]

    return {**sess.data, "datasets": datasets}


class RenameSessionRequest(BaseModel):
    name: str


@app.patch("/sessions/{session_id}")
async def rename_session(session_id: str, body: RenameSessionRequest, user: dict = Depends(get_current_user)):
    """Rename a session."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    sess = (
        supabase_admin.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found")

    supabase_admin.table("sessions").update({"name": name, "updated_at": "now()"}).eq("id", session_id).execute()
    return {"name": name}


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user: dict = Depends(get_current_user)):
    """Delete a session and its clone datasets."""
    sess = (
        supabase_admin.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Find and delete clone datasets attached to this session
    sd_result = (
        supabase_admin.table("session_datasets")
        .select("dataset_id")
        .eq("session_id", session_id)
        .execute()
    )
    for sd in (sd_result.data or []):
        ds = (
            supabase_admin.table("datasets")
            .select("id, source_dataset_id")
            .eq("id", sd["dataset_id"])
            .maybe_single()
            .execute()
        )
        if ds.data and ds.data["source_dataset_id"] is not None:
            supabase_admin.table("datasets").delete().eq("id", ds.data["id"]).execute()

    supabase_admin.table("sessions").delete().eq("id", session_id).execute()
    log.info(f"Deleted session {session_id} and its clones")
    return {"deleted": True}


class AddDatasetToSessionRequest(BaseModel):
    dataset_id: str


@app.post("/sessions/{session_id}/datasets")
async def add_dataset_to_session(session_id: str, body: AddDatasetToSessionRequest, user: dict = Depends(get_current_user)):
    """Clone a dataset and add it to a session."""
    # Verify session ownership
    sess = (
        supabase_admin.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Verify dataset ownership
    ds = (
        supabase_admin.table("datasets")
        .select("id")
        .eq("id", body.dataset_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not ds.data:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Clone the dataset for session isolation
    clone_id = clone_dataset(body.dataset_id, user["id"])

    # Get next display_order
    existing = (
        supabase_admin.table("session_datasets")
        .select("display_order")
        .eq("session_id", session_id)
        .order("display_order", desc=True)
        .limit(1)
        .execute()
    )
    next_order = (existing.data[0]["display_order"] + 1) if existing.data else 0

    supabase_admin.table("session_datasets").insert({
        "session_id": session_id,
        "dataset_id": clone_id,
        "display_order": next_order,
    }).execute()

    return {"added": True, "display_order": next_order, "clone_id": clone_id}


@app.delete("/sessions/{session_id}/datasets/{dataset_id}")
async def remove_dataset_from_session(session_id: str, dataset_id: str, user: dict = Depends(get_current_user)):
    """Remove a dataset from a session and delete the clone."""
    sess = (
        supabase_admin.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Remove from join table
    supabase_admin.table("session_datasets").delete().eq("session_id", session_id).eq("dataset_id", dataset_id).execute()

    # If it's a clone, delete the dataset itself
    ds = (
        supabase_admin.table("datasets")
        .select("id, source_dataset_id")
        .eq("id", dataset_id)
        .maybe_single()
        .execute()
    )
    if ds.data and ds.data["source_dataset_id"] is not None:
        supabase_admin.table("datasets").delete().eq("id", dataset_id).execute()

    return {"removed": True}


# --- Chat endpoints ---


class ChatRequest(BaseModel):
    message: str
    session_id: str
    dataset_id: str | None = None


@app.post("/chat")
async def chat_endpoint(body: ChatRequest, user: dict = Depends(get_current_user)):
    # Verify session ownership
    sess = (
        supabase_admin.table("sessions")
        .select("id")
        .eq("id", body.session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Load active dataset info
    dataset_info = None
    if body.dataset_id:
        try:
            ds = (
                supabase_admin.table("datasets")
                .select("filename, columns, row_count, col_avg_chars")
                .eq("id", body.dataset_id)
                .eq("user_id", user["id"])
                .single()
                .execute()
            )
            if ds.data:
                dataset_info = {"id": body.dataset_id, **ds.data}
        except Exception as e:
            log.warning(f"Failed to load dataset context for chat: {e}")

    # Load all open datasets in session
    open_datasets: list[dict] = []
    try:
        sd_result = (
            supabase_admin.table("session_datasets")
            .select("dataset_id")
            .eq("session_id", body.session_id)
            .order("display_order")
            .execute()
        )
        ds_ids = [r["dataset_id"] for r in (sd_result.data or [])]
        if ds_ids:
            ds_result = (
                supabase_admin.table("datasets")
                .select("id, filename, columns, row_count")
                .in_("id", ds_ids)
                .execute()
            )
            ds_map = {d["id"]: d for d in (ds_result.data or [])}
            open_datasets = [ds_map[did] for did in ds_ids if did in ds_map]
    except Exception as e:
        log.warning(f"Failed to load open datasets for chat: {e}")

    async def event_stream():
        from agent.agent import ComplexAgent, SimpleAgent, classify

        # Quick pre-check: if user can't afford even the cheapest query, bail
        # immediately without burning time on the classify LLM call
        pre = supabase_admin.rpc("use_message_credits", {
            "p_user_id": str(user["id"]),
            "p_cost": SIMPLE_QUERY_COST,
        }).execute()
        if not pre.data["allowed"]:
            yield f"data: {json.dumps({'type': 'error', 'code': 'quota_exceeded', 'credits_used': pre.data.get('credits_used', 0), 'credits_limit': pre.data.get('credits_limit', 0)})}\n\n"
            yield "data: [DONE]\n\n"
            return

        agent_type = await classify(
            body.message, dataset_info, open_datasets, body.session_id,
        )
        yield f"data: {json.dumps({'type': 'route', 'agent': agent_type})}\n\n"

        # Deduct remaining credits (pre-check already deducted SIMPLE_QUERY_COST)
        remaining_cost = (COMPLEX_QUERY_COST - SIMPLE_QUERY_COST) if agent_type == "complex" else 0
        if remaining_cost > 0:
            result = supabase_admin.rpc("use_message_credits", {
                "p_user_id": str(user["id"]),
                "p_cost": remaining_cost,
            }).execute()
            if not result.data["allowed"]:
                yield f"data: {json.dumps({'type': 'error', 'code': 'quota_exceeded', 'credits_used': result.data.get('credits_used', 0), 'credits_limit': result.data.get('credits_limit', 0)})}\n\n"
                yield "data: [DONE]\n\n"
                return

        AgentClass = ComplexAgent if agent_type == "complex" else SimpleAgent
        agent = AgentClass(body.message, dataset_info, user["id"], body.session_id, open_datasets)
        try:
            async for event in agent.run():
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            agent.cleanup()
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/chat/cancel")
async def cancel_chat(user: dict = Depends(get_current_user)):
    from agent.agent import request_cancel
    found = request_cancel(user["id"])
    return {"cancelled": found}


@app.post("/sessions/{session_id}/chat/clear")
async def clear_session_chat(session_id: str, user: dict = Depends(get_current_user)):
    """Clear agent conversation history for a session."""
    sess = (
        supabase_admin.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found")
    from agent.memory import clear
    clear(session_id)
    return {"cleared": True}


@app.get("/sessions/{session_id}/chat/history")
async def get_session_chat_history(session_id: str, user: dict = Depends(get_current_user)):
    """Get agent conversation history for a session."""
    sess = (
        supabase_admin.table("sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user["id"])
        .maybe_single()
        .execute()
    )
    if not sess.data:
        raise HTTPException(status_code=404, detail="Session not found")
    from agent.memory import get_history
    history = get_history(session_id)
    return {"history": history}


@app.get("/jobs/active")
async def get_active_job(user: dict = Depends(get_current_user)):
    """Return the user's most recent running/pending job, if any."""
    result = (
        supabase_admin.table("jobs")
        .select("id, status, rows_processed, rows_total, new_column_name, created_at")
        .eq("user_id", user["id"])
        .in_("status", ["pending", "running", "cancelling"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return {"job": result.data[0] if result.data else None}


@app.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, user: dict = Depends(get_current_user)):
    """Cancel a running job. Signals the job to stop processing new batches."""
    from services import request_cancel

    job = (
        supabase_admin.table("jobs")
        .select("id, user_id, status")
        .eq("id", job_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not job.data:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.data["status"] not in ("pending", "running"):
        raise HTTPException(status_code=400, detail="Job is not running")

    request_cancel(job_id)
    update_job(job_id, status="cancelling")
    return {"cancelled": True}


@app.on_event("startup")
async def cleanup_stuck_jobs():
    """Mark any leftover 'running' or 'pending' jobs as 'failed' on server restart."""
    try:
        for status in ("running", "pending", "cancelling"):
            result = (
                supabase_admin.table("jobs")
                .select("id, user_id, rows_total, rows_processed, status")
                .eq("status", status)
                .execute()
            )
            for job in result.data:
                job_id = job["id"]
                update_job(job_id, status="failed", error_message="Server restarted while job was in progress")
                log.info(f"Cleaned up stuck job {job_id} (was {status})")
    except Exception as e:
        log.error(f"Failed to clean up stuck jobs: {e}")
