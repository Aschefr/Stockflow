<!-- refreshed: 2026-07-18 -->
# Architecture

**Analysis Date:** 2026-07-18

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                      Presentation Layer (React/TS)                    │
├──────────────┬──────────────┬──────────────┬────────────────────────┤
│  App.tsx     │  BomTab.tsx  │ ProductForm  │  ScrapeComponents       │
│  (Main)      │  (BOM Mgt)   │  (CRUD)      │  (Scraping UI)          │
│ `src/App.tsx`│ `src/BomTab.tsx`│`src/ProductForm.tsx`│`src/ScrapeComponents.tsx`│
└──────┬───────┴──────┬───────┴──────┬───────┴───────────┬────────────┘
       │              │              │                    │
       ▼              ▼              ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Tauri IPC Bridge (invoke / events)                    │
│              `@tauri-apps/api/core` + `@tauri-apps/api/event`        │
└─────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Rust Backend (Tauri v2 Commands)                     │
├────────────┬────────────┬────────────┬────────────┬─────────────────┤
│  lib.rs    │  db.rs     │  events.rs │  config.rs │  scraper_*.rs   │
│ (Handlers) │ (SQLite)   │(Event Src) │ (Settings) │ (Scrape Engine)  │
│ `src-tauri/│ `src-tauri/│ `src-tauri/│ `src-tauri/│ `src-tauri/     │
│  src/lib.rs`│ src/db.rs`│ src/events.rs`│src/config.rs`│src/scraper*.rs`│
└──────┬──────┴─────┬──────┴──────┬─────┴──────┬─────┴────────────────┘
       │            │             │            │
       ▼            ▼             ▼            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Storage & External Layers                            │
├────────────────────┬────────────────────┬────────────────────────────┤
│  Network Share     │  Local SQLite DB   │  Web (HTTP / SearXNG)      │
│  `{network_path}/` │  `%APPDATA%/       │  VPC APIs, WebView         │
│  (JSON events,     │   Stockflow/       │  Scraper                   │
│   media, cache)    │   stockflow.db`    │                            │
└────────────────────┴────────────────────┴────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App | Main orchestrator — all state, all views, all handlers | `src/App.tsx` |
| BomTab | Bill of Materials (BOM) CRUD, PDF/Excel export, DnD sorting | `src/BomTab.tsx` |
| ProductDetailPanel | Sidebar detail view, image carousel, stock movements, audit log | `src/ProductDetailPanel.tsx` |
| ProductForm | Create/Edit product modal, scraping controls, media management | `src/ProductForm.tsx` |
| ScrapeProgressBadge | Inline scraping progress indicator with cancel/resume | `src/ScrapeComponents.tsx` |
| AutoFillModal | Full candidate review modal (properties, resources, sources) | `src/ScrapeComponents.tsx` |
| iframeScraper | In-browser iframe-based scraping fallback | `src/utils/iframeScraper.ts` |
| lib.rs | Tauri command handler registration & 60+ IPC commands | `src-tauri/src/lib.rs` |
| config.rs | AppConfig struct, load/save from `%APPDATA%/Stockflow/config.json` | `src-tauri/src/config.rs` |
| db.rs | SQLite schema, product/history/bom queries | `src-tauri/src/db.rs` |
| events.rs | Event sourcing — write/read JSON event files, sync to SQLite | `src-tauri/src/events.rs` |
| scraper_task.rs | Async task queue — enqueue, worker, cancel, resume | `src-tauri/src/scraper_task.rs` |
| scraper_engine.rs | Scraping orchestrator — one-pass data collection per SKU | `src-tauri/src/scraper_engine.rs` |
| scraper.rs | HTTP scraping logic, WebView scrape, provider-specific scrapers | `src-tauri/src/scraper.rs` |
| scraper_http.rs | Stealth HTTP client, rate limiting, user agents | `src-tauri/src/scraper_http.rs` |
| scraper_extractor.rs | HTML/JSON-LD data extraction (price, dimensions, images, PDFs) | `src-tauri/src/scraper_extractor.rs` |
| scraper_candidates.rs | Candidate data model, JSON cache persistence | `src-tauri/src/scraper_candidates.rs` |
| providers.rs | VPC provider enum (RS, Farnell, Mouser, Conrad) with scrape dispatch | `src-tauri/src/providers.rs` |
| searxng.rs | SearXNG search API client | `src-tauri/src/searxng.rs` |
| csv_importer.rs | CSV import with Win-1252 decoding, DB upsert | `src-tauri/src/csv_importer.rs` |
| backup.rs | Backup scheduler with config, lock, rotation | `src-tauri/src/backup.rs` |

## Pattern Overview

**Overall:** Desktop-native Tauri app with offline-capable event sourcing architecture.

**Key Characteristics:**
- **Event sourcing persistence**: All mutations write timestamped JSON event files to a shared network folder; local SQLite is a read cache replayed from events.
- **Offline-first**: When network share is unreachable, events queue in `pending_events` SQLite table and sync when connectivity returns.
- **Background scraping**: Async task queue (`ScrapeTaskManager`) with single-worker execution, cancellation tokens, progress events.
- **Monolithic frontend**: All application state lives in `App.tsx` with no client-side router or state management library.
- **Tauri IPC bridge**: React frontend communicates with Rust backend exclusively through `invoke()` commands and `listen()` events.

## Layers

**Presentation Layer (React/TypeScript):**
- Purpose: UI rendering, user interaction, local UI state
- Location: `src/`
- Contains: React components (`App.tsx`, `BomTab.tsx`, `ProductForm.tsx`, `ProductDetailPanel.tsx`, `ScrapeComponents.tsx`), CSS (`App.css`), utility (`utils/iframeScraper.ts`)
- Depends on: `@tauri-apps/api/core` (invoke), `@tauri-apps/api/event` (listen), `@tauri-apps/plugin-opener` (openPath)
- Used by: End user via desktop window

**IPC Bridge:**
- Purpose: Serialized command/event channel between frontend and backend
- Location: Implicit in `@tauri-apps/api/core` invoke/listen API
- Contains: 60+ registered commands in `lib.rs`, custom Tauri events (`scrape-task-progress`, `scrape-task-complete`, `scrape-task-error`)
- Used by: All frontend components

**Backend Layer (Rust):**
- Purpose: Business logic, I/O, HTTP scraping, persistence, file system operations
- Location: `src-tauri/src/`
- Contains: Command handlers (`lib.rs`), persistence (`db.rs`, `events.rs`, `config.rs`), scraping engine (`scraper*.rs`, `providers.rs`, `searxng.rs`), utilities (`csv_importer.rs`, `backup.rs`)
- Depends on: rusqlite, reqwest, serde, tauri, tokio
- Used by: Frontend via IPC

**Storage Layer:**
- Purpose: Data persistence
- Contains: Network share (JSON events + media + scrape cache), local SQLite DB (cached products + pending events), config file (`%APPDATA%/Stockflow/config.json`)
- Used by: Rust backend

**External Layer:**
- Purpose: Web data retrieval
- Contains: SearXNG instances (product search), VPC supplier websites (RS Components, Farnell, Mouser, Conrad), VPC REST APIs (Farnell API, Mouser API)
- Used by: Scraping engine

## Data Flow

### Primary Request Path (Product CRUD)

1. User submits form in `ProductForm.tsx` → `onSubmit` handler calls `invoke("create_product", {...})` in `src/App.tsx:160`
2. Rust command handler `create_product()` in `src-tauri/src/lib.rs:160` validates SKU, computes diffs from existing product
3. Handler calls `events::write_audit_file()` in `src-tauri/src/events.rs` for each changed field → JSON audit file written to `{network_path}/audit/`
4. Handler calls `events::write_event_file()` → JSON event file written to `{network_path}/events/`
5. Event is also applied immediately to local SQLite cache via `apply_single_event()` in `src-tauri/src/events.rs`
6. Frontend receives `Result<()>` → shows success toast, triggers `syncAndFetch()` to refresh products list

### Event Sourcing Sync (Background Polling)

1. `useEffect` in `App.tsx:1068` sets a 4-second interval calling `syncAndFetch(config)`
2. `syncAndFetch()` in `src/App.tsx:1080` calls `invoke("sync_events", { networkPath })`
3. Rust `sync_events()` in `src-tauri/src/lib.rs:151` spawns blocking task:
   - Reads all unprocessed `.json` files from `{network_path}/events/`
   - Reads all audit files from `{network_path}/audit/`
   - Applies each to local SQLite DB, marks as processed in `applied_events` table
4. After sync, `invoke("get_products")` refreshes the products cache
5. `invoke("get_dashboard_stats")` updates dashboard numbers
6. If selected product exists, refreshes its media, history, and audit log

### Background Scraping Flow

1. User clicks "Scraper" in `ProductForm.tsx` → `handleLaunchUnifiedScrape()` in `App.tsx:500` → `invoke("start_background_scrape", { sku, ... })`
2. Rust handler enqueues task in `ScrapeTaskManager::enqueue()` (`src-tauri/src/scraper_task.rs:79`)
3. Worker picks up task: runs `scraper_engine::run_scrape_for_sku()` in `src-tauri/src/scraper_engine.rs`
4. Engine iterates through providers: VPC site (RS webview / Farnell API / Mouser API) → SearXNG search → generic web scrape
5. Progress emitted via `app_handle.emit("scrape-task-progress", payload)` 
6. On completion: candidates saved to `{network_path}/scrape_cache/{SKU}.json`
7. Event `scrape-task-complete` emitted to frontend
8. Frontend `useEffect` listeners in `App.tsx:357` update progress badges, auto-open AutoFillModal

**State Management:**
- All global state lives in `App.tsx` as `useState` hooks (products, config, stats, modals, selections)
- UI preferences persisted to `localStorage` (theme, column configs, BOM column configs, file paths)
- No external state management library (no Redux, Zustand, etc.)
- Product data sourced from Rust backend SQLite cache (not directly from network)

## Key Abstractions

**AppConfig (`src-tauri/src/config.rs:30`):**
- Purpose: Central configuration object for the application
- Fields: `trigramme`, `network_path`, `searxng_url`, `vpc_sites`, rename conventions, API keys
- Pattern: JSON file at `%APPDATA%/Stockflow/config.json`, loaded at startup via `invoke("get_config")`

**Product (`src-tauri/src/db.rs:5`):**
- Purpose: Core domain entity representing an inventory item
- Fields: sku, mpn, label, brand, category, sub_category, location, item_type, min_stock, price, current_stock, reserved_stock, attributes (JSON), image_path, pdf_path, pack_size
- Pattern: SQLite row, mapped to frontend interface in `App.tsx:27`

**Event (`src-tauri/src/events.rs:9`):**
- Purpose: Immutable record of state mutation, persisted as JSON file
- Types: `PRODUCT_CREATE`, `PRODUCT_UPDATE`, `STOCK_IN`, `STOCK_OUT`, `STOCK_REVERSAL`
- Pattern: Written to `{network_path}/events/{timestamp}_{trigramme}_{type}_{sku}_{uuid}.json`

**AuditLogItem (`src-tauri/src/db.rs:52`):**
- Purpose: Field-level change tracking with revert capability
- Pattern: JSON files in `{network_path}/audit/`, loaded per product via `invoke("get_product_audit_log")`

**ScrapeCandidates (`src-tauri/src/scraper_candidates.rs:88`):**
- Purpose: Container for all scraped data candidates for a single SKU
- Contains: typed candidate arrays (label, brand, mpn, price, dimension, weight, pack_size), plus resource candidates (images, PDFs), plus source metadata
- Pattern: JSON cache at `{network_path}/scrape_cache/{SKU}.json`

**ScrapeTaskManager (`src-tauri/src/scraper_task.rs:47`):**
- Purpose: Manages background scraping queue with single-worker execution
- Key features: enqueue with priority, cancel via cancellation token, resume failed tasks, queue info querying
- Pattern: Singleton managed by Tauri state (`app.manage()`)

## Entry Points

**Desktop Application:**
- Location: `src-tauri/src/main.rs:5` → calls `tauri_app_lib::run()` in `src-tauri/src/lib.rs:1906`
- Triggers: User launches the executable
- Responsibilities: Initialize Tauri app, register plugins (opener, window-state), build ScrapeTaskManager, register 60+ IPC commands

**Frontend Entry:**
- Location: `src/main.tsx:5` → mounts `<App />` component into `#root`
- Triggers: Vite dev server or Tauri window loads `index.html`
- Responsibilities: React bootstrap, StrictMode wrapper

**Event Sync Polling:**
- Location: `src/App.tsx:1068` → `useEffect` with 4-second `setInterval`
- Triggers: On mount and whenever `config` changes
- Responsibilities: Keep local SQLite cache in sync with network events, refresh products/stats

## Architectural Constraints

- **Threading:** Rust backend is multi-threaded (tokio async runtime + `spawn_blocking` for SQLite/FS). Scraping queue uses single tokio worker. Frontend is single-threaded React.
- **Global state:** `App.tsx` holds all application state as React hooks — no lifting or external store. `ScrapeTaskManager` is a Tauri-managed singleton accessed by multiple command handlers.
- **Monolithic frontend:** `App.tsx` contains all state, all event listeners, all command handlers (~2800 lines). No component-level data fetching — everything flows through App's `syncAndFetch()`.
- **No client-side routing:** Single-page app with tab-based navigation (`activeTab` state) — no React Router or similar.
- **File system access:** Tauri asset protocol allows reading any local/network file via `convertFileSrc()`. Scoped per-drive in capabilities config.

## Anti-Patterns

### Monolithic God Component

**What happens:** `src/App.tsx` (~2800 lines) contains all application state, all event listeners, all IPC handlers, all modal management, all data formatting logic, and all configuration logic.
**Why it's wrong:** Makes the component impossible to test, hard to reason about, and any change risks breaking unrelated features. The single-file constraint creates merge conflicts and cognitive overload.
**Do this instead:** Split state management into custom hooks (e.g., `useProducts`, `useConfig`, `useScraping`). Extract tab views into separate page components. Use React Context or a lightweight store for shared state (e.g., `src/hooks/useInventory.ts`, `src/hooks/useScraping.ts`).

### Duplicate Interface Definitions

**What happens:** Interfaces like `Product`, `AppConfig`, `ProductHistoryItem`, `AuditLogItem` are defined independently in Rust (`db.rs`), in `App.tsx`, `ProductDetailPanel.tsx`, `ProductForm.tsx`, and `ScrapeComponents.tsx`.
**Why it's wrong:** When a field is added or changed, all copies must be updated in sync. There is no single source of truth for the data contracts. Type mismatches between frontend and backend manifest as silent runtime errors.
**Do this instead:** Place shared TypeScript interfaces in a dedicated `src/types/` directory (e.g., `src/types/product.ts`, `src/types/config.ts`). Leverage Tauri's `ts` codegen to auto-generate frontend types from Rust structs.

### Inline CSS in JSX

**What happens:** Components (`BomTab.tsx`, `ProductForm.tsx`, `ProductDetailPanel.tsx`) use extensive inline `style={{}}` objects rather than CSS classes.
**Why it's wrong:** Inline styles cannot be overridden, don't support media queries, bloat component files, and bypass CSS theming. `ProductForm.tsx` is over 1000 lines largely due to inline styles.
**Do this instead:** Define CSS class names (`.form-group`, `.btn`, `.modal-body`) in `App.css` and reference them via `className`. Reserve inline styles for truly dynamic values (e.g., programmatic widths).

## Error Handling

**Strategy:** Rust commands return `Result<T, String>` — errors are propagated to frontend as string messages. Frontend catches errors in `.catch()` handlers and displays them via toast notifications or inline error divs.

**Patterns:**
- Rust: `Result<(), String>` return type on all commands; `.map_err(|e| e.to_string())` for error conversion
- Frontend: try/catch in async handlers; `showToast(message, "error")` for transient errors; `setXxxError(message)` for form errors
- Network unreachability: `syncAndFetch` catches errors and checks for `RÉSEAU_HORS_LIGNE` string to set `isOnline` state
- Scraping errors: emitted as Tauri events (`scrape-task-error`) caught by listeners in `App.tsx:411`

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` in TypeScript; `println!` / `eprintln!` in Rust. No structured logging library.
**Validation:** SKU trim/uppercase in Rust; trigramme length validation (must be 3 chars); numeric input cleaned of non-numeric characters via `cleanNumericInput()` helpers duplicated across frontend files.
**Authentication:** None — trigramme serves as user identifier but is not authenticated. Config API keys (Farnell, Mouser) stored in plaintext in `config.json`.
**Localization:** French UI throughout — all labels, messages, error strings, and documentation are in French. No i18n framework.

---

*Architecture analysis: 2026-07-18*
