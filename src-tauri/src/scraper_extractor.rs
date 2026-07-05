#![allow(dead_code, unused_variables)]
//! Module d'extraction universelle de données depuis HTML/JSON-LD.
//! Centralise toute la logique d'extraction de prix, labels, images, PDFs, dimensions.

use serde::{Serialize, Deserialize};

// ─── Structures de données extraites ──────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ExtractedProductData {
    pub label: Option<String>,
    pub brand: Option<String>,
    pub mpn: Option<String>,
    pub prices: Vec<ExtractedPrice>,
    pub dimensions: ExtractedDimensions,
    pub weight: Option<String>,
    pub pack_size: Option<i64>,
    pub pdf_urls: Vec<ExtractedResource>,
    pub image_urls: Vec<ExtractedResource>,
    pub source_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtractedPrice {
    pub value: f64,
    pub currency: String,
    pub tax_type: String,  // "HT", "TTC", "unknown"
    pub label: String,     // Ex: "Prix unitaire", "lowPrice", "1+ pièce"
    pub pack_size: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ExtractedDimensions {
    pub width: Option<String>,
    pub height: Option<String>,
    pub depth: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtractedResource {
    pub url: String,
    pub title: String,
    pub domain: String,
    pub resource_type: String,  // "pdf", "jpg", "png", "webp"
}

// ─── Extraction depuis JSON-LD ────────────────────────────────────────────────

/// Extrait les blocs JSON-LD d'un document HTML.
pub fn extract_json_ld_blocks(html: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let marker = r#"type="application/ld+json">"#;
    let mut pos = 0;
    while let Some(start_idx) = html[pos..].find(marker) {
        let abs_start = pos + start_idx + marker.len();
        if let Some(end_idx) = html[abs_start..].find("</script>") {
            let abs_end = abs_start + end_idx;
            blocks.push(html[abs_start..abs_end].trim().to_string());
            pos = abs_end + 9;
        } else {
            break;
        }
    }
    blocks
}

/// Extrait les données d'un produit depuis les blocs JSON-LD.
/// Supporte les types Product, IndividualProduct, ProductModel et les tableaux @type.
pub fn extract_from_json_ld(json_ld_blocks: &[String]) -> ExtractedProductData {
    let mut data = ExtractedProductData::default();

    for block in json_ld_blocks {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(block) {
            // Supporter @type: "Product", "IndividualProduct", "ProductModel"
            // et @type: ["Product", "Thing"] (tableau)
            let is_product = match json.get("@type") {
                Some(serde_json::Value::String(s)) => {
                    matches!(s.as_str(), "Product" | "IndividualProduct" | "ProductModel")
                }
                Some(serde_json::Value::Array(arr)) => {
                    arr.iter().any(|v| v.as_str().map(|s| {
                        matches!(s, "Product" | "IndividualProduct" | "ProductModel")
                    }).unwrap_or(false))
                }
                _ => false,
            };
            if is_product {
                // Label
                if let Some(name) = json.get("name").and_then(|v| v.as_str()) {
                    data.label = Some(name.to_string());
                }
                // Brand
                if let Some(b_obj) = json.get("brand") {
                    if let Some(b_name) = b_obj.get("name").and_then(|v| v.as_str()) {
                        data.brand = Some(b_name.to_string());
                    } else if let Some(b_str) = b_obj.as_str() {
                        data.brand = Some(b_str.to_string());
                    }
                }
                // MPN
                if let Some(m) = json.get("mpn").and_then(|v| v.as_str()) {
                    data.mpn = Some(m.to_string());
                }
                // Prix
                if let Some(offers) = json.get("offers") {
                    let currency = offers.get("priceCurrency")
                        .and_then(|v| v.as_str())
                        .unwrap_or("EUR")
                        .to_string();
                    
                    let mut price_val = None;
                    let mut price_label = "price".to_string();
                    
                    if let Some(low_p) = offers.get("lowPrice").and_then(|v| v.as_f64()) {
                        price_val = Some(low_p);
                        price_label = "lowPrice".to_string();
                    } else if let Some(p) = offers.get("price").and_then(|v| v.as_f64()) {
                        price_val = Some(p);
                    } else if let Some(p_str) = offers.get("price").and_then(|v| v.as_str()) {
                        if let Ok(p) = p_str.replace(",", ".").parse::<f64>() {
                            price_val = Some(p);
                        }
                    }

                    if let Some(p) = price_val {
                        let converted = crate::scraper_http::convert_to_eur(p, &currency);
                        data.prices.push(ExtractedPrice {
                            value: converted,
                            currency: currency.clone(),
                            tax_type: "unknown".to_string(),
                            label: price_label,
                            pack_size: 1,
                        });
                    }
                }
                // Dimensions
                extract_dimensions_from_json_ld(&json, &mut data.dimensions);
                // Weight
                if let Some(w_val) = json.get("weight") {
                    if let Some(w_name) = w_val.get("name").and_then(|v| v.as_str()) {
                        data.weight = Some(w_name.replace("g", "").replace("kg", "").trim().to_string());
                    }
                }
                // Additional properties (dimensions/weight)
                if let Some(props) = json.get("additionalProperty").and_then(|v| v.as_array()) {
                    for p in props {
                        if let (Some(name), Some(val)) = (
                            p.get("name").and_then(|v| v.as_str()),
                            p.get("value").and_then(|v| v.as_str())
                        ) {
                            let clean_val = val.replace("mm", "").replace("g", "").replace("kg", "").trim().to_string();
                            match name.to_lowercase().as_str() {
                                "largeur" | "width" => data.dimensions.width = Some(clean_val),
                                "hauteur" | "height" => data.dimensions.height = Some(clean_val),
                                "profondeur" | "depth" => data.dimensions.depth = Some(clean_val),
                                "poids" | "weight" => data.weight = Some(clean_val),
                                _ => {}
                            }
                        }
                    }
                }
                // PDFs
                collect_pdf_urls_from_json(&json, &mut data.pdf_urls);
                // Images
                collect_image_urls_from_json(&json, &mut data.image_urls);
            }
        }
    }
    data
}

fn extract_dimensions_from_json_ld(json: &serde_json::Value, dims: &mut ExtractedDimensions) {
    for (field, target) in [
        ("width", &mut dims.width as &mut Option<String>),
        ("height", &mut dims.height),
        ("depth", &mut dims.depth),
    ] {
        if let Some(v) = json.get(field) {
            if let Some(name) = v.get("name").and_then(|v| v.as_str()) {
                *target = Some(name.replace("mm", "").trim().to_string());
            }
        }
    }
}

// ─── Extraction PDF URLs ──────────────────────────────────────────────────────

fn collect_pdf_urls_from_json(val: &serde_json::Value, urls: &mut Vec<ExtractedResource>) {
    match val {
        serde_json::Value::String(s) => {
            let s_lower = s.to_lowercase();
            if s_lower.contains(".pdf") && !urls.iter().any(|u| u.url == *s) {
                let domain = get_domain_from_url(s);
                urls.push(ExtractedResource {
                    url: s.clone(),
                    title: "Fiche Technique".to_string(),
                    domain,
                    resource_type: "pdf".to_string(),
                });
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_pdf_urls_from_json(item, urls);
            }
        }
        serde_json::Value::Object(obj) => {
            for (_, value) in obj {
                collect_pdf_urls_from_json(value, urls);
            }
        }
        _ => {}
    }
}

// ─── Extraction Image URLs ────────────────────────────────────────────────────

fn collect_image_urls_from_json(val: &serde_json::Value, urls: &mut Vec<ExtractedResource>) {
    match val {
        serde_json::Value::String(s) => {
            if is_valid_product_image_url(s) && !urls.iter().any(|u| u.url == *s) {
                let domain = get_domain_from_url(s);
                let s_lower = s.to_lowercase();
                let ext = if s_lower.ends_with(".png") { "png" }
                    else if s_lower.ends_with(".webp") { "webp" }
                    else { "jpg" };
                urls.push(ExtractedResource {
                    url: s.clone(),
                    title: String::new(),
                    domain,
                    resource_type: ext.to_string(),
                });
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_image_urls_from_json(item, urls);
            }
        }
        serde_json::Value::Object(obj) => {
            if obj.get("@type").and_then(|v| v.as_str()) == Some("ImageObject") {
                if let Some(url_str) = obj.get("url").and_then(|v| v.as_str()) {
                    if !urls.iter().any(|u| u.url == url_str) {
                        let domain = get_domain_from_url(url_str);
                        urls.push(ExtractedResource {
                            url: url_str.to_string(),
                            title: "ImageObject".to_string(),
                            domain,
                            resource_type: "jpg".to_string(),
                        });
                    }
                }
            }
            for (_, value) in obj {
                collect_image_urls_from_json(value, urls);
            }
        }
        _ => {}
    }
}

// ─── Extraction depuis HTML brut ──────────────────────────────────────────────

/// Extrait les URLs PDF depuis le HTML brut avec filtrage des faux positifs JS/JSON.
/// Filtre les URLs dans des contextes JavaScript, commentaires, et fragments JSON inline.
pub fn extract_pdf_urls_from_html(html: &str) -> Vec<ExtractedResource> {
    let mut results = Vec::new();
    let html_lower = html.to_lowercase();
    let mut pos = 0;

    while let Some(rel_start) = html_lower[pos..].find("http") {
        let abs_start = pos + rel_start;
        let end = html.as_bytes()[abs_start..]
            .iter()
            .position(|&c| c == b'"' || c == b'\'' || c == b' ' || c == b'<' || c == b'>' || c == b'\\' || c == b'}' || c == b']' || c == b'\n')
            .map(|p| abs_start + p)
            .unwrap_or(html.len());
        let url_raw = html[abs_start..end].replace('\\', "");
        let url_lower = url_raw.to_lowercase();

        if url_lower.contains(".pdf") && !url_lower.contains("javascript") {
            // Filtrer les faux positifs : URL dans du JS inline ou du JSON
            let context_start = abs_start.saturating_sub(30);
            let context = &html[context_start..abs_start];
            let context_lower = context.to_lowercase();

            // Ignorer si on est dans un commentaire JS/HTML ou du code
            let is_js_context = context_lower.contains("function") 
                || context_lower.contains("var ") 
                || context_lower.contains("const ")
                || context_lower.contains("let ")
                || context_lower.contains("//")
                || context.trim_end().ends_with('?')
                || context.trim_end().ends_with(',');

            // S'assurer que l'URL est dans un attribut href/src ou une chaîne propre
            let in_link_attr = context_lower.contains("href=") 
                || context_lower.contains("src=")
                || context_lower.contains("url=")
                || context_lower.contains("link=")
                || context_lower.contains("action=");
            
            // Accepter si : dans un attribut de lien OU pas dans un contexte JS détecté
            if (in_link_attr || !is_js_context) && !url_raw.is_empty() {
                if !results.iter().any(|r: &ExtractedResource| r.url == url_raw) {
                    let title = extract_link_text(html, &url_raw);
                    let clean_title = if title.is_empty() { "Fiche Technique".to_string() } else { title };
                    let domain = get_domain_from_url(&url_raw);
                    results.push(ExtractedResource {
                        url: url_raw,
                        title: clean_title,
                        domain,
                        resource_type: "pdf".to_string(),
                    });
                }
            }
        }
        pos = end.max(abs_start + 1);
    }
    results
}

/// Valide si une URL d'image correspond à un produit potentiel (exclut avatars, réseaux sociaux, publicités).
pub fn is_valid_product_image_url(url: &str) -> bool {
    let url_lower = url.to_lowercase();
    
    // Cloudinary RS exception
    let is_cloudinary = url_lower.contains("cloudinary.com");

    // Extensions valides
    if !is_cloudinary && !url_lower.ends_with(".jpg") && !url_lower.ends_with(".jpeg") && !url_lower.ends_with(".png") && !url_lower.ends_with(".webp") {
        return false;
    }

    // Exclure les termes génériques de mise en page / tracking / profils
    let blacklisted_keywords = [
        "avatar", "profile", "author", "user", "social", "logo", "icon", "banner", 
        "favicon", "theme", "plugin", "adsystem", "googleads", "analytics", "pixel", 
        "spacer", "tracking", "loader", "spinner", "captcha", "placeholder", "badge",
        "button", "rating", "star", "marker", "arrow", "checkbox", "bg", "background",
        "thumb", "carousel"
    ];
    
    for kw in &blacklisted_keywords {
        if url_lower.contains(kw) {
            return false;
        }
    }

    // Exclure les domaines génériques non liés à la VPC / électronique / produits industriels
    let blacklisted_domains = [
        "pinimg.com", "pinterest.com", "instagram.com", "facebook.com", "fbcdn.net",
        "starsinsider.com", "ranker.com", "gravatar.com", "tumblr.com", "reddit.com",
        "redditstatic.com", "tiktok.com", "twitter.com", "twimg.com", "youtube.com",
        "ytimg.com", "wikimedia.org", "wikipedia.org", "flickr.com", "unsplash.com",
        "giphy.com", "doubleclick.net", "google-analytics.com", "wp.com", "wordpress.com",
        "blogspot.com", "medium.com", "starsinsider", "inkl.com"
    ];

    for dom in &blacklisted_domains {
        if url_lower.contains(dom) {
            return false;
        }
    }

    // Longueur minimale raisonnable
    if url.len() < 20 {
        return false;
    }

    true
}

/// Extrait les URLs d'images depuis le HTML brut.
pub fn extract_image_urls_from_html(html: &str) -> Vec<ExtractedResource> {
    let mut results = Vec::new();
    let mut pos = 0;
    while let Some(start_idx) = html[pos..].find("https://") {
        let abs_start = pos + start_idx;
        let end = html.as_bytes()[abs_start..]
            .iter()
            .position(|&c| c == b'"' || c == b'\'' || c == b' ' || c == b'<' || c == b'>')
            .map(|p| abs_start + p)
            .unwrap_or(html.len());
        let url_str = html[abs_start..end].to_string();
        
        if is_valid_product_image_url(&url_str) {
            if !results.iter().any(|r: &ExtractedResource| r.url == url_str) {
                let domain = get_domain_from_url(&url_str);
                let url_lower = url_str.to_lowercase();
                let ext = if url_lower.ends_with(".png") { "png" }
                    else if url_lower.ends_with(".webp") { "webp" }
                    else { "jpg" };
                results.push(ExtractedResource {
                    url: url_str,
                    title: String::new(),
                    domain,
                    resource_type: ext.to_string(),
                });
            }
        }
        pos = end.max(abs_start + 1);
    }
    results
}

/// Extrait les URLs Cloudinary (spécifique RS Components) depuis le HTML.
pub fn extract_cloudinary_urls(html: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let prefix = "https://res.cloudinary.com/rsc/image/upload/";
    let mut pos = 0;
    while let Some(start_idx) = html[pos..].find(prefix) {
        let abs_start = pos + start_idx;
        let end = html.as_bytes()[abs_start..]
            .iter()
            .position(|&c| c == b'"' || c == b'\'' || c == b' ' || c == b'<' || c == b'>' || c == b'\\' || c == b'}' || c == b']')
            .map(|p| abs_start + p)
            .unwrap_or(html.len());
        let url_str = html[abs_start..end].replace('\\', "");
        if !urls.contains(&url_str) {
            urls.push(url_str);
        }
        pos = end.max(abs_start + 1);
    }
    urls
}

// ─── Extraction de prix depuis texte brut ─────────────────────────────────────

/// Extrait les prix possibles depuis un texte brut (snippets SearxNG, pages HTML strippées).
pub fn extract_price_from_text(text: &str) -> Option<f64> {
    let mut matches = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() {
                let c = chars[i];
                if c.is_ascii_digit() || c == '.' || c == ',' {
                    i += 1;
                } else if c == ' ' || c == '\u{202f}' || c == '\u{00a0}' {
                    if i + 3 < chars.len()
                        && chars[i+1].is_ascii_digit()
                        && chars[i+2].is_ascii_digit()
                        && chars[i+3].is_ascii_digit()
                        && (i + 4 >= chars.len() || !chars[i+4].is_ascii_digit())
                    {
                        i += 1;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            let chunk: String = chars[start..i].iter().collect();
            let mut trimmed_chunk = chunk.trim().to_string();
            if trimmed_chunk.ends_with('.') || trimmed_chunk.ends_with(',') {
                trimmed_chunk.pop();
            }
            let cleaned = trimmed_chunk.replace(' ', "").replace('\u{202f}', "").replace('\u{00a0}', "");
            let parsed_val = parse_price_string(&cleaned);

            if let Some(val) = parsed_val {
                let start_sub = start.saturating_sub(25);
                let end_sub = std::cmp::min(chars.len(), i + 25);
                let context_str: String = chars[start_sub..end_sub].iter().collect::<String>().to_lowercase();
                let has_ht = {
                    let has_ht_kw = context_str.contains("ht") 
                        && !context_str.contains("http") 
                        && !context_str.contains("https")
                        && !context_str.contains("html");
                    has_ht_kw && (
                        context_str.contains(" ht") 
                        || context_str.contains("€ht") 
                        || context_str.contains("ht ") 
                        || context_str.contains("h.t.")
                    )
                };
                let has_unit = context_str.contains("unit") || context_str.contains("unitaire") || context_str.contains("unité");
                matches.push((val, has_ht, has_unit));
            }
        } else {
            i += 1;
        }
    }
    
    // Priorité: HT+unitaire > HT > unitaire > tout
    if let Some(&(val, _, _)) = matches.iter().find(|&&(_, has_ht, has_unit)| has_ht && has_unit) {
        return Some(val);
    }
    if let Some(&(val, _, _)) = matches.iter().find(|&&(_, has_ht, _)| has_ht) {
        return Some(val);
    }
    let unit_matches: Vec<f64> = matches.iter()
        .filter(|&&(_, _, has_unit)| has_unit)
        .map(|&(val, _, _)| val)
        .filter(|&val| val >= 0.1 && val <= 10000.0)
        .collect();
    if !unit_matches.is_empty() {
        let mut sorted = unit_matches;
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        return Some(sorted[0]);
    }
    let all_valid: Vec<f64> = matches.iter()
        .map(|&(val, _, _)| val)
        .filter(|&val| val >= 0.1 && val <= 10000.0)
        .collect();
    if !all_valid.is_empty() {
        let mut sorted = all_valid;
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        return Some(sorted[0]);
    }
    None
}

fn parse_price_string(cleaned: &str) -> Option<f64> {
    if cleaned.contains('.') && cleaned.contains(',') {
        if let (Some(last_dot), Some(last_comma)) = (cleaned.rfind('.'), cleaned.rfind(',')) {
            if last_dot > last_comma {
                cleaned.replace(',', "").parse::<f64>().ok()
            } else {
                cleaned.replace('.', "").replace(',', ".").parse::<f64>().ok()
            }
        } else {
            None
        }
    } else if cleaned.contains(',') {
        cleaned.replace(',', ".").parse::<f64>().ok()
    } else {
        cleaned.parse::<f64>().ok()
    }
}

// ─── Extraction dimensions depuis HTML brut ───────────────────────────────────

/// Extrait les dimensions et le poids depuis les attributs Conrad-style dans le HTML.
pub fn extract_dimensions_from_html(html: &str) -> (ExtractedDimensions, Option<String>) {
    let mut dims = ExtractedDimensions::default();
    let mut weight = None;

    for (attr_name, target) in [
        ("Largeur", "width"),
        ("Hauteur", "height"),
        ("Profondeur", "depth"),
        ("Poids", "weight"),
    ] {
        let search = format!("\"attributeName\":\"{}",  attr_name);
        if let Some(idx) = html.find(&search) {
            let after = &html[idx..];
            if let Some(val_idx) = after.find("\"value\":\"") {
                let after_val = &after[val_idx + 9..];
                if let Some(end_val) = after_val.find('"') {
                    let val = after_val[..end_val].trim().to_string();
                    match target {
                        "width" => dims.width = Some(val),
                        "height" => dims.height = Some(val),
                        "depth" => dims.depth = Some(val),
                        "weight" => weight = Some(val),
                        _ => {}
                    }
                }
            }
        }
    }
    (dims, weight)
}

// ─── Conrad price extraction ──────────────────────────────────────────────────

/// Extrait un prix depuis le JSON d'état Conrad.
pub fn extract_conrad_price_value(html: &str, key: &str) -> Option<f64> {
    let search_key = format!("\"{}\"", key);
    if let Some(idx) = html.find(&search_key) {
        let after_key = &html[(idx + search_key.len())..];
        if let Some(colon_idx) = after_key.find(':') {
            let after_colon = after_key[(colon_idx + 1)..].trim_start();
            let mut num_str = String::new();
            for c in after_colon.chars() {
                if c.is_ascii_digit() || c == '.' || c == ',' {
                    num_str.push(c);
                } else if c.is_whitespace() {
                    if !num_str.is_empty() { break; }
                } else {
                    break;
                }
            }
            if !num_str.is_empty() {
                if let Ok(val) = num_str.replace(',', ".").parse::<f64>() {
                    return Some(val);
                }
            }
        }
    }
    None
}

// ─── Meta tag extraction ──────────────────────────────────────────────────────

pub fn extract_meta_tag_value(html: &str, property_name: &str) -> Option<String> {
    let mut pos = 0;
    while let Some(idx) = html[pos..].find("<meta") {
        let abs_start = pos + idx;
        if let Some(tag_end_idx) = html[abs_start..].find('>') {
            let abs_end = abs_start + tag_end_idx;
            let tag_content = &html[abs_start..abs_end];
            if tag_content.contains(property_name) {
                if let Some(content_idx) = tag_content.find("content=\"") {
                    let val_start = content_idx + 9;
                    if let Some(val_end_rel) = tag_content[val_start..].find('"') {
                        return Some(tag_content[val_start..(val_start + val_end_rel)].trim().to_string());
                    }
                } else if let Some(content_idx) = tag_content.find("content='") {
                    let val_start = content_idx + 9;
                    if let Some(val_end_rel) = tag_content[val_start..].find('\'') {
                        return Some(tag_content[val_start..(val_start + val_end_rel)].trim().to_string());
                    }
                }
            }
            pos = abs_end + 1;
        } else {
            break;
        }
    }
    None
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

/// Extrait le texte du lien <a> contenant une URL donnée.
pub fn extract_link_text(html: &str, url: &str) -> String {
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
                let clean: String = text.trim().replace("\n", " ").replace("\r", "")
                    .chars().filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '-').collect();
                if !clean.trim().is_empty() && clean.len() < 50 {
                    return clean.trim().to_string();
                }
            }
        }
    }
    String::new()
}

/// Supprime les tags HTML pour obtenir le texte brut.
pub fn strip_html_tags(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        if c == '<' { in_tag = true; }
        else if c == '>' { in_tag = false; }
        else if !in_tag { result.push(c); }
    }
    result.replace("&nbsp;", " ")
}

fn get_domain_from_url(url_str: &str) -> String {
    if let Ok(parsed) = reqwest::Url::parse(url_str) {
        parsed.host_str().unwrap_or("").to_string()
    } else {
        "".to_string()
    }
}

// ─── Extraction complète depuis une page HTML ─────────────────────────────────

/// Extraction universelle : combine JSON-LD + HTML brut pour extraire toutes les données.
pub fn extract_all_from_html(html: &str, source_url: &str) -> ExtractedProductData {
    let json_ld_blocks = extract_json_ld_blocks(html);
    let mut data = extract_from_json_ld(&json_ld_blocks);
    
    // Enrichir avec les PDFs du HTML brut
    let html_pdfs = extract_pdf_urls_from_html(html);
    for pdf in html_pdfs {
        if !data.pdf_urls.iter().any(|u| u.url == pdf.url) {
            data.pdf_urls.push(pdf);
        }
    }

    // Enrichir avec les images du HTML brut
    let html_images = extract_image_urls_from_html(html);
    for img in html_images {
        if !data.image_urls.iter().any(|u| u.url == img.url) {
            data.image_urls.push(img);
        }
    }

    // Images Cloudinary (RS)
    let cloudinary = extract_cloudinary_urls(html);
    for mut url in cloudinary {
        if !url.to_lowercase().ends_with(".jpg") && !url.to_lowercase().ends_with(".jpeg") && !url.to_lowercase().ends_with(".png") {
            url.push_str(".jpg");
        }
        if !data.image_urls.iter().any(|u| u.url == url) {
            data.image_urls.push(ExtractedResource {
                url,
                title: "RS Cloudinary".to_string(),
                domain: "res.cloudinary.com".to_string(),
                resource_type: "jpg".to_string(),
            });
        }
    }

    // Dimensions depuis HTML brut (fallback si JSON-LD incomplet)
    if data.dimensions.width.is_none() || data.dimensions.height.is_none() {
        let (html_dims, html_weight) = extract_dimensions_from_html(html);
        if data.dimensions.width.is_none() { data.dimensions.width = html_dims.width; }
        if data.dimensions.height.is_none() { data.dimensions.height = html_dims.height; }
        if data.dimensions.depth.is_none() { data.dimensions.depth = html_dims.depth; }
        if data.weight.is_none() { data.weight = html_weight; }
    }

    // Prix depuis meta tags (fallback)
    if data.prices.is_empty() {
        if let Some(meta_p_str) = extract_meta_tag_value(html, "product:price:amount") {
            if let Ok(meta_p) = meta_p_str.replace(',', ".").parse::<f64>() {
                let meta_curr = extract_meta_tag_value(html, "product:price:currency");
                let currency = meta_curr.as_deref().unwrap_or("EUR").to_string();
                let converted = crate::scraper_http::convert_to_eur(meta_p, &currency);
                data.prices.push(ExtractedPrice {
                    value: converted,
                    currency,
                    tax_type: "unknown".to_string(),
                    label: "meta tag".to_string(),
                    pack_size: 1,
                });
            }
        }
    }

    data.source_url = Some(source_url.to_string());
    data
}
