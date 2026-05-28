#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

PATH = r"C:\Users\Adminlocal\.gemini\antigravity-ide\brain\6ba68494-4a2f-424e-88f5-b6563470049b\task.md"

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

task = """
## Améliorations UI & Scraping (Nouveau Plan)
- `[ ]` Ajouter les confirmations inline pour la suppression (Images, Produits, PDFs)
- `[ ]` Scraper VPC : parser les liens <a> pour extraire le nom du document
- `[ ]` Scraper PDF : S'arrêter après le VPC si des PDFs sont trouvés (ne pas lancer SearxNG)
- `[ ]` Scraper PDF : Dédupliquer agressivement pour garder max 3 documents
"""

content = content.replace("## Validation", task + "\n## Validation")

with open(PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print("Tasks updated.")
