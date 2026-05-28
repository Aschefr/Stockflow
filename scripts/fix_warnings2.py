#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Revert le prefixe _ sur title_lower et snippet_lower (ils sont utilises plus bas dans la boucle)."""
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

SCRAPER_PATH = r"d:\Code Projects\Stockflow\src-tauri\src\scraper.rs"

with open(SCRAPER_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# Revert uniquement title_lower et snippet_lower (ils sont utilises dans un if plus bas)
# is_ma_rs est vraiment inutilise, on garde le _
fixes = [
    ('let _title_lower = title.to_lowercase();',     'let title_lower = title.to_lowercase();'),
    ('let _snippet_lower = snippet.to_lowercase();', 'let snippet_lower = snippet.to_lowercase();'),
]

changes = 0
for old, new in fixes:
    count = content.count(old)
    if count:
        content = content.replace(old, new)
        print(f"[OK] {count}x revert : {old!r}")
        changes += count

# Supprimer les avertissements en ajoutant #[allow(unused_assignments)] sur is_ma_rs
# ou simplement laisser le _ sur is_ma_rs car il est vraiment inutilise
# Verifier si _is_ma_rs est bien le seul warning restant
print(f"\n{changes} reverts effectues.")

with open(SCRAPER_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print("[OK] Fichier ecrit.")
