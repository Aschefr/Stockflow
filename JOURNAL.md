# Journal des Modifications - StockFlow

Ce document répertorie l'historique des modifications apportées au codebase de StockFlow étape par étape.

---

## [2026-05-25] Initialisation du projet et de la phase de planification

- **Planification :** Création et validation du plan d'architecture global (`PLAN_AMELIORE.md`) basé sur Tauri (Rust + React) et un système d'Event-Sourcing sur lecteur réseau.
- **Plan d'Implémentation :** Rédaction de `implementation_plan.md` détaillant les technologies, les schémas JSON d'événements et le mécanisme de synchronisation local SQLite.
- **Suivi :** Création du fichier `task.md` pour le suivi des tâches et du présent `JOURNAL.md` pour la traçabilité des modifications.
- **Initialisation Technique :**
  - Échafaudage du projet Tauri v2 + React + TypeScript via `create-tauri-app` avec gestionnaire `npm`.
  - Restauration des fichiers de planification (`PLAN_AMELIORE.md`) suite à l'écrasement par la commande d'initialisation.
  - Installation des dépendances NPM (`npm install`).
  - Lancement de la première compilation/vérification Cargo (`cargo check`).
- **Développement de la Fondation MVP (Phase 1 complète) :**
  - **Styles & Thèmes (App.css) :** Création du design industriel sombre/clair avec feuille de styles CSS moderne (variables, disposition grille/tableur, transitions micro-animations).
  - **Interface Réactive (App.tsx) :** Intégration de l'assistant de configuration, du Dashboard interactif, de la liste type tableur compacte (avec double-clic d'édition inline), du volet de détails complet (mouvements stock, fiches PDF/images) et du polling de sync automatique (toutes les 4s).
  - **Moteur d'événements & Cache (db.rs, events.rs) :** Base SQLite locale pour le cache de stock, génération chronologique d'événements JSON sur le lecteur réseau avec gestion du mode hors-ligne.
  - **Importateur CSV (csv_importer.rs) :** Lecteur de CSV avec transcodage Windows-1252, saut d'en-tête de 8 lignes et recopie intelligente des images/PDFs.
  - **Validation de Build :** Vérification réussie de la compilation frontend et backend (zéro erreur).
- **Correctif [2026-05-25] :**
  - Correction d'un bug dans l'importateur CSV : remplacement du sélecteur de dossier par un sélecteur de fichier spécifique aux extensions `.csv` (`select_csv_file` en Rust / invoke dans `App.tsx`).
  - Résolution du gel de l'interface utilisateur pendant les longues opérations d'import réseau : conversion des commandes Rust `import_csv` et `sync_events` en commandes asynchrones (`async fn` s'exécutant sur un thread pool `tauri::async_runtime::spawn_blocking`).
  - Ajout d'états d'inactivité/chargement visuels dans le formulaire de migration React pour désactiver les boutons et inputs durant l'import.
- **Publication & Release [2026-05-25] :**
  - Compilation réussie du livrable de production (`npm run tauri build`).
  - Préparation et renommage des livrables (`StockFlow.exe` portable, installeurs MSI et NSIS).
  - Création de la première release GitHub sous le tag `v1.0.0-mvp` avec téléversement automatique des assets binaires (via la CLI `gh` configurée par l'utilisateur).

---

## [2026-05-26] Nommage événements & Planification médias

- **Amélioration Event-Sourcing (`events.rs`) :** Le format de nommage des fichiers JSON générés sur le réseau inclut désormais le SKU du produit pour une lecture humaine directe. Ancien format : `20260525T143000Z_JDO_STOCK_OUT_c7b3.json`. Nouveau format : `20260525T143000Z_JDO_STOCK_OUT_6ES7507-0RA00-0AB0_c7b3.json`.
- **Mise à jour du plan (`PLAN_AMELIORE.md`) :** Ajout de tags `[DONE]`, `[IN PROGRESS]`, `[TODO]` sur toutes les étapes de la Phase 1 pour refléter l'avancement réel.
- **Planification Phase 1 restante :** Analyse complète du CSV de production (784 lignes, 25 colonnes dont chemins relatifs vers images et PDF), du dossier `Images des références` (~450+ images) et du dossier `Manuels PDF` (70 sous-dossiers par marque). Rédaction du plan d'implémentation pour P1.2 (migration médias) et P1.5 (affichage images/documents).
- **Décisions validées :** Plusieurs images par produit (`[SKU]_1.jpg`, `[SKU]_2.jpg`...), ouverture PDF dans le lecteur par défaut de Windows, deux saisies de dossiers séparées (images et PDF) dans le wizard de migration.
