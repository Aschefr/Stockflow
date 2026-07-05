#![allow(dead_code, unused_variables)]
//! Modèle de données pour les candidats scrapés et persistance JSON réseau.
//! Les candidats sont stockés dans {network_path}/scrape_cache/{SKU}.json
//! et les screenshots dans {network_path}/scrape_cache/screenshots/

use std::path::{Path, PathBuf};
use std::fs;
use serde::{Serialize, Deserialize};

// ─── Status ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ScrapeStatus {
    Pending,
    InProgress,
    Complete,
    Failed,
    Cancelled,
}

impl Default for ScrapeStatus {
    fn default() -> Self { ScrapeStatus::Pending }
}

// ─── Candidate generics ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CandidateSource {
    pub url: Option<String>,
    pub screenshot_path: Option<String>,
    pub provider: String,   // "RS", "Farnell", "SearxNG", "WebView", etc.
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Candidate<T: Clone> {
    pub value: T,
    pub source: CandidateSource,
    pub confidence: f32,    // 0.0 - 1.0
    pub selected: bool,     // pré-sélectionné par défaut
}

// ─── Typed candidate values ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PriceInfo {
    pub price: f64,
    pub currency: String,
    pub tax_type: String,
    pub label: String,
    pub pack_size: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DimensionInfo {
    pub width: Option<String>,
    pub height: Option<String>,
    pub depth: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResourceCandidate {
    pub url: String,
    pub title: String,
    pub domain: String,
    pub source: CandidateSource,
    pub file_type: String,  // "pdf", "jpg", "png"
}

// ─── Source Info ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SourceInfo {
    pub url: String,
    pub provider: String,
    pub screenshot_path: Option<String>,
    pub visited_at: String,
    pub success: bool,
}

// ─── Main candidates structure ───────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScrapeCandidates {
    pub sku: String,
    pub scraped_at: String,
    /// Timestamp Unix en millisecondes pour le calcul de TTL côté frontend.
    #[serde(default)]
    pub scraped_at_ms: i64,
    pub status: ScrapeStatus,
    pub progress: f32,
    pub error_message: Option<String>,
    pub sources_visited: Vec<SourceInfo>,

    // Candidats par propriété
    pub label_candidates: Vec<Candidate<String>>,
    pub brand_candidates: Vec<Candidate<String>>,
    pub mpn_candidates: Vec<Candidate<String>>,
    pub price_candidates: Vec<Candidate<PriceInfo>>,
    pub dimension_candidates: Vec<Candidate<DimensionInfo>>,
    pub weight_candidates: Vec<Candidate<String>>,
    pub pack_size_candidates: Vec<Candidate<i64>>,

    // Ressources
    pub pdf_candidates: Vec<ResourceCandidate>,
    pub image_candidates: Vec<ResourceCandidate>,
}

impl ScrapeCandidates {
    pub fn new(sku: &str) -> Self {
        let now = chrono::Utc::now();
        Self {
            sku: sku.to_uppercase(),
            scraped_at: now.to_rfc3339(),
            scraped_at_ms: now.timestamp_millis(),
            status: ScrapeStatus::Pending,
            progress: 0.0,
            error_message: None,
            sources_visited: Vec::new(),
            label_candidates: Vec::new(),
            brand_candidates: Vec::new(),
            mpn_candidates: Vec::new(),
            price_candidates: Vec::new(),
            dimension_candidates: Vec::new(),
            weight_candidates: Vec::new(),
            pack_size_candidates: Vec::new(),
            pdf_candidates: Vec::new(),
            image_candidates: Vec::new(),
        }
    }

    /// Nombre total de candidats trouvés.
    pub fn total_candidates(&self) -> usize {
        self.label_candidates.len()
            + self.brand_candidates.len()
            + self.mpn_candidates.len()
            + self.price_candidates.len()
            + self.dimension_candidates.len()
            + self.weight_candidates.len()
            + self.pack_size_candidates.len()
            + self.pdf_candidates.len()
            + self.image_candidates.len()
    }

    /// Pré-sélectionne le meilleur candidat dans une liste par confiance décroissante.
    fn reselect_best<T: Clone>(candidates: &mut Vec<Candidate<T>>) {
        if candidates.is_empty() { return; }
        let best_idx = candidates.iter().enumerate()
            .max_by(|(_, a), (_, b)| a.confidence.partial_cmp(&b.confidence).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(i, _)| i)
            .unwrap_or(0);
        for (i, c) in candidates.iter_mut().enumerate() {
            c.selected = i == best_idx;
        }
    }

    /// Ajoute un candidat label s'il n'est pas déjà présent.
    /// Pré-sélectionne automatiquement le candidat avec la meilleure confiance.
    pub fn add_label(&mut self, value: &str, source: CandidateSource, confidence: f32) {
        let val = value.trim().to_string();
        if val.is_empty() || self.label_candidates.iter().any(|c| c.value == val) { return; }
        self.label_candidates.push(Candidate { value: val, source, confidence, selected: false });
        Self::reselect_best(&mut self.label_candidates);
    }

    /// Ajoute un candidat marque s'il n'est pas déjà présent.
    pub fn add_brand(&mut self, value: &str, source: CandidateSource, confidence: f32) {
        let val = value.trim().to_string();
        if val.is_empty() || val == "Inconnue" || self.brand_candidates.iter().any(|c| c.value == val) { return; }
        self.brand_candidates.push(Candidate { value: val, source, confidence, selected: false });
        Self::reselect_best(&mut self.brand_candidates);
    }

    /// Ajoute un candidat MPN s'il n'est pas déjà présent.
    pub fn add_mpn(&mut self, value: &str, source: CandidateSource, confidence: f32) {
        let val = value.trim().to_string();
        if val.is_empty() || self.mpn_candidates.iter().any(|c| c.value == val) { return; }
        self.mpn_candidates.push(Candidate { value: val, source, confidence, selected: false });
        Self::reselect_best(&mut self.mpn_candidates);
    }

    /// Ajoute un candidat prix.
    pub fn add_price(&mut self, info: PriceInfo, source: CandidateSource, confidence: f32) {
        if info.price <= 0.0 { return; }
        self.price_candidates.push(Candidate { value: info, source, confidence, selected: false });
        Self::reselect_best(&mut self.price_candidates);
    }

    /// Ajoute un candidat dimensions.
    pub fn add_dimensions(&mut self, info: DimensionInfo, source: CandidateSource, confidence: f32) {
        if info.width.is_none() && info.height.is_none() && info.depth.is_none() { return; }
        self.dimension_candidates.push(Candidate { value: info, source, confidence, selected: false });
        Self::reselect_best(&mut self.dimension_candidates);
    }

    /// Ajoute un candidat poids.
    pub fn add_weight(&mut self, value: &str, source: CandidateSource, confidence: f32) {
        let val = value.trim().to_string();
        if val.is_empty() || self.weight_candidates.iter().any(|c| c.value == val) { return; }
        self.weight_candidates.push(Candidate { value: val, source, confidence, selected: false });
        Self::reselect_best(&mut self.weight_candidates);
    }

    /// Ajoute un candidat taille de lot.
    pub fn add_pack_size(&mut self, value: i64, source: CandidateSource, confidence: f32) {
        if value <= 0 || self.pack_size_candidates.iter().any(|c| c.value == value) { return; }
        self.pack_size_candidates.push(Candidate { value, source, confidence, selected: false });
        Self::reselect_best(&mut self.pack_size_candidates);
    }

    /// Ajoute un candidat PDF.
    pub fn add_pdf(&mut self, url: &str, title: &str, domain: &str, source: CandidateSource) {
        if url.is_empty() || self.pdf_candidates.iter().any(|c| c.url == url) { return; }
        self.pdf_candidates.push(ResourceCandidate {
            url: url.to_string(),
            title: title.to_string(),
            domain: domain.to_string(),
            source,
            file_type: "pdf".to_string(),
        });
    }

    /// Ajoute un candidat image.
    pub fn add_image(&mut self, url: &str, title: &str, domain: &str, file_type: &str, source: CandidateSource) {
        if url.is_empty() || self.image_candidates.iter().any(|c| c.url == url) { return; }
        // Blacklist images non pertinentes
        let url_lower = url.to_lowercase();
        let blacklist = ["banner", "promo", "cookie", "tracking", "analytics", "pixel",
            "favicon", "sprite", "placeholder", "default", "social", "facebook", "twitter",
            "linkedin", "ads", "advertisement", "campaign"];
        if blacklist.iter().any(|b| url_lower.contains(b)) { return; }
        
        self.image_candidates.push(ResourceCandidate {
            url: url.to_string(),
            title: title.to_string(),
            domain: domain.to_string(),
            source,
            file_type: file_type.to_string(),
        });
    }

    /// Intègre les données extraites d'une page dans les candidats.
    pub fn ingest_extracted_data(
        &mut self,
        data: &crate::scraper_extractor::ExtractedProductData,
        provider: &str,
        source_url: Option<&str>,
        screenshot_path: Option<&str>,
    ) {
        let make_source = || CandidateSource {
            url: source_url.map(|s| s.to_string()),
            screenshot_path: screenshot_path.map(|s| s.to_string()),
            provider: provider.to_string(),
        };

        if let Some(ref label) = data.label {
            self.add_label(label, make_source(), 0.9);
        }
        if let Some(ref brand) = data.brand {
            self.add_brand(brand, make_source(), 0.9);
        }
        if let Some(ref mpn) = data.mpn {
            self.add_mpn(mpn, make_source(), 0.9);
        }
        for price in &data.prices {
            self.add_price(
                PriceInfo {
                    price: price.value,
                    currency: price.currency.clone(),
                    tax_type: price.tax_type.clone(),
                    label: price.label.clone(),
                    pack_size: price.pack_size,
                },
                make_source(),
                0.8,
            );
        }
        if data.dimensions.width.is_some() || data.dimensions.height.is_some() || data.dimensions.depth.is_some() {
            self.add_dimensions(
                DimensionInfo {
                    width: data.dimensions.width.clone(),
                    height: data.dimensions.height.clone(),
                    depth: data.dimensions.depth.clone(),
                },
                make_source(),
                0.8,
            );
        }
        if let Some(ref weight) = data.weight {
            self.add_weight(weight, make_source(), 0.8);
        }
        if let Some(ps) = data.pack_size {
            self.add_pack_size(ps, make_source(), 0.8);
        }
        for pdf in &data.pdf_urls {
            self.add_pdf(&pdf.url, &pdf.title, &pdf.domain, make_source());
        }
        for img in &data.image_urls {
            self.add_image(&img.url, &img.title, &img.domain, &img.resource_type, make_source());
        }
    }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

fn get_cache_dir(network_path: &str) -> PathBuf {
    Path::new(network_path).join("scrape_cache")
}

fn get_screenshots_dir(network_path: &str) -> PathBuf {
    get_cache_dir(network_path).join("screenshots")
}

fn get_candidates_path(network_path: &str, sku: &str) -> PathBuf {
    get_cache_dir(network_path).join(format!("{}.json", sku.to_uppercase()))
}

/// Retourne le chemin relatif (depuis network_path) d'un screenshot pour un SKU.
pub fn get_screenshot_relative_path(sku: &str, source_index: usize) -> String {
    format!("scrape_cache/screenshots/{}_{}.jpg", sku.to_uppercase(), source_index)
}

/// Retourne le chemin absolu d'un screenshot.
pub fn get_screenshot_absolute_path(network_path: &str, sku: &str, source_index: usize) -> PathBuf {
    Path::new(network_path).join(get_screenshot_relative_path(sku, source_index))
}

/// Sauvegarde les candidats sur le disque réseau.
pub fn save_candidates(network_path: &str, candidates: &ScrapeCandidates) -> Result<(), String> {
    let cache_dir = get_cache_dir(network_path);
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Impossible de créer scrape_cache: {}", e))?;
    
    let screenshots_dir = get_screenshots_dir(network_path);
    fs::create_dir_all(&screenshots_dir).map_err(|e| format!("Impossible de créer screenshots dir: {}", e))?;
    
    let path = get_candidates_path(network_path, &candidates.sku);
    let data = serde_json::to_string_pretty(candidates)
        .map_err(|e| format!("Erreur sérialisation candidats: {}", e))?;
    fs::write(&path, data)
        .map_err(|e| format!("Erreur écriture candidats: {}", e))?;
    
    Ok(())
}

/// Charge les candidats depuis le disque réseau.
pub fn load_candidates(network_path: &str, sku: &str) -> Option<ScrapeCandidates> {
    let path = get_candidates_path(network_path, sku);
    if !path.exists() { return None; }
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<ScrapeCandidates>(&data).ok()
}

/// Met à jour uniquement le status et la progression.
pub fn update_candidates_progress(
    network_path: &str,
    sku: &str,
    progress: f32,
    status: ScrapeStatus,
    error_message: Option<String>,
) -> Result<(), String> {
    if let Some(mut candidates) = load_candidates(network_path, sku) {
        candidates.progress = progress;
        candidates.status = status;
        candidates.error_message = error_message;
        save_candidates(network_path, &candidates)
    } else {
        Err("Aucun fichier candidat trouvé".to_string())
    }
}

/// Vérifie si un fichier candidat existe pour un SKU donné.
pub fn candidates_exist(network_path: &str, sku: &str) -> bool {
    get_candidates_path(network_path, sku).exists()
}

/// Supprime le fichier candidat pour un SKU.
pub fn delete_candidates(network_path: &str, sku: &str) -> Result<(), String> {
    let path = get_candidates_path(network_path, sku);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Erreur suppression candidats: {}", e))?;
    }
    Ok(())
}
