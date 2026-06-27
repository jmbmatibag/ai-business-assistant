# System Prompt & Master Plan: Backend, Auth, and AI Configuration

## 1. Objective & Context
We have successfully completed Phases 1 through 5 of the frontend. We are now transitioning our local development environment (Docker, VS Code, Claude Code) to build out the backend infrastructure, a secure authentication layer, and the database integration. 

Instead of an asynchronous file synchronization pipeline, this application will read directly from the live PostgreSQL database of our custom POS system. The system data structure must map directly to the data fields found in 'DUMMY SALES SHEET - DUMMY_SALES_SHEET_CAVITE.csv', but stored as native relational tables. Cancelled transactions must be fully preserved in the database to allow the AI to track them as a key metric for operational anomalies.

## 2. Technology Stack Extensions
* **Backend Framework:** FastAPI (Python)
* **Database:** PostgreSQL (running inside a local Docker container for development)
* **ORM:** SQLAlchemy with Alembic for database migrations
* **Authentication:** JWT (JSON Web Tokens) with Passlib (bcrypt) for password hashing
* **AI Engine Connection:** Anthropic Python SDK (Claude API)

---

## 3. Execution Phases

Please execute the following backend implementation phases. Stop and ask for my confirmation before proceeding past each major milestone.

### Phase 1: PostgreSQL Schema Design (POS Native Integration)
1. Initialize a PostgreSQL container configuration in our local Docker setup.
2. Design and create the core relational tables matching the fields from 'DUMMY SALES SHEET - DUMMY_SALES_SHEET_CAVITE.csv':
    * `users`: `id`, `username`, `password_hash`, `role`, `created_at`
    * `stores`: `id`, `store_name` (e.g., COTERIE 1)
    * `receipts`: `id`, `receipt_number`, `receipt_type`, `date`, `status` (Strictly preserve 'Closed' and 'Cancelled' statuses), `store_id`
    * `sales_items`: `id`, `receipt_id`, `category`, `sku`, `item_name`, `quantity`, `gross_sales`, `net_sales`, `gross_profit`
3. Write a database seed script that takes the rows from 'DUMMY SALES SHEET - DUMMY_SALES_SHEET_CAVITE.csv' and populates these relational tables so we have immediate real-world data to test against.

### Phase 2: Secure Authentication Infrastructure
1. **Backend Integration:** 
    * Create an `/api/auth/register` and `/api/auth/login` endpoint in FastAPI.
    * Implement password hashing using bcrypt.
    * Generate secure access tokens using JWT with an expiration timeframe (e.g., 24 hours).
    * Create a dependency function `get_current_user` to secure private endpoints.
2. **Frontend Wiring:**
    * Create a clean, modern `/login` page using shadcn/ui components.
    * Implement a global auth state store using Zustand (`useAuthStore`) to track tokens and login state.
    * Protect application routes: Redirect unauthenticated users back to the `/login` screen if they attempt to access dashboards or the chat workspace.

### Phase 3: AI Configuration Settings Layout & Storage
We want the user to be able to fine-tune how the AI acts directly from the app interface.
1. **Database Strategy:** Create an `ai_settings` table to store system parameters dynamically:
    * `id`, `current_model` (e.g., claude-3-5-sonnet), `base_system_prompt`, `default_safety_stock` (percentage integer), `anomaly_threshold`.
2. **Backend Architecture:** Write a CRUD route to fetch and update these configuration settings.
3. **Frontend Implementation:**
    * Update the `/settings` page to include an "AI Configuration" panel.
    * Use shadcn/ui forms to let users adjust the Base System Prompt, change default safety stocks via slider or input, and view model configuration parameters.
    * Bind this view to the backend endpoints so adjustments save persistently.

### Phase 4: Connecting Claude to the Database via Tool Use
1. Set up an endpoint `/api/chat/message` that accepts user prompts and pulls conversation history.
2. When a user sends a chat message, the backend must fetch the operational parameters from the `ai_settings` table to construct Claude's system prompt instructions dynamically.
3. Equip Claude with Python "Tools" (Function Calling) that allow it to execute read-only SQL queries or structured analytics functions against our data tables. Ensure it has a dedicated tool to scan the `receipts` table for a spike in `Cancelled` entries to call out operational anomalies.