use std::path::{Path, PathBuf};
use std::fs;
use serde_json::json;

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
                168 => '¨', 169 => '©', 170 => 'ª', 171 => '«', 172 => '¬', 173 => '­', 174 => '®',
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
    media_dir: Option<&str>
) -> Result<usize, String> {
    let bytes = fs::read(csv_path)
        .map_err(|e| format!("Impossible de lire le fichier CSV : {}", e))?;

    let content_utf8 = decode_win1252(&bytes);
    let mut lines = content_utf8.lines();

    // Sauter les 8 premières lignes d'en-têtes Excel
    for _ in 0..8 {
        lines.next();
    }

    let mut import_count = 0;

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
        let sku = ref_str.replace(" ", "").replace("/", "-").to_uppercase();

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
        
        let prix_str = parts.get(15).copied().unwrap_or("0").trim().replace(",", ".");
        let prix: f64 = prix_str.parse().unwrap_or(0.0);
        let qte: f64 = qte_str.replace(",", ".").parse().unwrap_or(0.0);

        // Récupérer les chemins relatifs des images/PDF s'ils existent dans les colonnes (indices ~17 et ~18 ou plus)
        // D'après le format : PDF et Image sont à la fin.
        // On va les chercher intelligemment à la fin ou par index :
        let raw_pdf = parts.get(17).copied().unwrap_or("").trim();
        let raw_img = parts.get(18).copied().unwrap_or("").trim();

        let mut image_path = None;
        let mut pdf_path = None;

        // Copie physique des fichiers médias si un dossier source a été fourni
        if let Some(src_media) = media_dir {
            let src_media_path = Path::new(src_media);
            
            if !raw_img.is_empty() {
                let src_img_file = src_media_path.join(raw_img);
                if src_img_file.exists() {
                    let ext = src_img_file.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
                    let net_img_name = format!("{}.{}", sku.to_lowercase(), ext);
                    let dest_img_path = Path::new(network_path).join("images").join(&net_img_name);
                    if fs::copy(&src_img_file, &dest_img_path).is_ok() {
                        image_path = Some(format!("images/{}", net_img_name));
                    }
                }
            }

            if !raw_pdf.is_empty() {
                let src_pdf_file = src_media_path.join(raw_pdf);
                if src_pdf_file.exists() {
                    let ext = src_pdf_file.extension().and_then(|e| e.to_str()).unwrap_or("pdf");
                    let net_pdf_name = format!("{}.{}", sku.to_lowercase(), ext);
                    let dest_pdf_path = Path::new(network_path).join("documents").join(&net_pdf_name);
                    if fs::copy(&src_pdf_file, &dest_pdf_path).is_ok() {
                        pdf_path = Some(format!("documents/{}", net_pdf_name));
                    }
                }
            }
        }

        // Créer l'événement de création de produit
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
            "attributes": {
                "tension": tension,
                "largeur": largeur,
                "hauteur": hauteur,
                "profondeur": profondeur,
                "poids": poids,
                "codeRS": code_rs,
                "notes": notes
            }
        });

        if super::events::write_event_file(network_path, "PRODUCT_CREATE", trigramme, create_payload).is_ok() {
            import_count += 1;
            
            // Si la quantité de stock initial est supérieure à 0, on écrit aussi un STOCK_IN
            if qte > 0.0 {
                let stock_payload = json!({
                    "sku": sku,
                    "qty": qte,
                    "note": "Import initial de stock"
                });
                let _ = super::events::write_event_file(network_path, "STOCK_IN", trigramme, stock_payload);
            }
        }
    }

    Ok(import_count)
}
