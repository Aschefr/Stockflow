#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Corrige le second reset de newProduct qui manque le champ initial_stock."""
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

APP_PATH = r"d:\Code Projects\Stockflow\src\App.tsx"

with open(APP_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# Il y a un second setNewProduct({...}) sans initial_stock dans le bouton reset du modal
# On cherche TOUS les endroits où poids: "" termine un setNewProduct sans initial_stock

OLD = '''                      poids: ""
                    });'''
NEW = '''                      poids: "",
                      initial_stock: "0"
                    });'''

count = content.count(OLD)
print(f"Occurrences de poids sans initial_stock: {count}")
if count:
    content = content.replace(OLD, NEW)
    print(f"[OK] {count} reset(s) corrigés")

with open(APP_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print("[OK] Fichier écrit.")
print("=== TERMINÉ ===")
