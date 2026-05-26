# StockFlow - Plan de Projet (v1.4.0)

**StockFlow** est un système intelligent de gestion d'inventaire industriel conçu pour fonctionner dans un environnement Windows restreint (sans installation, sans droits administrateur, sans ports réseau ouverts). Il repose sur une architecture "Serverless" utilisant un lecteur réseau partagé comme unique vecteur de communication.

---

## 1. Informations Projet

| Propriété | Valeur |
|---|---|
| **Nom** | StockFlow |
| **Version** | 1.4.0 |
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
- Au premier lancement, l'interface invite l'utilisateur à **localiser le dossier réseau partagé** (ex: `Z:\Stockflow_Data`) qui contient ou contiendra les données de l'application.
- L'application demande également d'entrer un **Nom de Poste ou Trigramme** (ex: `MAGASIN_01` ou `JDO`). Sans comptes, c'est ce nom qui sera utilisé pour signer les mouvements dans la traçabilité.
- L'application crée automatiquement la structure de sous-dossiers si elle n'existe pas (Dossiers `Events`, `Images`, `Documents`).
- Ces paramètres sont sauvegardés localement sur le PC (fichier `config.json`).

#### [IN PROGRESS] P1.2 — Outil de Migration (Importation CSV & Médias)
> Transition depuis l'ancien système Excel vers le nouveau moteur.
- Module spécifique au premier lancement pour importer le fichier historique `data to import exemple.csv`.
- Nettoyage à la volée : Ignorer les lignes d'en-tête (métadonnées Excel), mapper les colonnes (Quantité, Référence, Description, Attributs dynamiques).
- Conversion automatique : Chaque ligne du CSV génère le premier événement JSON ("Stock Initial") de l'article sur le lecteur réseau.
- **Migration des fichiers :** L'outil demandera le dossier local actuel contenant les images/PDF et les copiera intelligemment vers le nouveau dossier réseau (`Z:\Stockflow_Data\Media\`) en les renommant selon le format standard de l'application.

#### [DONE] P1.3 — Gestion du Référentiel Produits
- **Champs de base :** Référence fabricant (MPN), Référence interne (SKU), Description, Marque, Catégorie/Sous-catégorie.
- **Attributs Techniques :** Propriétés dynamiques (Tension, Dimensions, Puissance, etc.).
- **Localisation Physique :** Gestion hiérarchique stricte (Dépôt → Allée → Étagère → Bac) pour éviter les pertes de temps en magasin.
- **Typologie d'Article :** Séparation claire entre les articles **Sérialisés** (suivi unitaire par S/N) et les articles en **Vrac/Consommable** (suivi purement quantitatif).
- **Détection de Doublons :** À la saisie d'une nouvelle référence, l'application vérifie en temps réel si elle existe déjà et propose de charger la fiche existante pour la modifier plutôt que de créer un doublon.

#### [DONE] P1.4 — Moteur Event-Sourcing & Mouvements de Stock
- **Génération d'événements :** Chaque mouvement génère un fichier JSON nommé explicitement avec le SKU du produit (ex: `20260525T143000Z_JDO_STOCK_OUT_6ES7507-0RA00-0AB0_c7b3.json`) sur le réseau.
- **Cache Local & Performances (Critique) :** L'application maintient un cache local (ex: base SQLite locale sur le PC). Au démarrage, elle ne synchronise que les *nouveaux* fichiers JSON apparus depuis sa dernière session.
- **Synchronisation Temps-Réel :** Un processus en arrière-plan surveille le dossier réseau (polling périodique toutes les 3-5 secondes). Les changements détectés (nouveaux événements créés par d'autres postes) sont intégrés au cache local et l'interface se met à jour dynamiquement sans aucune action de l'utilisateur.
- **Résilience Réseau (Mode Hors-Ligne) :** Si le lecteur réseau se déconnecte, l'application affiche une bannière "Hors-Ligne". Elle permet la consultation du stock en cache, mais met en attente (file locale) les nouvelles écritures jusqu'au retour de la connexion.
- **Seuils d'Alerte (Reorder Point) :** Définition d'un stock minimum avec notification locale.
- **Auditing / Traçabilité (Natif) :** Le système de fichiers JSON sert de journal immuable (Qui=Trigramme, Quoi, Quand).

#### [TODO] P1.5 — Stockage Document & Images sur Réseau
- Les fichiers (PDF de fiches techniques, Images de produits) sont téléversés directement dans l'arborescence du lecteur réseau désigné à l'étape P1.1.
- L'application portable les affiche en les lisant via le système de fichiers Windows.
- **UX Améliorée :** Affichage d'un aperçu miniature de l'image au simple survol de la souris (Hover) sur une référence dans les listes.

#### [DONE] P1.6 — Tableau de Bord (Dashboard)
- Écran d'accueil synthétique affichant en un coup d'œil : nombre total de références, valeur estimée du stock, nombre d'articles sous le seuil d'alerte, derniers mouvements enregistrés.
- Mise à jour dynamique au même rythme que la synchronisation réseau.

---

### Phase 2 — Intelligence & Connectivité 🔶 High Priority

**Objectif :** Automatiser l'enrichissement des fiches produits via internet, directement depuis les postes clients.

#### P2.1 — Recherche Intégrée (SearxNG)
- Interrogation d'une instance SearxNG depuis le PC de l'utilisateur pour trouver les fiches techniques.
- Extraction asynchrone des URLs de PDF, téléchargement automatique et dépôt sur le lecteur réseau partagé.

#### P2.2 — Scraping des Prix & Anti-Redondance
- Veille tarifaire en tâche de fond (ex: RS Components).
- **Contrôle de concurrence :** Pour éviter que plusieurs postes ne lancent le scraping du même produit en même temps, vérification d'un fichier `last_scrape_lock.json`. L'information mise à jour est ensuite publiée comme un événement JSON.
- **Résilience aux Crashs (Locks fantômes) :** Si un poste plante pendant un scraping, le fichier lock reste sur le réseau. L'application détectera un verrou anormalement long (> 5 minutes), affichera un avertissement visuel, et permettra à l'utilisateur de "Forcer le déverrouillage" d'un simple clic pour reprendre la main.

#### P2.3 — Gestion Dépôts vs Fournisseurs
- Distinction sémantique et logique entre les **Dépôts Physiques** internes (Usine, Atelier) et les **Fournisseurs / VPC** externes.
- Liaison des codes catalogues (ex: Code RS) avec les fiches fournisseurs pour faciliter les achats.

#### P2.4 — Scraping Images Automatique
- Téléchargement et standardisation automatique des illustrations produits (`[SKU]_[Source]_[Date].jpg`).
- Génération de miniatures gérée localement par le PC client avant l'écriture réseau pour des performances d'affichage optimales.

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
