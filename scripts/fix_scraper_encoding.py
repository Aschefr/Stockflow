#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Correcteur complet pour scraper.rs :
  1. Correction de l'encodage (PowerShell a ecrit en latin-1 au lieu d'UTF-8)
  2. Query SearxNG PDF generaliste (pas orientee datasheet filetype:pdf)
  3. Pas de suppression des fichiers existants (images/docs)
"""
import sys
import re

# Forcer stdout en UTF-8 pour eviter les erreurs de print
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

SCRAPER_PATH = r"d:\Code Projects\Stockflow\src-tauri\src\scraper.rs"

print("=== Lecture du fichier ===")
with open(SCRAPER_PATH, 'rb') as f:
    raw = f.read()

# Enlever le BOM UTF-8 s'il est present
if raw[:3] == b'\xef\xbb\xbf':
    raw = raw[3:]
    print("BOM UTF-8 supprime.")

# Methode : decoder en latin-1, re-encoder en latin-1 pour recuperer les bytes UTF-8
# PowerShell Get-Content lit en cp1252, Set-Content -Encoding UTF8 ecrit chaque
# octet comme s'il etait un char. On inverse la transformation.
try:
    content_latin1 = raw.decode('latin-1')
    recovered_bytes = content_latin1.encode('latin-1')
    content = recovered_bytes.decode('utf-8')
    print("[OK] Encodage recupere : latin-1 -> UTF-8")
except (UnicodeDecodeError, UnicodeEncodeError) as e:
    print(f"Methode 1 echouee ({e}), essai direct UTF-8...")
    try:
        content = raw.decode('utf-8')
        print("[OK] Fichier deja en UTF-8 valide.")
    except UnicodeDecodeError:
        content = raw.decode('latin-1')
        print("[OK] Decode en latin-1 (fallback).")

# Verification post-correction
corruption_count = content.count('Ã')
print(f"Occurrences de 'A~' corrompues apres recuperation : {corruption_count}")
if corruption_count > 0:
    # Remplacement manuel des sequences corrompues les plus courantes
    replacements = [
        ('Ã©', 'é'), ('Ã¨', 'è'), ('Ã ', 'à'), ('Ãª', 'ê'), ('Ã®', 'î'),
        ('Ã´', 'ô'), ('Ã»', 'û'), ('Ã§', 'ç'), ('Ã«', 'ë'), ('Ã¯', 'ï'),
        ('Ã¹', 'ù'), ('Ã¢', 'â'), ('Ã¦', 'æ'), ('Å\x93', 'œ'), ('Ã\x89', 'É'),
        ('Ã\x87', 'Ç'), ('Ã\x80', 'À'), ('Ã\x82', 'Â'), ('Ã\x88', 'È'),
        ('Ã\x8a', 'Ê'), ('Ã\x8b', 'Ë'), ('â€™', "'"), ('â€œ', '"'),
        ('â€\x9d', '"'), ('â€"', '—'), ('â€"', '–'), ('â‰¥', '>='),
        ('â‰¤', '<='), ('â"€', '-'), ('â"‚', '|'),
    ]
    for bad, good in replacements:
        content = content.replace(bad, good)
    after = content.count('Ã')
    print(f"Apres remplacement manuel : {after} occurrences restantes")


# === CORRECTION 1 : Query SearxNG PDF generaliste ===
print("\n=== Correction 1 : Query PDF generaliste ===")

OLD_MARKERS = [
    '/// Construit une query SearxNG enrichie pour les PDFs.',
    '/// Construit une query SearxNG pour trouver des documents techniques.',
    '/// Construit une query SearxNG generaliste pour trouver',
]

NEW_PDF_QUERY_FN = r'''/// Construit une query SearxNG pour trouver des documents techniques (PDF).
/// La recherche est generaliste : on cherche le produit (MPN + marque), puis on filtre
/// les liens PDF dans les resultats (datasheets, manuels, notes de calcul, fiches...).
/// Pour les sites VPC, la page produit est scrapee directement sans passer par cette query.
fn build_searxng_query_pdf(mpn: &str, brand: &str, label: &str, domain_hint: Option<&str>) -> String {
    let mut parts: Vec<String> = Vec::new();
    // MPN entre guillemets pour correspondance exacte
    if !mpn.trim().is_empty() {
        parts.push(format!("\"{}\"", mpn.trim()));
    }
    if !brand.trim().is_empty() && brand != "INCONNU" {
        parts.push(brand.trim().to_string());
    }
    // Premiers mots du label pour contextualiser
    if !label.trim().is_empty() {
        let words: Vec<&str> = label.split_whitespace().take(4).collect();
        if !words.is_empty() {
            parts.push(words.join(" "));
        }
    }
    // PAS de "datasheet filetype:pdf" dans la query : la recherche est generaliste.
    // Le filtrage sur les liens PDF se fait dans les resultats (voir ci-apres).
    let base = parts.join(" ");
    if let Some(domain) = domain_hint {
        let clean_domain = domain
            .replace("https://", "")
            .replace("http://", "")
            .trim_end_matches('/')
            .to_string();
        format!("site:{} {}", clean_domain, base)
    } else {
        base
    }
}'''

fn_start_pos = None
for marker in OLD_MARKERS:
    pos = content.find(marker)
    if pos != -1:
        fn_start_pos = pos
        print(f"  Fonction trouvee avec marqueur: '{marker[:60]}'")
        break

if fn_start_pos is not None:
    # Trouver la fin de la fonction (accolade fermante au niveau 0)
    fn_brace_start = content.find('{', content.find('fn build_searxng_query_pdf(', fn_start_pos))
    depth = 0
    fn_end = fn_brace_start
    i = fn_brace_start
    while i < len(content):
        if content[i] == '{':
            depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                fn_end = i + 1
                break
        i += 1
    content = content[:fn_start_pos] + NEW_PDF_QUERY_FN + '\n' + content[fn_end:]
    print("[OK] build_searxng_query_pdf remplacee par version generaliste.")
else:
    print("[WARN] Fonction build_searxng_query_pdf non trouvee.")

# Supprimer les residus de "datasheet filetype:pdf" dans les queries
if 'datasheet filetype:pdf' in content:
    content = content.replace(
        'parts.push("datasheet filetype:pdf".to_string());',
        '// Pas de filtre oriente dans la query - filtrage dans les resultats.'
    )
    print("[OK] Residus 'datasheet filetype:pdf' supprimes.")


# === CORRECTION 2 : Verifier pas de suppression de fichiers existants ===
print("\n=== Correction 2 : Suppression fichiers existants ===")

# Supprimer le bloc "Supprimer les fichiers locaux ecrases"
pattern = r'[ \t]*// Supprimer les fichiers locaux[^\n]*\n[ \t]*for file_to_delete in local_files_to_remove \{[^}]*\}[ \t]*\n'
new_content, count = re.subn(pattern, '', content, flags=re.DOTALL)
if count:
    content = new_content
    print(f"[OK] Supprime {count} bloc(s) de suppression de fichiers existants.")
else:
    # Recherche plus large
    if 'local_files_to_remove' in content:
        lines = content.split('\n')
        to_remove = []
        in_delete_block = False
        for i, line in enumerate(lines):
            if '// Supprimer les fichiers locaux' in line:
                in_delete_block = True
            if in_delete_block:
                to_remove.append(i)
                if line.strip() == '}' and len(to_remove) > 1:
                    break
        if to_remove:
            for idx in reversed(to_remove):
                lines.pop(idx)
            content = '\n'.join(lines)
            print(f"[OK] Supprime {len(to_remove)} lignes de suppression via scan ligne par ligne.")
    else:
        print("[OK] Aucune suppression de fichiers detectee (correct).")

# Verifier les remove_file restants dans scrape_pdf/scrape_images
lines = content.split('\n')
remove_lines = [(i+1, l) for i, l in enumerate(lines) if 'remove_file' in l and 'lock' not in l.lower()]
if remove_lines:
    print(f"[WARN] remove_file encore present :")
    for ln, l in remove_lines:
        print(f"   L{ln}: {l.strip()}")
else:
    print("[OK] Aucun remove_file dans les fonctions de scraping.")


# === ECRITURE FINALE en UTF-8 sans BOM ===
print("\n=== Ecriture finale ===")
with open(SCRAPER_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
print(f"[OK] Fichier ecrit en UTF-8 sans BOM : {SCRAPER_PATH}")

# Verification BOM
with open(SCRAPER_PATH, 'rb') as f:
    first4 = f.read(4)
if first4[:3] == b'\xef\xbb\xbf':
    print("[ERREUR] BOM UTF-8 present !")
else:
    print(f"[OK] Pas de BOM. Premiers octets: {first4.hex()}")

# Verification corruption residuelle
with open(SCRAPER_PATH, 'r', encoding='utf-8') as f:
    final = f.read()
remaining = final.count('Ã')
print(f"\nCorruption residuelle 'A~' : {remaining}")
if remaining > 0:
    for i, line in enumerate(final.split('\n')):
        if 'Ã' in line:
            print(f"  L{i+1}: {line[:120]}")

total_lines = len(final.split('\n'))
print(f"\nFichier final : {total_lines} lignes, {len(final)} chars")
print("\n=== TERMINE ===")
