# StockFlow

## What This Is

StockFlow est un outil intelligent de gestion d'inventaire industriel, 100% portable, fonctionnant sur dossier réseau partagé sans serveur central. L'application est construite avec Tauri v2 (Rust backend + React/TypeScript frontend) et utilise une architecture Event-Sourcing pour éviter les conflits d'accès concurrents sur le réseau Windows.

## Core Value

Les utilisateurs doivent pouvoir gérer leur inventaire industriel (références, mouvements de stock, scraping fournisseurs, nomenclatures) en toute confiance — l'interface doit refléter fidèlement l'état réel des données, sans incohérence ni comportement UX inattendu.

## Requirements

### Validated

- ✓ Moteur Event-Sourcing avec synchronisation réseau (polling 4s, mode hors-ligne) — existing
- ✓ Grille d'inventaire type tableur avec recherche, filtres, édition inline — existing
- ✓ Dashboard avec KPIs (total références, valeur stock, alertes, mouvements récents) — existing
- ✓ Scraping multi-fournisseurs (RS Components, Conrad, Farnell, Mouser, Distrelec) — existing
- ✓ Scraping par lot (images, PDF, prix) avec sélection par checkbox — existing
- ✓ Pré-remplissage intelligent à la création (autofill via code VPC/MPN) — existing
- ✓ Nomenclatures (BOM) avec statut stock en temps réel — existing
- ✓ Export PDF (fiche picking) et XLSX (commande achat) — existing
- ✓ Import CSV avec migration des médias — existing
- ✓ Configuration poste (trigramme, dossier réseau) — existing

### Active

- [ ] **E2E-01**: Suite de tests E2E structurée avec fixtures réutilisables et helpers
- [ ] **E2E-02**: Tests de cohérence données — chaque action utilisateur (création, modification, scraping) est vérifiée en lecture UI et en base
- [ ] **E2E-03**: Tests d'états visuels — vérification que les éléments UI s'affichent correctement (modales, loading states, boutons désactivés, badges, colonnes)
- [ ] **E2E-04**: Tests Dashboard — KPIs reflètent le stock réel, colonnes d'activité cohérentes
- [ ] **E2E-05**: Tests Inventaire — recherche, filtres, édition inline, tri, colonnes personnalisables
- [ ] **E2E-06**: Tests Scraping — autofill RS/Conrad/Farnell/Mouser/Distrelec, fallback SearxNG, batch scraping prix/images/PDF, validation des données scrapées
- [ ] **E2E-07**: Tests BOM/Projets — création nomenclature, ajout articles, statut stock, export PDF picking, export XLSX commande
- [ ] **E2E-08**: Détection d'anomalies UX — console errors, éléments orphelins, états bloquants, timeouts inattendus
- [ ] **E2E-09**: Rapports de test automatiques (HTML, capture d'écran sur échec, traces Playwright)

### Out of Scope

- Tests unitaires frontend (React) — couverts par un autre périmètre
- Tests unitaires backend (Rust) — couverts par un autre périmètre
- Refactoring du code applicatif — les tests doivent fonctionner sur le code existant sans modification
- Tests de performance / charge

## Context

**Technologies:** Tauri v2, React 19, TypeScript 5.8, Rust 2021, Playwright 1.61, SQLite (local), JSON events (réseau)

**Environnement de test:** L'application Tauri est lancée avec le flag `--remote-debugging-port=9222` pour la connexion CDP Playwright. Les tests existants (`test_e2e.cjs`, `tests/e2e/`) utilisent ce mécanisme. Le backend Rust compile en target debug.

**Données de test:** Un jeu de données existe dans `exemple_data/` avec CSV d'inventaire, images et PDF. Un dossier réseau partagé simulé est disponible localement.

**Contraintes existantes:**
- Les tests nécessitent un build Rust du backend en debug (`src-tauri/target/debug/tauri-app.exe`)
- Le scraping dépend de sites externes (RS, Conrad, etc.) — tests sensibles au réseau
- Les tests actuels (`test_e2e.cjs`, `scraper.spec.ts`, `multi_vpc_scrape.spec.ts`, `screenshot_*.spec.ts`, `check_console.spec.ts`) sont disparates et sans structure commune
- La commande `npm run test:e2e` enchaîne `cargo build` puis `playwright test`

## Constraints

- **Réseau**: Les tests de scraping nécessitent une connexion internet — prévoir timeouts longs et fallbacks
- **Build Rust**: Chaque exécution de test E2E nécessite un binaire Tauri compilé en debug
- **Port 9222**: Le port CDP doit être libre pour la connexion Playwright → Tauri
- **État persistant**: La base SQLite locale (`%APPDATA%/Stockflow/stockflow.db`) peut contenir des résidus de tests précédents
- **Playwright**: Framework imposé par le stack existant (`@playwright/test` + `playwright`)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Nouvelle suite plutôt qu'extension | Tests existants disparates, sans structure commune, difficilement maintenables | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-18 after initialization*
