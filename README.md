# 📈 StockFlow (v1.1.0)

**StockFlow** est un système intelligent de gestion d'inventaire industriel conçu pour fonctionner dans un environnement d'entreprise Windows hautement restreint. 

L'application est **100% portable** (aucun droit administrateur requis, aucune installation) et fonctionne en mode **Serverless** : il n'y a pas de serveur central ni de base de données active en réseau. L'ensemble des communications et de la réplication de données entre postes s'effectue via un simple **dossier réseau partagé (partage SMB / lecteur réseau comme `Z:\`)**.

---

## 🏗️ Architecture Technique (Event-Sourcing)

Pour éviter les corruptions de base de données (comme SQLite ou Access) induites par les accès concurrents sur des partages réseau Windows (SMB), StockFlow implémente une architecture **Event-Sourcing (Append-Only)** :

1. **Événements Immuables :** Chaque action utilisateur (création de produit, entrée de stock, sortie de stock) génère un petit fichier JSON horodaté déposé dans le dossier réseau `events/` (ex: `20260525T203000Z_JDO_STOCK_IN_f42a.json`). Ces fichiers ne sont **jamais modifiés**, éliminant tout conflit d'accès concurrent.
2. **Cache SQLite Local :** Chaque poste client possède une base SQLite locale (`stockflow.db` dans `%APPDATA%`).
3. **Synchronisation Réactive :** L'application surveille en tâche de fond le dossier réseau (polling régulier). Elle télécharge chronologiquement uniquement les nouveaux événements et reconstruit l'état du stock instantanément en local.
4. **Résilience Hors-ligne :** Si la connexion réseau est coupée, l'application reste utilisable en consultation. Les nouveaux mouvements sont placés dans une file d'attente locale (`pending_events`) et poussés automatiquement sur le réseau dès le retour de la connexion.

```
+---------------------------------------------------------------+
|                      Lecteur Réseau Partagé                   |
|  +------------------+  +-----------------+  +--------------+  |
|  |     /events/     |  |    /images/     |  | /documents/  |  |
|  | (Fichiers JSON)  |  | (Images produit)|  | (PDFs Fiches)|  |
|  +------------------+  +-----------------+  +--------------+  |
+---------------------------------------------------------------+
         ^                               ^
         | (Sync toutes les 4s)          | (Lecture directe)
         v                               v
+---------------------------------------------------------------+
|                         Poste Client                          |
|  +-------------------+               +---------------------+  |
|  |   Tauri Frontend  |<------------->|    Tauri Backend    |  |
|  |   (React / TS)    |  IPC Command  |       (Rust)        |  |
|  +-------------------+               +---------------------+  |
|                                                 |             |
|                                                 v             |
|                                      +---------------------+  |
|                                      | SQLite Cache Local  |  |
|                                      |   (stockflow.db)    |  |
|                                      +---------------------+  |
+---------------------------------------------------------------+
```

---

## 🛠️ Stack Technique

- **Backend & Wrapper Natif :** [Tauri v2](https://tauri.app/) (Rust) - Légèreté, sécurité et binaire portable unique `.exe`.
- **Frontend :** [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/).
- **Styles :** CSS Vanille moderne (CSS Variables pour thèmes Dark/Light, Layout Flexbox/Grid denses).
- **Moteur Base de Données Cache :** SQLite (via la crate Rust `rusqlite`).
- **Sélecteur de fichiers natif :** Crate Rust `rfd`.

---

## 📋 Fonctionnalités de la Phase 1 (MVP)

- [x] **Assistant de configuration initial :** Saisie du trigramme de poste et sélection graphique du dossier réseau partagé au premier lancement.
- [x] **Moteur d'Event-Sourcing résistant :** Écritures réseau asynchrones non-bloquantes (`spawn_blocking`) et mise en file d'attente hors-ligne.
- [x] **Tableur Spreadsheet ultra-dense :** Table dense de l'inventaire avec tri, recherche instantanée par marque/désignation/SKU, filtrage par famille, et double-clic pour modification directe des cellules (inline).
- [x] **Volet de détails latéral :** Historique complet des mouvements pour la référence sélectionnée, aperçu de l'image stockée sur le réseau, lien vers la fiche technique PDF, et formulaire de saisie des entrées/sorties.
- [x] **Miniature au survol (Hover UX) :** Affichage d'un aperçu d'image en miniature au survol de la souris sur l'inventaire.
- [x] **Outil de migration CSV :** Importation de l'ancien fichier de stock (décodage Windows-1252, saut de 8 lignes d'en-tête Excel, copie physique des images/PDFs locaux associés vers le réseau et génération des événements de création initiale).
- [x] **Thèmes Sombre et Clair :** Changement de thème d'un seul clic.

---

## 📋 Fonctionnalités de la Phase 2 (Scraping & Médias)

- [x] **Colonnes de dimensions industrielles :** Ajout des colonnes physiques (Largeur, Hauteur, Profondeur, Poids, Tension) dans la grille principale et le volet détails.
- [x] **Pré-remplissage Intelligent :** Scraping en tâche de fond de la marque, désignation, prix et taille de lot à partir du SKU ou du code VPC lors de la création.
- [x] **Scraping PDF et cascade de répertoires :** Récupération automatique des fiches techniques par SearxNG et structuration en sous-dossiers réseau partagés (`documents/MARQUE/CATEGORIE/...`).
- [x] **Déduplication robuste des PDF :** Comparaison avancée des fichiers PDF existants (par métadonnées, taille et type) pour éviter le gaspillage de bande passante.
- [x] **Scraping et standardisation d'images :** Téléchargement d'illustrations produits, création de miniatures rapides locales, et déduplication automatique par comparaison d'octets.
- [x] **Scraping par lot :** Files d'attente randomisées pour le traitement par lot d'images et de PDF sur plusieurs références sélectionnées.
- [x] **Suppression en cascade :** Le retrait d'un produit supprime physiquement ses fiches techniques PDF et ses images stockées sur le réseau partagé.

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
Pour générer le fichier binaire exécutable autonome (`.exe` standalone dans `src-tauri/target/release/bundle/nsis/` ou dans `target/release/`) :
```bash
npm run tauri build
```
Le fichier généré est entièrement autonome et peut être copié sur n'importe quel poste Windows.

### ⚠️ Windows SmartScreen (Environnement sans droits admin)
L'exécutable n'étant pas signé numériquement, Windows SmartScreen peut bloquer le lancement si le fichier a été **téléchargé depuis internet** (GitHub). Ce blocage est lié au marqueur "Mark of the Web" (MOTW) que Windows ajoute automatiquement aux téléchargements web. Le bouton "Exécuter quand même" nécessite des droits administrateur.

**Solution recommandée — Distribution via le lecteur réseau :**
Copiez le `StockFlow.exe` compilé **directement** depuis le poste de développement vers le lecteur réseau partagé (ex: `Z:\Stockflow\app\StockFlow.exe`). Les fichiers copiés en local ou depuis un partage SMB **ne reçoivent pas** le marqueur MOTW et SmartScreen ne se déclenchera pas.

**Alternative — Retirer le marqueur manuellement (ne nécessite pas de droits admin) :**
```powershell
Unblock-File -Path ".\StockFlow.exe"
```
Ou via l'explorateur Windows : clic droit sur le fichier → Propriétés → cocher **"Débloquer"** en bas → OK.

> **En résumé :** Ne distribuez jamais l'application en la faisant re-télécharger depuis GitHub sur les postes utilisateurs. Déposez-la sur le partage réseau depuis un poste de confiance.

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
