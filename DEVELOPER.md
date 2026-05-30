# Guide de Développement — StockFlow

Ce document regroupe les instructions techniques et de compilation destinées aux développeurs de StockFlow.

---

## 🛠️ Stack Technique

- **Backend & Wrapper Natif :** [Tauri v2](https://tauri.app/) (Rust) - Légèreté, sécurité et binaire portable unique `.exe`.
- **Frontend :** [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/).
- **Styles :** CSS Vanille moderne (CSS Variables pour thèmes Dark/Light, Layout Flexbox/Grid denses).
- **Moteur Base de Données Cache :** SQLite (via la crate Rust `rusqlite`).
- **Sélecteur de fichiers natif :** Crate Rust `rfd`.

---

## 🚀 Démarrage & Compilation

### Prérequis
- [Node.js](https://nodejs.org/) (v18 ou supérieur)
- [Rust & Cargo](https://www.rust-lang.org/) (outils de compilation C++ build tools installés sous Windows)

### Installation
1. Clonez ou copiez le projet dans votre répertoire de travail.
2. Installez les dépendances npm :
   ```bash
   npm install
   ```

### Lancer en mode Développement
Pour lancer la fenêtre de l'application avec rechargement à chaud (Vite + Cargo compile) :
```bash
npm run tauri dev
```

### Compiler pour la Production (Générer le `.exe` portable)
Pour générer le fichier binaire exécutable autonome (`.exe` standalone) :
```bash
npm run tauri build
```
Les binaires générés et renommés sont copiés dans le dossier `release_bin/` à l'aide du script d'automatisation :
```powershell
.\build.ps1
```

---

## 🗃️ Structure du Code source

```
Stockflow/
├── src-tauri/                  # Code source Rust (Backend)
│   ├── src/
│   │   ├── config.rs           # Gestion config locale APPDATA & Initialisation réseau
│   │   ├── db.rs               # Gestion et requêtes du cache local SQLite
│   │   ├── events.rs           # Écritures JSON d'événements et Sync vers SQLite
│   │   ├── csv_importer.rs     # Parser CSV et migration des médias
│   │   ├── lib.rs              # Déclaration des modules et Commandes IPC Tauri
│   │   └── main.rs             # Point d'entrée de l'application Rust
│   └── Cargo.toml              # Dépendances Rust
├── src/                        # Code source React (Frontend)
│   ├── assets/                 # Logos et médias
│   ├── App.css                 # Charte graphique (Dark/Light) et layout tableur
│   ├── App.tsx                 # Logique d'interface et d'appel des commandes Tauri
│   └── main.tsx                # Point d'entrée React
├── package.json                # Dépendances NPM & Scripts
├── PLAN_AMELIORE.md            # Plan de développement validé
└── JOURNAL.md                  # Historique chronologique des modifications
```
