#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import re
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

SCRAPER_PATH = r"d:\Code Projects\Stockflow\src-tauri\src\scraper.rs"

with open(SCRAPER_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# 1. Ajouter la fonction extract_link_text
EXTRACT_FN = """fn extract_link_text(html: &str, url: &str) -> String {
    if let Some(url_pos) = html.find(url) {
        if let Some(a_start) = html[..url_pos].rfind("<a ") {
            if let Some(a_end_rel) = html[url_pos..].find("</a>") {
                let a_tag_content = &html[a_start..(url_pos + a_end_rel)];
                let mut text = String::new();
                let mut in_tag = false;
                for c in a_tag_content.chars() {
                    if c == '<' { in_tag = true; }
                    else if c == '>' { in_tag = false; }
                    else if !in_tag { text.push(c); }
                }
                let clean = text.trim().replace("\\n", " ").replace("\\r", "");
                // Garder les caractères alphanumériques et espaces
                let clean: String = clean.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '-').collect();
                // S'assurer qu'il reste quelque chose et que ce n'est pas trop long
                if !clean.trim().is_empty() && clean.len() < 50 {
                    return clean.trim().to_string();
                }
            }
        }
    }
    String::new()
}"""

if "fn extract_link_text" not in content:
    # Insérer avant fn detect_doc_type
    content = content.replace("fn detect_doc_type", EXTRACT_FN + "\n\nfn detect_doc_type")
    changes += 1
    print("[OK] extract_link_text ajouté")


# 2. Modifier detect_doc_type pour accepter link_text
OLD_DETECT = """fn detect_doc_type(url: &str) -> String {
    let lower = url.to_lowercase();"""
NEW_DETECT = """fn detect_doc_type(url: &str, link_text: &str) -> String {
    let lower = url.to_lowercase();
    let text_lower = link_text.to_lowercase();
    
    // Priorité absolue au texte du lien (ex: "Fiche technique", "Manual")
    if text_lower.contains("fiche technique") || text_lower.contains("datasheet") || text_lower.contains("data sheet") {
        return "Datasheet".to_string();
    }
    if text_lower.contains("manuel") || text_lower.contains("manual") || text_lower.contains("guide") || text_lower.contains("notice") || text_lower.contains("instructions") {
        return "Manual".to_string();
    }
    if text_lower.contains("certificat") || text_lower.contains("certificate") || text_lower.contains("declaration") || text_lower.contains("rohs") {
        return "Certificate".to_string();
    }
    
    // Si pas de texte pertinent, on fallback sur l'URL"""

if OLD_DETECT in content:
    content = content.replace(OLD_DETECT, NEW_DETECT)
    changes += 1
    print("[OK] detect_doc_type modifié")


# 3. Changer candidate_links de Vec<String> à Vec<(String, String)>
OLD_VEC = "let mut candidate_links: Vec<String> = Vec::new();"
NEW_VEC = "let mut candidate_links: Vec<(String, String)> = Vec::new(); // (URL, Link Text)"

if OLD_VEC in content:
    content = content.replace(OLD_VEC, NEW_VEC)
    changes += 1
    print("[OK] candidate_links modifié")

# 4. Push dans la partie VPC (ligne 970 environ)
OLD_PUSH_VPC = """                    if url_lower.contains(".pdf") && !url_lower.contains("javascript") {
                        if !candidate_links.contains(&url_raw) {
                            candidate_links.push(url_raw);
                        }
                    }"""
NEW_PUSH_VPC = """                    if url_lower.contains(".pdf") && !url_lower.contains("javascript") {
                        if !candidate_links.iter().any(|(u, _)| u == &url_raw) {
                            let text = extract_link_text(&html, &url_raw);
                            candidate_links.push((url_raw, text));
                        }
                    }"""

if OLD_PUSH_VPC in content:
    content = content.replace(OLD_PUSH_VPC, NEW_PUSH_VPC)
    changes += 1
    print("[OK] push VPC modifié")

# 5. Push dans la partie SearxNG 1
OLD_PUSH_SX1 = """                                if ll.contains(".pdf") || ll.contains("filetype=pdf") || ll.contains("format=pdf") {
                                    candidate_links.push(link.to_string());
                                }"""
NEW_PUSH_SX1 = """                                if ll.contains(".pdf") || ll.contains("filetype=pdf") || ll.contains("format=pdf") {
                                    let title = r["title"].as_str().unwrap_or("").to_string();
                                    candidate_links.push((link.to_string(), title));
                                }"""
if OLD_PUSH_SX1 in content:
    content = content.replace(OLD_PUSH_SX1, NEW_PUSH_SX1)
    changes += 1
    print("[OK] push SearxNG 1 modifié")

# 6. Push dans la partie SearxNG 2
OLD_PUSH_SX2 = """                                    if ll.contains(".pdf") || ll.contains("filetype=pdf") {
                                        candidate_links.push(link.to_string());
                                    }"""
NEW_PUSH_SX2 = """                                    if ll.contains(".pdf") || ll.contains("filetype=pdf") {
                                        let title = r["title"].as_str().unwrap_or("").to_string();
                                        candidate_links.push((link.to_string(), title));
                                    }"""
if OLD_PUSH_SX2 in content:
    content = content.replace(OLD_PUSH_SX2, NEW_PUSH_SX2)
    changes += 1
    print("[OK] push SearxNG 2 modifié")


# 7. S'arrêter après VPC (Si le VPC a trouvé des PDF, ne pas faire SearxNG)
# La condition pour SearxNG est déjà `if candidate_links.is_empty() {` à la ligne 991, donc c'est DEJA implementé comme on veut !
# On ajoute un log pour le confirmer.
OLD_SX_START = "if candidate_links.is_empty() {"
NEW_SX_START = """if !candidate_links.is_empty() {
        let _ = window.emit("pdf-download-progress", ScrapeEventPayload {
            message: "PDFs trouvés sur la page produit (VPC). Recherche SearxNG ignorée.".to_string(),
            details: None,
        });
    }

    if candidate_links.is_empty() {"""

if OLD_SX_START in content and "Recherche SearxNG ignorée" not in content:
    content = content.replace(OLD_SX_START, NEW_SX_START, 1) # Seulement la première occurrence (ligne 991)
    changes += 1
    print("[OK] Skip SearxNG log ajouté")


# 8. Adapter la déduplication et les tris
OLD_DEDUP = "candidate_links.dedup();"
NEW_DEDUP = """candidate_links.dedup_by(|a, b| a.0 == b.0);"""
if OLD_DEDUP in content:
    content = content.replace(OLD_DEDUP, NEW_DEDUP)
    changes += 1
    print("[OK] candidate_links.dedup() corrigé")

OLD_SORT = """        candidate_links.sort_by(|a, b| {
            let a_lower = a.to_lowercase();
            let b_lower = b.to_lowercase();"""
NEW_SORT = """        candidate_links.sort_by(|a, b| {
            let a_lower = a.0.to_lowercase();
            let b_lower = b.0.to_lowercase();"""
if OLD_SORT in content:
    content = content.replace(OLD_SORT, NEW_SORT)
    changes += 1
    print("[OK] sort_by corrigé")

OLD_TAKE = "let candidates_to_try: Vec<String> = candidate_links.into_iter().take(10).collect();"
NEW_TAKE = "let candidates_to_try: Vec<(String, String)> = candidate_links.into_iter().take(10).collect();"
if OLD_TAKE in content:
    content = content.replace(OLD_TAKE, NEW_TAKE)
    changes += 1
    print("[OK] candidates_to_try type corrigé")

OLD_LOOP = "for (idx, link) in candidates_to_try.iter().enumerate() {"
NEW_LOOP = "for (idx, (link, link_text)) in candidates_to_try.iter().enumerate() {"
if OLD_LOOP in content:
    content = content.replace(OLD_LOOP, NEW_LOOP)
    changes += 1
    print("[OK] for loop link destructuration corrigée")

# 9. Appeler detect_doc_type avec link_text et réduire max à 3
OLD_DETECT_CALL = "let doc_type = detect_doc_type(link);"
NEW_DETECT_CALL = "let doc_type = detect_doc_type(link, link_text);"
if OLD_DETECT_CALL in content:
    content = content.replace(OLD_DETECT_CALL, NEW_DETECT_CALL)
    changes += 1
    print("[OK] detect_doc_type call modifié")

OLD_MAX_PDF = "if downloaded_pdfs.len() >= 5 { break; }"
NEW_MAX_PDF = "if downloaded_pdfs.len() >= 3 { break; }"
if OLD_MAX_PDF in content:
    content = content.replace(OLD_MAX_PDF, NEW_MAX_PDF)
    changes += 1
    print("[OK] Limite max PDFs passée à 3")

# 10. Déduplication par nom strict
OLD_SIZE_CLOSE = """            let size_close = p_file.doc_type == u_pdf.doc_type && max_size > 0.0 && (size_diff / max_size) < size_threshold.max(0.20);

            if perfect_size || size_close {"""

NEW_SIZE_CLOSE = """            let size_close = p_file.doc_type == u_pdf.doc_type && max_size > 0.0 && (size_diff / max_size) < size_threshold.max(0.20);
            let same_doc_type = p_file.doc_type == u_pdf.doc_type;

            // Déduplication très agressive : si c'est le même type de document (ex: Datasheet), on en garde qu'un seul, sauf si la taille diffère énormément.
            if perfect_size || size_close || same_doc_type {"""

if OLD_SIZE_CLOSE in content:
    content = content.replace(OLD_SIZE_CLOSE, NEW_SIZE_CLOSE)
    changes += 1
    print("[OK] Déduplication agressive par type ajoutée")

with open(SCRAPER_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print(f"Modifications effectuées : {changes}")
