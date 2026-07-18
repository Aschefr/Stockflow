# Coding Conventions

**Analysis Date:** 2026-07-18

## Naming Patterns

**Files:**
- PascalCase for React components: `App.tsx`, `BomTab.tsx`, `ProductForm.tsx`, `ScrapeComponents.tsx`, `ProductDetailPanel.tsx`
- camelCase for utilities: `iframeScraper.ts`
- PascalCase for entry point: `App.tsx`, `main.tsx`
- Pattern: `<ComponentName>.tsx` for components, `<description>.ts` for utilities

**Functions:**
- camelCase for regular functions: `getVpcCode()`, `cleanNumericInput()`, `handleSaveSettings()`, `handleSelectProduct()`
- PascalCase for React component functions: `App()`, `ProductForm()`, `BomTab()`, `AutoFillModal()`
- `handle` prefix for event handlers: `handleMouseDown`, `handleSelectProduct`, `handleAutoFillApply`, `handleLaunchUnifiedScrape`
- `set` prefix for state setters (React convention): `setActiveTab`, `setSearchQuery`, `setSelectedProduct`
- `load`/`fetch` prefix for data loading: `loadConfig()`, `loadMedia()`, `fetchBoms()`
- `on` prefix for callback props: `onClose`, `onSubmit`, `onScrape`
- Anonymous async functions used inline for IIFE patterns (e.g., `(async () => { ... })()` in `src/App.tsx`)

**Variables:**
- camelCase exclusively: `activeTab`, `selectedProduct`, `searchQuery`, `networkPathInput`, `configLoaded`
- Boolean state variables prefixed with `is` or `show`: `isEditingConfig`, `isOnline`, `isDragging`, `showAddModal`, `showColumnSettings`, `showPriceConfirmModal`
- Plural `s` suffix for arrays: `products`, `columns`, `categories`, `vpcSitesInput`
- Refs use `Ref` suffix: `selectedProductRef`, `batchSkusRef`

**Types:**
- PascalCase with noun-first naming: `AppConfig`, `Product`, `ColumnConfig`, `BomItem`, `Bom`, `DashboardStats`, `ProductHistoryItem`
- Interface names use no prefix (no `I` prefix convention): `interface Product`, `interface AppConfig`, `interface Bom`
- Props interfaces use `<Component>Props` pattern: `ProductFormProps`, `AutoFillModalProps`, `ProductDetailPanelProps`
- Some types are defined locally within components (e.g., `PriceCandidate`, `ConfirmModalConfig`, `AlertModalConfig` in `src/App.tsx`)
- Re-exported types use `export` keyword directly: `export interface BomItem`, `export interface Bom`, `export interface AutoFillSelections`

## Code Style

**Formatting:**
- No Prettier config detected — no automatic formatting tool configured
- No ESLint config detected — no linting tool configured
- Semicolons: Used consistently (TypeScript default)
- Quotes: Double quotes used throughout (`import`, `className`, string values)
- Trailing commas: Used in multiline arrays/objects
- Indentation: 2 spaces

**Linting:**
- No ESLint detected — linting relies entirely on TypeScript compiler
- TypeScript strict mode enabled in `tsconfig.json`:
  - `"strict": true`
  - `"noUnusedLocals": true`
  - `"noUnusedParameters": true`
  - `"noFallthroughCasesInSwitch": true`
- `"skipLibCheck": true` to skip node_modules type checking

## Import Organization

**Order:**
1. React/core imports: `import { useState, useEffect } from "react"`
2. Tauri API imports: `import { invoke, convertFileSrc } from "@tauri-apps/api/core"`
3. Plugin imports: `import { openPath } from "@tauri-apps/plugin-opener"`
4. Third-party library imports: `import * as XLSX from "xlsx-js-style"`, `import jsPDF from "jspdf"`
5. Local component imports: `import { ProductForm } from "./ProductForm"`
6. Asset imports: `import logoImg from "./assets/logo.png"`
7. CSS imports: `import "./App.css"`

**Path Aliases:**
- No path aliases configured in `tsconfig.json`
- All imports use relative paths (`./`, `../`)

## Error Handling

**Patterns:**
- Try/catch blocks with `console.error` logging for most async operations:
  ```typescript
  try {
    const result = await invoke("some_command");
    // handle success
  } catch (err) {
    console.error("Failed to load config", err);
  }
  ```
- Silent catch blocks for expected/non-critical errors:
  ```typescript
  .catch(() => {});
  ```
  Used extensively in `src/App.tsx` for operations like `invoke("send_notification")` where failure is non-critical.
- Silent try/catch with empty catch for JSON parsing:
  ```typescript
  try { JSON.parse(prod.attributes || "{}"); } catch (e) {}
  ```
- User-facing errors via toast notifications:
  ```typescript
  showToast("Erreur import d'images : " + err.toString(), "error");
  ```
- Form-level errors via dedicated state variables like `configError`, `createError`, `editError`, `movementError`
- Some async operations use `.catch()` chaining instead of try/catch:
  ```typescript
  invoke("get_app_version")
    .then((ver) => setAppVersion(ver))
    .catch(() => {});
  ```
- `async/await` with try/catch is the dominant pattern throughout the codebase.

## Logging

**Framework:** `console` (no structured logging library)

**Patterns:**
- `console.log()` for general debugging and flow tracing, mostly in English
- `console.error()` for error logging
- `console.warn()` for warnings (e.g., network offline detection)
- French messages in user-facing console output for E2E test files
- Structured log prefixes used in `iframeScraper.ts`: `[IframeScraper]`, `[E2E JS]` in `App.tsx`
- No log levels, no structured logging framework

## Comments

**When to Comment:**
- French is the primary language for comments throughout the codebase
- Component-level descriptions: JSDoc-style block comments at the top of component modules describe their purpose:
  ```typescript
  /**
   * ScrapeProgressBadge - Badge discret de progression du scraping en arrière-plan.
   * ...
   */
  ```
- Section dividers: `// ─── [section name] ────────────────────────────────────────` used in `src/App.tsx`
- Inline comments explain business logic in French
- Step numbering comments: `// 1. Initial configuration load`, `// 2. Background Polling...`
- Comment markers like `// Avoid unused variable compiler errors` indicate forced workarounds
- Few English comments — mostly found in test files and utility code

**JSDoc/TSDoc:**
- Used for complex component documentation (see `ScrapeComponents.tsx`):
  ```typescript
  /**
   * AutoFillModal - Modal principal d'auto-remplissage.
   * 
   * Affiche toutes les données candidats scrapées pour un SKU, avec des dropdowns
   * de sélection par propriété. L'utilisateur valide sa sélection avant application.
   */
  ```
- Not used for regular functions or interfaces
- Type-only interfaces (no JSDoc on props)

## Function Design

**Size:**
- Components range from ~9 lines (`main.tsx`) to ~1800+ lines (`App.tsx` — very large, covers most app logic)
- Helper functions are usually small (3-10 lines)
- Event handler functions tend to be large (20-100+ lines) with nested logic
- Autonomous functions are preferred over extracting into separate modules

**Parameters:**
- Named parameters via TypeScript interfaces for component props
- Regular functions accept positional parameters or single config objects
- Callback props use consistent naming: `on<Event>` pattern
- Destructuring object parameters in component definitions

**Return Values:**
- Functions that can fail return `void` and throw/catch side effects
- Data-fetching functions use `async` with typed return values
- Helper functions return typed values (`string`, `number`, `boolean`)
- `useState` setter functions store `null` for empty/unset states

## Module Design

**Exports:**
- Named exports for most components: `export function ProductForm`, `export function AutoFillModal`, `export function ScrapeProgressBadge`
- Default export for `BomTab`: `export default function BomTab`
- Named exports for interfaces: `export interface BomItem`, `export interface ScrapedIframeData`, `export interface AutoFillSelections`
- Named exports in utility file: `export function scrapeUrlWithIframe`

**Barrel Files:**
- Not used — components import directly from each file
- No `index.ts` files detected for re-exporting

---

*Convention analysis: 2026-07-18*
