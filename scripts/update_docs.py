#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

CORRECTIONS_PATH = r"d:\Code Projects\Stockflow\corrections\Corrections.md"
JOURNAL_PATH = r"d:\Code Projects\Stockflow\JOURNAL.md"
PLAN_PATH = r"d:\Code Projects\Stockflow\PLAN_AMELIORE.md"

# 1. Update Corrections.md
with open(CORRECTIONS_PATH, 'a', encoding='utf-8') as f:
    f.write("\n### [x] Feature 6 : Saisie rapide du stock\n")
    f.write("* **Description :** Intégration d'un champ 'Stock initial' lors de la création d'une fiche et rendu de la cellule 'Stock Actuel' double-cliquable dans le tableau principal pour une saisie rapide sans passer par le panneau latéral.\n")
    
    f.write("\n### [x] Feature 7 : Confirmations de suppressions intégrées (Inline)\n")
    f.write("* **Description :** Remplacement des fenêtres d'alerte globales bloquantes par des composants de confirmation discrets intégrés directement à la place du bouton supprimé (pour les images, documents, et le produit).\n")
    
    f.write("\n### [x] Feature 8 : Scraping Intelligent et Déduplication des PDF\n")
    f.write("* **Description :** Extraction du texte des liens PDF depuis les sites fournisseurs (ex: 'Fiche technique') pour un nommage pertinent. Arrêt de la recherche (coupe-circuit SearxNG) dès qu'un PDF est trouvé sur la page fournisseur. Limite stricte de conservation à 3 documents par composant et déduplication rigoureuse.\n")

print("Corrections.md mis à jour.")

# 2. Update JOURNAL.md
with open(JOURNAL_PATH, 'a', encoding='utf-8') as f:
    f.write("\n- **Saisie Rapide du Stock :**\n")
    f.write("  - Ajout du champ optionnel `initial_stock` au formulaire d'ajout (`App.tsx`), géré dynamiquement dans le backend Rust (`lib.rs`) pour générer un mouvement `STOCK_IN` lors de la création.\n")
    f.write("  - Rendu de la cellule **Stock Actuel** éditable (double-clic) dans le tableau (`DataGrid`), avec un calcul automatique et transparent de la différence entre l'ancien et le nouveau stock pour générer la transaction `STOCK_IN` ou `STOCK_OUT` associée.\n")
    
    f.write("\n- **UI/UX - Confirmations Inline :**\n")
    f.write("  - Suppression complète de la modale globale perturbante (`confirmModal`) pour les actions destructives.\n")
    f.write("  - Implémentation d'un état React local (`inlineConfirm`) permettant aux boutons 'Corbeille' et 'Supprimer' de se transformer de manière contextuelle en petits bandeaux de confirmation 'Sûr ? [Oui] [Non]'.\n")
    
    f.write("\n- **Amélioration du Moteur de Scraping PDF :**\n")
    f.write("  - **Extraction contextuelle (Rust) :** Ajout de la fonction `extract_link_text` dans `scraper.rs` qui analyse le HTML environnant pour récupérer le texte exact du lien (`<a href>Texte</a>`).\n")
    f.write("  - **Nommage Dynamique :** La fonction `detect_doc_type` a été adaptée pour lire ce texte extrait et assigner un type de document ultra-pertinent au lieu du type générique 'Datasheet'.\n")
    f.write("  - **Coupe-circuit SearxNG :** Ajout d'une condition interrompant totalement la recherche fallback sur le moteur de recherche public dès lors que la page VPC (ex: RS) a retourné au moins un PDF valide.\n")
    f.write("  - **Déduplication agressive :** Modification du seuil de tolérance PDF : maximum de 3 fichiers gardés en mémoire, et suppression des doublons sur le seul critère du type de document si la taille est similaire.\n")

print("JOURNAL.md mis à jour.")

# 3. Update PLAN_AMELIORE.md
# We will append to Section 2.2 for frontend architecture and Section 3 for Scraping engine.
with open(PLAN_PATH, 'r', encoding='utf-8') as f:
    plan_content = f.read()

# Insert after: - **Bouton d'Auto-Remplissage intelligent :** (around UI components)
# Actually, let's just append an "Update" block before Compilation & Automatisation

UPDATE_TEXT = """
#### Évolutions Récentes de l'UI et Scraping (Mai 2026)
- **Confirmations Inline :** Toutes les actions de suppression (PDF, Images, Produit) abandonnent les modales globales au profit de micro-composants React *inline* de confirmation (état `inlineConfirm`), conservant le focus utilisateur.
- **Saisie Rapide des Stocks :** La cellule "Stock Actuel" du tableau (Ag-Grid / DataGrid) est désormais éditable au double-clic avec calcul asynchrone du mouvement différentiel vers le backend SQLite.
- **Scraping PDF Avancé :** 
  - *Coupe-circuit :* Le moteur Rust stoppe la recherche s'il trouve les documents chez le fournisseur VPC (évitant l'appel massif à SearxNG).
  - *Nommage Contextuel :* Extraction manuelle du texte contenu dans la balise HTML `<a>` du PDF par le scraper pour nommer automatiquement les fichiers avec le libellé officiel du fournisseur (ex: "Notice de montage").
  - *Anti-Duplication :* Limite maximale absolue de 3 documents par SKU, avec déduplication agressive par "doc_type".

"""

plan_content = plan_content.replace("## 5. Compilation & Automatisation", UPDATE_TEXT + "## 5. Compilation & Automatisation")

with open(PLAN_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(plan_content)

print("PLAN_AMELIORE.md mis à jour.")
