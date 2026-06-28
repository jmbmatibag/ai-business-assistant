# System Prompt & Master Plan: Dual-Engine Data Sourcing & Multi-CSV Upload

## 1. Objective & Context
The application must support two distinct, isolated modes of operation, controlled by a global UI toggle:
1. **Live Database Mode:** Reads from the connected PostgreSQL POS database.
2. **Local CSV Mode (Ephemeral):** Reads exclusively from user-uploaded CSV files. These files must NOT be saved to the PostgreSQL database. Multiple files can be uploaded at once.

The transition between these modes must instantly update the dashboard metrics and shift the AI Assistant's data context without requiring a page reload.

## 2. Core Architectural Directives
* **Frontend State:** `Zustand` will manage a global `dataSource` state (`'database' | 'csv'`).
* **Backend Ephemeral Engine:** When users upload CSVs, the FastAPI backend will load them into temporary Pandas DataFrames or an in-memory SQLite database (`sqlite:///:memory:`). This allows the AI to use standard SQL tool-calling logic regardless of which data source is active.
* **Stateless Persistence:** If the user refreshes the page while in 'CSV' mode, the ephemeral data is lost. This is the intended behavior for security and memory management.

---

## 3. Execution Phases

Please execute these phases sequentially. Confirm with me once each step is fully functional.

### Phase 1: Global State & UI Toggle
1. **Zustand Update:** Add `dataSource: 'database' | 'csv'` to the global store, along with a `setDataSource` action.
2. **Navigation Header:** Implement a clean shadcn/ui `Tabs` or `Switch` component in the main navigation bar: "[Live POS] <--> [Local CSV]".
3. **UI Reactivity:** When the toggle switches to 'CSV', clear the current dashboard metrics. If no CSVs have been uploaded yet, display a prompt/empty state on the dashboard asking the user to upload files.

### Phase 2: Multi-CSV Uploader (Ephemeral)
1. **Component Update:** Modify the drag-and-drop upload zone to accept multiple files (`multiple={true}`).
2. **Endpoint Creation:** Create a new backend endpoint `/api/data/upload-ephemeral`.
3. **Upload Logic:** When files are dropped, POST them to this new endpoint. Include a visual loading state in the UI.

### Phase 3: The Backend Dual-Engine (The Adapter)
1. **In-Memory Storage:** When `/api/data/upload-ephemeral` receives the CSVs, use Pandas to concatenate them (if they share the same schema like the Loyverse exports) and push them into an in-memory SQLite database tied to the user's active session.
2. **Query Routing Context:** Update all dashboard API routes (e.g., `/api/analytics/dashboard`) and the AI chat endpoint to accept a `source` query parameter or header (e.g., `?source=csv` or `?source=database`).
3. **Dynamic Execution:** * If `source=database`: Route the query to the PostgreSQL SQLAlchemy engine.
    * If `source=csv`: Route the query to the in-memory SQLite engine containing the uploaded data.

### Phase 4: UI/UX Polish
1. **Visual Cues:** When the application is in 'Local CSV' mode, apply a subtle visual indicator (e.g., a colored border or a persistent "CSV Mode Active" badge) so the user never forgets they are looking at static file data instead of live POS data.
2. **Session Cleanup:** Add a "Clear CSV Data" button next to the upload zone that flushes the ephemeral data from the backend session and resets the dashboard.