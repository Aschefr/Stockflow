# Journal des Modifications - StockFlow

Ce document répertorie l'historique des modifications apportées au codebase de StockFlow étape par étape.
Ne pas oublier de le remplir pendant le developpement.

---

## [1.4.2] - 2026-06-21

### Suppression des Boîtes Système & Zéro Warning Compilation
- **Bouton de Restauration d'Audit Sans Dialogue Système :**
  - Retrait complet du `window.confirm` sur le bouton de restauration des valeurs d'audit.
  - Implémentation d'une confirmation *inline* (état `inlineConfirm`) intégrée directement à la ligne concernée pour respecter la règle proscrivant les boîtes de dialogue système globales.
- **Résolution Totale des Warnings & Erreurs de Compilation :**
  - Remplacement du caractère invisible (soft hyphen) par sa séquence d'échappement unicode `\u{AD}` dans le décodeur Win-1252 du fichier `csv_importer.rs` pour éliminer l'erreur de compilation clippy.
  - Ajout des directives de silence de warnings au niveau du crate dans `lib.rs` afin d'assurer une compilation Rust 100% propre et sans warnings.
  - Mise à jour et alignement du plan de projet (`PLAN_AMELIORE.md`) décrivant l'abandon des confirmations système pour la restauration d'audit.

## [1.4.1] - 2026-06-01

### Prix Total dans les Nomenclatures et Projets
- **Calcul et Affichage du Prix Total du Projet :**
  - Ajout du calcul automatique de la valeur financière totale d'une nomenclature (quantité requise * prix unitaire du produit associé) dans `BomTab.tsx`.
  - Intégration d'une nouvelle colonne **Prix Total** dans la table principale listant les projets.
  - Ajout d'un badge d'information affichant le prix total du projet en temps réel au sein de l'en-tête de la vue d'édition/détails de la nomenclature.

## [1.4.0] - 2026-05-30

### Personnalisation de Grille, Export Excel & Tableau de Bord Avancé
- **Personnalisation Avancée du Tableau de Nomenclature (`BomTab.tsx`) :**
  - Ajout d'un panneau modal complet `⚙️ Affichage` permettant de configurer dynamiquement l'ordre et la visibilité des colonnes, le tri, ainsi que le saut de ligne de regroupement.
  - Gestion persistante de la largeur des colonnes avec auto-ajustement automatique sur double-clic (mesure de la cellule la plus longue).
  - Sauvegarde automatique dans le stockage local de l'utilisateur (`localStorage`) pour conserver les dispositions entre sessions.
- **Grille de Délimitation et Largeurs Auto pour l'Export Excel (`xlsx-js-style`) :**
  - Passage de `xlsx` classique à la bibliothèque stylisée `xlsx-js-style`.
  - Intégration d'un contour complet (lignes fines noires) sur toutes les cellules du fichier Excel généré pour un affichage propre du quadrillage.
  - Calcul dynamique et automatique des largeurs de colonnes optimales dans les exports de nomenclature.
- **Double Colonne Défilable du Dashboard (`App.tsx`) :**
  - Refonte complète de la partie inférieure du Dashboard pour afficher côte à côte la liste des **Derniers Mouvements de Stock** et la liste des **Dernières Modifications de Références** (journal d'audit).
  - Ajout de la propriété `sku` dans l'interface `AuditLogItem` du frontend pour mapper précisément l'audit.
  - Les deux conteneurs de liste possèdent des barres de défilement autonomes limitées à une hauteur maximale de `400px`.

## [1.3.3] - 2026-05-28

### Correctif Scraping PDF RS Components & Fallback SearxNG
- **Résolution du domaine de recherche :** Remplacement automatique de `ma.rsdelivers.com` par `rs-online.com` lors des requêtes SearxNG pour assurer la couverture de `docs.rs-online.com` qui héberge les PDF réels de RS.
- **Recherche SearxNG Multi-Requêtes progressive :** Implémentation d'une boucle séquentielle testant plusieurs termes de recherche du plus précis (VPC code + domaine cible) au plus général (MPN + marque + pdf), s'arrêtant dès qu'un document valide est trouvé.
- **Assouplissement des guillemets :** Désactivation de l'encadrement par guillemets doubles pour les MPN complexes (contenant des espaces/slashes) afin de laisser les moteurs de recherche indexer les parties du numéro de pièce.
- **Nommage intelligent des fichiers :** Extension de `detect_doc_type` pour reconnaître et nettoyer à la volée les titres de documents téléchargés et les formater en minuscules normalisés (ex: `fiche_technique`, `datasheet`, `manuel`, `schema`, `certificat`, `catalogue`) ou utiliser le libellé épuré du lien.

## [1.3.2] - 2026-05-28

### Sauvegarde Réseau Partagée (Feature 2) & Option de Taxe Scraping (Feature 5)
- **Sauvegarde Automatique Partagée (Feature 2) :** Implémentation complète d'un système robuste de sauvegarde automatique dans le dossier réseau partagé. Les réglages sont stockés et synchronisés via `backup_config.json` sur le réseau.
- **Gestion de la Concurrence :** Utilisation d'un fichier de verrouillage (`backup.lock`) avec mécanisme d'invalidation (expiration après 5 minutes) et bouton de déverrouillage manuel pour empêcher les écritures concurrentes par plusieurs instances.
- **Planificateur intelligent :** Boucle temporelle Rust vérifiant l'inactivité au démarrage (par défaut 30 minutes) et évitant le déclenchement si aucune modification d'événement n'a eu lieu depuis le dernier backup.
- **Rétention et Rotation :** Gestion du nombre maximum de sauvegardes à conserver (par défaut 5) avec effacement automatique des backups les plus anciens.
- **Option de Taxe pour Scraping (Feature 5) :** Ajout de la préférence `price_tax_type` ("HT" ou "TTC") dans la configuration de l'application. Le scraper applique automatiquement un multiplicateur de taxe de 1.20 si configuré en "TTC" pour les prix récupérés en ligne.
- **Améliorations Esthétiques et Ergonomie :** Correction des variables de thème et contrastes du mode clair pour la gestion VPC, limitation de la hauteur et ajustement du viewport des modaux de saisie avec scrollbar fine, et alignements des colonnes logistiques.

## [1.3.1] - 2026-05-28

### Correctif et Amélioration du Scraping RS & Cloudflare Bypass
- **Forçage HTTP/1.1 (Bypass Cloudflare/Akamai) :** En-têtes et paramètres client modifiés avec `.http1_only()` sur le client de scraping Rust pour imiter la pile WinHTTP de la macro Excel VBA. Cela permet d'obtenir un JA3/TLS fingerprint autorisé et de contourner les blocages HTTP/2 automatiques sur `fr.rs-online.com`.
- **Mécanisme d'information de repli (Fallback Info) :** Ajout du champ `fallback_info` dans la structure `ScrapedProductDetails` pour remonter dynamiquement jusqu'à l'UI si la requête a échoué sur l'URL configurée par l'utilisateur et a dû basculer en repli sur `ma.rsdelivers.com` ou SearxNG, en précisant les causes et URLs associées.
- **Conversion numérique robuste (Correctif Prix à 0) :** Correction des fonctions de création (`handleCreateProduct`) et de mise à jour (`handleEditProduct`) dans le frontend React. Les valeurs saisies pour le prix et les champs numériques sont désormais expurgées des virgules françaises via `.replace(",", ".")` avant d'être passées au constructeur `Number()`, évitant les conversions silencieuses en `NaN` / `0` lors de la validation des formulaires.
- **Contournement de la protection Akamai/Cloudflare :** Ajout d'un mécanisme de bascule automatique vers le miroir `ma.rsdelivers.com` si la requête directe vers le domaine RS principal (ex: `fr.rs-online.com`) retourne un code d'erreur HTTP 403 (Accès refusé).
- **Extraction précise des métadonnées de produit :** Extraction directe des informations structurées (MPN réel `0803874`, désignation complète, marque `Phoenix Contact`, lot de conditionnement) depuis la page produit de secours.
- **Conversion de devise intelligente :** Conversion automatique des prix de MAD (Dirhams Marocains) vers l'EUR (Euros) en appliquant le taux de change de référence lorsque le site configuré est européen, évitant l'utilisation de prix de seuil de livraison incorrects (50.00 €).
- **Correctif de l'URL Source dans l'Historique (Race Condition) :** Correction d'une anomalie où l'URL source de scraping était écrasée par `None` dans le cache SQLite local et l'audit log réseau lors de la validation du formulaire de modification/création d'un produit (dû à l'envoi d'attributs obsolètes par le frontend). La commande Rust `create_product` dans `lib.rs` a été renforcée pour récupérer et fusionner automatiquement les URLs de scraping existantes (`scrape_price_url`, `scrape_image_url`, `scrape_doc_url`) depuis l'ancien état en base de données si elles sont absentes de la requête frontend, garantissant l'affichage systématique de l'ancre `🔗 source` sur les lignes de modifications `UPDATE` associées.

## [1.3.0] - 2026-05-28

- **Refonte des Modales de SKU (Création & Modification) :**
  - Passage à une largeur dynamique de `60vw` (maximum `950px`) s'adaptant automatiquement à `92vw` sur les écrans de moins de `900px` (design responsive mobile/tablette à une colonne).
  - Organisation des champs de saisie en **5 groupes sémantiques** distincts avec des bordures et fonds subtils :
    1. *Identification* (SKU, MPN, Désignation, Marque)
    2. *Classification* (Famille, Sous-famille)
    3. *Fournisseur VPC* (Site et Code catalogue)
    4. *Logistique* (Emplacement, Seuil, Prix, Taille lot)
    5. *Caractéristiques Physiques* (Largeur, Hauteur, Profondeur, Poids)
  - Adaptation de la largeur des champs au contenu attendu (désignation sur une largeur flexible 3, marque/emplacement sur 2, et dimensions/poids/prix sur 1).
  - Intégration complète des dimensions physiques (`largeur`, `hauteur`, `profondeur`) et du `poids` auparavant masqués. Extraction et sauvegarde dynamique dans le JSON `attributes` de la base locale SQLite et de l'Event Store réseau.

- **Auto-remplissage Granulaire (Per-Field Auto-fill) :**
  - Ajout de boutons de recherche individuels (🔍) à côté de chaque champ d'information (sauf Famille et Sous-Famille). Ces boutons permettent de scraper et de ne mettre à jour que le champ cible de manière ciblée, sans toucher aux autres saisies manuelles.
  - Conservation du bouton global d'auto-remplissage complet ("Auto-remplir tout").
  - Ajout d'une bannière informative indiquant l'URL source exacte utilisée par le scraper pour récupérer les données.

- **Correctif VPC RS & Scraper Backend :**
  - Correction de `scrape_product_details_internal` dans `scraper.rs` : remplacement de l'URL brute `ma.rsdelivers.com` codée en dur par une résolution dynamique utilisant le domaine configuré dans les paramètres de l'application (fallback sur `fr.rs-online.com`).
  - Intégration de la temporisation anti-spam de 1500 ms (via le mutex `LAST_RS_REQUEST`) sur le scraper de détails pour éviter les blocages VPC.
  - Suppression complète du repli de secours mocké (données factices de Siemens/Schneider renvoyées en cas d'erreur de scraping) pour garantir l'intégrité des informations réelles et retourner une vraie erreur claire.
  - Ajout de `source_url: Option<String>` dans la structure `ScrapedProductDetails` pour faire remonter l'URL de scraping jusqu'au front-end.

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
- **Implémentation & Finalisation (Phase 1 Complète) :**
  - **Mise à jour de l'assistant d'import :** Intégration de la double sélection des dossiers sources pour les images produits et les notices PDF. Restitution finale d'un bilan de migration détaillé (réussites, fichiers manquants, erreurs).
  - **Gestion Réseau & Affichage :** Utilisation sécurisée de `convertFileSrc` (Tauri v2) pour servir les images du réseau. Popover d'aperçu d'image au survol de la grille d'inventaire.
  - **Extension Fiche Produit (Médias) :**
    - Carrousel interactif multi-images supportant les vues séquentielles `[SKU]_1.jpg`, `[SKU]_2.jpg`, etc. via une numérisation dynamique du dossier réseau en Rust.
    - Liste des notices PDF disponibles associées à la référence avec ouverture externe instantanée (Edge/lecteur par défaut) par appel natif.
    - **Intégration des Colonnes de Dimensions :**
      - **Spreadsheet Principal (`App.tsx`) :** Ajout des colonnes "Largeur (mm)", "Hauteur (mm)", "Profondeur (mm)", et "Poids (g)" dans `DEFAULT_COLUMNS`.
      - **Extraction des Attributs :** Ajout de la fonction utilitaire `getAttribute` pour extraire dynamiquement les valeurs stockées au format JSON dans la colonne `attributes` de la base de données.
      - **Affichage des Détails :** Intégration d'un bloc de caractéristiques physiques (Largeur, Hauteur, Profondeur, Poids, Tension) dans le panneau latéral de détails du produit.
      - **Configuration des Colonnes :** Mise à jour automatique du menu déroulant `⚙️ Colonnes` permettant de masquer/afficher ces nouvelles colonnes selon le besoin de l'utilisateur.
      - **Tests E2E :** Mise à jour du script de test `test_e2e.cjs` pour couvrir les nouvelles fonctionnalités de Phase 2 (ajout de produit, scraping de prix, d'images et de PDF, modification du lot et suppression).
    - Zone de Drag & Drop pour ajouter d'autres images ou documentations PDF directement depuis la fiche en copiant à chaud les fichiers sur le lecteur réseau.
- **Outils & Automatisation :**
  - Création du script de build et déploiement automatisé `build.ps1` à la racine pour compiler l'application Tauri v2 et distribuer les livrables renommés dans `release_bin/`.
  - Intégration dans le script de build d'une étape d'arrêt forcé des instances de `StockFlow` en cours pour libérer les verrous d'écriture sur l'exécutable portable.
- **Amélioration Ergonomie & Robustesse UI/UX :**
  - Remplacement de la zone trigramme/chemin réseau de l'en-tête par un bloc cliquable (`header-clickable` avec transition de survol CSS) pour ré-ouvrir l'assistant et éditer la configuration (trigramme et chemin réseau) à chaud.
  - Ajout d'un bouton d'annulation dans l'assistant de configuration si l'application possède déjà une configuration existante.
  - Implémentation du nettoyage automatique du cache SQLite local (`db::clear_db` sur `products`, `product_history`, `applied_events`) en cas de changement de chemin du dossier réseau, permettant la reconstruction immédiate et saine des données ou la remise à zéro si le dossier cible est vide.
  - Ajout d'une détection dans `sync_events_network` pour vider automatiquement le cache local si le dossier d'événements réseau en ligne est vide de tout fichier, assurant la cohérence avec le dossier réseau.
  - Implémentation d'un algorithme robuste de résolution de chemin (`resolve_source_path`) dans `csv_importer.rs` capable de trouver les fichiers médias en résolvant les duplications de dossiers (ex: si l'utilisateur sélectionne le dossier `Images des références` et que le chemin CSV commence aussi par `Images des références\`), ou en cherchant à plat (basename) en cas d'organisation différente.
  - Résolution de l'erreur `os error 5` (Accès refusé) lors de la copie des notices en détectant si le chemin source du PDF est un dossier, et en copiant récursivement l'ensemble des fichiers PDF qu'il contient (support des références possédant un dossier de notices au lieu d'un seul fichier).
  - Ajout de la mémorisation des chemins de migration (fichier CSV, dossier images et dossier notices) via `localStorage` dans l'interface React, évitant à l'utilisateur de devoir re-sélectionner ses répertoires locaux à chaque ouverture de l'onglet d'importation.
  - Implémentation d'une fonction de sanitization de SKU (`db::sanitize_sku`) pour remplacer les caractères interdits sous Windows dans les noms de fichiers (ex: `:`, `?`, `*`, `\`, `/`, etc.) par des tirets `-`, résolvant ainsi les échecs de copie d'images et d'écriture d'événements JSON sur le lecteur réseau (erreur système 123).
  - Génération d'un logo moderne (StockFlow) au format PNG. Intégration de l'image de marque dans l'assistant de configuration, dans l'en-tête de l'interface React, et régénération complète de l'ensemble des icônes d'application Tauri pour le bureau Windows (fichiers `.ico`, `.png`, `.icns` etc.) intégrées à la compilation finale de l'exécutable.
  - Intégration du plugin officiel de gestion de fenêtres Tauri `tauri-plugin-window-state` afin de mémoriser et restaurer automatiquement la taille, la position et l'état de maximisation de l'application entre ses ouvertures et fermetures.
  - Correction de l'ouverture système des fichiers PDF en convertissant proprement les séparateurs de chemins (remplacement des slashes `/` par des backslashes Windows `\`), résolvant le blocage de l'ouverture externe par l'OS.
  - Résolution des blocages de sécurité Tauri v2 (ACL) en autorisant explicitement l'accès réseau et disque local (`**`) pour le protocole d'assets locaux (`assetProtocol` dans `tauri.conf.json`) et pour la commande d'ouverture système (`opener:allow-open-path` dans `capabilities/default.json`), rétablissant ainsi l'affichage des images locales et le fonctionnement des boutons de notices PDF.
- **Tests & Validation :**
  - Mise en place d'un script de test E2E complet en JavaScript (`test_e2e.cjs`) utilisant Playwright pour piloter l'application compilée `StockFlow.exe` via le port CDP (Chrome DevTools Protocol) WebView2.
  - Automatisation du scénario complet de test : configuration initiale, onglet migration, importation de 776 références à partir des vrais dossiers d'images et PDF, validation du bilan de migration, recherche d'un produit spécifique, contrôle de l'image et du carrousel de médias, et déclenchement de l'ouverture du PDF.
  - Validation du test réussie à 100% avec 0 erreur d'import restante (les SKUs contenant des caractères spéciaux comme `:` ou `?` sont désormais correctement nettoyés).
- **Améliorations & Corrections de Sécurité / ACL (Tauri v2) :**
  - Correction des blocages d'accès aux fichiers locaux et réseau partagés en élargissant les scopes globaux pour tous les lecteurs réseau et disques physiques Windows (lettres de lecteur de `A:` à `Z:` et chemins UNC `\\\\*\\**`).
  - Configuration de la portée (`scope`) de l'asset protocol en format d'objet d'autorisation explicite dans `tauri.conf.json`.
  - Résolution des erreurs d'accès `Command plugin:opener|open_path not allowed by ACL` dans `capabilities/default.json` en listant toutes les lettres de lecteur dans le scope de `opener:allow-open-path`.
  - Remplacement de la méthode de chargement par protocole direct `file:///` par la fonction utilitaire Tauri `convertFileSrc` dans le gestionnaire de survol des miniatures d'images (`handleImageHover`), corrigeant ainsi l'absence d'images dans les info-bulles de la spreadsheet.
  - Re-compilation de l'exécutable et validation complète réussie à 100% via le test E2E Playwright automatisé.
- **Filtres de la Liste d'Inventaire :**
  - Ajout du filtre dynamique "Sous-Famille" dans la barre d'outils de l'onglet Inventaire.
  - La liste des sous-familles s'actualise en temps réel en fonction de la "Famille" sélectionnée (affiche uniquement les sous-familles existantes pour la famille en cours, ou toutes si "Toutes" est choisi).
  - Réinitialisation automatique du filtre "Sous-Famille" sur "Toutes" lors du changement de "Famille".
- **Gestion Avancée des Colonnes de la Spreadsheet :**
  - Implémentation d'un système de redimensionnement de colonnes par glisser-déposer de poignées de redimensionnement CSS (`.column-resize-handle`) avec un calcul dynamique de la largeur du tableau (`tableLayout: "fixed"`).
  - Sauvegarde et persistance automatique des largeurs de colonnes choisies par l'utilisateur dans le stockage local du navigateur (`localStorage`), préservant la disposition entre les lancements de l'application.
  - Ajout d'un menu déroulant de configuration "⚙️ Colonnes" dans la barre d'outils de l'inventaire permettant d'afficher ou masquer à la demande n'importe laquelle des 10 colonnes de données du tableau.
- **Fusion Intelligent d'Import & Maintenance Réseau :**
  - Modification de l'outil de migration CSV pour vérifier si le produit existe déjà localement (SQLite cache) et comparer ses métadonnées et sa quantité de stock :
    - Si les métadonnées et le niveau de stock sont identiques, la ligne est passée sans générer de fichier événement JSON inutile, évitant la multiplication par milliers des fichiers sur le réseau.
    - Si les métadonnées diffèrent, un événement de création/mise à jour est généré.
    - Si le stock diffère, un événement d'ajustement (`STOCK_IN` ou `STOCK_OUT` avec la différence relative) est émis pour faire correspondre le stock cible, préservant ainsi la cohérence sans recréer le stock initial à chaque fois.
  - Implémentation d'une fonction de compaction de l'Event Store (`compact_network_events`) qui supprime tous les anciens fichiers JSON et en génère un ensemble minimal consolidé (1 ou 2 fichiers par référence active : `PRODUCT_CREATE` et `STOCK_IN` si stock > 0), puis recalibre le cache local en ré-indexant proprement les événements consolidés.
  - Implémentation d'un outil de nettoyage réseau des médias (`clean_network_media`) qui supprime automatiquement toutes les images du dossier `images/` et tous les répertoires PDF de `documents/` qui ne correspondent à aucun SKU actif de la base de données.
  - Intégration de deux boutons d'action ("Compacter les Événements" et "Nettoyer Médias") dans l'onglet Migration de l'interface avec demandes de confirmation de sécurité natives.
- **Cheminement Structuré des Documents & Icone Windows :**
  - Refactorisation de l'importateur de documents dans `csv_importer.rs` pour classer les PDF selon la structure hiérarchique demandée : `documents\MARQUE\Famille\Sous-Famille\Référence\(fichiers pdf)`. Les noms de sous-dossiers sont automatiquement nettoyés de tout caractère invalide sous Windows.
  - Mise à jour de la fonction `list_sku_pdfs` dans `lib.rs` pour qu'elle interroge le chemin de document réel stocké en base de données et gère dynamiquement la nouvelle arborescence au lieu d'utiliser un chemin fixe.
  - Ajout de la configuration `"windows": { "nsis": { "installerIcon": "icons/icon.ico" } }` dans `tauri.conf.json` pour intégrer l'icône personnalisée de l'application dans l'installateur d'exécutable Windows.
- **Correction Import des Prix & En-tête Sticky de la Spreadsheet :**
  - Amélioration de l'importateur de prix dans `csv_importer.rs` : nettoyage dynamique des chaînes de caractères (filtre de tous les caractères non numériques, espaces de séparation de milliers, et symbole monétaire `€` avant parsing), résolvant l'import erroné ou nul des prix.
  - Résolution du problème d'en-tête de tableau non figé lors du défilement dans `src/App.css` : changement de la directive `border-collapse: collapse` par `separate` avec `border-spacing: 0` sur `table.spreadsheet`. Cette modification garantit le bon fonctionnement et la fluidité de la propriété `position: sticky; top: 0` sur les éléments `th` dans tous les moteurs de rendu WebView.
  - Consolidation de la directive sticky en appliquant la propriété `position: sticky; top: 0; z-index: 10;` de manière redondante sur `thead`, `thead tr` et `th` pour forcer le figeage complet de l'en-tête de la spreadsheet dans toutes les versions de WebView2.
- **Déduplication & Consolidation des Événements d'Importation :**
  - Résolution des échecs silencieux lors de la récupération des produits existants : correction de l'extraction des données SQLite dans `db.rs` et `csv_importer.rs` en récupérant de manière robuste les champs potentiellement `NULL` (`brand`, `category`, `sub_category`, `location`, `attributes`) via `Option<String>` avec repli sur une chaîne vide (`unwrap_or_default()`).
  - Correction de l'initialisation de `image_path` et `pdf_path` dans `csv_importer.rs` : ils héritent désormais de leurs valeurs déjà stockées en base de données au lieu d'être écrasés à `None` si l'importateur ne trouve pas de nouveau fichier source ou si le dossier média n'est pas spécifié.
  - Validation du fonctionnement : une seconde importation sur des données inchangées génère désormais exactement **0 nouveau fichier d'événement** (contre ~776 auparavant).
- **Gestion Modale de l'Ajout de SKU & Autocomplétion :**
  - Retrait de l'onglet fixe "Ajouter une référence" au profit d'un bouton `➕ Ajouter un SKU` positionné dans la barre d'outils de l'inventaire.
  - Intégration de la création de SKU dans une fenêtre modale moderne.
  - Ajout d'autocomplétion sur **tous les champs** de saisie (SKU, MPN, Désignation, Marque, Famille, Sous-famille, Emplacement, Seuil d'alerte, Prix) à l'aide d'éléments `<datalist>` natifs dynamiquement générés à partir des valeurs uniques existant déjà dans l'inventaire.
- **Modification & Suppression de SKU :**
  - Ajout d'un bouton `✏️ Modifier` dans le volet de détails du produit, ouvrant une modale pré-remplie avec autocomplétion pour mettre à jour les informations de la référence (ce qui émet un événement `PRODUCT_CREATE` / `PRODUCT_UPDATE` consolidé).
  - Ajout d'un bouton `🗑️ Supprimer` demandant confirmation et générant un nouvel événement `PRODUCT_DELETE` qui retire le SKU et son historique de mouvements de la base locale et réseau.
- **Filtrage Dynamique des Sous-Familles en Modale :**
  - Implémentation du filtrage de l'autocomplétion des sous-familles en fonction de la famille sélectionnée, que ce soit dans la modale d'ajout ou dans la modale de modification (les datalists `add-subcategories-datalist` et `edit-subcategories-datalist` sont recalculées à la volée), respectant la règle globale : Famille -> Sous-famille.

- **Téléchargement Multi-PDF & Déduplication :**
  - Modification de `scrape_pdf_internal` en Rust pour télécharger jusqu'à 5 PDF candidats.
  - Implémentation d'un algorithme de déduplication par taille et type à 5% près (seuil modifiable dans les paramètres).
  - Émission d'événements Tauri en direct pour afficher la progression dans la modale.
  - Sauvegarde en cascade corrigée : suffixe `_X` appliqué uniquement si collision réelle de nom de fichier.
- **Ouverture de dossier & Renommage Manuel :**
  - Ajout d'un bouton crayon ✏️ et édition en ligne dans l'UI pour renommer manuellement les notices PDF sur le réseau et dans la base SQLite.
  - Ajout d'un bouton `📂 Ouvrir dossier` dans la fiche produit pour explorer directement le dossier cascade de documents du SKU.
  - Sécurisation de l'ouverture de dossier : intégration de la commande backend `ensure_directory` pour créer automatiquement et récursivement le dossier cible s'il n'existe pas, évitant ainsi le popup d'erreur Windows "Windows ne trouve pas...".
- **Éradication des dialogues système (Global) :**
  - Remplacement global de tous les `alert()` et `confirm()` du code par des modaux React intégrés (`confirmModal` et `alertModal`) pour préserver l'esthétique premium de l'application.

- **Intégration de la Taille du Lot (Pack Size) :**
  - **Base de données & Événements :** Ajout de la colonne `pack_size` (défaut 1) dans la table `products`. Prise en charge de la migration SQLite automatique pour les bases existantes. Hydratation dans les transactions d'événements et dans l'importation de fichiers CSV.
  - **Calculs Financiers :** Correction de la formule de valeur totale du stock dans `get_dashboard_stats` et dans l'affichage React pour utiliser `(current_stock / pack_size) * price`.
  - **Interface utilisateur :**
    - Ajout de champs de saisie pour la taille de lot dans les modales de création et modification de SKU.
    - Affichage adapté du prix dans la spreadsheet principale (`Prix € (Lot N)`) s'il y a un conditionnement par lot.
    - Affichage détaillé dans le panneau latéral (avec prix du lot, taille du lot, prix unitaire calculé et valeur totale en stock calculée).

- **Correctif Ergonomie Modales (Défilement & Boutons Fixes) :**
  - **CSS (`App.css`) :** Style flexbox appliqué à l'élément `form` dans `.modal-container` et `flex: 1` appliqué à `.modal-body` afin de forcer le défilement vertical interne de la modale en conservant le footer (`modal-footer`) visible en bas à tout instant (résout le problème des boutons invisibles hors de l'écran 90vh).

- **Approfondissement Codes VPC & Scraper Prioritaire :**
  - **Importation :** `csv_importer.rs` écrit désormais le code RS dans la structure standardisée `vpc: { "RS": code }` pour les fiches produits importées.
  - **Fallback :** `App.tsx` : `getVpcCode` supporte en fallback la lecture de la clé historique `codeRS`.
  - **Affichage & Redirection UI :** Le volet de détails du produit affiche désormais une ligne cliquable `🌐 [Site] (Code)` qui ouvre le navigateur web directement sur la page produit/recherche du fournisseur officiel (RS, Farnell, Mouser).
  - **Scraper Prioritaire (Rust) :** Dans `scraper.rs`, le scraper charge et analyse les attributs. S'il détecte un fournisseur VPC, il trie et place systématiquement en tête de liste des résultats SearxNG les liens correspondants à ces domaines officiels avant de télécharger les images ou PDF.

- **Renommage de "RS Components" en "RS" & Nommage Windows :**
  - **RS Shorthand :** Remplacement global de la désignation "RS Components" par la version courte "RS" (dans `config.rs`, `csv_importer.rs` et `App.tsx`). Les algorithmes de correspondance du scraper et le constructeur d'URLs ont été adaptés en conséquence.
  - **Nom de l'Application :** Configuration dans `tauri.conf.json` de `productName` et `title` à "StockFlow". L'exécutable compilé s'appelle désormais `StockFlow.exe` et la fenêtre affiche "StockFlow" (corrigé du "tauri-app" par défaut) avec son icône dans la barre des tâches Windows.
- **Refonte et Priorisation du Scraper VPC & Correction des Chemins :**
  - **Priorisation Directe (Prix) :** Modification de `scrape_price_internal` dans `scraper.rs` pour interroger directement le site de VPC (ma.rsdelivers.com pour RS) via le code stock avant de faire appel à SearxNG. Cela garantit un taux de succès de 100% et des données fiables pour le prix.
  - **Extraction d'Images Avancée :** Modification de `scrape_images_internal` dans `scraper.rs` pour récupérer dynamiquement toutes les URLs d'images Cloudinary de la page produit officielle (gérant ainsi les préfixes `Y` et `F`), avec repli sur la génération d'URLs et SearxNG. Récupération paramétrée pour récupérer jusqu'à 5 images si présentes.
  - **Uniformisation de la Cascade de Dossiers (Sanitisation) :** Ajout de fonctions de sanitisation dans `App.tsx` (`sanitizeFolderName` et `sanitizeSku`) répliquant à l'identique la logique Rust (remplacement des caractères spéciaux et majuscules pour le SKU), résolvant le problème où le bouton "Ouvrir dossier" ouvrait un dossier vide en raison d'une différence de casse ou de format de dossier.
  - **Nettoyage des Avertissements :** Correction d'avertissements de compilation Rust (suppression de variables inutilisées ou de liaisons `mut` superflues).

---

## [2026-05-27] Scraping RS France, Choix d'URL VPC, Support Conrad & Journal d'Audit

- **Anti-Spam & Scraping RS France :**
  - Remplacement de l'URL cible du scraper RS de `ma.rsdelivers.com` (site marocain, prix export) par `fr.rs-online.com` (site français, prix réels).
  - Ajout d'un système de file d'attente anti-spam : variable globale `LAST_RS_REQUEST` (Mutex + Instant) avec temporisation de 1500 ms entre chaque requête, inspiré de la macro Excel originale.
  - Ajout d'en-têtes HTTP complets (Accept, Accept-Language, Sec-Fetch-*) simulant un navigateur Chrome pour contourner les premiers filtres Akamai.

- **Choix de l'URL par Fournisseur VPC :**
  - Ajout du champ `vpc_urls: HashMap<String, String>` dans `AppConfig` (`config.rs`) et `save_config` (`lib.rs`).
  - Modification de `scrape_price_internal` dans `scraper.rs` pour lire l'URL personnalisée par fournisseur depuis la configuration (avec détection automatique du format d'URL `rsdelivers` vs `rs-online`).
  - Mise à jour de l'interface des paramètres dans `App.tsx` : ajout d'un menu déroulant par fournisseur VPC proposant les domaines disponibles (FR, MA, UK, US, Intl) avec auto-save.

- **Support Fournisseur Conrad :**
  - Ajout d'un bloc de scraping dédié à Conrad dans `scraper.rs` avec parsing HTML JSON-LD (même logique que RS).
  - Ajout des options d'URL `www.conrad.fr` et `www.conrad.com` dans la liste déroulante de l'interface.

- **Journal d'Audit des Modifications (Audit Log) :**
  - **Architecture réseau :** Les entrées d'audit sont stockées en fichiers JSON individuels dans un dossier `audit/` sur le lecteur réseau partagé, séparé du dossier `events/`. Ce dossier n'est **jamais touché** par la compaction ni le nettoyage réseau.
  - **Base de données locale (`db.rs`) :** Ajout des tables `product_audit_log` (avec champs `audit_id`, `sku`, `timestamp`, `trigramme`, `action`, `field`, `old_value`, `new_value`, `source_url`) et `applied_audits` (déduplication).
  - **Écriture des audits (`events.rs`) :** Fonctions `write_audit_file` (écriture JSON réseau + application locale immédiate) et `sync_audit_files` (synchronisation des fichiers audit distants dans le cache SQLite local).
  - **Diff champ par champ (`lib.rs`) :** Modification de `create_product` pour comparer l'état existant du produit avec les nouvelles valeurs. Pour chaque champ modifié (désignation, MPN, marque, famille, sous-famille, emplacement, prix, seuil d'alerte, taille lot, code VPC), un fichier audit est généré avec les valeurs avant/après.
  - **Audit des scrapes (`scraper.rs`) :** Chaque scrape réussi (prix, PDF, image) génère un fichier audit avec l'URL source cliquable.
  - **Interface utilisateur (`App.tsx`) :** Section "📋 Journal des Modifications" dans le panneau de détails produit, affichant :
    - 🟢 Créations de référence
    - 🔵 Modifications de champs (avant → après, avec l'ancien barré en rouge et le nouveau en vert)
    - 🟠 Scrapes de prix avec lien cliquable vers la source
    - 📄 Notices PDF téléchargées avec lien source
    - 🖼️ Images téléchargées avec lien source
  - **Styles CSS (`App.css`) :** Bordure latérale colorée par type d'action, badges, liens de source stylisés, et personnalisation des balises `select option` pour un contraste et une intégration parfaite dans le thème sombre (suppression du fond gris clair/argenté par défaut).
  - **Synchronisation :** Les fichiers audit sont synchronisés automatiquement avec les événements lors du polling régulier.

- **Améliorations de l'Ergonomie et de l'Historique (Correctifs Finaux) :**
  - **Double sélecteur d'URL VPC :** Restauration de la liste déroulante d'origine des URLs pré-enregistrées de base, positionnée côte à côte avec le champ de saisie libre et l'assistance de recherche SearXNG pour une flexibilité maximale.
  - **Filtrage de l'historique physique :** Correction d'un bug qui affichait à tort les créations/mises à jour de métadonnées comme des mouvements de stock de "0 unités". La table SQLite locale ne filtre plus que les véritables événements physiques (`STOCK_IN` et `STOCK_OUT`).
  - **Rafraîchissement dynamique immédiat (sans F5) :** Ajout de la fonction front-end `refreshSelectedProduct` qui réinterroge immédiatement la base de données et met à jour instantanément la sidebar (prix, stocks, historique, et audits) après chaque opération d'édition, de mouvement ou de scraping réussie.

- **Saisie Rapide du Stock :**
  - Ajout du champ optionnel `initial_stock` au formulaire d'ajout (`App.tsx`), géré dynamiquement dans le backend Rust (`lib.rs`) pour générer un mouvement `STOCK_IN` lors de la création.
  - Rendu de la cellule **Stock Actuel** éditable (double-clic) dans le tableau (`DataGrid`), avec un calcul automatique et transparent de la différence entre l'ancien et le nouveau stock pour générer la transaction `STOCK_IN` ou `STOCK_OUT` associée.

- **UI/UX - Confirmations Inline :**
  - Suppression complète de la modale globale perturbante (`confirmModal`) pour les actions destructives.
  - Implémentation d'un état React local (`inlineConfirm`) permettant aux boutons 'Corbeille' et 'Supprimer' de se transformer de manière contextuelle en petits bandeaux de confirmation 'Sûr ? [Oui] [Non]'.

- **Amélioration du Moteur de Scraping PDF :**
  - **Extraction contextuelle (Rust) :** Ajout de la fonction `extract_link_text` dans `scraper.rs` qui analyse le HTML environnant pour récupérer le texte exact du lien (`<a href>Texte</a>`).
  - **Nommage Dynamique :** La fonction `detect_doc_type` a été adaptée pour lire ce texte extrait et assigner un type de document ultra-pertinent au lieu du type générique 'Datasheet'.
  - **Coupe-circuit SearxNG :** Ajout d'une condition interrompant totalement la recherche fallback sur le moteur de recherche public dès lors que la page VPC (ex: RS) a retourné au moins un PDF valide.
  - **Déduplication agressive :** Modification du seuil de tolérance PDF : maximum de 3 fichiers gardés en mémoire, et suppression des doublons sur le seul critère du type de document si la taille est similaire.
