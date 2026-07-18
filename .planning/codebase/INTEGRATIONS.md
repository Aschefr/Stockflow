# External Integrations

**Analysis Date:** 2026-07-18

## APIs & External Services

**Supplier API Integrations (VPC — Vente Par Correspondance):**
- **Farnell / element14 API** — Product search by SKU/MPN
  - SDK/Client: Raw `reqwest` HTTP POST/POST calls (`src-tauri/src/scraper.rs` lines 2638-2696)
  - Endpoint: `https://api.element14.com/catalog/v1/service?keyword=search:{sku}&apiKey={key}&storeInfo.id=fr.farnell.com`
  - Auth: API key passed as query parameter `apiKey` — stored in config under `vpc_api_keys["Farnell"]`
  - Also calls: `https://fr.farnell.com/dp/{code}` via WebView fallback (currently disabled — `src-tauri/src/providers.rs` line 53)
  - Configuration: `vpc_api_keys["Farnell"]` in `config.json`

- **Mouser API** — Product search by part number
  - SDK/Client: Raw `reqwest` POST to JSON endpoint (`src-tauri/src/scraper.rs` lines 2698-2763)
  - Endpoint: `https://api.mouser.com/api/v1.0/search/partnumber?apiKey={key}`
  - Auth: API key passed as query parameter `apiKey` — stored in config under `vpc_api_keys["Mouser"]`
  - Configuration: `vpc_api_keys["Mouser"]` in `config.json`

- **RS Components** — Product data via direct HTTP scraping + WebView fallback
  - SDK/Client: `reqwest` with stealth headers + human delays (`src-tauri/src/scraper_http.rs`)
  - Primary URL: `https://fr.rs-online.com/web/c/?searchTerm={code}`
  - Fallback URL: `https://ma.rsdelivers.com/product/a/a/a/{code}`
  - WebView fallback: Hidden Tauri WebView window with JS injection (`src-tauri/src/scraper.rs` lines 2853-2969)
  - Scraping script: `src-tauri/src/scripts/webview_scraper.js`
  - No API key required (web scraping only)
  - Rate-limited: enforced 1.5s minimum between requests (`src-tauri/src/scraper_http.rs` lines 14-35)
  - Anti-bot: Random rotating User-Agents (Chrome 131, Firefox 133, Edge 131, Safari 18.1), stealth HTTP headers, human-like delays (1.5-4s standard, 5% chance of 8-15s pause)

- **Conrad** — Product data via direct HTTP scraping (WebView disabled due to CAPTCHA/deadlocks)
  - Primary URL: `https://www.conrad.fr/p/{code}`
  - Configuration accepts custom `vpc_urls["Conrad"]` for alternative domains

**Search Engine Integration:**
- **SearxNG** — Self-hosted metasearch engine for product discovery
  - SDK/Client: `reqwest` GET to JSON endpoint (`src-tauri/src/scraper_http.rs` lines 274-345, `src-tauri/src/searxng.rs`)
  - Endpoint: `{base_url}/search?q={query}&format=json`
  - Image search: `{base_url}/search?q={query}&categories=images&format=json`
  - Configuration: `searxng_url` (primary, default `http://localhost:8080`) and `searxng_urls` (fallback list) in `config.json`
  - Hardcoded fallback: `https://search.amify-studio.fr` (`src-tauri/src/scraper_http.rs` line 251)
  - Used for: reseller discovery, price lookup, datasheet PDF search, product image search
  - Local server delay: 200-400ms between requests

**Web/CDN Dependencies:**
- **RS Cloudinary CDN** — Product images for RS Components items
  - URL pattern: `https://res.cloudinary.com/rsc/image/upload/b_rgb:FFFFFF,c_pad,dpr_1.0,f_auto,q_auto,w_700/c_pad,w_700/{prefix}{code}-{idx:02}.jpg` (`src-tauri/src/scraper_engine.rs` line 600)
  - Validated via HEAD request before adding as candidate
  - Prefixes: `Y` and `F`; indices: 01-05

- **html2canvas (CDNJS)** — Screenshot capture library injected into WebView
  - URL: `https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js` (`src-tauri/src/scraper_engine.rs` line 704)
  - Injected dynamically as fallback (local copy from `node_modules/html2canvas` preferred)

- **svgfavicon.vercel.app** — Scrape progress notifications use this as placeholder icon (observed in `src-tauri/src/scripts/webview_scraper.js`)

## Data Storage

**Databases:**
- SQLite (embedded via `rusqlite` 0.39.0 with `bundled` feature)
  - Connection: Local file at `%APPDATA%/Stockflow/stockflow.db`
  - Client: `rusqlite` Rust crate (`src-tauri/src/db.rs`)
  - Tables: `products`, `boms`, `bom_items`, `applied_events`, `product_history`, `product_audit_log`, `applied_audits`, `pending_events`
  - Purpose: Local cache of network product data, history/audit logs, BOMs
  - Schema migrations handled inline with column existence checks (`src-tauri/src/db.rs` lines 87-109)

**File Storage:**
- Network shared folder (Windows SMB/CIFS file share) — Primary data store
  - Folder structure:
    - `events/` — JSON event files (product create/update, stock movements)
    - `images/` — Product images (JPG/PNG) and thumbnails (`thumb_*`)
    - `documents/` — Product PDF datasheets (hierarchical: `{Brand}/{Category}/{SubCategory}/{SKU}/`)
  - Path configured by user via config `network_path`
  - Handles offline mode: events queued in `pending_events` table when network unavailable (`src-tauri/src/events.rs` lines 71-97)

- Local filesystem only (no cloud storage integration)

**Caching:**
- SQLite local cache DB — caches products, history, and audit log from network events
- Scrape cache: JSON files in `{network_path}/scrape_cache/{SKU}.json` (`src-tauri/src/scraper_engine.rs`)
- Screenshots: `{network_path}/scrape_cache/screenshots/{SKU}_{idx}.jpg`
- WebView PDF cache: In-memory `Mutex<Option<(String, Vec<(String, String)>)>>` (`src-tauri/src/scraper.rs` line 31)

## Authentication & Identity

**Auth Provider:**
- Custom (no external identity provider)
  - User identity: 3-letter "trigramme" code configured in app settings (`src-tauri/src/config.rs` line 31)
  - Trigramme stamped on all event files and audit logs
  - No user login, no OAuth, no SSO

**API Key Storage:**
- VPC API keys (Farnell, Mouser) stored in `%APPDATA%/Stockflow/config.json` as `vpc_api_keys` hashmap (`src-tauri/src/config.rs` line 50)
- Keys are plaintext in JSON config file (no encryption)
- Set via UI save_config command

## Monitoring & Observability

**Error Tracking:**
- None — No Sentry, no crash reporting, no external error tracking service

**Logs:**
- Debug logging to file: `{project_root}/scratch/webview_debug.log` (`src-tauri/src/scraper.rs` lines 2765-2774)
- Console logging in frontend: `console.log` / `console.warn` statements in `src/App.tsx` and `src/utils/iframeScraper.ts`
- No structured logging framework (no tracing, no log crate)
- Audit log: Events written to network `events/` directory as JSON files, mirrored to SQLite `product_audit_log` table

## CI/CD & Deployment

**Hosting:**
- Desktop application (Windows) — self-hosted on user machines
- No cloud hosting, no server deployment
- Network share acts as shared data store for multi-user setup

**CI Pipeline:**
- None detected — No GitHub Actions, no GitLab CI, no Jenkins
- No `.github/` directory
- No Docker or container configuration

**Build Process:**
- Manual build via `build.ps1` PowerShell script (`build.ps1`)
  - Runs `npm run tauri build`
  - Copies artifacts to `release_bin/`: `StockFlow.exe` (portable), `StockFlow_Setup_x64.exe` (NSIS installer), `StockFlow_x64.msi` (MSI)
  - Kills running processes before build

**E2E Testing:**
- Playwright tests connect via Chrome DevTools Protocol to Tauri's WebView2 (`--remote-debugging-port=9222`)
- Tests defined in `tests/e2e/` — scraper tests, screenshot tests, multi-VPC tests

## Environment Configuration

**Configuration file:** `%APPDATA%/Stockflow/config.json` (JSON format, not environment variables)

**Required config fields:**
- `trigramme` (string, 3 chars) — User identifier
- `network_path` (string) — Path to shared network folder

**Optional config fields:**
- `searxng_url` (string, default `http://localhost:8080`) — SearxNG instance URL
- `searxng_urls` (string[]) — Additional SearxNG instance URLs
- `max_image_candidates` (number, default 15)
- `vpc_sites` (string[], default `["RS", "Farnell", "Mouser", "Conrad"]`)
- `pdf_rename_convention` (string, default `"{SKU}_datasheet.pdf"`)
- `image_rename_convention` (string, default `"{SKU}_{Index}.jpg"`)
- `pdf_size_threshold` (number, default 5.0)
- `price_tax_type` (string, default `"HT"`)
- `vpc_api_keys` (object) — API keys per provider e.g. `{"Farnell": "...", "Mouser": "..."}`
- `vpc_urls` (object) — Custom domains per provider e.g. `{"RS": "fr.rs-online.com", "Farnell": "fr.farnell.com"}`

**Secrets location:**
- API keys stored in plaintext in `%APPDATA%/Stockflow/config.json` (local machine only, does not sync to git)

## Webhooks & Callbacks

**Incoming:**
- None — No webhook endpoints

**Outgoing:**
- None — No webhook callbacks to external services

## Networking

**Outbound HTTP requests made by the application:**
1. `fr.rs-online.com` — Product page scraping (with stealth headers, human delays, 1.5s rate limit)
2. `ma.rsdelivers.com` — RS Components fallback domain
3. `api.element14.com` — Farnell API (requires API key)
4. `api.mouser.com` — Mouser API (requires API key)
5. `www.conrad.fr` — Conrad product page scraping
6. `res.cloudinary.com` — RS Cloudinary image CDN (HEAD validation)
7. `cdnjs.cloudflare.com` — html2canvas CDN (screenshot fallback)
8. SearxNG instance(s) — User-configured, default `http://localhost:8080`, fallback `https://search.amify-studio.fr`

**Internal networking (local machine only):**
- Tauri app server: `localhost:1420` (Vite dev), `localhost:1421` (HMR WebSocket)
- WebView2 remote debugging: `localhost:9222` (test mode only)

---

*Integration audit: 2026-07-18*
