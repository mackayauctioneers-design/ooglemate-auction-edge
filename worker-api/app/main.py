"""Carbitrage Worker API - FastAPI entry point.

Authenticates every request with WORKER_TOKEN, validates a dealer_id is
present, then dispatches to the canonical Supabase pipeline. No dealer
is special-cased. The Lovable Hub is the dealer identity source of
truth; this worker never creates dealers — unmapped scrape sources are
written to ``dealer_unmapped_sources`` for operator review.
"""
from __future__ import annotations

import os
import time
from datetime import date, datetime, timezone
from typing import Any, Iterable
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

# Disappearance count that promotes inferred sales into vehicle_sales_truth.
SOLD_PROMOTION_THRESHOLD = int(os.environ.get("SOLD_PROMOTION_THRESHOLD", "1"))
DEFAULT_SALE_CONFIDENCE = float(os.environ.get("DEFAULT_SALE_CONFIDENCE", "0.7"))

app = FastAPI(title="Carbitrage Worker API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


class ScrapeAllBody(BaseModel):
    only_dealer_id: str | None = Field(None, description="Optional restriction to one dealer")


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

    steps.append({"step": "recompute_fingerprints", "dispatched": True})
    _invoke_edge_function(sb, "recompute-fingerprint-performance", {"account_id": dealer_id})

    steps.append({"step": "generate_mandates", "dispatched": True})
    _invoke_edge_function(sb, "generate-dealer-mandates", {"account_id": dealer_id})

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

    _invoke_edge_function(sb, "run-mandates", {"account_id": dealer_id})
    _invoke_edge_function(
        sb,
        "score-operator-opportunities",
        {"focus_account_id": dealer_id},
    )

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
        res = sb.table(table).select("id", count="exact").eq(column, dealer_id).limit(1).execute()
        return res.count or 0

    def _last(table: str, column: str, ts_col: str) -> str | None:
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

    health = (
        sb.table("dealer_scrape_health")
        .select("*")
        .eq("account_id", dealer_id)
        .limit(1)
        .execute()
    )
    return {
        "ok": True,
        "dealer_id": dealer_id,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "scrape": (health.data or [None])[0],
        "counts": {
            "vehicle_sales_truth": _count("vehicle_sales_truth", "account_id"),
            "dealer_fingerprints": _count("dealer_fingerprints", "dealer_profile_id"),
            "active_mandates": _count("active_mandates", "account_id"),
            "mandate_feed_items": _count("mandate_feed_items", "dealer_id"),
            "sold_vehicles_active": _count("sold_vehicles", "dealer_id"),
        },
        "last_seen": {
            "mandate_feed_items.created_at": _last(
                "mandate_feed_items", "dealer_id", "created_at"
            ),
        },
    }


# ---------------------------------------------------------------------------
# Dealer-site scrape pipeline
# ---------------------------------------------------------------------------

@app.post("/scrape-dealer-sites", dependencies=[Depends(require_worker_token)])
def scrape_dealer_sites(body: ScrapeAllBody) -> dict[str, Any]:
    """Iterate every enabled scrape target, write snapshots, infer sales.

    Targets without a canonical ``account_id`` are pushed into
    ``dealer_unmapped_sources`` and skipped — never silently dropped.
    """
    started = time.time()
    sb = get_supabase()

    targets, unmapped = _load_active_targets(sb)
    if body.only_dealer_id:
        dealer_id = validate_dealer_id(body.only_dealer_id)
        targets = [t for t in targets if t.get("account_id") == dealer_id]

    results: list[dict[str, Any]] = []
    for target in targets:
        results.append(_run_dealer_scrape(sb, target))

    return {
        "ok": True,
        "targets_run": len(results),
        "unmapped_count": len(unmapped),
        "results": results,
        "unmapped": unmapped,
        "duration_ms": int((time.time() - started) * 1000),
    }


def _load_active_targets(sb: Client) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (mapped_targets, unmapped_targets).

    Unmapped rows are upserted into ``dealer_unmapped_sources`` so operators
    can resolve them inside the Hub.
    """
    res = (
        sb.table("dealer_outbound_sources")
        .select(
            "id, account_id, dealer_slug, dealer_name, dealer_domain, "
            "inventory_path, adapter_type, scrape_enabled"
        )
        .eq("scrape_enabled", True)
        .execute()
    )
    mapped: list[dict[str, Any]] = []
    unmapped: list[dict[str, Any]] = []
    for row in res.data or []:
        if row.get("account_id"):
            mapped.append(row)
        else:
            unmapped.append(row)
            try:
                sb.table("dealer_unmapped_sources").upsert(
                    {
                        "source_slug": row["dealer_slug"],
                        "source_name": row.get("dealer_name"),
                        "source_domain": row.get("dealer_domain"),
                        "last_seen_at": datetime.now(timezone.utc).isoformat(),
                        "sample_payload": {"target": row},
                        "status": "open",
                    },
                    on_conflict="source_slug",
                ).execute()
            except Exception:  # noqa: BLE001 - best-effort logging
                pass
    return mapped, unmapped


def _run_dealer_scrape(sb: Client, target: dict[str, Any]) -> dict[str, Any]:
    """Execute one dealer-site scrape cycle.

    The HTML fetch + parse lives in ``app/pipelines/dealer_site.py``
    (pluggable per ``adapter_type``). This function owns the canonical
    storage contract: every write carries ``account_id``.
    """
    account_id = target["account_id"]
    worker_name = f"dealer_site:{target.get('adapter_type') or 'default'}"
    run_started = datetime.now(timezone.utc).isoformat()

    # 1) Open scrape_runs audit row
    run_insert = (
        sb.table("trap_crawl_runs")
        .insert(
            {
                "trap_slug": target["dealer_slug"],
                "dealer_name": target.get("dealer_name"),
                "account_id": account_id,
                "worker_name": worker_name,
                "parser_mode": target.get("adapter_type") or "default",
                "run_started_at": run_started,
            }
        )
        .execute()
    )
    run_id = (run_insert.data or [{}])[0].get("id")

    try:
        listings = _scrape_target(target)
    except Exception as exc:  # noqa: BLE001
        _close_run(sb, run_id, target, ok=False, error=str(exc))
        return {"account_id": account_id, "ok": False, "error": str(exc)}

    # 2) Read prior active snapshot for diff
    prior = (
        sb.table("sold_vehicles")
        .select("id, stock_number, vin, last_seen, sold_date, sale_confidence")
        .eq("dealer_id", account_id)
        .is_("sold_date", "null")
        .execute()
    )
    prior_rows = prior.data or []
    prior_by_key = {_listing_key(r): r for r in prior_rows}

    # 3) Upsert current listings
    seen_keys: set[str] = set()
    new_count = 0
    for listing in listings:
        key = _listing_key(listing)
        if not key:
            continue
        seen_keys.add(key)
        if key not in prior_by_key:
            new_count += 1
        sb.table("sold_vehicles").upsert(
            {
                "dealer_id": account_id,
                "stock_number": listing.get("stock_number"),
                "vin": listing.get("vin"),
                "make": listing.get("make"),
                "model": listing.get("model"),
                "variant": listing.get("variant"),
                "year": listing.get("year"),
                "km": listing.get("km"),
                "colour": listing.get("colour"),
                "listed_price": listing.get("listed_price"),
                "first_seen": listing.get("first_seen") or run_started,
                "last_seen": run_started,
                "sold_date": None,
                "source": worker_name,
                "raw_snapshot": listing.get("raw") or listing,
            },
            on_conflict="dealer_id,stock_number",
        ).execute()

    # 4) Diff -> mark disappeared as sold_assumed
    disappeared = 0
    promoted: list[dict[str, Any]] = []
    for key, row in prior_by_key.items():
        if key in seen_keys:
            continue
        disappeared += 1
        sb.table("sold_vehicles").update(
            {
                "sold_date": date.today().isoformat(),
                "sale_confidence": DEFAULT_SALE_CONFIDENCE,
                "source": worker_name,
            }
        ).eq("id", row["id"]).execute()
        promoted.append(row)

    # 5) Close audit row + update target health
    _close_run(
        sb,
        run_id,
        target,
        ok=True,
        listings_found=len(listings),
        new_listings=new_count,
        disappeared=disappeared,
    )

    # 6) Promote to sales truth + refresh pipeline if threshold met
    promoted_to_truth = 0
    if disappeared >= SOLD_PROMOTION_THRESHOLD:
        promoted_to_truth = _promote_to_sales_truth(sb, account_id, promoted, worker_name)
        _invoke_edge_function(
            sb, "recompute-fingerprint-performance", {"account_id": account_id}
        )
        _invoke_edge_function(sb, "generate-dealer-mandates", {"account_id": account_id})
        _invoke_edge_function(sb, "run-mandates", {"account_id": account_id})

    return {
        "account_id": account_id,
        "dealer_slug": target["dealer_slug"],
        "ok": True,
        "listings_found": len(listings),
        "new_listings": new_count,
        "disappeared_listings": disappeared,
        "promoted_to_sales_truth": promoted_to_truth,
    }


def _scrape_target(target: dict[str, Any]) -> list[dict[str, Any]]:
    """Adapter dispatch.

    Replace this stub with the existing Python scraper modules per
    ``adapter_type``. Returning [] is treated as a successful but empty
    scrape (the diff will mark everything previously seen as sold), so
    NEVER return [] from a broken parser — raise instead.
    """
    try:
        from app.pipelines import dealer_site  # type: ignore

        return dealer_site.scrape(target)
    except ModuleNotFoundError:
        # No adapter wired yet — surface clearly instead of silently
        # marking the dealer's whole inventory as sold.
        raise RuntimeError(
            f"No scrape adapter for adapter_type={target.get('adapter_type')!r}; "
            "implement app/pipelines/dealer_site.py"
        )


def _listing_key(row: dict[str, Any]) -> str:
    return (row.get("stock_number") or row.get("vin") or "").strip().lower()


def _close_run(
    sb: Client,
    run_id: str | None,
    target: dict[str, Any],
    *,
    ok: bool,
    listings_found: int = 0,
    new_listings: int = 0,
    disappeared: int = 0,
    error: str | None = None,
) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    if run_id:
        sb.table("trap_crawl_runs").update(
            {
                "run_completed_at": now_iso,
                "vehicles_found": listings_found,
                "vehicles_ingested": listings_found,
                "new_listings": new_listings,
                "disappeared_listings": disappeared,
                "error": error,
            }
        ).eq("id", run_id).execute()

    health = "ok" if ok else "failing"
    update_payload: dict[str, Any] = {
        "last_crawl_at": now_iso,
        "last_crawl_count": listings_found,
        "last_crawl_error": error,
        "scrape_health_status": health,
    }
    if ok:
        update_payload["last_successful_scrape_at"] = now_iso
        update_payload["consecutive_failures"] = 0
    sb.table("dealer_outbound_sources").update(update_payload).eq(
        "id", target["id"]
    ).execute()


def _promote_to_sales_truth(
    sb: Client,
    account_id: str,
    promoted: Iterable[dict[str, Any]],
    worker_name: str,
) -> int:
    """Move disappeared snapshots into vehicle_sales_truth (inferred)."""
    count = 0
    for row in promoted:
        # Re-read the snapshot for full vehicle details.
        snap = (
            sb.table("sold_vehicles")
            .select("*")
            .eq("id", row["id"])
            .limit(1)
            .execute()
        )
        rows = snap.data or []
        if not rows:
            continue
        v = rows[0]
        try:
            sb.table("vehicle_sales_truth").insert(
                {
                    "account_id": account_id,
                    "dealer_id": str(account_id),
                    "make": v.get("make"),
                    "model": v.get("model"),
                    "variant": v.get("variant"),
                    "year": v.get("year"),
                    "odometer": v.get("km"),
                    "sale_price": v.get("listed_price"),
                    "sale_date": (v.get("sold_date") or date.today().isoformat()),
                    "vin": v.get("vin"),
                    "source": worker_name,
                    "tier": "inferred",
                }
            ).execute()
            count += 1
        except Exception:  # noqa: BLE001
            # Schema differences are caught here rather than aborting the run.
            continue
    return count


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _invoke_edge_function(sb: Client, name: str, body: dict[str, Any]) -> Any:
    """Call a Lovable edge function from the VPS using the service role."""
    try:
        return sb.functions.invoke(name, invoke_options={"body": body})
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
