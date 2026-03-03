import json
import logging
import os
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client
import stripe
import sentry_sdk
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from services import supabase_admin
from plan_limits import PLANS, SIMPLE_QUERY_COST, COMPLEX_QUERY_COST, STRIPE_PRO_PRICE_ID

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Sentry error tracking — no-op if SENTRY_DSN is not set
if os.getenv("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=os.getenv("SENTRY_DSN"),
        traces_sample_rate=0.1,
        send_default_pii=False,
    )

limiter = Limiter(key_func=get_remote_address)
app = FastAPI()
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Please try again later."},
    )


# Supabase anon client (auth only)
supabase_url = os.getenv("SUPABASE_URL")
supabase_anon_key = os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(supabase_url, supabase_anon_key)

# Stripe
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
if FRONTEND_URL not in _origins:
    _origins.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


async def get_current_user(authorization: str = Header(None)) -> dict:
    """Extract and validate user from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.replace("Bearer ", "")

    try:
        user_response = supabase.auth.get_user(token)
        user = user_response.user
        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")

        profile = supabase_admin.table("profiles").select("*").eq("id", user.id).single().execute()
        if not profile.data:
            raise HTTPException(status_code=404, detail="User profile not found")

        p = profile.data

        # Auto-expire beta users
        plan = p.get("plan", "free")
        if plan == "beta" and p.get("beta_expires_at"):
            expires = datetime.fromisoformat(p["beta_expires_at"])
            if expires <= datetime.now(timezone.utc):
                supabase_admin.table("profiles").update({
                    "plan": "free", "beta_expires_at": None,
                }).eq("id", user.id).execute()
                plan = "free"
                p["beta_expires_at"] = None
                log.info(f"Beta expired for user {user.id}")

        # Tag Sentry events with the authenticated user
        sentry_sdk.set_user({"id": str(user.id), "email": user.email})

        return {
            "id": user.id,
            "email": user.email,
            "plan": plan,
            "credits_used": p.get("credits_used", 0),
            "transform_rows_used": p.get("transform_rows_used", 0),
            "period_start": p.get("period_start"),
            "stripe_customer_id": p.get("stripe_customer_id"),
            "stripe_subscription_id": p.get("stripe_subscription_id"),
            "beta_expires_at": p.get("beta_expires_at"),
        }
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


# --- Account ---

@app.get("/account")
async def get_account(user: dict = Depends(get_current_user)):
    """Get current user's plan status and usage."""
    plan = user["plan"]
    limits = PLANS[plan]
    resp = {
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
    if plan == "beta":
        resp["beta_expires_at"] = user.get("beta_expires_at")
    return resp


# --- Feedback ---

class FeedbackRequest(BaseModel):
    category: str = Field(..., pattern="^(bug|feature|general)$")
    message: str = Field(..., min_length=1, max_length=5000)
    page_url: str | None = Field(None, max_length=500)


@app.post("/feedback")
@limiter.limit("10/minute")
async def submit_feedback(request: Request, body: FeedbackRequest, user: dict = Depends(get_current_user)):
    """Submit feedback. Only available to beta testers."""
    if user["plan"] != "beta":
        raise HTTPException(status_code=403, detail="Feedback is only available to beta testers")

    try:
        supabase_admin.table("feedback").insert({
            "user_id": str(user["id"]),
            "category": body.category,
            "message": body.message,
            "page_url": body.page_url,
        }).execute()
        return {"status": "received"}
    except Exception as e:
        log.error(f"Feedback insert error: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit feedback")


# --- Stripe ---

@app.post("/create-checkout-session")
@limiter.limit("5/minute")
async def create_checkout_session(request: Request, user: dict = Depends(get_current_user)):
    """Create a Stripe Checkout session for Pro subscription."""
    raise HTTPException(status_code=403, detail="Pro subscriptions are temporarily unavailable")
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
            success_url=f"{FRONTEND_URL}/plans/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{FRONTEND_URL}/plans",
            metadata={"user_id": str(user["id"])},
        )
        return {"url": session.url}
    except Exception as e:
        log.error(f"Stripe checkout error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create checkout session")


@app.post("/create-portal-session")
@limiter.limit("5/minute")
async def create_portal_session(request: Request, user: dict = Depends(get_current_user)):
    """Create a Stripe Customer Portal session for managing subscription."""
    if not user.get("stripe_customer_id"):
        raise HTTPException(status_code=400, detail="No billing account")
    try:
        session = stripe.billing_portal.Session.create(
            customer=user["stripe_customer_id"],
            return_url=f"{FRONTEND_URL}/plans",
        )
        return {"url": session.url}
    except Exception as e:
        log.error(f"Stripe portal error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create portal session")


@app.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events. No auth -- verified via signature."""
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

    # Idempotency check
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
                    "period_start": datetime.now(timezone.utc).isoformat(),
                }).eq("id", user_id).execute()
                log.info(f"Stripe: user {user_id} upgraded to Pro (sub={subscription_id})")

        elif event_type == "customer.subscription.deleted":
            sub_obj = event["data"]["object"]
            customer_id = sub_obj.get("customer")
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


# --- Chat (agent) ---

# Active agents registry: user_id -> agent instance
# Used by /chat/result to deliver R execution results back to the agent
_active_agents: dict = {}


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=16_000)
    session_id: str = Field(..., max_length=100)
    dataset_context: dict | None = None
    other_dataframes: list[dict] | None = None
    history: list | None = None


@app.post("/chat")
@limiter.limit("30/minute")
async def chat_endpoint(request: Request, body: ChatRequest, user: dict = Depends(get_current_user)):
    async def event_stream():
        from agent.agent import ComplexAgent, SimpleAgent, classify
        from agent.logger import log as alog

        # Prevent concurrent agents per user
        if user["id"] in _active_agents:
            yield f"data: {json.dumps({'type': 'error', 'code': 'agent_busy', 'detail': 'Another query is already in progress. Please wait.'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        alog(f"Chat request: message={body.message[:80]!r}")

        # Pre-check credits
        pre = supabase_admin.rpc("use_message_credits", {
            "p_user_id": str(user["id"]),
            "p_cost": SIMPLE_QUERY_COST,
        }).execute()
        alog("Credit pre-check done")
        if not pre.data["allowed"]:
            yield f"data: {json.dumps({'type': 'error', 'code': 'quota_exceeded', 'plan': user['plan'], 'credits_used': pre.data.get('credits_used', 0), 'credits_limit': pre.data.get('credits_limit', 0)})}\n\n"
            yield "data: [DONE]\n\n"
            return

        agent_type = await classify(
            body.message, body.dataset_context, body.history,
        )
        alog(f"Routed to: {agent_type}")
        yield f"data: {json.dumps({'type': 'route', 'agent': agent_type})}\n\n"

        # Deduct remaining credits for complex queries
        remaining_cost = (COMPLEX_QUERY_COST - SIMPLE_QUERY_COST) if agent_type == "complex" else 0
        if remaining_cost > 0:
            result = supabase_admin.rpc("use_message_credits", {
                "p_user_id": str(user["id"]),
                "p_cost": remaining_cost,
            }).execute()
            if not result.data["allowed"]:
                yield f"data: {json.dumps({'type': 'error', 'code': 'quota_exceeded', 'plan': user['plan'], 'credits_used': result.data.get('credits_used', 0), 'credits_limit': result.data.get('credits_limit', 0)})}\n\n"
                yield "data: [DONE]\n\n"
                return

        # Budget callback: re-charges COMPLEX_QUERY_COST every N rounds
        def check_budget() -> bool:
            try:
                r = supabase_admin.rpc("use_message_credits", {
                    "p_user_id": str(user["id"]),
                    "p_cost": COMPLEX_QUERY_COST,
                }).execute()
                allowed = r.data["allowed"]
                alog(f"Budget re-check: allowed={allowed}")
                return allowed
            except Exception as e:
                alog(f"Budget re-check failed: {e}")
                return True  # fail open — don't kill the task on transient DB errors

        AgentClass = ComplexAgent if agent_type == "complex" else SimpleAgent
        agent = AgentClass(
            body.message, body.dataset_context,
            user["id"], body.session_id, body.history,
            other_dataframes=body.other_dataframes,
            check_budget=check_budget if agent_type == "complex" else None,
            user_plan=user["plan"],
        )
        _active_agents[user["id"]] = agent

        # Log full conversation context to trace file
        agent.alog.session_start(
            user_message=body.message,
            agent_type=agent_type,
            session_id=body.session_id,
            dataset_context=body.dataset_context,
            other_dataframes=body.other_dataframes,
            history=body.history,
        )

        try:
            async for event in agent.run():
                agent.alog.sse_event(event)
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            agent.alog.error("agent_exception", f"{type(e).__name__}: {e}")
            alog(f"Agent error: {type(e).__name__}: {e}")
            yield f"data: {json.dumps({'type': 'error', 'code': 'agent_error', 'detail': 'Something went wrong. Please try again.'})}\n\n"
        finally:
            agent.cleanup()
            _active_agents.pop(user["id"], None)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/chat/cancel")
async def cancel_chat(user: dict = Depends(get_current_user)):
    from agent.agent import request_cancel
    found = request_cancel(user["id"])
    return {"cancelled": found}


class ChatAnswerRequest(BaseModel):
    ask_id: str
    answer: str


@app.post("/chat/answer")
async def chat_answer(body: ChatAnswerRequest, user: dict = Depends(get_current_user)):
    """Receive user answer to an agent question."""
    agent = _active_agents.get(user["id"])
    if not agent:
        raise HTTPException(status_code=404, detail="No active agent")
    agent.submit_result(body.ask_id, {"answer": body.answer})
    return {"received": True}


class ChatResultRequest(BaseModel):
    execution_id: str
    success: bool
    stdout: str | None = None
    stderr: str | None = None
    error: str | None = None


@app.post("/chat/result")
async def chat_result(body: ChatResultRequest, user: dict = Depends(get_current_user)):
    """Receive R code execution result from the frontend."""
    agent = _active_agents.get(user["id"])
    if not agent:
        raise HTTPException(status_code=404, detail="No active agent")
    agent.submit_result(body.execution_id, {
        "success": body.success,
        "stdout": body.stdout or "",
        "stderr": body.stderr or "",
        "error": body.error or "",
    })
    return {"received": True}
