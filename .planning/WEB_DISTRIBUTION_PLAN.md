# Plan de Conception & Suivi : Version Pure Web (Standalone HTML) & Architecture Dual-Target

## 1. Contexte & Problématique Métier
- **Contexte :** L'application Stockflow doit être déployée sur des postes de travail industriels à session restreinte (accès utilisateur verrouillé, sans droits administrateur).
- **Blocage rencontré :** Même les exécutables portables (`.exe`) sont soumis à une politique stricte d'approbation d'exécutables (AppLocker, SRP, Defender Application Control) qui empêche le lancement direct de la version Desktop Tauri.
- **Solution validée :** Fournir une **version Web pure** sous la forme d'un fichier HTML unique autonome (`Stockflow.html`), exécutable directement dans Microsoft Edge ou Google Chrome (navigateurs d'entreprise approuvés), sur le même modèle que [`Pointage_v1.3.html`](file:///d:/Code%20Projects/gestion%20du%20temps%20personnel/Pointage_v1.3.html).
- **Impératif d'ingénierie :** **Architecture Dual-Target**. La version Desktop Tauri (`.exe`) et la version Web autonome (`Stockflow.html`) partagent **exactement le même code source** (Single Source of Truth). La version pure Web est simplement un package de distribution supplémentaire.

---

## 2. Architecture Technique Dual-Target

```
                               ┌────────────────────────────────┐
                               │   Composants UI React 19       │
                               │  (App, BomTab, ProductForm...) │
                               └───────────────┬────────────────┘
                                               │
                               ┌───────────────▼────────────────┐
                               │     Service API Universel      │
                               │     (src/services/api.ts)      │
                               └───────────────┬────────────────┘
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               │                                                               │
      [Mode TAURI Desktop]                                            [Mode PURE WEB]
  (window.__TAURI_INTERNALS__)                                     (Navigateur Edge / Chrome)
               │                                                               │
 ┌─────────────▼─────────────┐                                   ┌─────────────▼─────────────┐
 │    Tauri Core IPC         │                                   │     Web Backend Engine    │
 │    (invoke, listen...)    │                                   │ (src/services/webBackend) │
 └─────────────┬─────────────┘                                   └─────────────┬─────────────┘
               │                                                               │
 ┌─────────────▼─────────────┐                                   ┌─────────────▼─────────────┐
 │    Backend Rust           │                                   │ IndexedDB (Cache local)   │
 │  - SQLite locale          │                                   │ File System Access API    │
 │  - Fichiers JSON réseau   │                                   │  - Lecture events/*.json  │
 │  - Scraper natif          │                                   │  - Écriture direct JSON   │
 └───────────────────────────┘                                   └───────────────────────────┘
```

---

## 3. Matrice de Correspondance des Commandes Tauri vers Web

| Commande Tauri | Rôle Métier | Implémentation Mode Desktop (Tauri) | Implémentation Mode Pure Web (Edge/Chrome) |
| :--- | :--- | :--- | :--- |
| `get_config` / `save_config` | Paramètres (trigramme, dossier, thème) | Fichier `config.json` via Rust | `localStorage` + IndexedDB |
| `select_network_directory` | Choix du partage réseau | Boîte dialogue native OS (`rfd`) | `window.showDirectoryPicker()` (FSA API) |
| `sync_events` | Synchronisation des mouvements | Scan du dossier réseau + SQLite | Scan `events/*.json` via DirectoryHandle + projection IndexedDB |
| `get_products` | Liste complète du catalogue | Requête SQL SQLite `products` | Requête IndexedDB `getAll('products')` |
| `create_product` / `delete_product` | Création / suppression article | Écriture fichier JSON événement | Écriture fichier JSON événement dans DirectoryHandle + update IndexedDB |
| `add_movement` | Entrée, sortie, régularisation | Écriture événement `STOCK_IN/OUT` | Écriture événement `STOCK_IN/OUT` dans DirectoryHandle + update IndexedDB |
| `get_boms` / `save_bom` | Gestion des Nomenclatures | Requête / Événement `BOM_SAVE` | Écriture événement `BOM_SAVE` + update IndexedDB |
| `get_product_history` | Historique des pointages | Requête SQLite `stock_movements` | Requête IndexedDB `history` par SKU |
| `get_product_audit_log` | Traçabilité des modifications | Requête SQLite `audit_log` | Requête IndexedDB `audit_log` par SKU |
| `get_dashboard_stats` | KPIs et alertes stock | Calculs SQL agrégés | Calculs JS en mémoire depuis IndexedDB |
| `list_sku_images` / `pdfs` | Médias attachés à un SKU | Scan répertoires locaux/réseau | Scan des handles `images/` et `documents/` |
| `save_file_dialog` | Export PDF / Excel | Boîte dialogue native OS | Téléchargement direct navigateur (Blob URL) |
| Scraper VPC (`start_scrape`...) | Enrichissement automatique | Moteur Rust + WebView2 | Message d'information (CORS restreint sur le web ; opération à faire sur poste non restreint) |

---

## 4. Stratégie de Persistance et Accès Réseau en Mode Web

1. **File System Access API (Chromium / Edge)** :
   - Fonctionne nativement dans Microsoft Edge sans extension.
   - Au premier lancement ou au clic sur "Dossier Réseau", l'utilisateur sélectionne le dossier partagé (ex: `Z:\Stockflow_Data`).
   - Le handle du dossier est conservé dans IndexedDB pour les sessions suivantes.
   - L'application lit les événements existants `events/*.json` pour reconstituer le stock complet.
   - À chaque modification, elle écrit le fichier JSON directement sur le lecteur réseau.
2. **Mode de repli (Offline / Sans dossier)** :
   - Si l'utilisateur n'a pas encore connecté de dossier réseau, l'application fonctionne en local avec IndexedDB et propose d'importer/exporter une sauvegarde JSON globale.

---

## 5. Pipeline de Build & Packaging

1. **Cible Desktop (Existant inchangé)** :
   ```bash
   npm run build
   npm run tauri build
   ```
   -> Génère `src-tauri/target/release/Stockflow.exe`.

2. **Cible Pure Web (Nouveau)** :
   ```bash
   npm run build:web
   ```
   -> Utilise `vite-plugin-singlefile` pour produire un fichier unique autonome `dist-web/Stockflow.html`.
   -> Le fichier intègre le HTML, le JS bundle, le CSS, les polices et les icônes sans aucune dépendance externe.

---

## 6. Plan d'Exécution & Suivi des Jalons

- [x] **Jalon 1 : Couche d'Abstraction API Universelle**
  - [x] Créer `src/services/api.ts` (détection `isTauri()`, mapping `apiInvoke`, `apiConvertFileSrc`, `apiOpenPath`, `apiListen`).
  - [x] Remplacer les imports directs `@tauri-apps/api` dans les composants par `api.ts`.
  - [x] Vérifier que la version Desktop tourne sans aucune régression.

- [x] **Jalon 2 : Moteur de Stockage Web & IndexedDB**
  - [x] Créer `src/services/webDatabase.ts` (schéma IndexedDB : `products`, `boms`, `history`, `audit_log`, `applied_events`, `config`).
  - [x] Créer `src/services/webEventProcessor.ts` (rejeu des événements JSON répliquant fidèlement `events.rs`).

- [x] **Jalon 3 : Gestionnaire de Fichiers Réseau (FSA API)**
  - [x] Créer `src/services/webFileSystem.ts` (connexion au répertoire partagé, scan des JSON, écriture atomique de nouveaux fichiers d'événements, accès aux images/PDF).
  - [x] Intégrer la lecture des médias (conversion des fichiers image/PDF en ObjectURL locaux).

- [x] **Jalon 4 : Moteur de Commandes Web (`webBackend.ts`)**
  - [x] Implémenter le routeur de commandes pour toutes les méthodes `apiInvoke` nécessaires.
  - [x] Calcul des KPIs Dashboard (`get_dashboard_stats`).
  - [x] Gestion des mouvements de stock et BOMs.

- [x] **Jalon 5 : Configuration du Build Standalone & Tests**
  - [x] Installer et configurer `vite-plugin-singlefile`.
  - [x] Configurer le script `npm run build:web` et intégration dans `build.ps1`.
  - [x] Tester l'exécution directe de `Stockflow.html` via test Playwright autonome.
  - [x] Génération réussie du livrable autonome dans `release_bin/StockFlow.html`.
