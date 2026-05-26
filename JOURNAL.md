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

## [2026-05-26] Améliorations de robustesse, Analyse de données & Planification Médias

- **Correction Réseau & Push Git :** Résolution des erreurs de connexion Git en forçant le protocole HTTPS sur le port 443 pour pousser la branche `master` vers GitHub.
- **Rangement du Dépôt :** 
  - Confirmation du stockage des binaires compilés directement dans le dépôt sous `release_bin/` pour une distribution aisée sur lecteur réseau (évitant les blocages SmartScreen).
  - Résolution d'un problème d'encodage (octets nuls) dans le fichier `.gitignore` et configuration propre pour ignorer le dossier `exemple_data/*` tout en conservant la structure.
- **Analyse du CSV de Production & Données Réelles :**
  - Analyse du fichier `DB Stock du 26_05_26 08_09.csv` (784 lignes, encodage Windows-1252, délimiteur `;`, saut d'en-tête de 8 lignes).
  - Découverte majeure : les colonnes 24 (PDF) et 25 (Image) contiennent directement les chemins relatifs des médias associés (ex: `Images des références\...` et `Manuels PDF\...`), ce qui élimine le besoin d'heuristiques de matching complexes.
  - Identification de l'arborescence des manuels PDF (70 sous-dossiers classés par constructeur) et des images produits (~450 fichiers).
- **Décisions de Conception Validées :**
  - **Interface de Migration :** Remplacement de la recherche globale automatique par une saisie explicite de deux chemins distincts dans le wizard (un dossier source pour les images, un pour les PDF).
  - **Gestion des Images :** Prise en charge de plusieurs images par référence nommées `[SKU]_1.jpg`, `[SKU]_2.jpg`, etc., avec intégration d'une vue carrousel.
  - **Visualisation PDF :** Ouverture des manuels techniques dans le lecteur de PDF externe par défaut de Windows (Edge, Adobe Reader, etc.) via une commande native Rust.
- **Amélioration Technique de l'Event-Sourcing (`events.rs`) :**
  - Modification de la structure de nommage des fichiers d'événements JSON écrits sur le réseau pour y injecter directement le SKU du produit (ex: `20260525T143000Z_JDO_STOCK_OUT_6ES7507-0RA00-0AB0_c7b3.json`). Cela facilite l'audit direct par le service informatique ou l'utilisateur sans passer par la base SQLite locale.
- **Documentation & Planification :**
  - Rédaction et validation du plan d'implémentation de fin de Phase 1 (`implementation_plan.md`) traitant des modules de copie des fichiers médias et de leur affichage/survol dans l'UI.
  - Mise à jour détaillée de `PLAN_AMELIORE.md` avec des listes de tâches (`[x] [DONE]`, `[ ] [TODO]`) ultra-précises pour le suivi de la fin de Phase 1.
