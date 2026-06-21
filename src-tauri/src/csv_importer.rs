use std::path::Path;
use std::fs;
use serde_json::json;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImportReport {
    pub success: usize,
    pub missing_files: usize,
    pub errors: Vec<String>,
}

pub fn decode_win1252(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| {
        if b < 128 {
            b as char
        } else {
            match b {
                128 => '€', 130 => '‚', 131 => 'ƒ', 132 => '„', 133 => '…', 134 => '†', 135 => '‡',
                136 => 'ˆ', 137 => '‰', 138 => 'Š', 139 => '‹', 140 => 'Œ', 142 => 'Ž', 145 => '‘',
                146 => '’', 147 => '“', 148 => '”', 149 => '•', 150 => '–', 151 => '—', 152 => '˜',
                153 => '™', 154 => 'š', 155 => '›', 156 => 'œ', 158 => 'ž', 159 => 'Ÿ', 160 => ' ',
                161 => '¡', 162 => '¢', 163 => '£', 164 => '¤', 165 => '¥', 166 => '¦', 167 => '§',
                168 => '¨', 169 => '©', 170 => 'ª', 171 => '«', 172 => '¬', 173 => '\u{AD}', 174 => '®',
                175 => '¯', 176 => '°', 177 => '±', 178 => '²', 179 => '³', 180 => '´', 181 => 'µ',
                182 => '¶', 183 => '·', 184 => '¸', 185 => '¹', 186 => 'º', 187 => '»', 188 => '¼',
                189 => '½', 190 => '¾', 191 => '¿', 192 => 'À', 193 => 'Á', 194 => 'Â', 195 => 'Ã',
                196 => 'Ä', 197 => 'Å', 198 => 'Æ', 199 => 'Ç', 200 => 'È', 201 => 'É', 202 => 'Ê',
                203 => 'Ë', 204 => 'Ì', 205 => 'Í', 206 => 'Î', 207 => 'Ï', 208 => 'Ð', 209 => 'Ñ',
                210 => 'Ò', 211 => 'Ó', 212 => 'Ô', 213 => 'Õ', 214 => 'Ö', 215 => '×', 216 => 'Ø',
                217 => 'Ù', 218 => 'Ú', 219 => 'Û', 220 => 'Ü', 221 => 'Ý', 222 => 'Þ', 223 => 'ß',
                224 => 'à', 225 => 'á', 226 => 'â', 227 => 'ã', 228 => 'ä', 229 => 'å', 230 => 'æ',
                231 => 'ç', 232 => 'è', 233 => 'é', 234 => 'ê', 235 => 'ë', 236 => 'ì', 237 => 'í',
                238 => 'î', 239 => 'ï', 240 => 'ð', 241 => 'ñ', 242 => 'ò', 243 => 'ó', 244 => 'ô',
                245 => 'õ', 246 => 'ö', 247 => '÷', 248 => 'ø', 249 => 'ù', 250 => 'ú', 251 => 'û',
                252 => 'ü', 253 => 'ý', 254 => 'þ', 255 => 'ÿ',
                _ => '?',
            }
        }
    }).collect()
}

pub fn import_csv_file(
    csv_path: &str,
    network_path: &str,
    trigramme: &str,
    images_dir: Option<&str>,
    pdf_dir: Option<&str>
) -> Result<ImportReport, String> {
    let bytes = fs::read(csv_path)
        .map_err(|e| format!("Impossible de lire le fichier CSV : {}", e))?;

    let content_utf8 = decode_win1252(&bytes);
    let mut lines = content_utf8.lines();

    // Sauter les 8 premières lignes d'en-têtes Excel
    for _ in 0..8 {
        lines.next();
    }

    let mut report = ImportReport {
        success: 0,
        missing_files: 0,
        errors: Vec::new(),
    };

    let db_path = super::events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split(';').collect();
        // S'assurer qu'on a le nombre de colonnes minimum (au moins Qte, Ref, Description)
        if parts.len() < 3 {
            continue;
        }

        let qte_str = parts[0].trim();
        let ref_str = parts[1].trim();
        let desc_str = parts[2].trim();

        if ref_str.is_empty() || desc_str.is_empty() {
            continue;
        }

        // Nettoyer la référence pour le SKU
        let sku = super::db::sanitize_sku(ref_str);

        // Récupérer le produit s'il existe déjà
        let existing: Option<super::db::Product> = conn.query_row(
            "SELECT sku, mpn, label, brand, category, sub_category, location, item_type, min_stock, price, current_stock, reserved_stock, attributes, image_path, pdf_path, pack_size FROM products WHERE sku = ?",
            [&sku],
            |row| Ok(super::db::Product {
                sku: row.get(0)?,
                mpn: row.get(1)?,
                label: row.get(2)?,
                brand: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                category: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                sub_category: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                location: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                item_type: row.get(7)?,
                min_stock: row.get(8)?,
                price: row.get(9)?,
                current_stock: row.get(10)?,
                reserved_stock: row.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
                attributes: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                image_path: row.get(13)?,
                pdf_path: row.get(14)?,
                pack_size: row.get::<_, Option<i64>>(15)?.unwrap_or(1),
            })
        ).ok();

        let famille = parts.get(3).copied().unwrap_or("").trim().to_string();
        let sous_famille = parts.get(4).copied().unwrap_or("").trim().to_string();
        let emplacement = parts.get(5).copied().unwrap_or("").trim().to_string();
        let marque = parts.get(7).copied().unwrap_or("").trim().to_string();
        
        let tension = parts.get(8).copied().unwrap_or("").trim().to_string();
        let notes = parts.get(9).copied().unwrap_or("").trim().to_string();
        let largeur = parts.get(10).copied().unwrap_or("").trim().to_string();
        let hauteur = parts.get(11).copied().unwrap_or("").trim().to_string();
        let profondeur = parts.get(12).copied().unwrap_or("").trim().to_string();
        let poids = parts.get(13).copied().unwrap_or("").trim().to_string();
        let code_rs = parts.get(14).copied().unwrap_or("").trim().to_string();
        
        let raw_prix = parts.get(15).copied().unwrap_or("0").trim();
        let prix_str = raw_prix.replace(",", ".");
        let prix_clean: String = prix_str.chars()
            .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
            .collect();
        let prix: f64 = prix_clean.parse().unwrap_or(0.0);
        let qte: f64 = qte_str.replace(",", ".").parse().unwrap_or(0.0);

        // Récupérer les chemins relatifs des images/PDF s'ils existent dans les colonnes 23 et 24 (index 23 et 24)
        let raw_pdf = parts.get(23).copied().unwrap_or("").trim();
        let raw_img = parts.get(24).copied().unwrap_or("").trim();

        let mut image_path = existing.as_ref().and_then(|p| p.image_path.clone());
        let mut pdf_path = existing.as_ref().and_then(|p| p.pdf_path.clone());

        // Copie physique des fichiers médias
        if raw_img.is_empty() {
            image_path = None;
        } else if let Some(src_images) = images_dir {
            let src_media_path = Path::new(src_images);
            let src_img_file = resolve_source_path(src_media_path, raw_img);
            if src_img_file.exists() {
                let ext = src_img_file.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
                let net_img_name = format!("{}_1.{}", sku.to_uppercase(), ext);
                let dest_img_path = Path::new(network_path).join("images").join(&net_img_name);
                match fs::copy(&src_img_file, &dest_img_path) {
                    Ok(_) => {
                        image_path = Some(format!("images/{}", net_img_name));
                    }
                    Err(e) => {
                        report.errors.push(format!("Échec copie image pour {} : {}", sku, e));
                    }
                }
            } else if image_path.is_none() {
                report.missing_files += 1;
            }
        }

        if raw_pdf.is_empty() {
            pdf_path = None;
        } else if let Some(src_pdfs) = pdf_dir {
            let src_pdf_path = Path::new(src_pdfs);
            let src_pdf_file = resolve_source_path(src_pdf_path, raw_pdf);
            if src_pdf_file.exists() {
                let clean_brand = sanitize_folder_name(&marque, "INCONNUE");
                let clean_cat = sanitize_folder_name(&famille, "SANS_FAMILLE");
                let clean_subcat = sanitize_folder_name(&sous_famille, "SANS_SOUS_FAMILLE");

                let dest_pdf_dir = Path::new(network_path)
                    .join("documents")
                    .join(&clean_brand)
                    .join(&clean_cat)
                    .join(&clean_subcat)
                    .join(&sku);

                let _ = fs::create_dir_all(&dest_pdf_dir); // S'assurer que le sous-dossier existe
                
                if src_pdf_file.is_dir() {
                    let mut success_copy = false;
                    if let Ok(entries) = fs::read_dir(&src_pdf_file) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.is_file() {
                                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                                    let dest_path = dest_pdf_dir.join(file_name);
                                    if fs::copy(&path, &dest_path).is_ok() {
                                        success_copy = true;
                                    }
                                }
                            }
                        }
                    }
                    if success_copy {
                        pdf_path = Some(format!("documents/{}/{}/{}/{}", clean_brand, clean_cat, clean_subcat, sku));
                    } else {
                        report.errors.push(format!("Aucun fichier PDF copié depuis le dossier pour {}", sku));
                    }
                } else {
                    let file_name = src_pdf_file.file_name().and_then(|n| n.to_str()).unwrap_or("manuel.pdf");
                    let dest_pdf_path = dest_pdf_dir.join(file_name);
                    match fs::copy(&src_pdf_file, &dest_pdf_path) {
                        Ok(_) => {
                            pdf_path = Some(format!("documents/{}/{}/{}/{}/{}", clean_brand, clean_cat, clean_subcat, sku, file_name));
                        }
                        Err(e) => {
                            report.errors.push(format!("Échec copie PDF pour {} : {}", sku, e));
                        }
                    }
                }
            } else if pdf_path.is_none() {
                report.missing_files += 1;
            }
        }

        // Déterminer s'il y a des modifications à apporter par rapport à la DB locale
        let mut details_changed = true;
        let mut stock_diff = qte;

        if let Some(ref prod) = existing {
            details_changed = prod.mpn != ref_str
                || prod.label != desc_str
                || prod.brand != marque
                || prod.category != famille
                || prod.sub_category != sous_famille
                || prod.location != emplacement
                || (prod.price - prix).abs() > 0.001
                || prod.image_path != image_path
                || prod.pdf_path != pdf_path;
            
            stock_diff = qte - prod.current_stock;
        }

        // Si rien n'a changé, on passe simplement à la suite
        if existing.is_some() && !details_changed && stock_diff.abs() <= 0.001 {
            report.success += 1;
            continue;
        }

        let mut event_written = false;

        // Créer l'événement de création/mise à jour de produit si les détails ont changé ou si le produit n'existe pas
        if details_changed || existing.is_none() {
            let mut attributes_json = json!({
                "tension": tension,
                "largeur": largeur,
                "hauteur": hauteur,
                "profondeur": profondeur,
                "poids": poids,
                "notes": notes
            });
            if !code_rs.is_empty() {
                attributes_json["vpc"] = json!({ "RS": code_rs });
            }

            let create_payload = json!({
                "sku": sku,
                "mpn": ref_str.to_string(),
                "label": desc_str.to_string(),
                "brand": marque,
                "category": famille,
                "subCategory": sous_famille,
                "location": emplacement,
                "type": "QUANTITATIVE",
                "minStock": 0.0,
                "price": prix,
                "image_path": image_path,
                "pdf_path": pdf_path,
                "initial_stock": qte,
                "packSize": existing.as_ref().map(|p| p.pack_size).unwrap_or(1),
                "attributes": attributes_json
            });

            if super::events::write_event_file(network_path, "PRODUCT_CREATE", trigramme, create_payload).is_ok() {
                event_written = true;
            } else {
                report.errors.push(format!("Impossible d'écrire l'événement de création pour {}", sku));
            }
        }

        // Écrire un ajustement de stock uniquement pour les produits existants dont la quantité a changé
        if existing.is_some() && stock_diff.abs() > 0.001 {
            if stock_diff > 0.0 {
                let stock_payload = json!({
                    "sku": sku,
                    "qty": stock_diff,
                    "note": "Ajustement import (entrée)"
                });
                if super::events::write_event_file(network_path, "STOCK_IN", trigramme, stock_payload).is_ok() {
                    event_written = true;
                }
            } else {
                let stock_payload = json!({
                    "sku": sku,
                    "qty": -stock_diff,
                    "note": "Ajustement import (sortie)"
                });
                if super::events::write_event_file(network_path, "STOCK_OUT", trigramme, stock_payload).is_ok() {
                    event_written = true;
                }
            }
        }

        if event_written || existing.is_some() {
            report.success += 1;
        }
    }

    Ok(report)
}

fn resolve_source_path(base_dir: &Path, relative_path: &str) -> std::path::PathBuf {
    let clean_path = relative_path.replace("\\", "/");
    let joined = base_dir.join(&clean_path);
    if joined.exists() {
        return joined;
    }
    
    // Découper le chemin relatif
    let parts: Vec<&str> = clean_path.split('/').collect();
    if parts.len() > 1 {
        // Tenter de retirer le premier dossier si son nom correspond au dossier de base sélectionné
        if let Some(base_folder_name) = base_dir.file_name().and_then(|n| n.to_str()) {
            if parts[0].to_lowercase() == base_folder_name.to_lowercase() {
                let sub_path = parts[1..].join("/");
                let try_path = base_dir.join(&sub_path);
                if try_path.exists() {
                    return try_path;
                }
            }
        }
        
        // Tenter avec juste le nom du fichier (à plat dans le dossier de base)
        if let Some(file_name) = parts.last() {
            let try_path = base_dir.join(file_name);
            if try_path.exists() {
                return try_path;
            }
        }
    }
    
    joined
}

pub fn sanitize_folder_name(name: &str, fallback: &str) -> String {
    let clean = name.trim()
        .replace("/", "-")
        .replace("\\", "-")
        .replace(":", "-")
        .replace("*", "-")
        .replace("?", "-")
        .replace("\"", "-")
        .replace("<", "-")
        .replace(">", "-")
        .replace("|", "-");
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean
    }
}

