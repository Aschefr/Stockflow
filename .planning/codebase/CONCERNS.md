# Codebase Concerns

**Analysis Date:** 2026-07-18

## Tech Debt

### Massively Oversized Frontend Components
- Issue: Multiple frontend components exceed 1000 lines, making them extremely difficult to maintain, test, or extend. State management, rendering logic, and event handlers are tightly coupled in single monolithic files.
- Files:
  - `src/App.tsx` (4049 lines) — main application component with all state, UI, and logic
  - `src/BomTab.tsx` (2002 lines) — BOM management tab
  - `src/ProductDetailPanel.tsx` (1086 lines) — product detail panel
  - `src/ProductForm.tsx` (992 lines) — product create/edit form
  - `src/ScrapeComponents.tsx` (984 lines) — scraping UI components
- Impact: Any change requires deep understanding of the entire component. Risk of regression is very high. Cannot be unit tested effectively. Devs waste time finding where to put logic.
- Fix approach: Split each component by concern — separate data fetching hooks into `src/hooks/` files, extract reusable UI into `src/components/`, and move business logic into `src/services/` or `src/utils/`. Target max 300 lines per component.

### Massively Oversized Rust Backend Files
- Issue: The Rust backend has several files exceeding 1000 lines with mixed responsibilities. Error handling patterns are inconsistent.
- Files:
  - `src-tauri/src/scraper.rs` (~5000+ lines, 162KB) — price scraping, PDF scraping, image scraping, HTML parsing, URL building, webview fallback, all in one file
  - `src-tauri/src/lib.rs` (1973 lines, 79KB) — all Tauri commands, argument parsing, media management, backup scheduling, VPC URL parsing
  - `src-tauri/src/scraper_engine.rs` (~1200+ lines, 45KB) — scraping engine orchestration
  - `src-tauri/src/scraper_extractor.rs` (~1000+ lines, 38KB) — data extraction logic
- Impact: Difficult to reason about data flow. High risk of introducing bugs during changes. The single-file architecture prevents parallel development.
- Fix approach: Split `scraper.rs` by scraping target (price_scraper.rs, pdf_scraper.rs, image_scraper.rs). Split `lib.rs` command handlers by domain (product_commands.rs, media_commands.rs, config_commands.rs, scraper_commands.rs).

### Compiler Warnings Suppressed Globally
- Issue: 7 out of 8 Rust source files use `#![allow(dead_code, unused_variables)]` at the crate level. `lib.rs` uses `#![allow(clippy::all, dead_code, unused_variables, unused_imports, unused_mut)]`.
- Files:
  - `src-tauri/src/lib.rs` — `#![allow(clippy::all, dead_code, unused_variables, unused_imports, unused_mut)]`
  - `src-tauri/src/scraper.rs` — `#![allow(dead_code, unused_variables)]`
  - `src-tauri/src/scraper_engine.rs` — `#![allow(dead_code, unused_variables)]`
  - `src-tauri/src/scraper_extractor.rs` — `#![allow(dead_code, unused_variables)]`
  - `src-tauri/src/scraper_candidates.rs` — `#![allow(dead_code, unused_variables)]`
  - `src-tauri/src/scraper_http.rs` — `#![allow(dead_code, unused_variables)]`
  - `src-tauri/src/scraper_task.rs` — `#![allow(dead_code, unused_variables)]`
  - `src-tauri/src/searxng.rs` — `#![allow(dead_code, unused_variables)]`
- Impact: Dead code accumulates silently. Unused variables hide logic errors. Clippy suggestions (performance, correctness) are invisible. The code quality cannot be enforced by the compiler.
- Fix approach: Remove the allow attributes incrementally. First, remove `unused_variables` and `dead_code` from the smallest modules (e.g., `searxng.rs`, `scraper_task.rs`), then clean up unused code. For `lib.rs`, remove `clippy::all` and fix remaining warnings individually.

### Widespread Use of `any` Types in TypeScript
- Issue: The frontend codebase uses TypeScript `any` type extensively, defeating the purpose of static typing. Over 100+ `any` usages across all TSX files.
- Files: `src/App.tsx`, `src/BomTab.tsx`, `src/ProductForm.tsx`, `src/ScrapeComponents.tsx`, `src/ProductDetailPanel.tsx`
- Patterns:
  - `catch (err: any)` — error types not properly typed
  - `invoke<any>(...)` — Tauri invoke results typed as `any`
  - `setProductData((prev: any) => ...)` — state setters using `any`
  - `(col: any)`, `(p: any)`, `(items: any[])` — collection iteration using `any`
- Impact: TypeScript becomes "JavaScript with extra syntax." Type-checking cannot catch mismatches. IDE autocomplete is degraded. Refactoring becomes dangerous.
- Fix approach: Define proper interfaces for all API responses, error types, and callback parameters. Use TypeScript generics with `invoke<T>()`. Remove `any` from all `setProductData` callbacks by properly typing the state.

### Manual HTML Parser Implementation
- Issue: The scraper implements its own HTML parser (finding tags by string search) instead of using a proper HTML parsing library.
- File: `src-tauri/src/scraper.rs`
  - `extract_meta_tag_value()` (line 262) — manual `<meta>` tag parsing
  - `extract_conrad_price_value()` (line 290) — manual JSON-in-HTML parsing
  - `strip_html_tags()` (line 498) — manual tag stripper
  - `re_find_json_ld()` (line 369) — manual JSON-LD extraction
  - `extract_price_from_text()` (line 386) — manual number extraction from HTML text
- Impact: Fragile parsing that breaks on malformed HTML or minor markup changes. No support for XPath/CSS selectors. Misses data when providers update their HTML structure.
- Fix approach: Add the `scraper` crate (or `select.rs`) for CSS selector-based HTML traversal and the `reqwest` response handling for proper DOM parsing. Replace all manual parsing with declarative selectors.

### Manual Windows-1252 Decoder
- Issue: A complete manual Windows-1252 to Unicode decoder is implemented for CSV import, instead of using `encoding_rs` or `chardetng` crate.
- File: `src-tauri/src/csv_importer.rs` (lines 13-41, `decode_win1252()`)
- Impact: The hardcoded mapping is fragile, incomplete (some byte values map to '?'), and duplicates what well-tested crates provide. If a CSV uses a different encoding (e.g., ISO-8859-15), it will silently produce incorrect characters.
- Fix approach: Replace with the `encoding_rs` crate which supports Windows-1252 plus all common encodings, and auto-detect encoding from BOM or content.

### Hardcoded SearxNG Default URL
- Issue: The default SearxNG URL `http://localhost:8080` is hardcoded in 7+ locations throughout the codebase.
- Files:
  - `src-tauri/src/lib.rs` (lines 1079, 1090, 1105, 1132, 1367, 1496)
  - `src-tauri/src/scraper_engine.rs` (line 824)
- Impact: If the user does not explicitly configure a SearxNG URL, the application defaults to a non-HTTPS connection to localhost. This is a single point of configuration inconsistency — changing the default requires editing 7 locations.
- Fix approach: Define the default URL as a `const DEFAULT_SEARXNG_URL: &str = "http://localhost:8080"` in `config.rs` and reference it everywhere. Better: make it a compile-time constant or environment variable.

### Backup Scheduler Busy-Loop
- Issue: The backup scheduler runs a tight loop checking every 60 seconds in an unbounded thread.
- File: `src-tauri/src/lib.rs` (lines 1899-1904)
  ```rust
  std::thread::spawn(|| {
      loop {
          std::thread::sleep(std::time::Duration::from_secs(60));
          backup::check_and_run_scheduler();
      }
  });
  ```
- Impact: Thread runs for entire application lifetime with no cancellation mechanism. If `check_and_run_scheduler()` encounters an error, no logging or recovery occurs. On app shutdown, the thread is forcefully terminated.
- Fix approach: Use `tokio::spawn` with a graceful shutdown signal (e.g., CancellationToken). Add error logging inside the loop.

### Plaintext API Key Storage
- Issue: VPC API keys (Farnell, Mouser) are stored in plain JSON in the config file at `%APPDATA%/Stockflow/config.json`.
- Files: `src-tauri/src/config.rs` — `AppConfig.vpc_api_keys` field
  - `src-tauri/src/lib.rs` — `save_config()` command receives and stores keys
- Impact: Anyone with filesystem access to the user's `%APPDATA%` can read supplier API keys. This is a credentials leak risk.
- Fix approach: Use the OS keychain (e.g., `keyring` crate on Windows) for storing API keys, or at minimum encrypt the config file with a key derived from a user-provided master password.

## Known Bugs

### Empty Products Table Causes Crash on Fresh Install
- Issue: When the products database is empty (fresh install), some dashboard queries return NULL instead of 0, causing NaN/invalid values in the UI.
- Files:
  - `src-tauri/src/lib.rs` — `get_dashboard_stats()` (line 675): uses `unwrap_or(0)` and `unwrap_or(0.0)` for aggregate queries, but `SUM()` over empty set returns NULL which may not properly default to 0 for `f64`.
  - `src/App.tsx` — dashboard component that displays these values
- Trigger: Open dashboard before any products are imported.
- Workaround: Import at least one product first.

### Network Path Change May Not Invalidate All Stale Data
- Issue: When the user changes `network_path`, the local cache is cleared (`db::clear_db`), but pending events in the local SQLite `pending_events` table are not cleared.
- File: `src-tauri/src/lib.rs` — `save_config()` (lines 72-75): Only calls `db::clear_db` but does not clear pending_events or stop/reset the background scrape task manager.
- Trigger: Change the network path in settings while offline events are queued.
- Workaround: Restart the application after changing the network path.

## Security Considerations

### Unvalidated Network Path
- Issue: The `network_path` config field is only checked for existence via `net_path.exists()` but not validated for being a legitimate network share.
- Files:
  - `src-tauri/src/config.rs` (line 113): `if !net_path.exists()`
  - `src-tauri/src/lib.rs` (lines 48-49): path stored and used for all file operations
- Risk: A user could point to any accessible path (including a malicious SMB share) that triggers arbitrary file read/write. All file operations use this path for reading, writing, and deleting files.
- Current mitigation: None beyond basic existence check.
- Recommendations: Validate that the path resolves to a network UNC path (`\\server\share\...`) or a local path explicitly. Add a "safety file" marker (e.g., `.stockflow_marker`) in the root of the network path that must exist.

### Insecure SearxNG Communication
- Issue: The default SearxNG URL uses plain HTTP (`http://localhost:8080`). No TLS verification, no API key or authentication for SearxNG requests.
- Files:
  - `src-tauri/src/lib.rs` (multiple locations)
  - `src-tauri/src/scraper_engine.rs` (line 824)
- Risk: If SearxNG is exposed beyond localhost (misconfiguration), queries and results are in plaintext, including product search terms that could contain sensitive internal part numbers.
- Current mitigation: Relies on user to configure HTTPS.
- Recommendations: Default to `https://` with a configurable option. Add TLS certificate verification by default.

### No Input Size Limits on File Uploads
- Issue: The `upload_media` command accepts `Vec<u8>` with no size limit, and `save_screenshot` accepts `base64_image` with no size validation.
- Files:
  - `src-tauri/src/lib.rs` (line 482): `file_data: Vec<u8>` — unbounded
  - `src-tauri/src/lib.rs` (line 1622): `base64_image: String` — unbounded
- Risk: A malicious frontend or compromised process could upload arbitrarily large files, filling the disk on the network share.
- Current mitigation: None.
- Recommendations: Add a configurable size limit (e.g., 50 MB for media, 10 MB for screenshots) before writing to disk.

### Config File Not Protected
- Issue: The application config is stored as plain JSON in `%APPDATA%/Stockflow/config.json` without any encryption or integrity protection.
- File: `src-tauri/src/config.rs` (lines 106-109)
- Risk: Tampering with config file could redirect the network path, inject malicious API keys, or corrupt the application state. VPC API keys are stored in plaintext within this config.
- Current mitigation: None.
- Recommendations: Encrypt the config file using OS-level DPAPI (Windows) or add a simple integrity check (HMAC).

## Performance Bottlenecks

### 4-Second Polling Loop for Event Sync
- Problem: The frontend polls the backend every 4 seconds for event synchronization, regardless of whether any events occurred.
- Files: `src/App.tsx` (lines 1068-1077)
  ```typescript
  const interval = setInterval(() => {
      syncAndFetch(config);
  }, 4000);
  ```
- Cause: Event sourcing architecture uses continuous polling instead of push-based updates.
- Improvement path: Use Tauri's event system (already partially set up for scrape progress) to push "new event" notifications from the Rust backend to the frontend. Only fetch when notified. Fall back to polling at a much lower frequency (e.g., 30s) as a heartbeat.

### Full Product List Reload on Every Poll
- Problem: Every 4-second sync cycle reloads the entire product list and dashboard stats, even if nothing changed.
- Files:
  - `src/App.tsx` (lines 1094-1101): `syncAndFetch()` calls `get_products` and `get_dashboard_stats` every time
- Cause: No incremental update mechanism. The entire product cache is re-read from SQLite and transferred to the frontend.
- Improvement path: Add an "incremental sync" flag. If the sync_events call returned 0 new events, skip reloading products and stats. Only refetch when new events were applied.

### Expensive Image Size Validation on Download
- Problem: Downloaded images are decoded to check dimensions (150x150 minimum) before saving, causing unnecessary CPU/memory for large images.
- File: `src-tauri/src/scraper.rs` (line 2521)
  ```
  println!("[Image Scraper] Image ignorée car trop petite ({}x{} < 150x150) : {}", w, h, clean_url);
  ```
- Cause: Every downloaded image is fully decoded with the `image` crate to read dimensions.
- Improvement path: Read only the image header (first ~100 bytes) to extract dimensions without decoding the full image. The `image` crate supports this via `Reader::new().with_guessed_format()`.

## Fragile Areas

### Scraping Engine (`scraper.rs`)
- Files: `src-tauri/src/scraper.rs` (~5000+ lines)
- Why fragile: Extremely large file with tight coupling between price scraping, PDF scraping, image scraping, HTML parsing, and WebView fallback logic. Uses manual HTML parsing that breaks when suppliers update their websites. Has 4+ fallback layers that are hard to trace.
- Safe modification: Make small, targeted changes only. Avoid refactoring the entire file. Add integration tests before modifying any scraping logic.
- Test coverage: No unit tests for any scraping function. Only Playwright E2E tests exist.

### Event Sourcing Layer
- Files:
  - `src-tauri/src/events.rs` (664 lines)
  - `src-tauri/src/db.rs` (406 lines)
- Why fragile: File-based event system on network shares introduces race conditions (multiple clients writing event files simultaneously). Offline mode adds complexity with pending_events table. Error handling uses many `unwrap_or()` and `ok()` calls that silently swallow failures.
- Safe modification: Always wrap event writing in proper error handling. Never assume the network share is available. Test with offline/disconnected scenarios.
- Test coverage: No unit tests. No integration tests for concurrent client scenarios.

### Universal Scraper Task Manager
- Files:
  - `src-tauri/src/scraper_task.rs` (328 lines)
  - `src-tauri/src/scraper_engine.rs` (~1200+ lines)
  - `src-tauri/src/scraper_candidates.rs` (16KB)
- Why fragile: The new "universal scraper" added a complex parallel task queue with cancellation tokens, but it coexists with the legacy synchronous scraping functions. State is shared via `Arc<Mutex<>>` with potential for deadlocks. The `network_path` stored at construction time may become stale if config changes.
- Safe modification: Ensure the task manager is properly reset when `network_path` changes. Test cancellation flows thoroughly.
- Test coverage: No unit tests for task queue or cancellation behavior.

### Tauri API Bridge (`lib.rs`)
- File: `src-tauri/src/lib.rs` (1973 lines)
- Why fragile: Contains 40+ Tauri commands as free functions, all registered in a single `generate_handler![]` invocation. The `create_product` function alone spans 180+ lines of inline logic. Adding a new command requires touching 3 places (function definition, registration, frontend call).
- Safe modification: Add new commands in separate modules and register them.
- Test coverage: No unit tests for any command logic. Commands depend on SQLite and filesystem, making isolation difficult.

## Scaling Limits

### Network Share File-Based Events
- Current capacity: The event system writes one JSON file per stock movement or product modification to a network share.
- Limit: With 100+ concurrent users, file creation on the same network share will cause race conditions, file locking errors, and lost events. The current sorting-by-filename approach assumes unique timestamps which will collide at high concurrency.
- Scaling path: Migrate to a proper server-side event store (e.g., SQLite on the network share with WAL mode, or a lightweight HTTP API server). Add UUID-based deduplication that is collision-safe under high concurrency.

### Single-threaded SQLite Access
- Current capacity: The application uses SQLite for the local cache, accessed from multiple `Connection::open` calls per command.
- Limit: Each Tauri command opens a new SQLite connection. With frequent polling (every 4 seconds) and multiple operations, SQLite's single-writer lock will become a bottleneck.
- Scaling path: Use a single connection behind `Arc<Mutex<Connection>>` or use `r2d2` connection pool. WAL mode should be enabled for concurrent reads.

### 100-Entry Limit on Dashboard History
- Problem: The dashboard stats query limits recent movements and audit entries to 100 each.
- File: `src-tauri/src/lib.rs` (lines 700-704, 726-730): `ORDER BY timestamp DESC LIMIT 100`
- Impact: With heavy usage, users will lose visibility into older inventory movements. The `product_history` table grows unboundedly with no cleanup mechanism.
- Scaling path: Add pagination to history queries. Implement configurable retention policies (e.g., auto-delete entries older than 1 year).

## Dependencies at Risk

### `rusqlite` with bundled feature
- Package: `rusqlite = { version = "0.39.0", features = ["bundled"] }`
- Risk: The `bundled` feature compiles SQLite from source, increasing compilation time by 5-10 minutes on first build. Version 0.39.0 may lack essential security patches vs the latest SQLite.
- Impact: CI/CD builds take significantly longer. Security vulnerabilities in SQLite require updating both the rusqlite crate and its bundled SQLite source.
- Migration plan: Consider using `rusqlite` without `bundled` but with the `bundled` feature as fallback. Monitor for security advisories.

### `serde_json` parsing without size limits
- Package: `serde_json = "1"`
- Risk: `serde_json::from_str` is used on untrusted data (SearxNG responses, supplier web pages) without size limits. A malicious response could cause OOM or DoS via memory exhaustion.
- Files: `src-tauri/src/scraper.rs` (line 612, 783), `src-tauri/src/lib.rs` (line 1423, 1511)
- Migration plan: Use `serde_json::Deserializer::from_str()` with a configured `max_deserialize` limit, or wrap deserialization in a timeout.

### Manual `lazy_static` usage (deprecated)
- Package: `lazy_static = "1.5"`
- Risk: `lazy_static` is deprecated in favor of `std::sync::OnceLock` or `std::sync::LazyLock` (stabilized in Rust 1.80+).
- Files: `src-tauri/src/scraper_http.rs` (uses lazy_static macros)
- Migration plan: Replace with `std::sync::LazyLock` or `once_cell::sync::OnceCell`.

## Missing Critical Features

### No Audit Log for Config Changes
- Problem: When VPC API keys, URLs, or network paths are changed in settings, there is no audit trail of who changed what and when.
- Files: `src-tauri/src/config.rs` — `save_config_internal()` writes directly
- Blocks: Security auditing and compliance with inventory management standards.
- Impact: Cannot determine who changed the network path or API keys, or when the change occurred.

### No Server-Side Validation of Event Integrity
- Problem: JSON event files on the network share are not digitally signed or checksummed. Any process with write access to the share can create, modify, or delete events.
- Files: `src-tauri/src/events.rs` — `write_event_file()`
- Blocks: Multi-user deployments where network share is accessible by non-Stockflow processes.
- Risk: Corrupted or malicious event files could modify stock levels, product data, or inject arbitrary data.

### No Data Export/Portability
- Problem: There is no built-in export mechanism for product data in a portable format (except the BOM's PDF/Excel exports which are subset views).
- Blocks: User migration, backup recovery, or data analysis in external tools.
- Impact: Users must use CSV import (one-way) but cannot easily export their full catalog.

## Test Coverage Gaps

### Entire Rust Backend Untested
- What's not tested: All modules in `src-tauri/src/` — no unit tests, no integration tests, no test modules anywhere.
- Files: All `*.rs` files in `src-tauri/src/`
- Risk: Any refactoring, dependency update, or feature addition can silently break existing functionality. The scraping logic (50% of the codebase) has zero automated validation.
- Priority: High

### Frontend Logic Untested
- What's not tested: All React components, state management, and Tauri invoke calls.
- Files: All `*.tsx` and `*.ts` files in `src/`
- Risk: Complex state transitions (form submission, modal workflows, polling logic) have no automated coverage. The 4-second sync cycle means subtle race conditions are likely.
- Priority: High

### E2E Tests Are Fragile and Sparse
- What's not tested: Only 5 Playwright E2E test files exist in `tests/e2e/`. They depend on specific UI structure and may fail on minor DOM changes.
- Files: `tests/e2e/scraper.spec.ts`, `tests/e2e/screenshot_test.spec.ts`, `tests/e2e/screenshot_sidebar_test.spec.ts`, `tests/e2e/multi_vpc_scrape.spec.ts`, `tests/e2e/check_console.spec.ts`
- Risk: Low confidence in scraping workflows, screenshot capture, sidebar interactions, and multi-VPC scenarios.
- Priority: Medium

---

*Concerns audit: 2026-07-18*
