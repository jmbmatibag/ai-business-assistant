# System Prompt & Master Plan Extension: Real-Time Intelligence & Advanced Dashboarding

## 1. Objective & Context
This module extends the core backend and dashboard capabilities by leveraging our shared POS database for real-time inventory tracking, proactive alert triggering, and deep-linking metrics directly into the AI conversational interface. We are also introducing long-term analytical trends (Monthly, Quarterly, Semi-Annual, Annual) that aggregate at the End of Day (EOD) to keep dashboard performance lightning-fast.

## 2. Core Architectural Enhancements
* **Real-time Event Bridge:** The backend monitors live inventory levels against calculated run-rates to trigger automated system notifications.
* **Smart Prompt Pre-filling:** Clicking a notification action button redirects the user to the `/chat` route, populating the input field with a dynamically constructed natural language prompt instead of auto-sending it. This leaves the user in full control to modify it before sending.
* **EOD Aggregation Pipelines:** Complex queries covering large date ranges (Quarterly/Annual) are computed via an End-of-Day database worker, saving the results to summary tables to avoid hitting live transaction tables during peak operation hours.

## 2.1 Google Drive Data Sync Deprecation & Dynamic Data Routing
The previously scoped Google Drive file monitoring and CSV synchronization layer is completely deprecated and removed from the system architecture. It is replaced by a direct, real-time connection to the live POS relational database. 

To future-proof this application for multi-store scaling, different franchises, or entirely separate database migrations, the backend must not rely on a single hardcoded database connection. Instead, implement a dynamic connection string routing layer. The application must be capable of changing its external data target dynamically via the application settings UI.

### Dynamic Database Configuration Schema
To support pointing to external databases through the app, implement a `data_source_connections` table in the core application database:

```sql
CREATE TABLE data_source_connections (
    id SERIAL PRIMARY KEY,
    connection_name VARCHAR(100) NOT NULL, -- e.g., 'Cavite Branch Live POS'
    db_dialect VARCHAR(20) DEFAULT 'postgresql', -- e.g., postgresql, mysql
    db_host VARCHAR(255) NOT NULL,
    db_port INTEGER DEFAULT 5432,
    db_username VARCHAR(100) NOT NULL,
    db_password_encrypted TEXT NOT NULL, -- Fernet encrypted string
    db_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

---

## 3. Detailed Feature Specifications & Implementation Phases

Please execute these phases sequentially. Confirm with me once each step is fully functional.

### Phase 1: Real-Time Notifications & Deep-Linked Actions
1. **Database Extension:** Create a `notifications` table:
    * `id`, `store_id`, `type` (e.g., STOCKOUT_RISK, ANOMALY), `message`, `suggested_prompt` (Text field storing the automated prompt text), `status` (Unread/Read), `created_at`.
2. **Backend Inventory Scanner:** Create an endpoint or internal service function that compares current stock quantities against average daily item sales. If stock drops below the required run-rate:
    * Generate a database notification record.
    * Dynamically write the `suggested_prompt`. Example: *"Create a 3-day replenishment plan for Store 5 focusing on Chicken Meals and Spaghetti to resolve the current low-stock warning."*
3. **Frontend Notification Panel:**
    * Build a real-time Notification Toast and a dropdown panel in the navigation header using shadcn/ui components.
    * Each low-stock alert card must feature an action button labeled **"Suggest a Plan"**.
4. **The Chat Redirection Bridge:**
    * When "Suggest a Plan" is clicked, stage the prompt in the Zustand global chat store (`setPendingPrompt(...)`), mark the notification as read, and programmatically navigate the user to the `/assistant` view.
    * The input field inside `ChatInput.tsx` must automatically inherit this text, focusing the cursor so the user can immediately review, edit, or submit the request.

### Phase 2: AI Replenishment Engine (Direct DB Hook)
1. **The Replenishment Tool:** Register a new function tool for Claude called `calculate_replenishment_matrix(store_id, target_days)`.
2. **Logic Execution:** When Claude invokes this tool via chat:
    * The backend queries the current live inventory numbers for that `store_id`.
    * The backend pulls the historical sales volume for those specific items to determine velocity.
    * The system computes the difference: $\text{Required Stock} = (\text{Daily Velocity} \times \text{Target Days}) - \text{Current Stock}$.
    * Returns the clean JSON output back to Claude to be rendered inside the `DeliveryPlanWidget` component in the chat.

### Phase 3: Advanced Dashboard Time Granularities (EOD Summaries)
1. **Database Schema Setup:** Create a `daily_sales_summaries` table to store aggregated historical statistics:
    * `id`, `summary_date`, `store_id`, `category`, `total_quantity_sold`, `total_net_sales`, `total_cancelled_receipts`, `total_gross_profit`.
2. **EOD Worker Script:** Write a script (to run at the close of business daily) that reads raw transaction data from the `receipts` and `sales_items` tables for that day, calculates totals, and inserts them into `daily_sales_summaries`.
3. **Multi-Period API Endpoints:** Build a backend route `/api/analytics/trends?period=X` where `X` accepts: `monthly`, `quarterly`, `semi-annual`, or `annual`. The query must pivot off the `daily_sales_summaries` table to ensure sub-second response times.
4. **Frontend Toggle & Recharts Integration:**
    * At the top of the Dashboard view, implement a shadcn/ui Tabs or Toggle Group component for: **Monthly | Quarterly | Semi-Annual | Annual**.
    * Wire this toggle to fetch data from the updated analytics endpoint and dynamically reload the main Recharts Line and Bar graphs to show long-term operational performance effortlessly.