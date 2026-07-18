# Requirements: StockFlow

**Defined:** 2026-07-18
**Core Value:** Les utilisateurs doivent pouvoir gérer leur inventaire industriel en toute confiance — l'interface doit refléter fidèlement l'état réel des données, sans incohérence ni comportement UX inattendu.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Infrastructure

- [ ] **E2E-INFRA-01**: Shared Playwright fixture encapsulates Tauri lifecycle (spawn, CDP connect, cleanup) via `test.extend()` — no per-file boilerplate
- [ ] **E2E-INFRA-02**: Test data factories with Faker.js produce deterministic, isolated Product, BOM, and Event fixtures per test
- [ ] **E2E-INFRA-03**: Automatic `afterEach` cleanup removes test-prefixed data from SQLite and JSON event store
- [ ] **E2E-INFRA-04**: Graceful CDP connection retry with timeout (30s max) and zombie-process cleanup
- [ ] **E2E-INFRA-05**: Console error collector captures JS/WebView errors per test and reports in output
- [ ] **E2E-INFRA-06**: HTML test report with screenshots on failure and trace-on-retry

### Dashboard

- [ ] **E2E-DASH-01**: Dashboard KPIs (total refs, stock value, alert count) match actual SQLite data after seeding
- [ ] **E2E-DASH-02**: Activity columns (last movements, last modifications) display correct entries in scrollable lists
- [ ] **E2E-DASH-03**: Dashboard refreshes dynamically when new JSON event appears in network share
- [ ] **E2E-DASH-04**: Empty state (no products) shows appropriate message, no NaN or crash

### Inventory

- [ ] **E2E-INV-01**: User can create a new SKU via modal — fields save correctly and appear in grid
- [ ] **E2E-INV-02**: Search filters grid in real-time by SKU, MPN, designation, brand
- [ ] **E2E-INV-03**: Family/Sub-family dropdown filters work correctly
- [ ] **E2E-INV-04**: Inline editing of cells (double-click) saves correct values
- [ ] **E2E-INV-05**: Stock movement via inline edit creates correct JSON event and updates SQLite
- [ ] **E2E-INV-06**: Column visibility toggle and reordering persist correctly
- [ ] **E2E-INV-07**: Product deletion removes from grid, SQLite, and cleans up events
- [ ] **E2E-INV-08**: Product detail panel shows correct data when row clicked

### Data Consistency

- [ ] **E2E-CONS-01**: After product creation, UI fields match SQLite row and JSON event file
- [ ] **E2E-CONS-02**: After inline edit, UI cell value matches SQLite value
- [ ] **E2E-CONS-03**: After stock movement, UI stock count matches SQLite aggregated quantity
- [ ] **E2E-CONS-04**: After product deletion, product is removed from SQLite and UI grid

### BOM / Projects

- [ ] **E2E-BOM-01**: User can create a new BOM/project with name
- [ ] **E2E-BOM-02**: Adding products to BOM shows correct stock status (green/orange/red)
- [ ] **E2E-BOM-03**: BOM total price and quantity calculations are correct
- [ ] **E2E-BOM-04**: PDF picking list export generates valid file with correct content
- [ ] **E2E-BOM-05**: XLSX purchase order export generates valid file with correct supplier grouping

### Scraping (tagged @external)

- [ ] **E2E-SCRP-01**: RS Components autofill populates designation, brand, price, MPN correctly
- [ ] **E2E-SCRP-02**: Conrad autofill populates product details correctly
- [ ] **E2E-SCRP-03**: Farnell autofill populates product details correctly
- [ ] **E2E-SCRP-04**: Mouser autofill populates product details correctly
- [ ] **E2E-SCRP-05**: Distrelec autofill populates product details correctly
- [ ] **E2E-SCRP-06**: Fallback to SearxNG when supplier code not found
- [ ] **E2E-SCRP-07**: Batch price scraping via checkbox selection processes and saves prices
- [ ] **E2E-SCRP-08**: Batch image scraping downloads and stores images correctly
- [ ] **E2E-SCRP-09**: Batch PDF scraping downloads and stores documents correctly
- [ ] **E2E-SCRP-10**: Dimensions candidate modal allows mapping scraped dimensions to axes
- [ ] **E2E-SCRP-11**: Scraped data appears in product detail panel after batch operation

### Visual Regression (baseline only)

- [ ] **E2E-VIS-01**: Dashboard layout baseline screenshot matches (masked dynamic values)
- [ ] **E2E-VIS-02**: Inventory grid layout baseline screenshot matches
- [ ] **E2E-VIS-03**: Product detail panel layout baseline screenshot matches
- [ ] **E2E-VIS-04**: BOM/project view layout baseline screenshot matches

### UX Anomaly Detection

- [ ] **E2E-UX-01**: No console errors during standard CRUD flows
- [ ] **E2E-UX-02**: Modals open and close correctly without orphaned backdrop
- [ ] **E2E-UX-03**: Loading states display during async operations and disappear on completion
- [ ] **E2E-UX-04**: Buttons are disabled during processing and re-enabled afterwards
- [ ] **E2E-UX-05**: Inline confirmation menus appear and dismiss correctly (delete, restore)
- [ ] **E2E-UX-06**: Empty states render correctly across all views (no products, no BOMs, no search results)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Offline Mode

- **E2E-OFF-01**: App remains usable in consultation mode when network share disconnected
- **E2E-OFF-02**: Actions queued locally are replayed when connection restored
- **E2E-OFF-03**: Warning banner appears when offline and disappears on reconnection

### Concurrent Modifications

- **E2E-CONC-01**: Two instances detect each other's changes within polling interval
- **E2E-CONC-02**: No data loss when concurrent writes to same SKU

### CSV Import

- **E2E-CSV-01**: Full CSV import flow creates correct events and media files
- **E2E-CSV-02**: Import report shows correct success/failure counts

### Cross-Provider Visual Regression

- **E2E-VIS-05**: Side-by-side visual diff of dark/light theme on all key views

## Out of Scope

| Feature | Reason |
|---------|--------|
| Unit tests (React components) | Couvert par un autre périmètre — E2E ne teste que l'intégration |
| Unit tests (Rust backend) | Couvert par un autre périmètre — E2E ne teste que l'intégration |
| Performance / load tests | Nécessite une infrastructure dédiée, hors scope de cette phase |
| Cross-platform (macOS/Linux) | StockFlow est Windows-only |
| Production build testing | Les tests E2E ciblent le build debug (plus rapide, meilleur logging) |
| Multi-worker parallel execution | CDP port unique limite à workers:1 — optimisation future |
| Percy / Chromatic intégration | `toHaveScreenshot()` intégré suffisant pour le volume actuel |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| E2E-INFRA-01 | Phase 1 | Pending |
| E2E-INFRA-02 | Phase 1 | Pending |
| E2E-INFRA-03 | Phase 1 | Pending |
| E2E-INFRA-04 | Phase 1 | Pending |
| E2E-INFRA-05 | Phase 1 | Pending |
| E2E-INFRA-06 | Phase 1 | Pending |
| E2E-DASH-01 | Phase 2 | Pending |
| E2E-DASH-02 | Phase 2 | Pending |
| E2E-DASH-03 | Phase 2 | Pending |
| E2E-DASH-04 | Phase 2 | Pending |
| E2E-INV-01 | Phase 2 | Pending |
| E2E-INV-02 | Phase 2 | Pending |
| E2E-INV-03 | Phase 2 | Pending |
| E2E-INV-04 | Phase 2 | Pending |
| E2E-INV-05 | Phase 2 | Pending |
| E2E-INV-06 | Phase 2 | Pending |
| E2E-INV-07 | Phase 2 | Pending |
| E2E-INV-08 | Phase 2 | Pending |
| E2E-CONS-01 | Phase 3 | Pending |
| E2E-CONS-02 | Phase 3 | Pending |
| E2E-CONS-03 | Phase 3 | Pending |
| E2E-CONS-04 | Phase 3 | Pending |
| E2E-BOM-01 | Phase 2 | Pending |
| E2E-BOM-02 | Phase 2 | Pending |
| E2E-BOM-03 | Phase 2 | Pending |
| E2E-BOM-04 | Phase 2 | Pending |
| E2E-BOM-05 | Phase 2 | Pending |
| E2E-SCRP-01 | Phase 4 | Pending |
| E2E-SCRP-02 | Phase 4 | Pending |
| E2E-SCRP-03 | Phase 4 | Pending |
| E2E-SCRP-04 | Phase 4 | Pending |
| E2E-SCRP-05 | Phase 4 | Pending |
| E2E-SCRP-06 | Phase 4 | Pending |
| E2E-SCRP-07 | Phase 4 | Pending |
| E2E-SCRP-08 | Phase 4 | Pending |
| E2E-SCRP-09 | Phase 4 | Pending |
| E2E-SCRP-10 | Phase 4 | Pending |
| E2E-SCRP-11 | Phase 4 | Pending |
| E2E-VIS-01 | Phase 5 | Pending |
| E2E-VIS-02 | Phase 5 | Pending |
| E2E-VIS-03 | Phase 5 | Pending |
| E2E-VIS-04 | Phase 5 | Pending |
| E2E-UX-01 | Phase 2 | Pending |
| E2E-UX-02 | Phase 2 | Pending |
| E2E-UX-03 | Phase 2 | Pending |
| E2E-UX-04 | Phase 2 | Pending |
| E2E-UX-05 | Phase 2 | Pending |
| E2E-UX-06 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 47 total
- Mapped to phases: 47
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-18*
*Last updated: 2026-07-18 after initial definition*
