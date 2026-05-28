# StockFlow - Plan de Projet (v1.4.1)

**StockFlow** est un système intelligent de gestion d'inventaire industriel conçu pour fonctionner dans un environnement Windows restreint (sans installation, sans droits administrateur, sans ports réseau ouverts). Il repose sur une architecture "Serverless" utilisant un lecteur réseau partagé comme unique vecteur de communication.

---

## 1. Informations Projet

| Propriété | Valeur |
|---|---|
| **Nom** | StockFlow |
| **Version** | 1.4.1 |
| **Description** | Système de gestion d'inventaire industriel portable fonctionnant exclusivement sur dossier réseau partagé, basé sur l'Event-Sourcing. Sans gestion de compte. |
| **Architecture cible** | App Windows Portable (.exe standalone via Tauri ou Go/React) / Base de données par Event-Sourcing (fichiers JSON) sur Lecteur Réseau / Stockage direct (PDF/Images) sur lecteur réseau |

---

## 2. Architecture Technique (Serverless sur Réseau Local)

Pour pallier l'absence de serveur dédié et les risques de corruption de bases de données (ex: SQLite) sur les partages réseau Windows (SMB), l'application utilise une approche **Event-Sourcing (Append-Only)** :
- **Pas de base centrale modifiable :** Chaque action (entrée, sortie, création) génère un nouveau fichier JSON horodaté déposé sur le lecteur réseau.
- **Construction d'état local :** L'exécutable portable lit ces fichiers JSON pour construire et maintenir la base de données (le stock actuel) en mémoire/localement sur le PC de l'utilisateur.
- **Zéro conflit :** Comme les fichiers ne sont jamais modifiés, il n'y a aucun verrou (lock) concurrentiel problématique.

---

## 3. Principes UI/UX

- **Vue Tableur Compacte :** L'interface principale adopte une disposition en grille dense (type spreadsheet), affichant un maximum de colonnes visibles sans défilement horizontal excessif. Chaque ligne = une référence. Les colonnes sont redimensionnables et triables.
- **Rafraîchissement Dynamique (Zéro F5) :** L'application surveille le dossier réseau en arrière-plan (polling toutes les quelques secondes ou FileSystemWatcher). Dès qu'un nouveau fichier JSON apparaît (ex: un collègue sort une pièce), le tableau se met à jour automatiquement avec une animation subtile pour signaler les changements.
- **Thèmes Sombre / Clair :** Interface sombre par défaut (Dark Mode) pour réduire la fatigue visuelle en environnement industriel, avec un thème clair disponible. Accents de couleur pour les alertes (rouge = rupture, orange = seuil bas, vert = stock OK). Commutable dans les paramètres.
- **Édition Inline :** Possibilité de modifier les champs directement dans la grille (double-clic sur une cellule) sans ouvrir de formulaire séparé, comme dans un tableur.
- **Panneaux Latéraux :** Un clic sur une ligne ouvre un panneau de détail à droite (fiche produit complète, image, documents PDF, historique des mouvements) sans quitter la vue principale.

---

## 4. Phases de Développement

### Phase 1 — MVP Foundation ⛔ Must Have

**Objectif :** Mettre en place le moteur Event-Sourcing, l'application portable, et la gestion du référentiel produit.

#### [DONE] P1.1 — Configuration Initiale (Premier Lancement)
> L'application étant par poste et sans comptes utilisateurs, la configuration se limite à la connexion au réseau.
- [x] **[DONE] Localisation du dossier réseau partagé** : Au premier lancement, l'interface invite l'utilisateur à localiser le dossier (ex: `Z:\Stockflow_Data`).
- [x] **[DONE] Signature Trigramme** : Saisie d'un nom de poste ou trigramme (ex: `JDO`) pour signer les mouvements sans gestion de compte.
- [x] **[DONE] Structure réseau automatique** : Création automatique des dossiers `Events`, `images` et `documents` sur le réseau.
- [x] **[DONE] Fichier de configuration locale** : Sauvegarde des paramètres locaux dans `config.json`.

#### [DONE] P1.2 — Outil de Migration (Importation CSV & Médias)
> Transition depuis l'ancien système Excel vers le nouveau moteur.
- [x] **[DONE] Importation asynchrone du CSV** : Traitement non bloquant du fichier CSV (`DB Stock du 26_05_26 08_09.csv`).
- [x] **[DONE] Transcodage & Nettoyage** : Encodage Windows-1252, saut intelligent des 8 lignes d'en-tête et traitement du délimiteur `;`.
- [x] **[DONE] Génération d'événements initiaux** : Création automatique des événements JSON de stock initial pour chaque produit.
- [x] **[DONE] Saisie double des dossiers sources** : Ajout de deux champs de sélection distincts dans le wizard d'import :
  1. Dossier source des images produits (ex: `Images des références`)
  2. Dossier source des manuels PDF (ex: `Manuels PDF`)
- [x] **[DONE] Migration intelligente des fichiers** : Copie et renommage automatique des médias sur le réseau :
  - Images renommées d'après le SKU (ex: `Z:\Stockflow_Data\images\[SKU]_1.jpg`).
  - Documents stockés dans un sous-dossier par produit (ex: `Z:\Stockflow_Data\documents\[SKU]\[nom_original].pdf`).
- [x] **[DONE] Rapport de migration** : Bilan final affichant le nombre de fichiers copiés avec succès, les fichiers manquants et les erreurs.

#### [DONE] P1.3 — Gestion du Référentiel Produits
- [x] **[DONE] Champs et attributs techniques** : Prise en charge des références MPN, SKU, Description, Marque, Catégories, dimensions, poids, prix et code RS.
- [x] **[DONE] Localisation physique** : Gestion de l'emplacement hiérarchique (Dépôt → Allée → Étagère → Bac).
- [x] **[DONE] Typologie d'article** : Séparation entre articles sérialisés et articles en vrac.
- [x] **[DONE] Détection de doublons** : Vérification en temps réel du SKU/MPN lors de la création d'un article.

#### [DONE] P1.4 — Moteur Event-Sourcing & Mouvements de Stock
- [x] **[DONE] Format de nommage explicite** : Fichiers JSON d'événements signés et contenant le SKU pour une lisibilité humaine optimale (ex: `20260525T143000Z_JDO_STOCK_OUT_6ES7507-0RA00-0AB0_c7b3.json`).
- [x] **[DONE] Cache local SQLite** : Chargement instantané et synchronisation différentielle incrémentale.
- [x] **[DONE] Synchronisation temps réel** : Surveillance arrière-plan (polling de 4s) avec mise à jour réactive de l'interface.
- [x] **[DONE] Résilience & Mode Hors-Ligne** : Bannière d'avertissement et file d'attente d'écriture locale en cas de perte de connexion réseau.
- [x] **[DONE] Seuils d'alerte** : Notifications et indicateurs visuels (rupture de stock, seuil bas).

#### [DONE] P1.5 — Stockage Document & Images sur Réseau
- [x] **[DONE] Chargement réseau** : Consultation directe des images et PDF depuis le lecteur réseau via Tauri.
- [x] **[DONE] Support multi-images** : Carrousel ou galerie pour visualiser les différentes vues d'un produit (`[SKU]_1.jpg`, `[SKU]_2.jpg`, etc.).
- [x] **[DONE] Ouverture PDF externe** : Lancement automatique du manuel PDF dans le lecteur de PDF par défaut du système (Edge, Adobe Reader, etc.) via la commande système native.
- [x] **[DONE] Miniatures au survol** : Affichage d'un popover d'aperçu de l'image de la référence au simple survol de la souris dans le tableau principal.
- [x] **[DONE] Téléversement drag & drop** : Ajout de fichiers images/PDF par glisser-déposer sur la fiche détaillée d'un produit existant.

#### [DONE] P1.6 — Tableau de Bord (Dashboard)
- Écran d'accueil synthétique affichant en un coup d'œil : nombre total de références, valeur estimée du stock, nombre d'articles sous le seuil d'alerte, derniers mouvements enregistrés.
- Mise à jour dynamique au même rythme que la synchronisation réseau.

---

### Phase 2 — Intelligence & Connectivité 🔶 High Priority

**Objectif :** Automatiser l'enrichissement des fiches produits via internet, directement depuis les postes clients.

#### [DONE] P2.1 — Recherche Intégrée (SearxNG) & Scraping PDF
- Interrogation d'une instance SearxNG depuis le PC de l'utilisateur pour trouver les fiches techniques.
- Extraction asynchrone des URLs de PDF, téléchargement automatique et dépôt sur le lecteur réseau partagé.
- **Structure de stockage en cascade :** Les PDF sont stockés en respectant la structure de dossiers hiérarchique de la migration : `documents/MARQUE/Famille/Sous-Famille/Référence/(fichiers pdf)` (avec sanitization des caractères invalides pour Windows).
- **Détection intelligente du type de document :** Le module de scraping analyse le texte et le nom du lien d'origine (ex: *datasheet*, *manuel*, *fiche-technique*) pour identifier automatiquement le type de document et l'injecter comme variable `{Type}` dans le renommage.
- **Convention de renommage paramétrable :** Configuration de l'instance SearxNG et définition d'une convention de renommage des documents PDF téléchargés dans les paramètres (ex: `{SKU}_{Type}.pdf` ou `{SKU}_{Brand}_{MPN}.pdf`).
- **Modal de progression en direct :** Un modal s'affiche dès le lancement du scraping pour montrer l'avancement détaillé de la recherche (mots-clés testés, liens trouvés, statut du téléchargement du document).
- **Modal de validation PDF :** Lors d'un scraping au cas par cas, ouverture d'un modal de validation montrant les PDF trouvés pour permettre à l'utilisateur de choisir et de valider celui à enregistrer.
- **Suppression de PDF :** Possibilité de supprimer une documentation PDF associée à une référence, entraînant sa suppression physique sur le lecteur réseau partagé.

#### [DONE] P2.2 — Scraping des Prix & Anti-Redondance
- Veille tarifaire sur demande utilisateur (ex: RS Components).
- **Contrôle de concurrence :** Pour éviter que plusieurs postes ne lancent le scraping du même produit en même temps, vérification d'un fichier `last_scrape_lock.json`. L'information mise à jour est ensuite publiée comme un événement JSON.
- **Résilience aux Crashs (Locks fantômes) :** Si un poste plante pendant un scraping, le fichier lock reste sur le réseau. L'application détectera un verrou anormalement long (> 5 minutes), affichera un avertissement visuel, et permettra à l'utilisateur de "Forcer le déverrouillage" d'un simple clic pour reprendre la main.
- Mesures anti-spam : Limiter le nombre de requêtes par seconde et par utilisateur.

#### [DONE] P2.3 — Gestion Dépôts vs Fournisseurs
- Distinction sémantique et logique entre les **Dépôts Physiques** internes (Usine, Atelier) et les **Fournisseurs / VPC** externes.
- **Gestion des codes fournisseurs (ex: Code RS, Code VPC) :** Identification d'un code article spécifique chez un fournisseur donné.
- **Colonne "Code VPC" dans le tableau principal :** Ajout d'une colonne dédiée dans la grille principale pour visualiser rapidement ces codes.
- **Colonnes de Dimensions :** Restauration des colonnes de caractéristiques physiques (Largeur, Hauteur, Profondeur, Poids, Tension) issues du CSV de migration, stockées en attributs et affichées de manière dynamique.
- **Détails SKU :** Affichage des informations de code fournisseur et des caractéristiques physiques dans le panneau latéral de détails du SKU.
- **Formulaire SKU (Modal) :** Ajout de nouveaux champs dans le modal de création/édition pour saisir et associer les codes fournisseurs.
- **Gestion de la Taille du Lot (Relation Quantité/Prix) :** Liaison entre la quantité d'unités physiques et le prix d'achat défini pour un lot (pack). Intégration du champ dans la base SQLite, événements, formulaires et adaptation des calculs de valeur globale du stock.
- **Page Paramètres (Gestion des sites de VPC) :** Interface permettant d'ajouter, modifier ou supprimer des sites de VPC (fournisseurs) dans le système.
- **Zéro boîte système (globale) :** Aucune boîte d'alerte ou de confirmation système n'est affichée (pas de `alert()` ni de `confirm()`). Toutes les confirmations se font via des modaux React localisés et les erreurs via des animations ou encarts de retours visuels.

#### [DONE] P2.4 — Scraping Images Automatique
- Téléchargement et standardisation automatique des illustrations produits.
- **Convention de renommage paramétrable :** Format de renommage des images personnalisable dans les paramètres (ex: `{SKU}_{Index}.jpg` ou `{SKU}_{Source}_{Date}.jpg`).
- **Éditeur de convention visuel :** Les champs de convention de nommage affichent des badges glisser-déposer pour composer la formule facilement avec insertion de séparateurs automatiques et aperçu en temps réel d'un exemple de nom de fichier simulé.
- **Modal de progression en direct :** Affichage d'un modal montrant les étapes de la recherche d'images et du téléchargement en cours.
- **Modal de validation d'images :** Lors d'un scraping au cas par cas, affichage d'un modal pour valider, réordonner ou sélectionner les images trouvées avant leur dépôt final.
- **Suppression d'images :** Possibilité de supprimer individuellement une ou plusieurs images associées à une référence depuis le carrousel/galerie (avec renommage/réindexation automatique des fichiers restants si nécessaire).
- Génération de miniatures gérée localement par le PC client avant l'écriture réseau pour des performances d'affichage optimales.

#### [DONE] P2.5 — Scraping par Lot (Images & PDF)
- **Sélection par case à cocher :** Ajout de cases à cocher dans le tableau principal pour sélectionner une liste de références.
- **Lancement groupé :** Possibilité de lancer le scraping (images et/ou PDF) sur l'ensemble de la sélection.
- **Progression aléatoire :** La file d'attente traite la sélection dans un ordre aléatoire (randomisé) pour éviter les requêtes successives trop prévisibles sur les mêmes serveurs/marques.
- **Indicateur de progression :** Barre de progression globale avec statistiques de réussite/échec de la tâche de lot.

#### [DONE] P2.6 — Pré-remplissage Intelligent à la Création
- **Recherche Instantanée :** À partir de la seule saisie du code VPC ou du SKU dans le formulaire de création, l'utilisateur peut cliquer sur un bouton "🔍 Pré-remplir".
- **Scraping en Arrière-plan :** Requête rapide vers le fournisseur configuré (ex: RS) pour extraire dynamiquement : la désignation (label), la marque (brand), le prix, la taille du lot (pack size), et éventuellement lancer en tâche de fond le scraping d'images et de PDF.
- **Remplissage Automatique :** Renseigne automatiquement tous les champs du modal d'ajout pour faire gagner un temps précieux à l'utilisateur lors des saisies manuelles.

---

### Phase 3 — Workflows Industriels 🔶 High Priority

**Objectif :** Gérer les nomenclatures (BOM), les réservations virtuelles et les commandes.

#### P3.1 — Gestion Nomenclature (BOM) & Réservation
- Interface d'assemblage de listes de pièces pour des projets.
- **Réservation de Stock :** L'utilisateur publie un événement JSON de "Réservation", déduisant virtuellement les pièces du stock disponible pour les autres sans pour autant les sortir physiquement.

#### P3.2 — Workflows de Retrait
- Édition de bons de préparation indiquant l'emplacement physique exact.
- Obligation d'une validation explicite dans l'interface pour convertir une "Réservation" en événement de "Sortie Définitive".
- **Annulation de Retrait :** Possibilité d'annuler un retrait erroné (génération d'un événement `STOCK_REVERSAL` qui restaure les quantités). L'historique conserve la trace de l'erreur et de sa correction.

#### P3.3 — Exportation Commande Achat
- Génération de fichiers XLSX épurés pour le service Achat.
- Regroupement des besoins par Fournisseur VPC et masquage des informations confidentielles ou inutiles.
- **Fonction d'exclusion :** Possibilité de masquer/exclure manuellement certaines références de la liste générée avant l'export (ex: pour retarder un achat).

#### P3.4 — Recherche Globale & Opérations en Lot
- Moteur de recherche local (en mémoire) combinant texte, références, numéros de série et attributs techniques. Filtres à facettes instantanés.
- **Mode Batch :** Sélection multiple de références pour appliquer une action groupée (changer l'emplacement, supprimer, exporter, lancer un scraping d'images en lot).

---

### Phase 4 — Optimisation & Maintenance 🔷 Nice to Have / V2.0

#### P4.1 — Snapshot & Sauvegarde (Backup & Garbage Collection)
- **Opération de maintenance globale :** Fusion de milliers de petits fichiers JSON d'événements passés en un unique fichier `snapshot_v1.json` pour accélérer le démarrage (re-calcul du stock).
- **Export de sécurité (Backup) :** Fonctionnalité pour générer un fichier `.zip` de sauvegarde de toute l'arborescence JSON sur le poste local (remplace la macro d'export de l'ancienne base Excel).

#### P4.2 — Support Multi Devise
- Conversion en temps réel des prix fournisseurs (EUR, USD, CHF) selon les taux de change.

#### P4.3 — Interface Windows Tablette & Scan Code-Barres
- Adaptation de l'interface pour les terminaux tactiles Windows.
- Prise en charge native des lecteurs de codes-barres USB / Webcams pour la recherche et les mouvements de stock.

#### P4.4 — Mise à Jour
- **Avec internet :** Au démarrage, l'application interroge l'API GitHub Releases pour vérifier si une version plus récente est disponible. Si oui, notification non-intrusive avec changelog et bouton "Télécharger la mise à jour".
- **Sans internet :** Le remplacement manuel du `.exe` par la nouvelle version suffit. Puisque toutes les données vivent sur le lecteur réseau et que la configuration locale est dans un fichier `config.json` séparé, aucune migration n'est nécessaire.

---


#### Évolutions Récentes de l'UI et Scraping (Mai 2026)
- **Confirmations Inline :** Toutes les actions de suppression (PDF, Images, Produit) abandonnent les modales globales au profit de micro-composants React *inline* de confirmation (état `inlineConfirm`), conservant le focus utilisateur.
- **Saisie Rapide des Stocks :** La cellule "Stock Actuel" du tableau (Ag-Grid / DataGrid) est désormais éditable au double-clic avec calcul asynchrone du mouvement différentiel vers le backend SQLite.
- **Scraping PDF Avancé :** 
  - *Coupe-circuit :* Le moteur Rust stoppe la recherche s'il trouve les documents chez le fournisseur VPC (évitant l'appel massif à SearxNG).
  - *Nommage Contextuel :* Extraction manuelle du texte contenu dans la balise HTML `<a>` du PDF par le scraper pour nommer automatiquement les fichiers avec le libellé officiel du fournisseur (ex: "Notice de montage").
  - *Anti-Duplication :* Limite maximale absolue de 3 documents par SKU, avec déduplication agressive par "doc_type".
  - *Recherche Multi-Requêtes progressive :* Boucle intelligente dans le backend testant le code VPC, le MPN un-quoted et la marque sur SearxNG avec remplacement du domaine mobile `ma.rsdelivers.com` par `rs-online.com` pour trouver les fiches techniques réelles.

## 5. Compilation & Automatisation

Pour faciliter la génération et la distribution des binaires sur le lecteur réseau partagé sans manipulations manuelles propices aux erreurs, le projet intègre un script de build automatisé :
- **Script :** [build.ps1](file:///d:/Code%20Projects/Stockflow/build.ps1)
- **Fonctionnement :**
  1. Lance la compilation de production (`npm run tauri build`) qui compile le frontend React puis le backend Rust.
  2. Crée ou met à jour le dossier de distribution `release_bin/`.
  3. Copie et renomme automatiquement les livrables générés :
     - Binaire portable autonome -> `release_bin/StockFlow.exe`
     - Installateur NSIS -> `release_bin/StockFlow_Setup_x64.exe`
     - Installateur MSI -> `release_bin/StockFlow_x64.msi`

