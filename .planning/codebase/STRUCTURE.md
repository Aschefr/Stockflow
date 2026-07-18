# Codebase Structure

**Analysis Date:** 2026-07-18

## Directory Layout

```
Stockflow/
├── src/                    # React/TypeScript Frontend
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Main application component (all state)
│   ├── App.css             # Global styles (dark/light theme, layout)
│   ├── BomTab.tsx          # Bill of Materials tab
│   ├── ProductDetailPanel.tsx  # Product detail sidebar
│   ├── ProductForm.tsx     # Product create/edit modal
│   ├── ScrapeComponents.tsx # Scraping progress badge & AutoFill modal
│   ├── utils/
│   │   └── iframeScraper.ts # Iframe-based web scraping fallback
│   ├── assets/
│   │   ├── logo.png        # App logo
│   │   └── react.svg       # React icon
│   └── vite-env.d.ts       # Vite type declarations
├── src-tauri/              # Rust Backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs         # Binary entry point (calls lib::run)
│   │   ├── lib.rs          # Tauri builder, 60+ command handlers
│   │   ├── config.rs       # AppConfig struct + load/save
│   │   ├── db.rs           # SQLite schema + CRUD queries
│   │   ├── events.rs       # Event sourcing (JSON files + sync)
│   │   ├── csv_importer.rs # CSV import with Win-1252
│   │   ├── backup.rs       # Backup scheduler + rotation
│   │   ├── providers.rs    # VPC provider enum (RS/Farnell/Mouser/Conrad)
│   │   ├── searxng.rs      # SearXNG search API client
│   │   ├── scraper.rs      # HTTP scraper (3738 lines — largest file)
│   │   ├── scraper_http.rs # Stealth HTTP client + rate limiting
│   │   ├── scraper_extractor.rs # HTML/JSON-LD data extraction
│   │   ├── scraper_candidates.rs # Candidate data model + cache
│   │   ├── scraper_engine.rs # Scraping orchestrator
│   │   ├── scraper_task.rs # Async task queue manager
│   │   └── scripts/
│   │       └── webview_scraper.js # WebView scraping JS
│   ├── capabilities/
│   │   └── default.json    # Tauri v2 permission capabilities
│   ├── gen/                # Auto-generated schemas
│   ├── icons/              # App icons for bundling
│   ├── build.rs            # Tauri build script
│   ├── Cargo.toml          # Rust dependencies
│   ├── Cargo.lock          # Rust lockfile
│   └── tauri.conf.json     # Tauri configuration
├── tests/
│   └── e2e/                # Playwright E2E tests
│       ├── scraper.spec.ts
│       ├── multi_vpc_scrape.spec.ts
│       ├── screenshot_test.spec.ts
│       ├── screenshot_sidebar_test.spec.ts
│       ├── check_console.spec.ts
│       └── e2e_requirements_reminder.md
├── public/
│   ├── tauri.svg           # Tauri icon
│   └── vite.svg            # Vite icon
├── dist/                   # Build output (gitignored)
├── node_modules/           # JS dependencies (gitignored)
├── target/                 # Rust build output (gitignored)
├── playwright-report/      # Playwright test reports
├── test-results/           # Playwright test artifacts
├── scratch/                # Scratch/sandbox files
├── release_bin/            # Release binaries
├── corrections/            # Code correction records
├── exemple_data/           # Sample data files
├── .planning/              # GSD planning artifacts
├── package.json            # npm manifest
├── package-lock.json       # npm lockfile
├── vite.config.ts          # Vite dev server config (port 1420)
├── tsconfig.json           # TypeScript config
├── tsconfig.node.json      # TypeScript node config
├── playwright.config.ts    # Playwright test config
├── index.html              # HTML entry point
├── build.ps1               # Build script
├── test_e2e.cjs            # E2E test runner script
├── CLAUDE.md               # AI coding guidelines
├── DEVELOPER.md            # Developer documentation
├── CHANGELOG.md            # Version changelog
├── JOURNAL.md              # Development journal
└── README.md               # Project README
```

## Directory Purposes

**`src/` — React/TypeScript Frontend:**
- Purpose: All frontend code — components, styles, utilities
- Contains: React components (TSX), CSS, TypeScript utilities, static assets
- Key files: `App.tsx` (main component, ~2800 lines), `App.css` (theme, ~1860 lines), `BomTab.tsx` (~1247+ lines)

**`src-tauri/src/` — Rust Backend:**
- Purpose: All backend code — IPC handlers, persistence, scraping engine
- Contains: Rust modules (~16 files), WebView scraper script
- Key files: `lib.rs` (command handlers, ~1973 lines), `scraper.rs` (HTTP scraping, ~3738 lines), `events.rs` (event sourcing, ~664 lines)

**`src-tauri/capabilities/` — Tauri Permissions:**
- Purpose: Declare what the app is allowed to access (file system, OS features)
- Contains: `default.json` — allows opening files on all drive letters and network paths

**`tests/e2e/` — End-to-End Tests:**
- Purpose: Playwright-based integration tests running against the Tauri dev server
- Contains: 5 spec files and a requirements reminder document

**`public/` — Static Assets:**
- Purpose: Unprocessed static files served by Vite
- Contains: SVG icons for Tauri and Vite branding

## Key File Locations

**Entry Points:**
- `src/main.tsx`: React frontend bootstrap — renders `<App />` into `#root`
- `src-tauri/src/main.rs`: Rust binary entry — calls `tauri_app_lib::run()`
- `index.html`: HTML shell loaded by Tauri webview, references Vite bundle

**Configuration:**
- `package.json`: npm dependencies, scripts (`dev`, `build`, `tauri`)
- `vite.config.ts`: Vite dev server (port 1420), React plugin, Tauri-specific HMR settings
- `tsconfig.json`: TypeScript strict mode, ES2020 target, JSX react-jsx
- `src-tauri/Cargo.toml`: Rust dependencies (tauri v2, rusqlite, reqwest, tokio, serde)
- `src-tauri/tauri.conf.json`: Tauri window config, bundle settings, asset protocol scopes
- `src-tauri/capabilities/default.json`: Permission capabilities for OS access

**Core Logic:**
- `src/App.tsx`: All state management, tab navigation, IPC handlers, modal orchestration
- `src/BomTab.tsx`: BOM CRUD operations, PDF/Excel generation, DnD sorting
- `src/ProductForm.tsx`: Create/edit product forms, inline scraping, candidate selection
- `src/ProductDetailPanel.tsx`: Product metadata display, image carousel, movements, audit log
- `src-tauri/src/lib.rs`: 60+ Tauri command implementations (config, products, events, media, scraping, BOM)
- `src-tauri/src/events.rs`: Event file I/O, SQLite sync, offline queue
- `src-tauri/src/scraper_engine.rs`: Orchestrates multi-source scraping for a single SKU
- `src-tauri/src/scraper_task.rs`: Background task queue with cancellation tokens

**Testing:**
- `playwright.config.ts`: Playwright config (test dir `./tests/e2e`, port 1420, web server)
- `tests/e2e/scraper.spec.ts`: Scraping workflow E2E tests
- `tests/e2e/multi_vpc_scrape.spec.ts`: Multi-VPC scraping tests
- `tests/e2e/screenshot_test.spec.ts`: Screenshot capture tests
- `tests/e2e/screenshot_sidebar_test.spec.ts`: Sidebar screenshot tests
- `tests/e2e/check_console.spec.ts`: Console error check tests

## Naming Conventions

**Files:**
- React components: PascalCase (`App.tsx`, `BomTab.tsx`, `ProductForm.tsx`, `ScrapeComponents.tsx`)
- Utilities: camelCase (`iframeScraper.ts`)
- CSS: PascalCase match component name (`App.css`)
- Rust source: snake_case (`config.rs`, `db.rs`, `scraper_task.rs`, `scraper_engine.rs`)
- Tests: snake_case dot-separated (`scraper.spec.ts`, `multi_vpc_scrape.spec.ts`)

**Directories:**
- Frontend: lowercase (`utils/`, `assets/`)
- Backend: lowercase (`capabilities/`, `gen/`, `icons/`, `scripts/`)
- Test: lowercase (`e2e/`)

## Where to Add New Code

**New Feature:**
- Primary code: Create a new component file in `src/` (e.g., `src/NewFeature.tsx`) and import it into `src/App.tsx`
- Backend commands: Add new `#[tauri::command]` function in a new or existing Rust module under `src-tauri/src/`, register it in `lib.rs` `invoke_handler!` macro
- Tests: `tests/e2e/` for Playwright E2E tests

**New Component/Module:**
- Implementation: `src/ComponentName.tsx` with PascalCase naming
- If it has sub-components, consider a directory: `src/ComponentName/index.tsx`, `src/ComponentName/SubComponent.tsx`
- Add corresponding CSS classes to `src/App.css` rather than using inline styles

**Utilities:**
- Shared helpers: `src/utils/utilityName.ts` for TypeScript utilities
- Rust utilities: `src-tauri/src/module_name.rs` for Rust helpers

**New Rust Module:**
- Create file in `src-tauri/src/new_module.rs`
- Add `mod new_module;` at top of `src-tauri/src/lib.rs`
- Implement `#[tauri::command]` functions and register in `generate_handler![]`

**New Test:**
- Playwright E2E: `tests/e2e/feature_name.spec.ts`

## Special Directories

**`dist/`:**
- Purpose: Vite build output (frontend production bundle)
- Generated: Yes (by `npm run build`)
- Committed: No (.gitignore)

**`src-tauri/target/`:**
- Purpose: Rust compilation output
- Generated: Yes (by `cargo build`)
- Committed: No (.gitignore)

**`src-tauri/gen/`:**
- Purpose: Auto-generated Tauri v2 schemas
- Generated: Yes (by Tauri build)
- Committed: Yes (schemas only, needed for IDE support)

**`node_modules/`:**
- Purpose: npm package dependencies
- Generated: Yes (by `npm install`)
- Committed: No (.gitignore)

**`src-tauri/icons/`:**
- Purpose: Application icons for Windows installer (32x32, 128x128, ico, icns)
- Generated: No
- Committed: Yes

**`.planning/`:**
- Purpose: GSD (Goal-Structured Development) planning artifacts including this codebase map
- Generated: No (manually maintained)
- Committed: Yes (internal planning, not part of product build)

---

*Structure analysis: 2026-07-18*
