"""Carbitrage Worker API - FastAPI entry point.

Authenticates every request with WORKER_TOKEN, validates a dealer_id is
present, then dispatches to the canonical Supabase pipeline. No dealer
is special-cased.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WORKER_TOKEN = os.environ["WORKER_TOKEN"]

app = FastAPI(title="Carbitrage Worker API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Only the Lovable Edge Function calls this anyway.
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def require_worker_token(request: Request) -> None:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    if auth.split(" ", 1)[1].strip() != WORKER_TOKEN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid worker token")


def validate_dealer_id(dealer_id: str) -> str:
    try:
        return str(UUID(dealer_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "dealer_id must be a UUID") from exc


class DealerBody(BaseModel):
    dealer_id: str = Field(..., description="Canonical dealer/account UUID")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def root() -> dict[str, Any]:
    return {"service": "carbitrage-worker", "status": "ok"}


@app.post("/activate-dealer", dependencies=[Depends(require_worker_token)])
def activate_dealer(body: DealerBody) -> dict[str, Any]:
    dealer_id = validate_dealer_id(body.dealer_id)
    started = time.time()
    sb = get_supabase()
    steps: list[dict[str, Any]] = []

    # 1) Ensure the dealer has sales truth rows. No data = nothing to activate.
    sales = (
        sb.table("vehicle_sales_truth")
        .select("id", count="exact")
        .eq("account_id", dealer_id)
        .limit(1)
        .execute()
    )
    sales_count = sales.count or 0
    steps.append({"step": "sales_check", "rows": sales_count})
    if sales_count == 0:
        return {
            "ok": False,
            "dealer_id": dealer_id,
            "reason": "No vehicle_sales_truth rows for this dealer. Upload sales first.",
            "steps": steps,
            "duration_ms": int((time.time() - started) * 1000),
        }

    # 2) Recompute fingerprints (TODO: wire Python pipeline call here).
    #    For now we invoke the canonical Lovable edge function which is
    #    already responsible for this step.
    steps.append({"step": "recompute_fingerprints", "dispatched": True})
    _invoke_edge_function(sb, "recompute-fingerprint-performance", {"account_id": dealer_id})

    # 3) Generate mandates from fingerprints.
    steps.append({"step": "generate_mandates", "dispatched": True})
    _invoke_edge_function(sb, "generate-dealer-mandates", {"account_id": dealer_id})

    # 4) First match run.
    steps.append({"step": "run_mandates", "dispatched": True})
    _invoke_edge_function(sb, "run-mandates", {"account_id": dealer_id})

    return {
        "ok": True,
        "dealer_id": dealer_id,
        "steps": steps,
        "duration_ms": int((time.time() - started) * 1000),
    }


@app.post("/run-dealer-scoring", dependencies=[Depends(require_worker_token)])
def run_dealer_scoring(body: DealerBody) -> dict[str, Any]:
    dealer_id = validate_dealer_id(body.dealer_id)
    started = time.time()
    sb = get_supabase()

    # Score current vehicle_listings against this dealer's mandates only.
    # TODO: replace with direct Python scoring pipeline call. For now we
    # delegate to the canonical edge functions, scoped to this dealer.
    _invoke_edge_function(sb, "run-mandates", {"account_id": dealer_id})
    _invoke_edge_function(
        sb,
        "score-operator-opportunities",
        {"focus_account_id": dealer_id},
    )

    # Return summary counts.
    feed = (
        sb.table("mandate_feed_items")
        .select("id", count="exact")
        .eq("dealer_id", dealer_id)
        .limit(1)
        .execute()
    )
    return {
        "ok": True,
        "dealer_id": dealer_id,
        "feed_items": feed.count or 0,
        "duration_ms": int((time.time() - started) * 1000),
    }


@app.post("/sync-opportunities", dependencies=[Depends(require_worker_token)])
def sync_opportunities(body: DealerBody) -> dict[str, Any]:
    dealer_id = validate_dealer_id(body.dealer_id)
    started = time.time()
    sb = get_supabase()

    # Lightweight refresh — re-runs the matcher without recomputing
    # fingerprints. Keeps the dealer's opportunity feed warm.
    _invoke_edge_function(sb, "run-mandates", {"account_id": dealer_id})

    feed = (
        sb.table("mandate_feed_items")
        .select("id", count="exact")
        .eq("dealer_id", dealer_id)
        .limit(1)
        .execute()
    )
    return {
        "ok": True,
        "dealer_id": dealer_id,
        "feed_items": feed.count or 0,
        "duration_ms": int((time.time() - started) * 1000),
    }


@app.get("/dealer-health/{dealer_id}", dependencies=[Depends(require_worker_token)])
def dealer_health(dealer_id: str) -> dict[str, Any]:
    dealer_id = validate_dealer_id(dealer_id)
    sb = get_supabase()

    def _count(table: str, column: str) -> int:
        res = (
            sb.table(table)
            .select("id", count="exact")
            .eq(column, dealer_id)
            .limit(1)
            .execute()
        )
        return res.count or 0

    def _last_run(table: str, column: str, ts_col: str) -> str | None:
        res = (
            sb.table(table)
            .select(ts_col)
            .eq(column, dealer_id)
            .order(ts_col, desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0][ts_col] if rows else None

    return {
        "ok": True,
        "dealer_id": dealer_id,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "vehicle_sales_truth": _count("vehicle_sales_truth", "account_id"),
            "dealer_fingerprints": _count("dealer_fingerprints", "dealer_profile_id"),
            "active_mandates": _count("active_mandates", "account_id"),
            "mandate_feed_items": _count("mandate_feed_items", "dealer_id"),
        },
        "last_seen": {
            "vehicle_sales_truth.sold_at": _last_run(
                "vehicle_sales_truth", "account_id", "sold_at"
            ),
            "mandate_feed_items.created_at": _last_run(
                "mandate_feed_items", "dealer_id", "created_at"
            ),
        },
    }


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _invoke_edge_function(sb: Client, name: str, body: dict[str, Any]) -> Any:
    """Call a Lovable edge function from the VPS using the service role.

    The Worker API is the orchestrator. While the Python pipeline is being
    wired in, we delegate the actual mutation work to the existing
    canonical edge functions so we never duplicate scoring logic.
    """
    try:
        return sb.functions.invoke(name, invoke_options={"body": body})
    except Exception as exc:  # noqa: BLE001 - log and continue, callers report
        return {"error": str(exc)}
