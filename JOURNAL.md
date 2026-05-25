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
