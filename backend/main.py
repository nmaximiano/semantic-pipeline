import asyncio
import csv
import io
import logging
import math
import os
import re
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, Form, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import httpx
import pandas as pd
from openai import OpenAI
from dotenv import load_dotenv
from supabase import create_client, Client
import stripe

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI()
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

# Supabase clients
supabase_url = os.getenv("SUPABASE_URL")
supabase_anon_key = os.getenv("SUPABASE_ANON_KEY")
supabase_service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(supabase_url, supabase_anon_key)
supabase_admin: Client = create_client(supabase_url, supabase_service_key)

# Stripe
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

CREDIT_PRICE_CENTS = 1  # 1 cent per credit ($0.01)
MIN_PURCHASE_CREDITS = 50  # $0.50 — Stripe minimum for USD
MAX_PURCHASE_CREDITS = 10000  # $100 cap

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL = "openai/gpt-oss-20b:nitro"
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_ROWS = 50_000
MAX_CHARS_PER_OBSERVATION = 4_000
MAX_BATCH_CHARS = 40_000
MAX_BATCH_SIZE = 50

# Credit system — tiered by average text length
CREDIT_TIERS = [
    (500,  0.01),   # short: avg < 500 chars → 0.01 credits/row (~23x margin)
    (2000, 0.02),   # medium: avg 500-2000 chars → 0.02 credits/row (~17x margin)
    (4000, 0.04),   # long: avg 2000+ chars → 0.04 credits/row (~13x margin)
]
MIN_CREDITS = 1

SYSTEM_PROMPT = """You are a data transformation function.
Given input text, you produce a single, clean output value.
Do not include explanations or extra text."""


def get_credit_rate(avg_chars: float) -> float:
    """Get credits-per-row rate based on average character length."""
    for threshold, rate in CREDIT_TIERS:
        if avg_chars < threshold:
            return rate
    return CREDIT_TIERS[-1][1]  # max tier


def estimate_credits(num_rows: int, avg_chars: float = 0) -> int:
    """Estimate credits needed for a job. Always rounds up."""
    rate = get_credit_rate(avg_chars)
    return max(MIN_CREDITS, math.ceil(num_rows * rate))


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

        # Get user profile with credits
        profile = supabase_admin.table("profiles").select("*").eq("id", user.id).single().execute()
        if not profile.data:
            raise HTTPException(status_code=404, detail="User profile not found")

        return {"id": user.id, "email": user.email, "credits": profile.data["credits"]}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


def deduct_credits(user_id: str, amount: int, job_id: str, description: str) -> bool:
    """Atomically deduct credits from user. Returns True if successful."""
    try:
        result = supabase_admin.rpc("deduct_credits", {
            "p_user_id": user_id,
            "p_amount": amount,
            "p_job_id": job_id,
            "p_description": description,
        }).execute()
        return result.data != -1  # -1 means insufficient credits
    except Exception as e:
        log.error(f"Failed to deduct credits: {e}")
        return False


def refund_credits(user_id: str, amount: int, job_id: str, description: str):
    """Atomically refund credits to user."""
    try:
        supabase_admin.rpc("refund_credits", {
            "p_user_id": user_id,
            "p_amount": amount,
            "p_job_id": job_id,
            "p_description": description,
        }).execute()
    except Exception as e:
        log.error(f"Failed to refund credits: {e}")


def create_job(user_id: str, filename: str, column_name: str, prompt: str,
               new_column_name: str, rows_total: int, credits_charged: int) -> str:
    """Create a job record. Returns job ID."""
    result = supabase_admin.table("jobs").insert({
        "user_id": user_id,
        "status": "pending",
        "filename": filename,
        "column_name": column_name,
        "prompt": prompt,
        "new_column_name": new_column_name,
        "rows_total": rows_total,
        "rows_processed": 0,
        "credits_charged": credits_charged
    }).execute()
    return result.data[0]["id"]


def update_job(job_id: str, **kwargs):
    """Update job fields."""
    supabase_admin.table("jobs").update(kwargs).eq("id", job_id).execute()


def get_generation_cost(generation_id: str) -> float | None:
    """Query OpenRouter for the cost of a completed generation."""
    try:
        resp = httpx.get(
            f"https://openrouter.ai/api/v1/generation?id={generation_id}",
            headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY')}"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            return resp.json().get("data", {}).get("total_cost")
    except Exception:
        pass
    return None


def apply_llm(text: str, instructions: str) -> str:
    """Single-row LLM call. Used by /preview and as fallback for failed batch items."""
    if pd.isna(text) or str(text).strip() == "":
        return ""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": instructions},
            {"role": "assistant", "content": "Understood. Send me the text and I will respond with only the output value."},
            {"role": "user", "content": text},
        ],
        extra_body={"reasoning": {"effort": "minimal"}},  # 97% cheaper
    )
    usage = response.usage
    cost = get_generation_cost(response.id) or 0.0
    log.info(f"Tokens: {usage.prompt_tokens} prompt, {usage.completion_tokens} completion | Cost: ${cost:.6f}")
    return response.choices[0].message.content.strip()


def create_batches(texts: list[str]) -> tuple[list[list[tuple[int, str]]], dict[int, str]]:
    """Greedy-pack texts into batches. Returns (batches, skipped)."""
    batches: list[list[tuple[int, str]]] = []
    skipped: dict[int, str] = {}
    current_batch: list[tuple[int, str]] = []
    current_chars = 0

    for idx, text in enumerate(texts):
        if pd.isna(text) or str(text).strip() == "":
            skipped[idx] = ""
            continue

        text = str(text)
        text_len = len(text)

        if current_batch and (current_chars + text_len > MAX_BATCH_CHARS or len(current_batch) >= MAX_BATCH_SIZE):
            batches.append(current_batch)
            current_batch = []
            current_chars = 0

        current_batch.append((idx, text))
        current_chars += text_len

    if current_batch:
        batches.append(current_batch)

    return batches, skipped


def apply_llm_batch(texts: list[tuple[int, str]], instructions: str) -> dict[int, str]:
    """Batch LLM call. Falls back to single-row only for items that failed to parse."""
    numbered_lines = []
    index_map: dict[int, int] = {}
    for pos, (orig_idx, text) in enumerate(texts, start=1):
        numbered_lines.append(f'{pos}: """{text}"""')
        index_map[pos] = orig_idx

    batch_prompt = (
        f"{instructions}\n\n"
        "Respond with one result per line, numbered to match. Example format:\n"
        "1: positive\n"
        "2: negative\n\n"
        "Texts:\n" + "\n".join(numbered_lines)
    )

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": batch_prompt},
            ],
            extra_body={"reasoning": {"effort": "minimal"}},  # 97% cheaper
        )
        usage = response.usage
        cost = get_generation_cost(response.id) or 0.0
        log.info(f"Batch ({len(texts)} items) tokens: {usage.prompt_tokens} prompt, {usage.completion_tokens} completion | Cost: ${cost:.6f}")
        raw = response.choices[0].message.content.strip()
    except Exception as e:
        log.error(f"Batch LLM call failed: {e}")
        # Full fallback — batch call itself failed
        results: dict[int, str] = {}
        for orig_idx, text in texts:
            try:
                results[orig_idx] = apply_llm(text, instructions)
            except Exception as e2:
                log.error(f"Row {orig_idx} failed: {e2}")
                results[orig_idx] = f"ERROR: {e2}"
        return results

    # Parse "N: result" lines
    results = {}
    for line in raw.splitlines():
        m = re.match(r"^(\d+):\s*(.*)$", line)
        if m:
            pos = int(m.group(1))
            if pos in index_map:
                results[index_map[pos]] = m.group(2).strip()

    # Only retry the specific items that failed to parse
    missing = [(orig_idx, text) for orig_idx, text in texts if orig_idx not in results]
    if missing:
        log.warning(f"Batch parse: got {len(results)}/{len(texts)}, retrying {len(missing)} individually")
        for orig_idx, text in missing:
            try:
                results[orig_idx] = apply_llm(text, instructions)
            except Exception as e:
                log.error(f"Row {orig_idx} failed: {e}")
                results[orig_idx] = f"ERROR: {e}"

    return results


def run_job(job_id: str, user_id: str, df: pd.DataFrame, column_name: str,
            prompt: str, new_column_name: str, credits_charged: int):
    """Run a processing job in a background thread. Updates DB directly."""
    total = len(df)
    texts = df[column_name].astype(str).tolist()
    batches, skipped = create_batches(texts)

    log.info(f"Job {job_id}: {total} rows, {len(batches)} batch(es), {len(skipped)} skipped")

    all_results: dict[int, str] = dict(skipped)
    processed = len(skipped)

    try:
        for batch in batches:
            batch_results = apply_llm_batch(batch, prompt)
            all_results.update(batch_results)
            processed += len(batch)
            update_job(job_id, rows_processed=processed)
            log.info(f"Job {job_id} progress: {processed}/{total}")

        df[new_column_name] = [all_results.get(i, "") for i in range(total)]
        csv_bytes = df.to_csv(index=False, quoting=csv.QUOTE_NONNUMERIC).encode("utf-8")

        # Upload result CSV to Supabase Storage
        storage_path = f"{user_id}/{job_id}.csv"
        supabase_admin.storage.from_("results").upload(
            storage_path, csv_bytes,
            {"content-type": "text/csv", "upsert": "true"},
        )

        update_job(job_id, status="completed", rows_processed=total,
                   completed_at=datetime.now(timezone.utc).isoformat())
        log.info(f"Job {job_id} completed — CSV uploaded to storage: {storage_path}")

    except Exception as e:
        log.error(f"Job {job_id} failed: {e}")
        unprocessed = total - processed
        refund_amount = math.ceil(unprocessed / total * credits_charged) if total > 0 else 0
        if refund_amount > 0:
            refund_credits(user_id, refund_amount, job_id, f"Partial refund: {unprocessed}/{total} rows")
            update_job(job_id, credits_refunded=refund_amount)

        update_job(job_id, status="failed", error_message=str(e))


# --- CSV helpers ---

def read_csv(file: UploadFile) -> pd.DataFrame:
    try:
        contents = file.file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to read file")

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid CSV file")

    if len(df) > MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"Too many rows ({len(df):,}). Max is {MAX_ROWS:,}")

    return df


def validate_column(df: pd.DataFrame, column_name: str):
    if column_name not in df.columns:
        raise HTTPException(status_code=400, detail=f"Column '{column_name}' not found")

    col = df[column_name].dropna().astype(str)
    if col.empty:
        raise HTTPException(status_code=400, detail=f"Column '{column_name}' is entirely empty")

    too_long = col[col.str.len() > MAX_CHARS_PER_OBSERVATION]
    if not too_long.empty:
        raise HTTPException(
            status_code=400,
            detail=f"{len(too_long)} observation(s) exceed {MAX_CHARS_PER_OBSERVATION:,} characters",
        )


# --- Endpoints ---

@app.post("/upload")
async def upload(file: UploadFile):
    log.info(f"Upload: {file.filename}")
    df = read_csv(file)
    if df.empty:
        raise HTTPException(status_code=400, detail="CSV file is empty")
    # Compute average char length per column (for credit estimation)
    col_avg_chars = {}
    for col in df.columns:
        col_data = df[col].dropna().astype(str)
        col_avg_chars[col] = round(col_data.str.len().mean(), 1) if not col_data.empty else 0

    log.info(f"Columns: {list(df.columns)}, Rows: {len(df)}")
    return {"columns": list(df.columns), "row_count": len(df), "col_avg_chars": col_avg_chars}


@app.post("/preview")
async def preview(
    file: UploadFile,
    column_name: str = Form(...),
    prompt: str = Form(...),
):
    df = read_csv(file)
    validate_column(df, column_name)

    text = str(df[column_name].dropna().sample(1).iloc[0])
    log.info(f"Preview: {text[:80]}...")
    try:
        result = apply_llm(text, prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM processing failed: {e}")

    return {"input": text, "output": result}


@app.post("/analyze")
async def analyze(
    file: UploadFile,
    column_name: str = Form(...),
    prompt: str = Form(...),
    new_column_name: str = Form(...),
    user: dict = Depends(get_current_user),
):
    df = read_csv(file)
    validate_column(df, column_name)

    if new_column_name in df.columns:
        raise HTTPException(status_code=400, detail=f"Column '{new_column_name}' already exists")

    total = len(df)
    col_data = df[column_name].dropna().astype(str)
    avg_chars = col_data.str.len().mean() if not col_data.empty else 0
    credits_needed = estimate_credits(total, avg_chars)

    if user["credits"] < credits_needed:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient credits. Need {credits_needed}, have {user['credits']}"
        )

    job_id = create_job(
        user_id=user["id"],
        filename=file.filename,
        column_name=column_name,
        prompt=prompt,
        new_column_name=new_column_name,
        rows_total=total,
        credits_charged=credits_needed
    )

    if not deduct_credits(user["id"], credits_needed, job_id, f"Job: {file.filename}"):
        raise HTTPException(status_code=402, detail="Failed to deduct credits")

    update_job(job_id, status="running")
    log.info(f"Job {job_id}: {total} rows, {credits_needed} credits charged")

    # Fire-and-forget: run processing in a background thread
    asyncio.create_task(asyncio.to_thread(
        run_job, job_id, user["id"], df, column_name, prompt, new_column_name, credits_needed
    ))

    return {"job_id": job_id, "credits_charged": credits_needed}


@app.get("/balance")
async def get_balance(user: dict = Depends(get_current_user)):
    """Get current user's credit balance."""
    return {"credits": user["credits"], "email": user["email"]}


@app.get("/estimate")
async def estimate_cost(rows: int, avg_chars: float = 0):
    """Estimate credits needed for a given number of rows and avg text length."""
    rate = get_credit_rate(avg_chars)
    credits = estimate_credits(rows, avg_chars)
    return {"rows": rows, "avg_chars": avg_chars, "rate": rate, "credits": credits, "cost_usd": credits * 0.01}


@app.get("/jobs")
async def list_jobs(user: dict = Depends(get_current_user)):
    """List user's jobs (excludes result_csv and prompt for performance)."""
    result = (
        supabase_admin.table("jobs")
        .select("id, user_id, status, filename, column_name, new_column_name, rows_total, rows_processed, credits_charged, credits_refunded, error_message, created_at, completed_at")
        .eq("user_id", user["id"])
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return {"jobs": result.data}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, user: dict = Depends(get_current_user)):
    """Get single job status/progress (excludes result_csv)."""
    result = (
        supabase_admin.table("jobs")
        .select("id, user_id, status, filename, column_name, new_column_name, rows_total, rows_processed, credits_charged, credits_refunded, error_message, created_at, completed_at")
        .eq("id", job_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return result.data


@app.get("/jobs/{job_id}/download")
async def download_job(job_id: str, user: dict = Depends(get_current_user)):
    """Download result CSV for a completed job."""
    result = (
        supabase_admin.table("jobs")
        .select("status, result_csv, filename")
        .eq("id", job_id)
        .eq("user_id", user["id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")
    if result.data["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job is not completed")

    # Try Supabase Storage first, fall back to DB column for old jobs
    csv_content = None
    storage_path = f"{user['id']}/{job_id}.csv"
    try:
        csv_content = supabase_admin.storage.from_("results").download(storage_path)
    except Exception:
        pass

    if csv_content is None and result.data.get("result_csv"):
        csv_content = result.data["result_csv"].encode("utf-8")

    if csv_content is None:
        raise HTTPException(status_code=404, detail="No result CSV available")

    filename = result.data.get("filename", "output.csv")
    if filename and not filename.endswith(".csv"):
        filename += ".csv"
    download_name = f"output_{filename}" if filename else "output.csv"

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'}
    )


@app.post("/create-checkout-session")
async def create_checkout_session(request: Request, user: dict = Depends(get_current_user)):
    """Create a Stripe Checkout session for credit purchase."""
    body = await request.json()
    credits = body.get("credits")

    if not isinstance(credits, int) or credits < MIN_PURCHASE_CREDITS or credits > MAX_PURCHASE_CREDITS:
        raise HTTPException(
            status_code=400,
            detail=f"Credits must be between {MIN_PURCHASE_CREDITS} and {MAX_PURCHASE_CREDITS:,}"
        )

    amount_cents = credits * CREDIT_PRICE_CENTS

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": f"Semantic Pipeline — {credits:,} Credits"},
                    "unit_amount": amount_cents,
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{FRONTEND_URL}/credits/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{FRONTEND_URL}/credits",
            metadata={
                "user_id": str(user["id"]),
                "credits": str(credits),
            },
            client_reference_id=str(user["id"]),
        )
        return {"url": session.url}
    except Exception as e:
        log.error(f"Stripe checkout error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create checkout session")


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

    if event["type"] == "checkout.session.completed":
        session_obj = event["data"]["object"]
        if session_obj.get("payment_status") == "paid":
            event_id = event["id"]
            user_id = session_obj["metadata"]["user_id"]
            credits = int(session_obj["metadata"]["credits"])

            try:
                result = supabase_admin.rpc("add_purchase_credits", {
                    "p_event_id": event_id,
                    "p_event_type": event["type"],
                    "p_checkout_session_id": session_obj["id"],
                    "p_user_id": user_id,
                    "p_credits": credits,
                }).execute()

                if result.data:
                    log.info(f"Stripe: added {credits} credits to user {user_id}")
                else:
                    log.info(f"Stripe: event {event_id} already processed, skipping")
            except Exception as e:
                log.error(f"Stripe webhook processing failed: {e}")
                raise HTTPException(status_code=500, detail="Processing failed")

    return {"status": "received"}


@app.on_event("startup")
async def cleanup_stuck_jobs():
    """Mark any leftover 'running' or 'pending' jobs as 'failed' on server restart."""
    try:
        for status in ("running", "pending"):
            result = (
                supabase_admin.table("jobs")
                .select("id, user_id, rows_total, rows_processed, credits_charged, status")
                .eq("status", status)
                .execute()
            )
            for job in result.data:
                job_id = job["id"]
                total = job["rows_total"]
                processed = job["rows_processed"]
                credits_charged = job["credits_charged"]

                unprocessed = total - processed
                refund_amount = math.ceil(unprocessed / total * credits_charged) if total > 0 else 0
                if refund_amount > 0:
                    refund_credits(job["user_id"], refund_amount, job_id,
                                   f"Server restart refund: {unprocessed}/{total} rows unprocessed")
                    update_job(job_id, credits_refunded=refund_amount)

                update_job(job_id, status="failed", error_message="Server restarted while job was in progress")
                log.info(f"Cleaned up stuck job {job_id} (was {status}), refunded {refund_amount} credits")
    except Exception as e:
        log.error(f"Failed to clean up stuck jobs: {e}")
