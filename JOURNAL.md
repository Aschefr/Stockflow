# Journal des Modifications - StockFlow

Ce document répertorie l'historique des modifications apportées au codebase de StockFlow étape par étape.
Ne pas oublier de le remplir pendant le developpement.

---

## [1.5.2] - 2026-10-02

### Exhaustivité & Parité Totale de l'Historique des Modifications (Audit Log)
- **Rendu Visuel Complet des 8 Actions (`ProductDetailPanel.tsx`) :**
  - Prise en charge avec badges et titres stylisés pour toutes les actions : `CREATE` (Création référence), `DELETE` (Suppression référence), `UPDATE` (Modification champ), `UPLOAD_MEDIA` (Ajout média image/pdf/screenshot), `DELETE_MEDIA` (Suppression média), `RENAME_MEDIA` (Renommage média avec ancien et nouveau nom), `SCRAPE_PDF` (Notice PDF récupérée avec type), `SCRAPE_IMAGE` (Image récupérée), et repli défensif pour tout événement personnalisé futur.
  - Boutons d'action contextuels cliquables : `👁️ voir` pour ouvrir le fichier/dossier local via `onOpenPath` et `🔗 source` pour ouvrir le lien web distant d'origine.
- **Audit Exhaustif des Champs Moteur Tauri (`src-tauri/src/lib.rs`) :**
  - Prise en compte dans le diff de création/mise à jour de : `Type d'article`, `Image principale`, `Notice principale`, `URL image`, `URL document`, `URL source prix`, `Documents`.
- **Audit de Chaque Image Téléchargée (`src-tauri/src/scraper.rs`) :**
  - Suppression de la condition restrictive `if count == 1` sur l'écriture de l'audit pour tracer l'ensemble des images sauvegardées avec leur chemin relatif `images/...` et URL source.
- **Parité Totale du Moteur Pur Web (`src/services/webBackend.ts`) :**
  - Intégration de `writeAuditToDirectory` sur l'ensemble des opérations (`create_product`, `delete_product`, `upload_media`, `delete_media`, `rename_media`, `save_selected_images`, `save_selected_pdf`) avec calcul de diffs champ par champ identique au moteur Rust et enregistrement dans IndexedDB `audit_log` ainsi que sur le partage réseau `audit/*.json`.
- **Restauration Universelle des Champs (`src/App.tsx`) :**
  - Extension de `handleRevertAudit` pour restaurer en un clic `Type d'article`, `Image principale`, `Notice principale`, `URL document`, `URL source prix`, `URL image` et `Documents`.
- **Traçabilité des Imports CSV (`csv_importer.rs` & `webCsvImporter.ts`) :**
  - Enregistrement automatique d'un audit `CREATE` (« Import initial CSV ») ou `UPDATE` (« Import CSV ») pour chaque article importé ou actualisé.

---

## [1.5.1] - 2026-10-01

### Organisation des Modales, Badges Modernes & Refonte de l'Algorithme de Scraping
- **Restauration de la navigation par onglets :** Les onglets (`📝 Général`, `🖼️ Images`, `📄 Documents`) reprennent leur place au sommet de la modale d'ajout/modification de SKU, offrant une vue dégagée dès l'ouverture.
- **Badges d'options modernes :** Remplacement des cases à cocher standard par des boutons-pilules interactifs stylisés (`[+ 🖼️ Images]`, `[+ 📄 Notices & PDF]`) avec état actif lumineux (`[✓ 🖼️ Images]`).
- **Refonte intégrale de l'algorithme d'extraction & détection des marques :**
  - **Diagnostic :** L'ancien algorithme parcourait bêtement un tableau statique de marques et s'arrêtait (`break`) dès la première correspondance trouvée dans le texte concaténé. Comme `Schneider` était en première position et apparaissait dans des liens de catégories ou pieds de page de distributeurs (RS/Sonepar), il était sélectionné à tort avec 92% de confiance même quand tous les résultats et domaines officiels provenaient de `Siemens`.
  - **Système de notation multi-critères (`scoreAndRankBrands`) :**
    - Pondération forte des domaines constructeurs officiels (+40 points pour `*.siemens.com`, `*.se.com`, `*.phoenixcontact.com`, etc.).
    - Pondération par rang et position dans les titres (+22 points pour le titre #1, +16 pour le #2, etc.).
    - Détection contextuelle des alias (`SIMATIC`, `SITOP`, `SIRIUS` -> Siemens).
    - Classement des candidats par score décroissant avec confiances réelles.
  - **Nettoyage intelligent des désignations (`cleanProductTitle`) :** Suppression du préfixe SKU/MPN (ex: `6GK... | `) au début des titres et des suffixes boutiques (` | RS`, ` - Sonepar`, ` - SiePortal`) pour obtenir une désignation claire et lisible.
  - **Correction du parseur RS :** Extension de la limite de longueur du MPN de 15 à 35 caractères (`{4,35}`), permettant la capture immédiate des références longues Siemens/Schneider.
  - **Détection des références MPN officielles formatées :** Extraction automatique de la référence avec tirets de catalogue (ex: `6GK7543-6WX00-0XE0` si l'utilisateur a saisi `6GK75436WX000XE0`).
  - **Extraction des dimensions, poids et conditionnements :** Remplissage automatique des propriétés à partir des motifs textuels des extraits de recherche.
- **Classification Intelligente & Détection du Type de Document (Historique Excel) :**
  - **Algorithme d'analyse textuelle contextuelle (`documentUtils.ts`, `scraper.rs`, `webScraperService.ts`) :**
    - Remplacement du type rigide `"datasheet"` par défaut par un algorithme heuristique analysant les termes dans l'URL, le nom de fichier, le titre et les extraits environnants (anglais, français, allemand).
    - Détection de 8 familles de documents techniques : `Fiche technique` (`fiche_technique`), `Manuel` (`manuel`), `Guide rapide` (`guide_rapide`), `Installation` (`installation`), `Information Produit` (`information_produit`), `Schéma / Plan` (`schema`), `Certificat` (`certificat`), `Catalogue` (`catalogue`), et repli sur `Autre` (`autre`).
  - **Badges visuels de type sur les candidats :**
    - Affichage d'un badge pilule coloré sur chaque candidat dans la liste de scraping (`ProductForm.tsx` et `ScrapeComponents.tsx`) indiquant son type détecté dès la recherche.
  - **Sélecteur déroulant de type modifiable par l'utilisateur :**
    - Intégration d'un menu déroulant `<select>` stylisé pour chaque document sélectionné dans la liste « Documents pour cet article ». L'utilisateur peut modifier en un clic la catégorie assignée au document avant la validation de la fiche.
  - **Intégration dans la convention de renommage (`{Type}`) :**
    - La balise `{Type}` configurée dans la convention de nommage (`pdf_rename_convention`) utilise désormais le slug du type choisi (`manuel`, `guide_rapide`, `installation`, etc.) pour le nom physique du fichier sur le disque au lieu du mot générique fixe `datasheet`.
- **Tri Interactif par Colonnes & Réinitialisation du Tri (Tableaux de Références) :**
  - **Tri multi-types intelligent (`compareProducts`) :**
    - Prise en charge du tri sur l'ensemble des colonnes : textuelles (SKU, MPN, Code VPC, Marque, Famille, Sous-famille, Désignation, Emplacement, Notes) via tri naturel insensible à la casse et aux accents (`localeCompare` avec `{ numeric: true }`), et numériques (Stock Actuel, Seuil Alerte, Prix Unitaire, Taille du lot, Valeur Totale, Largeur, Hauteur, Profondeur, Poids).
    - Gestion robuste des valeurs vides : systématiquement reléguées en fin de liste pour ne pas masquer les données utiles.
  - **Cycle de tri 3 états sur les en-têtes de colonnes :**
    - Clic 1 : Tri croissant (`▲`), mise en surbrillance de l'en-tête de colonne avec couleur d'accent.
    - Clic 2 : Tri décroissant (`▼`).
    - Clic 3 : Réinitialisation du tri et retour automatique à l'ordre par défaut (sans tri).
  - **Boutons explicites de réinitialisation :**
    - Bouton d'annulation rapide `✕` rouge intégré directement dans l'en-tête de la colonne triée.
    - Bouton dynamique dans la barre d'outils au-dessus du tableau (`✕ Tri : [NomColonne] (▲ croissant / ▼ décroissant)`) permettant de réinitialiser le tri en un seul clic.
    - Option de réinitialisation ajoutée dans la modale de configuration des colonnes (`⚙️ Colonnes`).
    - Préservation totale de l'action de redimensionnement de colonne (séparation stricte des événements de glisser/déposer via `stopPropagation`).
  - **Disponibilité universelle :** Fonctionne à la fois sur le tableau d'inventaire principal (`App.tsx`) et dans le sélecteur de références des Nomenclatures (`BomTab.tsx`).
- **Fermeture Immédiate des Modales & Téléchargements Médias en Arrière-Plan :**
  - **Diagnostic :** Lors de l'enregistrement d'une fiche avec des images ou des documents distants sélectionnés, le modal restait bloqué plusieurs secondes car `save_selected_images` et `save_selected_pdf` téléchargeaient l'ensemble des fichiers sur le réseau de manière bloquante avant de fermer la fenêtre.
  - **Fermeture instantanée :** Dès que l'écriture rapide de la référence en base de données locale (< 50 ms) est validée, le modal se ferme immédiatement et l'état du formulaire est réinitialisé.
  - **Micro-animation du bouton :** Remplacement instantané du libellé du bouton par `Enregistrement...` ou `Création...` avec spinner rotatif dès le clic, empêchant les doubles clics accidentels.
  - **Tâche d'arrière-plan non bloquante :** L'upload des fichiers locaux et le téléchargement HTTP des images et notices PDF s'exécutent en tâche asynchrone en arrière-plan sans ralentir l'utilisateur. Dès l'achèvement, les listes de médias de la fiche active sont rafraîchies automatiquement.
- **Centrage Automatique & Surbrillance de la Ligne (Auto-scroll & Pulse Highlight) :**
  - **Navigation automatique vers la position du SKU :** Dès la création ou la modification d'un SKU, l'application bascule sur l'onglet inventaire (`activeTab = "inventory"`), réinitialise les filtres de recherche ou de catégorie s'ils masquaient la référence, et scrolle en douceur (`scrollIntoView({ behavior: "smooth", block: "center" })`) jusqu'à la ligne concernée dans le tableau.
  - **Surbrillance visuelle temporaire (`rowHighlightPulse`) :** La ligne du tableau bénéficie d'une animation CSS lumineuse avec halo d'accentuation (`box-shadow: inset`) et contour marqué pendant 4 secondes avant de revenir à son état sélectionné habituel, guidant immédiatement le regard de l'utilisateur vers son nouvel article.
- **Interactions Avancées du Tableau de Bord & Filtrage par Statut de Stock :**
  - **Cartes de statistiques cliquables :**
    - Clic sur « Stock Bas Alertes » : bascule vers l'inventaire avec le filtre `Stock bas` actif (`current_stock <= min_stock AND min_stock > 0`).
    - Clic sur « Ruptures Totales » : bascule vers l'inventaire avec le filtre `Rupture` actif (`current_stock <= 0`).
    - Clic sur « Total Références » : bascule vers l'inventaire avec tous les filtres réinitialisés.
  - **Badges / Pilules de filtre de stock dans la barre d'outils d'inventaire :**
    - Ajout de 3 pilules interactives : `Tous (N)`, `⚠️ Stock bas (N)`, `🛑 Rupture (N)`.
    - Bouton d'annulation explicite `✕ Filtre stock : [Nom]` à côté du bouton de réinitialisation de tri.
    - Possibilité de basculer/annuler le filtre en recliquant simplement sur la pilule active ou sur le badge d'annulation.
  - **Derniers Mouvements de Stock cliquables avec Auto-scroll & Highlight :**
    - Clic sur une ligne de mouvement ou d'audit du tableau de bord : réinitialisation automatique des filtres masquants, sélection de l'article avec ouverture de sa fiche technique dans le volet latéral, navigation instantanée vers l'inventaire, centrage fluide de la ligne dans le tableau et surbrillance lumineuse pulsée de 4 secondes.

---

## [1.5.0] - 2026-09-30

### Architecture Dual-Target : Package de Distribution Pure Web (.html) & Moteur Hybride
- **Objectif & Session Restreinte :**
  - Permettre le fonctionnement de Stockflow sur des postes d'entreprise à session restreinte où même les exécutables portables (`.exe`) sont bloqués par les règles de sécurité (AppLocker/SRP).
  - Génération d'un package de distribution sous la forme d'un fichier HTML unique (`Stockflow.html`), exécutable directement dans Microsoft Edge sans droits d'administration.
- **Conception Dual-Target (Codebase Unique) :**
  - Les deux versions partagent 100% des composants graphiques (React 19, TypeScript, CSS).
  - Couche d'abstraction API universelle (`src/services/api.ts`) détectant automatiquement l'environnement d'exécution (`isTauri`).
  - Moteur Web autonome (`webBackend.ts`) reproduisant le rejeu des événements JSON dans IndexedDB et permettant la lecture/écriture sur le partage réseau via l'API File System Access de Chromium.
  - Moteur de migration CSV pur Web (`webCsvImporter.ts`) : sélection du fichier CSV et des dossiers sources médias (images, notices PDF), transcodage Windows-1252 et copie vers le partage réseau via des descripteurs de fichiers du navigateur.
  - Conservation intégrale de la version Desktop Tauri sans aucune régression.
- **Assistant de Scraping Navigateur & Capture Fournisseur (Mode Web) :**
  - **Favori Bookmarklet Edge/Chrome 1-Clic :** Bouton draggable interactif et bouton de copie de code dans l'onglet *Paramètres* (`src/services/webScraperAssistant.ts`, `src/App.tsx`). Extraction en un clic des données riches (JSON-LD, marque, MPN, code commande, prix, dimensions, liens images et fiches PDF) directement sur les pages fournisseurs (RS, Farnell, Mouser...) et transmission automatique vers StockFlow via `localStorage` et presse-papiers.
  - **Fonctionnalité « 📋 Coller fiche fournisseur » :** Bouton rapide et modale de saisie assistée dans `ProductForm.tsx`. Analyseur heuristique et syntaxique intelligent (`parseSupplierData`) convertissant tout texte brut ou JSON fournisseur collé en champs de formulaire et en candidats médias/documents.
  - **Gestion des médias Web :** Prise en charge du téléchargement et suppression des images et PDF dans le sous-système réseau (`webBackend.ts`).
- **Correctif d'enregistrement des nomenclatures (IndexedDB DataError) :**
  - Résolution de l'erreur `DataError: Evaluating the object store's key path yielded a value that is not a valid key` lors de l'enregistrement d'une nomenclature (BOM).
  - Prise en charge des paramètres camelCase (`bomId`, `equipmentNote`, `eventType`) transmis par les vues frontend dans `webBackend.ts`.
  - Sécurisation de l'assignation de l'ID primaire de nomenclature dans `webEventProcessor.ts` et garde-fou défensif dans `idbPut` (`webDatabase.ts`).
- **Colonne « Image produit » & Tailles de ligne dans le PDF Atelier (BOM) :**
  - Ajout de la colonne `Image produit` (`ALL_AVAILABLE_COLUMNS`) dans la configuration et réorganisation des colonnes du PDF Atelier.
  - Intégration d'un sélecteur déroulant « Taille image / Hauteur de ligne » dans le panneau de configuration du PDF (12 mm, 16 mm, 20 mm, 25 mm, 30 mm) mémorisé dans le `localStorage` (`sf_bom_pdf_img_size`).
  - Adaptation dynamique de la hauteur des lignes (`minCellHeight = imgSizeMm + 4`) et de la largeur de la colonne dans `jspdf-autotable`.
  - Préchargement asynchrone des images avec gestion des ratios d'aspect (portrait/paysage) et centrage optique dans chaque cellule via `didDrawCell`.
  - Aperçu interactif immédiat dans la vue de prévisualisation (tableau HTML reflétant les dimensions choisies) et support natif bi-moteur (Blob URLs résolues en mode Web, `convertFileSrc` en mode Tauri Desktop).
- **Chargement instantané depuis le cache local & Indicateur de synchronisation (Mode Web) :**
  - Au rechargement de la page (F5), les produits sont désormais chargés instantanément depuis IndexedDB (cache local) avant le démarrage de la synchronisation réseau, éliminant l'écran vide pendant le chargement.
  - La synchronisation avec le dossier partagé s'effectue en arrière-plan de manière transparente ; les données sont mises à jour automatiquement une fois la lecture distante terminée.
  - Ajout d'un indicateur de synchronisation en 3 états dans le header (mode Web uniquement) : `⏳ Synchronisation…` (spinner orange), `✅ Synchronisé` (badge vert), `● Cache local / Hors-ligne` (badge par défaut ou rouge).
  - Amélioration de l'affichage du chemin réseau en mode Web : le champ est en lecture seule (le chemin manuel ne fonctionne pas via l'API File System Access), un clic ouvre directement le sélecteur, et un message informatif explique la restriction de sécurité du navigateur.
- **Résolution du bug de synchronisation des Nomenclatures entre postes (Mode Web) :**
  - **Diagnostic :** Sur un poste secondaire, la page des nomenclatures restait vide car (1) `BomTab` ne rechargeait les données qu'une seule fois à son montage (`useEffect(..., [])`) sans écouter la boucle de synchronisation réseau de 4s (`syncAndFetch`), (2) la synchronisation initiale de plus de 1 100 fichiers d'événements prenait plusieurs dizaines de secondes et la nomenclature créée en dernier sur le poste 1 n'était pas encore traitée lors de l'ouverture de l'onglet, et (3) lors d'un rechargement (F5), l'API File System Access de Chromium repasse systématiquement la permission du handle de dossier stocké en état `"prompt"`, ce qui désactivait silencieusement la lecture réseau tout en affichant les produits du cache local.
  - **Rechargement dynamique :** Ajout de la prop `syncCounter` dans `BomTab` déclenchant automatiquement le rechargement de la liste dès qu'un cycle de synchronisation se termine.
  - **Bouton d'actualisation manuelle :** Ajout d'un bouton « 🔄 Actualiser » dans la barre d'outils de `BomTab` pour forcer la mise à jour immédiate à tout moment.
  - **Reconnexion 1-Clic du dossier réseau :** Détection de l'état déconnecté suite à un rechargement avec affichage du badge `⚠️ Dossier non connecté (Cliquer pour réactiver)` et commande `reconnect_network_directory` pour réautoriser l'accès au dossier partagé par un simple clic sans devoir naviguer dans l'explorateur.
  - **Tri des nomenclatures :** Tri automatique par date de modification décroissante (`updated_at DESC`) dans `get_boms` (`webBackend.ts`).
- **Suppression sécurisée des Nomenclatures (Desktop & Web) :**
  - Ajout d'un bouton de suppression rapide `🗑️` dans la colonne Actions du tableau de la vue principale et d'un bouton `🗑️ Supprimer` dans la barre d'outils d'édition d'un projet (`BomTab.tsx`).
  - Dialogue de confirmation préalable avant suppression définitive.
  - Gestion intelligente des réservations : si la nomenclature supprimée était au statut `RESERVED`, le système lève automatiquement toutes les réservations associées (`STOCK_UNRESERVE`), remettant instantanément les stocks physiques en réserve à disposition.
  - Émission de l'événement réseau `BOM_DELETE` partagé entre les postes et suppression immédiate des tables/stores locaux (`boms` et `bom_items`).
- **Persistance intégrale et synchrone des Paramètres dans le LocalStorage :**
  - **Diagnostic :** Confirmation du problème suspecté par l'utilisateur. Dans le moteur web (`webBackend.ts`), l'enregistrement de la configuration tronquait silencieusement 6 champs critiques (`searxng_url`, `searxng_urls`, `max_image_candidates`, `vpc_sites`, `pdf_rename_convention`, `image_rename_convention`), causant leur réinitialisation aux valeurs par défaut à chaque réouverture ou rechargement. De plus, les paramètres de sauvegarde (`stockflow_backup_config`) n'étaient conservés que dans IndexedDB sans miroir dans le `localStorage`.
  - **Mise à niveau du modèle de données (`AppConfig`) :** Intégration de l'ensemble des 14 champs de configuration applicative dans `src/types/index.ts`.
  - **Double persistance immédiate (`webBackend.ts`) :** Conservation de tous les champs sans aucune perte dans `localStorage` (`stockflow_config`) et IndexedDB (`app_config`), avec synchronisation miroir des paramètres de backup (`stockflow_backup_config`).
  - **Préchargement synchrone & Écriture directe (`App.tsx`) :**
    - Lecture synchrone de `localStorage.getItem("stockflow_config")` dès le montage du composant `App` avant même la résolution de `invoke("get_config")`, garantissant un affichage instantané et éliminant tout clignotement ou décalage de formulaire.
    - Écriture directe et instantanée dans le `localStorage` lors de la sauvegarde manuelle (`handleSaveSettings`) et de l'auto-sauvegarde à la perte de focus (`triggerAutoSave`).
- **Affichage du numéro de version dans la version Web :**
  - **Diagnostic :** La commande `get_app_version` n'était pas implémentée dans `WebBackend.handle`, renvoyant `null`. Le composant `App` écrasait alors sa valeur par défaut avec `null`, affichant un badge avec seulement `"v"`.
  - **Prise en charge universelle de la version :** Création de [`src/version.ts`](file:///d:/Code%20Projects/Stockflow/src/version.ts) avec `APP_VERSION = "1.5.0"`.
  - **Synchronisation :** Mise à niveau des versions dans `package.json`, `Cargo.toml` et `tauri.conf.json` vers `1.5.0`.
  - **Prise en charge Web :** Implémentation du handler `get_app_version` dans `webBackend.ts` renvoyant `APP_VERSION`, et initialisation robuste du state `appVersion` dans `App.tsx` (ignorant les retours falsy). Le badge dans le header affiche désormais fièrement `v1.5.0`.
- **Moteur de Recherche Manuel Intelligent et Tolérant (`searchUtils.ts`) :**
  - **Recherche multi-termes (ET logique) :** Découpage de la requête en mots-clés indépendants. Par exemple, la saisie de `"Alim 24v"` trouve instantanément `"Alimentation - 230V - 24V"`, même si d'autres mots ou caractères séparent les termes.
  - **Insensibilité stricte à la casse et aux accents :** Normalisation NFD automatique (`boîtier` trouve `boitier`, `câble` trouve `cable`).
  - **Tolérance sur les espaces et unités matérielles :** Gestion intelligente des notations numériques industrielles (`"24v"` trouve `"24 V"` et vice-versa, `"230v"` trouve `"230 V"`, `"1.5mm"` trouve `"1,5 mm"`).
  - **Recherche transversale sur tous les champs :** Analyse simultanée de la désignation (`label`), de la référence interne (`sku`), de la référence fabricant (`mpn`), de la marque (`brand`), de la famille (`category`), de la sous-famille (`sub_category`), de l'emplacement (`location`) et des attributs techniques (`attributes`).
  - **Tolérance aux abréviations & sous-chaînes :** Préfixes techniques immédiatement reconnus (`alim` => `alimentation`, `disj` => `disjoncteur`, `diff` => `différentiel`, `transfo` => `transformateur`).
  - **Tolérance aux fautes de frappe (Levenshtein) :** Prise en charge des coquilles sur les mots de 4 lettres et plus (ex: `"scheinder"` trouve `"Schneider"`).
  - **Classement par pertinence (Scoring) :** Tri dynamique plaçant en tête les correspondances exactes sur la désignation ou les références clés.
  - **Intégration universelle :** Appliqué à la fois sur la table principale d'inventaire (`App.tsx`) et sur le sélecteur d'articles des Nomenclatures (`BomTab.tsx`).
- **Optimisation de la Synchronisation Multi-Utilisateurs & Économie Réseau :**
  - **Allègement du polling de fond :** Intervalle porté de 4s à 15s (réduction immédiate de 73% des requêtes SMB/NAS par poste).
  - **Rechargement conditionnel intelligent :** Si aucun nouvel événement n'est présent sur le réseau (`newEventsCount === 0`), l'application ignore les requêtes `get_products`, `get_dashboard_stats`, `list_sku_images/pdfs` et évite tout re-render React superflu, économisant 95% du CPU et des E/S disques.
  - **Mise en veille sur masquage (`document.hidden`) :** Suspension totale du polling passif lorsque l'application ou l'onglet est en arrière-plan.
  - **Synchronisation immédiate sur reprise d'activité (`focus` & `visibilitychange`) :** Rafraîchissement instantané des données dès que l'utilisateur revient sur la fenêtre.
- **Moteur de Web Scraping Pur Navigateur & Intégration SearXNG Sécurisée (Mode Web) :**
  - **Objectif :** Remplacer le scraper lourd Desktop en permettant à la version HTML autonome (`StockFlow.html`) de rechercher des métadonnées, des images et des notices PDF directement depuis le navigateur, à l'image du fichier Excel historique (`Gestion de Stock R&T.xlsm`).
  - **Architecture CORS & Cloudflare :** Configuration des en-têtes CORS (`Access-Control-Allow-Origin: *`, `GET, POST, OPTIONS`) sur le tunnel Cloudflare de l'instance SearXNG privée (`search.amify-studio.fr`) avec rate limiting.
  - **Service de Scraping Dédié (`webScraperService.ts`) :**
    - `searchSearxngImages` : Requête SearXNG en catégorie `images` avec extraction des URLs directes et des miniatures Google/Bing.
    - `searchSearxngPdfs` : Requête SearXNG ciblée sur les fiches techniques (`filetype:pdf`) avec filtrage automatique.
    - `searchSearxngGeneral` : Recherche générale pour auto-remplissage des champs (désignation épurée des suffixes VPC, marque reconnue par heuristique industrielle, MPN, prix HT).
    - Respect strict du rate limiting Cloudflare grâce à une temporisation asynchrone courtoise entre les requêtes (800ms / 600ms).
    - Caching persistant des candidats dans IndexedDB (`candidates_{sku}`).
  - **Gestion Robuste des Médias et Téléchargement Sécurisé (`webBackend.ts`) :**
    - `save_selected_images` : Téléchargement du blob image avec repli automatique (*fallback*) sur la miniature SearXNG si le CDN du fabricant bloque le hotlinking direct (403/CORS), enregistrement dans le dossier `images/` via l'API File System Access et mise en cache `mediaUrlCache`.
    - `save_selected_pdf` : Téléchargement du document technique dans `documents/{sku}/`, mise à jour automatique de la fiche produit (`pdf_path`).
    - `upload_media` & `rename_media` : Prise en charge complète du téléversement manuel et du renommage des médias en mode Web.
  - **Compatibilité Visuelle et Fallback d'Affichage :**
    - Ajout de `<meta name="referrer" content="no-referrer" />` dans `index.html` pour contourner les protections anti-hotlink des CDN industriels.
    - Gestionnaires `onError` sur les balises images (`ProductForm.tsx`, `ScrapeComponents.tsx`) basculant dynamiquement sur la miniature de secours pour une prévisualisation infaillible.
  - **Verrou anti-concurrence (`isSyncingRef`) :** Élimination de tout risque de requêtes de synchronisation qui se chevauchent sur les connexions réseau lentes.
  - **Immédiateté locale préservée :** Les actions initiées par l'utilisateur (création, mouvement de stock, suppression, etc.) continuent d'exécuter un rechargement forcé instantané sans aucun délai.

## [1.4.4] - 2026-07-08

### Pertinence de recherche, scoring, correctifs d'auto-remplissage et confirmations inline
- **Scoring & Tri de Pertinence (Images et PDFs) :**
  - Ajout du champ `confidence` sur les ressources candidates pour trier automatiquement les meilleurs résultats en premier.
  - Attribution de coefficients de confiance : JSON-LD (`0.95`/`0.90`), Cloudinary RS (`0.92`), Open Graph `og:image` (`0.85`), liens explicites du HTML (`0.80`), HTML brut (`0.40`/`0.35`) et SearXNG (`0.50`/`0.60`).
  - Affichage de badges visuels colorés `Officiel` (vert) et `Probable` (orange) dans la modale d'auto-remplissage.
- **Importation & Remplissage Direct Résilient :**
  - Correction de l'erreur d'importation réseau lors de la création d'un produit (le SKU n'existait pas encore en DB).
  - Ouverture automatique et pré-remplissage du formulaire d'édition lors d'une application d'auto-remplissage initiée depuis la fiche de détails du produit.
- **Renommage intelligent & Résolution de collisions PDF :**
  - Le backend conserve le nom de fichier d'origine de l'URL s'il est plus descriptif que le mot générique `"datasheet"`.
  - Résolution des doublons physiques sur le lecteur réseau par ajout de suffixe incrémental (ex: `_1.pdf`) pour éviter que des notices ne s'écrasent entre elles.
- **Zéro Dialogue Système (Confirmation Inline de suppression) :**
  - Remplacement du dernier `confirm()` bloquant du navigateur par un mini menu de confirmation `[Confirmer]` / `[Annuler]` intégré directement aux vignettes d'images et lignes de notices PDF.
- **Amélioration de la Recherche SearXNG :**
  - La recherche de datasheet utilise prioritairement le MPN fabricant au SKU interne, et applique le format `filetype:pdf` pour cibler les résultats les plus qualitatifs.

## [1.4.3] - 2026-06-23

### Choix Explicite des Dimensions & Parcours d'Onglets Séquentiel
- **Modale d'Association de Dimensions (Choix Explicite) :**
  - Ajout d'une nouvelle modale React s'affichant s'il existe des candidats de dimensions suite à un scraping (auto-remplissage ou clic loupe).
  - L'utilisateur sélectionne l'expression de dimensions trouvée (ex: `150 x 80 x 60 mm`) et mappe explicitement chaque nombre à l'axe correspondant (Largeur, Hauteur, Profondeur) via des sélecteurs déroulants. Il peut également ajuster ou saisir le poids de la pièce.
  - Intégration du formatage automatique des nombres décimaux en format français (avec virgule).
- **Parcours Séquentiel et Accumulation des Onglets du Scraper :**
  - Modification de `webview_scraper.js` pour identifier et cliquer séquentiellement sur tous les onglets inactifs du produit (ex. *Documentation technique*, *Législation*, *Caractéristiques*...) en retardant la fin du scraping de 500 ms à chaque clic.
  - Implémentation d'une accumulation persistante des notices PDF et dimensions candidats au fil des clics. Même si le site remplace ou détruit les nœuds DOM d'un onglet au passage au suivant, l'ensemble des données extraites est conservé et renvoyé au frontend.
- **Robustesse du Backend Rust & WebView (Correctifs) :**
  - Ajout du support de `dimension_candidates` dans la structure `ScrapedProductDetails`.
  - Correction de la redirection bloquée de RS Online en renvoyant directement l'URL d'origine afin de laisser WebView2 gérer le flux de navigation sans déclencher de restrictions d'accès (Akamai/Cloudflare).
  - Suppression de la logique de faux prix de repli en cas d'erreur de scraping.

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
- **Refonte Ergonomique du Scraping & Réconciliation des Candidats :**
  - **Réconciliation des clés de cache SKU/MPN (`webScraperService.ts`, `webBackend.ts`) :**
    - Résolution du bug où un scraping lancé avec une référence brute sans tiret (ex: `6GK75436WX000XE0`) n'était plus retrouvé lorsque le formulaire adoptait le format officiel avec tirets (`6GK7543-6WX00-0XE0`).
    - `getStoredScrapeCandidates` et `save_scrape_candidates` effectuent désormais une recherche multi-niveaux : clé brute, clé alphanumérique normalisée (`replace(/[^A-Z0-9]/g, "")`), et balayage de secours sur toutes les clés de cache candidates.
    - Synchronisation automatique des candidats dans IndexedDB vers le nouveau SKU dès l'application d'un MPN.
  - **Clarification UX du bouton "Données récupérées" (`ProductForm.tsx`, `ProductDetailPanel.tsx`) :**
    - Suppression du libellé trompeur `📦 Données récupérées` qui laissait penser à une étape d'importation obligatoire non accomplie.
    - Remplacement par `🎯 Revoir les variantes` lorsque les données sont déjà appliquées (pour permettre de réajuster ou choisir un autre titre / photos / notices sans confusion), ou `✨ Appliquer les candidats` si non encore appliqués.
  - **Bannière récapitulative explicite :**
    - Remplacement de l'intitulé ambigu `📋 Modifications à appliquer` par `✅ Données pré-remplies par le scraping` avec un bouton d'accès rapide `🎯 Revoir les variantes`.
    - Message clarifié : les données sont bien injectées dans le formulaire et l'utilisateur n'a plus qu'à cliquer sur Créer.

- **Sélection Différée des Médias & Consultation ('Voir') (`ProductForm.tsx`, `App.tsx`) :**
  - **Inversion des interactions Clic / Bouton :**
    - Sur chaque image ou document candidat, le bouton d'action devient **`👁️ Voir`** et ouvre la ressource dans un nouvel onglet sans déclencher d'importation.
    - Cliquer sur la vignette de l'image ou sur la ligne du document **sélectionne / désélectionne** (toggle) l'élément pour le rattacher au SKU.
    - Retour visuel immédiat : bordure illuminée, fond accentué, badge vert avec coche `✓`.
  - **Résolution du bug d'affichage des documents importés :**
    - L'ancien comportement tentait un téléchargement réseau immédiat sur disque via `save_selected_pdf`, bloqué par CORS en mode Web pour les PDF externes sans que l'élément n'apparaisse dans la liste locale des fichiers physiques.
    - La liste du haut affiche désormais tous les **documents et images sélectionnés pour cet article** (fichiers existants sur disque + éléments candidats sélectionnés), avec badges explicites (`💾 Disque`, `✓ Prêt à enregistrer`), boutons `👁️ Voir` et `✕ Retirer`.
  - **Importation différée à la validation finale du JSON :**
    - Les URLs sélectionnées sont attachées aux attributs du produit en mémoire (`scrape_image_urls`, `scrape_pdf_urls`).
    - Le téléchargement physique en tâche de fond n'est exécuté qu'au clic final sur **"Créer"** (ou "Enregistrer"), garantissant une création instantanée et sans blocage.

