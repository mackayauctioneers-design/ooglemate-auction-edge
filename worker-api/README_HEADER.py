"""Carbitrage Worker API (reference FastAPI scaffold).

Deployed to the VPS. Owns the Supabase service-role key. Lovable Edge
Functions proxy to this service using WORKER_TOKEN — the browser never
sees either secret.

Endpoints
---------
POST /activate-dealer         body: {"dealer_id": "<uuid>"}
POST /run-dealer-scoring      body: {"dealer_id": "<uuid>"}
POST /sync-opportunities      body: {"dealer_id": "<uuid>"}
GET  /dealer-health/{dealer_id}

All actions are scoped strictly by `dealer_id`. There is no Patrick or
Mackay specific code path. All reads/writes target canonical tables:

  - vehicle_sales_truth      (dealer sales)
  - dealer_fingerprints      (computed fingerprints)
  - active_mandates          (open buy mandates)
  - vehicle_listings         (live market listings)
  - mandate_feed_items       (live matches / opportunities)
  - worker_runs              (audit log; written by Lovable proxy)

Run locally
-----------
    cp .env.example .env
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8080
"""
