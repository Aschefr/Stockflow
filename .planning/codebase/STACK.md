# Technology Stack

**Analysis Date:** 2026-07-18

## Languages

**Primary:**
- TypeScript ~5.8.3 — Frontend UI (`src/`)
- Rust edition 2021 — Backend native layer (`src-tauri/src/`)

**Secondary:**
- JavaScript — WebView scraping scripts (`src-tauri/src/scripts/webview_scraper.js`)
- Python — 100+ scratch/analysis scripts in `scratch/` (development/debugging only)

## Runtime

**Environment:**
- Tauri v2 — Desktop application shell (cross-platform: Windows, macOS, Linux)
- Bundled WebView2 on Windows, WebKit on macOS/Linux
- Node.js — Dev toolchain only (Vite, TypeScript compiler, Playwright)

**Package Manager:**
- npm (Node.js) — Frontend dependencies
- Cargo (Rust) — Backend/Rust dependencies
- Lockfiles: `package-lock.json` (present), `src-tauri/Cargo.lock` (present)

## Frameworks

**Core:**
- React ^19.1.0 — Frontend UI framework (`src/`)
- Tauri v2 — Desktop native bridge + IPC command system (`src-tauri/`)
- Vite ^7.0.4 — Frontend build/dev server (`vite.config.ts`)

**Testing:**
- Playwright ^1.61.0 — End-to-end testing (`tests/e2e/`)
- Config: `playwright.config.ts`

**Build/Dev:**
- @vitejs/plugin-react ^4.6.0 — React integration for Vite
- tauri-build v2 — Rust build dependency for Tauri
- PowerShell script `build.ps1` — Automated build + binary packaging

## Key Dependencies

**Critical (Frontend — React / TypeScript):**
- `@tauri-apps/api` ^2 — Tauri frontend IPC bridge (`src/App.tsx`)
- `@tauri-apps/plugin-opener` ^2 — Open files/paths from WebView (`src/App.tsx`)
- `@dnd-kit/core` ^6.3.1 — Drag-and-drop table columns (`src/App.tsx`)
- `@dnd-kit/sortable` ^10.0.0 — Sortable drag-and-drop items (`src/App.tsx`)
- `@dnd-kit/utilities` ^3.2.2 — DnD utilities (`src/App.tsx`)
- `jspdf` ^4.2.1 — PDF generation (BOM exports, reports)
- `jspdf-autotable` ^5.0.8 — PDF table plugin
- `xlsx` ^0.18.5 — Excel file parsing (CSV import)
- `xlsx-js-style` ^1.2.0 — Styled Excel export

**Critical (Backend — Rust):**
- `tauri` v2 — Desktop framework with `protocol-asset` feature (`src-tauri/Cargo.toml`)
- `rusqlite` 0.39.0 (bundled) — Embedded SQLite database (`src-tauri/src/db.rs`)
- `reqwest` 0.12 — HTTP client with `blocking`, `json`, `rustls-tls`, `cookies` features (`src-tauri/src/scraper_http.rs`)
- `serde` / `serde_json` 1 — JSON serialization throughout
- `rfd` 0.17.2 — Native file dialogs (`src-tauri/src/lib.rs`)
- `chrono` 0.4.44 — DateTime handling
- `uuid` 1.23.1 (v4) — UUID generation for event IDs and audit logs
- `tauri-plugin-opener` 2 — External URL/path opening
- `tauri-plugin-window-state` 2 — Window position/size persistence
- `tokio` 1 — Async runtime (`sync`, `time` features)
- `tokio-util` 0.7 — Cancellation token support
- `image` 0.25 — Image processing (JPEG, PNG)
- `urlencoding` 2.1.3 — URL encoding for search queries
- `base64` 0.22.1 — Base64 encode/decode for WebView screenshot data-URIs
- `lazy_static` 1.5 — Global lazy statics (HTTP client, rate limit state)
- `thiserror` 1 — Error type derivation

**Infrastructure:**
- `tauri-build` v2 — Build-time Tauri configuration (`src-tauri/build.rs`)
- `@types/react` ^19.1.8 — React type definitions
- `@types/react-dom` ^19.1.6 — ReactDOM type definitions

## Configuration

**Environment:**
- No `.env` file — Configuration is not stored in environment variables
- App configuration stored in `%APPDATA%/Stockflow/config.json` (`src-tauri/src/config.rs`)
- Config includes: trigramme, network path, SearxNG URL(s), VPC sites, VPC API keys, VPC URLs, naming conventions, price tax type, image candidates limit
- Network shared folder at user-configured path with subfolders: `events/`, `images/`, `documents/`
- Local SQLite cache DB at `%APPDATA%/Stockflow/stockflow.db`

**Build:**
- `tauri.conf.json` — Tauri app config (window, security, bundle, icon)
- `tsconfig.json` — TypeScript config (ES2020 target, strict mode, React JSX)
- `tsconfig.node.json` — TypeScript config for Vite config file
- `vite.config.ts` — Vite config (port 1420, HMR on port 1421, Tauri dev mode)
- `playwright.config.ts` — Playwright E2E config (test dir `tests/e2e`, web server on port 1420)
- `build.ps1` — Custom build script (compiles Tauri app, copies binaries to `release_bin/`)

## Platform Requirements

**Development:**
- Windows (primary target, WebView2 required)
- Rust toolchain (rustc, cargo)
- Node.js + npm
- Tauri CLI v2 (`@tauri-apps/cli`)
- WebView2 runtime (Windows) or WebKit (macOS/Linux)

**Production:**
- Windows desktop (Windows 10+)
- WebView2 runtime (included with Windows 11, installable on Windows 10)
- Network access to shared folder (SMB/Windows file share)
- Optional: SearxNG instance (local or network) for scraping features
- Optional: Farnell API key, Mouser API key for API-based scraping
- Distribution: NSIS installer (`StockFlow_Setup_x64.exe`), MSI (`StockFlow_x64.msi`), or portable exe (`StockFlow.exe`)

---

*Stack analysis: 2026-07-18*
