# 🏗️ Project Blueprint: Dual-Layer Persistence (SQLite + Google Sheets)

## 1. Executive Summary
This document outlines the architectural plan to transition the Telegram Payment Bot from volatile in-memory storage to a robust, dual-layered persistence system.
- **Primary Layer (SQLite):** Local, high-speed, reliable "Source of Truth".
- **Secondary Layer (Google Sheets):** Remote, real-time "Human Visibility" dashboard.

---

## 2. Unified Data Schema
Both SQLite and Google Sheets will share the following structure (12 columns).

| Field | Type | Google Sheet Col | Description |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT PRIMARY KEY` | `A` | Unique Request ID (Timestamp based) |
| `timestamp` | `TEXT` | `B` | ISO 8601 creation time |
| `requester_id` | `TEXT` | `C` | Telegram ID of the person who initiated |
| `recipient` | `TEXT` | `D` | Name of the payee |
| `amount` | `TEXT` | `E` | Payment amount |
| `item` | `TEXT` | `F` | Goods or service description |
| `manager_status` | `TEXT` | `G` | `PENDING`, `APPROVED`, `DECLINED` |
| `manager_id` | `TEXT` | `H` | Telegram ID of the approving manager |
| `manager_reason` | `TEXT` | `I` | Reason for decline (optional if approved) |
| `accountant_status`| `TEXT` | `J` | `PENDING`, `CONFIRMED`, `ISSUE` |
| `accountant_id` | `TEXT` | `K` | Telegram ID of the accountant |
| `accountant_reason`| `TEXT` | `L` | Details of payment or issue |

---

## 3. Component Architecture

### 3.1 SQLite Database (`utils/db.js`)
A singleton wrapper using the `better-sqlite3` library (preferred for performance and synchronous API in Node.js).
- **`init()`**: Checks for `database.sqlite` and creates the `requests` table if missing.
- **`createRequest(req)`**: Inserts a new row with initial `PENDING` statuses.
- **`updateManager(id, status, reason, managerId)`**: Updates columns G, H, I.
- **`updateAccountant(id, status, reason, accId)`**: Updates columns J, K, L.
- **`getRequest(id)`**: Fetches a specific row for state validation.

### 3.2 Google Sheets Syncer (`utils/sheetsSync.js`)
A "Fire-and-Forget" synchronization layer that maps DB changes to the cloud.
- **`appendRow(data)`**: Uses the `google-sheets` skill to add a new line.
- **`updateCells(id, dataMap)`**:
    1. Reads Column A to find the row index matching the `id`.
    2. Maps the `dataMap` keys to column indices (G-L).
    3. Writes the updates back to the specific row range.
- **Error Handling:** If Sheets API fails, the error is logged to console but **does not block** the bot's workflow.

### 3.3 Main Controller (`index.js`)
Refactored to remove `pendingRequests = {}`.
- **Validation Loop:** On successful AI extraction, `db.createRequest` is called immediately.
- **Callback Handlers:** Instead of checking an object, handlers will query `db.getRequest(id)` to ensure the transaction exists and hasn't been double-processed.

---

## 4. Implementation Step-by-Step

> [!IMPORTANT]
> **STRICT ADHERENCE RULE:** Never proceed beyond the specifically requested task or phase. If the user asks for Phase X.X, only that sub-phase must be completed. Mark off each completed task with `[x]` only after it is fully implemented and verified.

### Phase 1: Infrastructure (Setup)
- [x] **1.1 Install Dependencies:** Install `better-sqlite3`.
- [x] **1.2 Environment Configuration:** Ensure `GOOGLE_SERVICE_ACCOUNT_KEY` and `SPREADSHEET_ID` are in `.env`.
- [x] **1.3 Google Sheets Header Initialization:** Create a script to write the header row (A1:L1) to the Google Sheet if empty.

### Phase 2: The Database Layer
- [x] **2.1 Create Database Module:** Create `utils/db.js`.
- [x] **2.2 Implement Initialization Logic:** Implement `init()` with the `requests` table schema.
- [x] **2.3 Implement CRUD Operations:** Implement `createRequest`, `updateManager`, `updateAccountant`, and `getRequest`.
- [x] **2.4 Verify Database:** Write a small test script to verify `database.sqlite` creation and data insertion.

### Phase 3: The Synchronization Layer
- [x] 3.1 Create Sync Module: Create `utils/sheetsSync.js`.
- [x] 3.2 Implement Row Lookup: Implement row-finding logic (Read Col A -> `indexOf(id)`).
- [x] 3.3 Implement Update Logic: Implement cell-mapping logic for Manager/Accountant updates.
- [x] 3.4 Resilience: Wrap all Sheet calls in `try/catch` to ensure bot resilience.

### Phase 4: Integration & Refactoring
- [x] 4.1 Import Modules: Import `db` and `sheetsSync` into `index.js`.
- [x] 4.2 Replace In-Memory Storage: Replace `pendingRequests` usage with `db` calls.
- [x] 4.3 Integrate Sync: Inject sync calls after every successful DB write.
- [x] 4.4 Update State Management: Update the `actionState` logic to pull current data from the DB when a "Reason" is provided via reply.

---

## 5. Failure Mode Analysis (Safety)

| Failure | Impact | Mitigation |
| :--- | :--- | :--- |
| **SQLite Write Fails** | Bot stops processing the request. | Critical error sent to user; request is not routed. |
| **Google Sheets Offline** | Visibility is lost, but bot continues. | Log error to console; Notify Admin that sync is delayed. |
| **Double Click (Race)** | User clicks "Approve" twice. | SQLite `update` returns `0` affected rows or check status before update. |
| **Server Restart** | In-memory data is lost. | **NO IMPACT.** SQLite persists all pending requests; bot resumes from DB state. |

---

## 6. Verification Checklist
- [ ] Row created in SQL and Sheets on initial request.
- [ ] Manager approval updates Row X, Cols G-I in both.
- [ ] Accountant confirmation updates Row X, Cols J-L in both.
- [ ] Bot survives a crash/restart without losing "Pending" requests.
- [ ] Sheets sync failure does not crash the Telegram bot.
