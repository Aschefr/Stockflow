# Testing Patterns

**Analysis Date:** 2026-07-18

## Test Framework

**Runner:**
- Playwright `^1.61.0`
- Config: `playwright.config.ts`

**Assertion Library:**
- Playwright's built-in `expect` (`@playwright/test`)

**Run Commands:**
```bash
cargo build --manifest-path src-tauri/Cargo.toml && playwright test              # Run all E2E tests
cargo build --manifest-path src-tauri/Cargo.toml && npx playwright test          # Run all E2E tests (via npx)
npm run test:e2e                                                                 # Run all E2E tests (npm script)
```

**No unit or integration test infrastructure exists.** The project has no jest, vitest, or any other test runner configured.

## Test File Organization

**Location:**
- All tests live in `tests/e2e/` — no co-located tests

**Naming:**
- Pattern: `<description>.spec.ts`
- Examples: `scraper.spec.ts`, `screenshot_test.spec.ts`, `multi_vpc_scrape.spec.ts`, `check_console.spec.ts`, `screenshot_sidebar_test.spec.ts`

**Structure:**
```
tests/
└── e2e/
    ├── scraper.spec.ts                 # RS + Fallback scraping E2E
    ├── multi_vpc_scrape.spec.ts        # Multi-VPC + batch + DB verification
    ├── screenshot_test.spec.ts         # WebView screenshot capture (skipped)
    ├── screenshot_sidebar_test.spec.ts # Sidebar scrape screenshot (skipped)
    ├── check_console.spec.ts           # Root innerHTML extraction helper
    └── e2e_requirements_reminder.md    # Original prompt requirements (documentation)
```

## Test Structure

**Suite Organization:**
All test files follow the same Playwright E2E pattern:

```typescript
import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

let tauriApp: ChildProcess;
let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  // 1. Check Tauri binary exists
  // 2. Spawn Tauri app with CDP debugging port
  // 3. Connect via chromium.connectOverCDP()
  // 4. Get first page from browser context
});

test.afterAll(async () => {
  if (browser) await browser.close();
  if (tauriApp) tauriApp.kill();
});

test('test description', async () => {
  test.setTimeout(120000);
  // E2E flow: click → waitForSelector → assert
});
```

**Patterns:**
- **Setup pattern:** `test.beforeAll` — spawn Tauri binary, connect via CDP, get page reference
- **Teardown pattern:** `test.afterAll` — close browser, kill Tauri process
- **Assertion pattern:** Playwright `expect()` with DOM checks, text content checks
- **Timeouts:** `test.setTimeout()` set per-test (e.g., 120s, 1800000ms for batch test)
- **Wait pattern:** `await page.waitForSelector()` with timeout options
- **Skipped tests:** `test.skip('description', ...)` for disabled tests

## Mocking

**Framework:** Not used — no mocking framework exists. All tests run against a real Tauri backend.

**Patterns:**
- No mocking, stubbing, or test doubles anywhere in the codebase
- Tests interact with the real Rust backend via the Tauri IPC bridge
- `multi_vpc_scrape.spec.ts` uses a Python helper (`scratch/e2e_db_helper.py`) to directly query the SQLite database for verification

**What to Mock:**
- Not applicable — no mocking is done

**What NOT to Mock:**
- The E2E approach tests the full stack (frontend + Tauri backend + filesystem + database)

## Fixtures and Factories

**Test Data:**
- Test data is hardcoded as arrays of test case objects:
```typescript
const testCases = [
  { name: 'RS Components', provider: 'RS', code: '114-8175', targetSku: 'TEST-SCRAPE-RS' },
  { name: 'Conrad', provider: 'Conrad', code: '1827117', targetSku: 'TEST-SCRAPE-CONRAD' },
  { name: 'Farnell', provider: 'Farnell', code: '3051886', targetSku: 'TEST-SCRAPE-FARNELL' },
  { name: 'Mouser', provider: 'Mouser', code: '511-A9F74103', targetSku: 'TEST-SCRAPE-MOUSER' },
  { name: 'SearxNG Fallback', provider: 'mpn', code: 'Fluke 117', targetSku: 'TEST-SCRAPE-FALLBACK' }
];
```

**Location:**
- No separate fixtures directory — test data is defined inline within spec files
- No test factories or data builders

## Coverage

**Requirements:** None enforced — no coverage tool configured. Only Playwright E2E tests exist.

**View Coverage:**
```bash
# No coverage tool configured
```

## Test Types

**Unit Tests:**
- **Not used.** No unit test framework exists. No `*.test.ts` files found anywhere. Pure functions in `src/utils/iframeScraper.ts` have no tests.

**Integration Tests:**
- **Not used.** No integration test infrastructure exists.

**E2E Tests:**
- **Framework:** Playwright
- **Approach:** Full-stack E2E via Tauri binary spawn + CDP debugging
- Tests interact with the real UI by clicking elements, filling forms, and asserting on DOM state
- `multi_vpc_scrape.spec.ts` includes DB verification via a Python helper script

## Common Patterns

**Setup/Teardown:**
```typescript
// All E2E test files share this exact setup pattern:
test.beforeAll(async () => {
  const executablePath = path.resolve(process.cwd(), 'src-tauri/target/debug/tauri-app.exe');
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Executable not found: ${executablePath}`);
  }
  tauriApp = spawn(executablePath, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222"
    }
  });
  // Poll for CDP connection (up to 20-30 retries at 1s intervals)
  for (let i = 0; i < 20; i++) {
    try {
      browser = await chromium.connectOverCDP('http://localhost:9222');
      break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  page = browser.contexts()[0].pages()[0];
});
```

**UI Interaction Pattern:**
```typescript
// Click navigation
await page.click('text=Liste d\'Inventaire');

// Wait for element to appear
await page.waitForSelector('button:has-text("Ajouter un SKU")');

// Fill form fields
await page.fill('#modal-p-sku', 'TEST-SCRAPE-RS');
await page.selectOption('#modal-autofill-type', 'RS');

// Assert
const pageContent = await page.content();
expect(pageContent.toLowerCase()).toContain('rs');
```

**Async/Timeout Handling:**
```typescript
test.setTimeout(120000); // 2 minute timeout
await page.waitForSelector('.selector', { timeout: 45000 });
await page.waitForTimeout(2500); // hard wait (used sparingly)
await page.waitForSelector('.selector', { state: 'detached', timeout: 15000 });
```

**Error Testing:**
- No explicit error testing patterns — tests assume happy path
- Errors are logged to console but not asserted on
- `multi_vpc_scrape.spec.ts` uses `console.warn` for soft quality warnings without failing the test

**DB Verification Pattern:**
```typescript
// Used in multi_vpc_scrape.spec.ts
const dbProduct = getProductFromDb(tc.targetSku);
expect(dbProduct).toBeDefined();
expect(dbProduct.price).toBeGreaterThan(1.0);
```

---

*Testing analysis: 2026-07-18*
