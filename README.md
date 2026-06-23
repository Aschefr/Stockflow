# 📈 StockFlow (v1.4.3)

**StockFlow** est un outil intelligent de gestion d'inventaire industriel conçu pour fonctionner simplement dans les environnements d'entreprise sous Windows.

L'application est **100% portable** (elle ne nécessite aucune installation ni aucun droit d'administrateur pour s'exécuter) et fonctionne de manière **autonome sur dossier réseau partagé** : il n'y a pas de serveur central complexe à administrer. L'ensemble des données et des fichiers est partagé via un simple dossier réseau partagé (comme un lecteur réseau `Z:\` ou un dossier partagé SMB).

---

## 🚀 Prise en Main Rapide

### 1. Téléchargement et Lancement
1. Rendez-vous dans la section **Releases** de ce dépôt et téléchargez la version la plus récente de `StockFlow.exe`.
2. Lancez le fichier `StockFlow.exe` par double-clic.

> [!TIP]
> **Éviter le blocage Windows SmartScreen :** 
> Comme l'exécutable n'est pas signé numériquement, Windows peut afficher une alerte de sécurité. Pour l'éviter, déposez le fichier `StockFlow.exe` **directement sur votre lecteur réseau partagé** et lancez-le depuis ce lecteur. Sinon, faites un clic droit sur le fichier local -> **Propriétés** -> cochez la case **"Débloquer"** en bas de la fenêtre -> **Appliquer**.

### 2. Configuration Initiale (Premier Lancement)
Au premier lancement de l'application sur votre poste, deux éléments vous seront demandés :
- **Sélection du dossier réseau partagé** : Localisez graphiquement le dossier sur le réseau (ex: `Z:\Stockflow_Data`). C'est dans ce dossier que seront créées les bases de données d'inventaire, les images et les documentations techniques.
- **Trigramme de poste** : Saisissez vos initiales ou votre identifiant de poste (ex: `JDO`). Ce trigramme servira à signer tous les mouvements de stock et modifications de fiches que vous effectuerez.

---

## 📋 Fonctionnalités Clés

### 📊 Tableau de Bord Interactif
Dès l'ouverture, accédez aux indicateurs clés de votre parc de pièces :
- Nombre total de références et valeur financière totale estimée de votre stock.
- Nombre d'articles sous le seuil d'alerte et en rupture totale de stock.
- **Double colonne d'activité** : Visualisez côte à côte les derniers mouvements de stock physiques et les dernières modifications de caractéristiques faites par vos collègues dans des listes défilables en temps réel.

### 📋 Grille d'Inventaire Type Tableur
Gérez vos pièces dans un tableau dense et rapide :
- **Recherche instantanée** : Filtrez sur n'importe quel terme (marque, SKU, désignation, référence constructeur).
- **Filtrage précis** : Naviguez dans vos pièces par Famille et Sous-Famille.
- **Édition directe (Inline)** : Modifiez les informations à la volée en double-cliquant directement sur les cellules (comme dans Excel). Double-cliquez sur "Stock Actuel" pour saisir instantanément un mouvement de stock.
- **Disposition personnalisable** : Masquez, affichez ou réordonnez vos colonnes comme vous le souhaitez. Ajustez la largeur de vos colonnes par glisser-déposer, ou double-cliquez sur la poignée de séparation pour ajuster automatiquement la colonne à la largeur du texte le plus long.

### 🔍 Enrichissement Automatique par Scraping
Ne perdez plus de temps à remplir vos fiches produits manuellement :
- **Fiches techniques et notices PDF** : StockFlow recherche automatiquement les documentations techniques des constructeurs (ex: Siemens, Schneider, Phoenix Contact), les télécharge et les organise proprement dans le dossier réseau partagé.
- **Photos et illustrations** : L'outil cherche les images du produit et les intègre sous forme de carrousel photo interactif.
- **Tarifs et conditionnements** : Récupération des prix réels en euros et des tailles de lot (pack) directement depuis les sites de VPC (RS France, Conrad, etc.).
- **Traitement par lot** : Cochez plusieurs lignes dans l'inventaire pour lancer un scraping d'images ou de PDF groupé en arrière-plan.

### 📦 Projets & Nomenclatures (BOM)
Préparez vos chantiers et vos assemblages industriels :
- Créez des listes de matériel (BOM) pour vos projets (ex: "Armoire Électrique Tapis 2").
- Visualisez immédiatement l'état de votre stock par rapport aux besoins du projet (les pièces manquantes s'affichent en rouge).
- **Exportation Commande Achat** : Générez en un clic un fichier Excel formaté de manière professionnelle (avec quadrillage et largeurs adaptées) trié par fournisseur pour passer vos commandes de réapprovisionnement.
- **Impression de Fiche picking** : Imprimez un document PDF contenant les images des pièces, les références et leurs emplacements physiques exacts dans l'atelier pour optimiser la collecte physique de vos techniciens.

---

## 🛠️ Comment ça fonctionne ? (Event-Sourcing)

StockFlow a été conçu pour éliminer les problèmes classiques de corruption de base de données (comme avec Access ou SQLite) lorsqu'ils sont partagés en réseau local :

1. **Aucun Conflit d'Accès** : Plutôt que de modifier une base de données centrale commune, chaque action (un retrait de stock, une modification de désignation) écrit un petit fichier JSON individuel et immuable sur le réseau (ex : `20260530T143000_JDO_STOCK_OUT_6ES7...json`).
2. **Synchronisation Automatique** : StockFlow surveille le dossier réseau toutes les 4 secondes. Lorsqu'un nouveau fichier JSON écrit par un de vos collègues apparaît, l'application met à jour instantanément votre tableau local en arrière-plan.
3. **Résilience Réseau** : Si la connexion avec le lecteur réseau partagé est coupée, l'application reste active en mode consultation. Les actions que vous effectuez hors-ligne sont mémorisées localement et automatiquement envoyées sur le réseau dès le retour de la connexion.

---

*Pour en savoir plus sur la compilation, l'installation ou la contribution au code de l'application, veuillez consulter le [Guide de Développement](file:///d:/Code%20Projects/Stockflow/DEVELOPER.md).*

---

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.
