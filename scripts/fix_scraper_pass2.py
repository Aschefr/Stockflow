#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Seconde passe : corriger les caracteres restants, notamment E majuscule et a grave."""
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

SCRAPER_PATH = r"d:\Code Projects\Stockflow\src-tauri\src\scraper.rs"

with open(SCRAPER_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Avant passe 2 : {content.count(chr(0xc3))} bytes 0xC3 restants")

changes = 0

# Table de correspondances explicite pour chaque sequence restante
# On travaille sur les bytes unicode directement pour etre precis
fixes = [
    # E majuscule accent aigu (Ã‰ = C3 89 en UTF-8 mal lu)
    ('\u00c3\u2030tape',    '\u00c9tape'),   # Ã‰tape -> Étape (‰ = 0x89 en windows-1252)
    ('\u00c3\u2030chec',    '\u00c9chec'),   # Ã‰chec -> Échec
    # Formes avec le vrai byte 0x89
    ('\u00c3\x89tape',      '\u00c9tape'),   # alternative
    ('\u00c3\x89chec',      '\u00c9chec'),
    # A grave (Ã  = C3 A0)
    ('\u00c3 ',             '\u00e0 '),      # "Ã " -> "à "
    ("\u00c3\xa0",          '\u00e0'),       # Ã\xa0 -> à
    # Sequences specifiques identifiees
    ("jusqu'\u00c3 ",       "jusqu'\u00e0 "),
    (" \u00c3 ",            " \u00e0 "),
    ("1 \u00c3 ",           "1 \u00e0 "),
    ("Mettre \u00c3 ",      "Mettre \u00e0 "),
    ("d\u00e9j\u00c3 ",     "d\u00e9j\u00e0 "),
]

for bad, good in fixes:
    c = content.count(bad)
    if c:
        content = content.replace(bad, good)
        print(f"  Remplace {c}x: {repr(bad)} -> {repr(good)}")
        changes += c

# Scan ligne par ligne pour les residus avec "Etape" et "Echec"
lines = content.split('\n')
new_lines = []
for i, line in enumerate(lines):
    orig = line
    # Ã‰ en contexte Windows-1252 peut apparaitre comme plusieurs chars differents
    # selon ce qui a ete lu. On scanne les patterns visuels.
    for seq, repl in [
        ('\u00c3\u201atape',  '\u00c9tape'),   # Ã‚tape variante
        ('\u00c3\u0089tape',  '\u00c9tape'),
        ('\u00c3\u0089chec',  '\u00c9chec'),
    ]:
        if seq in line:
            line = line.replace(seq, repl)
    if line != orig:
        print(f"  L{i+1} corrigee: {orig[:80]} -> {line[:80]}")
        changes += 1
    new_lines.append(line)

content = '\n'.join(new_lines)

# Verification finale
remaining = 0
for i, line in enumerate(content.split('\n')):
    if '\u00c3' in line:
        remaining += 1
        print(f"  RESTANT L{i+1}: {line[:120]}")

print(f"\nApres passe 2 : {remaining} lignes avec 0xC3 residuel, {changes} corrections.")

# Ecriture
with open(SCRAPER_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print(f"[OK] Fichier mis a jour.")

# Verification directe sur les messages utilisateur (ceux affichés dans l'UI)
targets = ['Etape 1', 'Etape 2', 'Etape 3', 'Echec', 'deja', 'jusqu']
for t in targets:
    count = content.count(t)
    etarget = '\u00c9' + t[1:] if t[0] == 'E' else t.replace('deja', 'd\u00e9j\u00e0').replace('jusqu', "jusqu'\u00e0")
    count_accented = content.count(etarget)
    print(f"  '{t}' non-accentue: {count}x | '{etarget}' accentue: {count_accented}x")

print("\n=== PASSE 2 TERMINEE ===")
