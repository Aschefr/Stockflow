#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Supprime les 4 warnings de variables inutilisees dans scraper.rs"""
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

SCRAPER_PATH = r"d:\Code Projects\Stockflow\src-tauri\src\scraper.rs"

with open(SCRAPER_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

fixes = [
    # is_ma_rs : variable affectee mais jamais lue
    ('let mut is_ma_rs = false;', 'let mut _is_ma_rs = false;'),
    ('is_ma_rs = true;',          '_is_ma_rs = true;'),
    # title_lower et snippet_lower : variables inutilisees
    ('let title_lower = title.to_lowercase();',     'let _title_lower = title.to_lowercase();'),
    ('let snippet_lower = snippet.to_lowercase();', 'let _snippet_lower = snippet.to_lowercase();'),
]

changes = 0
for old, new in fixes:
    count = content.count(old)
    if count:
        content = content.replace(old, new)
        print(f"[OK] {count}x : {old!r:50s} -> {new!r}")
        changes += count
    else:
        print(f"[--] Non trouve : {old!r}")

with open(SCRAPER_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print(f"\n[OK] {changes} corrections, fichier ecrit en UTF-8 sans BOM.")
