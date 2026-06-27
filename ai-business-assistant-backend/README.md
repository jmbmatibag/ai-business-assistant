# AI Business Assistant — Backend

FastAPI + PostgreSQL backend that reads directly from the POS data model.

## Stack
- **FastAPI** (Python)
- **PostgreSQL 16** (local Docker container)
- **SQLAlchemy 2.0** + **Alembic** (ORM & migrations)
- **JWT** + **Passlib/bcrypt** (auth — Phase 2)
- **Anthropic SDK** (Claude — Phase 4)

## Phase 1 — Database schema & seed (done)

### Schema
| Table         | Key columns |
|---------------|-------------|
| `users`       | id, username, password_hash, role, created_at |
| `stores`      | id, store_name |
| `receipts`    | id, receipt_number, receipt_type, date, **status** (`Closed`/`Cancelled`, preserved verbatim), store_id |
| `sales_items` | id, receipt_id, category, sku, item_name, quantity, gross_sales, net_sales, gross_profit |

Cancelled transactions are kept in full so the AI can track cancellation spikes
as an operational-anomaly metric.

## Local setup

```bash
# 1. Copy env and start PostgreSQL
cp .env.example .env
docker compose up -d db

# 2. Create a virtualenv and install deps
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt

# 3. Apply migrations
alembic upgrade head

# 4. Seed from the dummy POS export
python -m scripts.seed --reset
```

The seed reads `data/dummy_sales_cavite.csv`. It is idempotent (dedupes by
`receipt_number`); `--reset` clears stores/receipts/sales_items first.

## Phase 2 — Authentication (done)

JWT + bcrypt auth. `bcrypt` is pinned to `4.0.1` for passlib 1.7.4 compatibility.

### Run the API

```bash
uvicorn app.main:app --reload --port 8000
```

Interactive docs at http://127.0.0.1:8000/docs.

### Endpoints
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/register` | `{username, password, role?}` → 201 + token |
| POST | `/api/auth/login` | `{username, password}` → token |
| GET  | `/api/auth/me` | Bearer token required → current user |
| GET  | `/api/health` | liveness check |

Tokens are JWTs (HS256) whose `sub` is the user id, expiring after
`ACCESS_TOKEN_EXPIRE_MINUTES` (default 24h). Secure private endpoints with the
`get_current_user` dependency (`app/api/deps.py`).

## Phase 3 — AI Configuration (done)

A single-row `ai_settings` table holds the operational parameters that shape
the assistant. Defaults seed on first read; the singleton row is created
automatically (`get_or_create_settings`).

| Column | Default | Meaning |
|--------|---------|---------|
| `current_model` | `claude-opus-4-8` | Claude model powering the assistant |
| `base_system_prompt` | (business-assistant prompt) | Standing instructions |
| `default_safety_stock` | `20` | Buffer stock % above forecast (0–100) |
| `anomaly_threshold` | `3` | Cancelled txns/store/day that flag an anomaly |

### Endpoints (all require a Bearer token)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/ai-settings` | Read settings (creates defaults on first call) |
| PUT | `/api/ai-settings` | Partial update; validates model + ranges (422 on bad input) |
| GET | `/api/ai-settings/models` | Selectable models with display labels |

The frontend "AI Configuration" panel lives on the `/settings` page
(`components/settings/AIConfigPanel.tsx`) and binds to these endpoints.

## Phase 4 — Claude + database via tool use (done)

`POST /api/chat/message` runs a Claude turn over the live POS data. The system
prompt is built dynamically from `ai_settings` (model, safety stock, anomaly
threshold) on every request, and Claude is given **read-only** database tools.

### Setup
Add your key to `.env` to enable the chat:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Without a key the endpoint returns `503` with a clear message; the tool layer
and prompt builder still work and are independently testable.

### Tools (all read-only)
| Tool | Purpose |
|------|---------|
| `run_readonly_sql` | Single guarded `SELECT` (validator + `SET TRANSACTION READ ONLY`, rolled back; capped at 200 rows) |
| `get_sales_summary` | Aggregate Closed-receipt sales, optional store/date filters |
| `scan_cancellation_anomalies` | **Dedicated**: store/day Cancelled-receipt counts ≥ the configured `anomaly_threshold` |

### Endpoints (Bearer token required)
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/chat/message` | `{message, conversation_id?}` → `{conversation_id, reply, tools_used}`. Omit `conversation_id` to start a new conversation. |
| GET | `/api/chat/conversations/{id}/messages` | Full message history for a conversation |

Conversations and messages are persisted (`conversations`, `chat_messages`
tables, migration `0003`) and scoped to the authenticated user. The model used
is whatever `ai_settings.current_model` is set to (default `claude-opus-4-8`);
the manual tool-use loop is capped at 6 iterations.

## Connection
- From the host: `postgresql+psycopg2://aiba:aiba_dev_password@localhost:5434/aiba`
  (host port **5434** is used to avoid clashing with a locally-installed
  PostgreSQL already bound to 5432).
- Inside the docker network the host is the service name `db` on port `5432`.
