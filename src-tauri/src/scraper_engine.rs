#![allow(dead_code, unused_variables)]
//! Moteur de scraping universel.
//! Orchestre le scraping de toutes les données d'un SKU en une seule passe.

use crate::scraper_http;
use crate::scraper_extractor;
use crate::scraper_candidates::*;
use crate::config::AppConfig;
use crate::scraper_task::ScrapeParams;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

// ─── URL building ─────────────────────────────────────────────────────────────

/// Construit l'URL de la fiche produit pour un VPC donné.
pub fn build_vpc_product_url(vpc_site: &str, vpc_code: &str, vpc_urls: &std::collections::HashMap<String, String>) -> Option<String> {
    if vpc_code.trim().is_empty() { return None; }
    let site_lower = vpc_site.to_lowercase();
    if site_lower.contains("rs") {
        let domain = vpc_urls.get(vpc_site)
            .or_else(|| vpc_urls.get("RS"))
            .cloned()
            .unwrap_or_else(|| "fr.rs-online.com".to_string());
        let code_stripped = vpc_code.trim().replace("-", "").replace(" ", "");
        if domain.contains("rsdelivers") {
            Some(format!("https://{}/product/a/a/a/{}", domain, code_stripped))
        } else {
            Some(format!("https://{}/web/c/?searchTerm={}", domain, vpc_code.trim()))
        }
    } else if site_lower.contains("farnell") {
        let domain = vpc_urls.get(vpc_site)
            .or_else(|| vpc_urls.get("Farnell"))
            .cloned()
            .unwrap_or_else(|| "fr.farnell.com".to_string());
        Some(format!("https://{}/dp/{}", domain, vpc_code.trim()))
    } else if site_lower.contains("mouser") {
        let domain = vpc_urls.get(vpc_site)
            .or_else(|| vpc_urls.get("Mouser"))
            .cloned()
            .unwrap_or_else(|| "www.mouser.fr".to_string());
        Some(format!("https://{}/ProductDetail/{}", domain, vpc_code.trim()))
    } else if site_lower.contains("conrad") {
        let domain = vpc_urls.get(vpc_site)
            .or_else(|| vpc_urls.get("Conrad"))
            .cloned()
            .unwrap_or_else(|| "www.conrad.fr".to_string());
        Some(format!("https://{}/p/{}", domain, vpc_code.trim()))
    } else {
        None
    }
}

// ─── Product details from DB ──────────────────────────────────────────────────

struct ProductInfo {
    sku: String,
    mpn: String,
    brand: String,
    label: String,
    category: String,
    sub_category: String,
    attributes: String,
}

fn get_product_info(sku: &str) -> Option<ProductInfo> {
    let db_path = crate::events::get_db_path()?;
    let conn = rusqlite::Connection::open(db_path).ok()?;
    let sku_upper = sku.to_uppercase();
    conn.query_row(
        "SELECT sku, mpn, brand, label, category, sub_category, attributes FROM products WHERE sku = ?",
        [&sku_upper],
        |row| {
            Ok(ProductInfo {
                sku: row.get(0)?,
                mpn: row.get(1)?,
                brand: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                label: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                category: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                sub_category: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                attributes: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            })
        }
    ).ok()
}

/// Extrait le site VPC et le code depuis les attributs produit.
fn get_vpc_info(attributes_str: &str) -> (String, String) {
    let mut site = String::new();
    let mut code = String::new();
    if let Ok(attrs) = serde_json::from_str::<serde_json::Value>(attributes_str) {
        if let Some(vpc_map) = attrs["vpc"].as_object() {
            if let Some((k, v)) = vpc_map.iter().next() {
                site = k.clone();
                code = v.as_str().unwrap_or("").to_string();
            }
        }
    }
    (site, code)
}

/// Extrait le code RS nettoyé.
fn get_rs_stock_code(attributes_str: &str) -> Option<String> {
    if let Ok(attrs) = serde_json::from_str::<serde_json::Value>(attributes_str) {
        let code = if let Some(vpc_map) = attrs["vpc"].as_object() {
            vpc_map.iter()
                .find(|(k, _)| k.to_lowercase().contains("rs"))
                .and_then(|(_, v)| v.as_str())
                .map(|s| s.to_string())
        } else {
            None
        };
        if let Some(c) = code {
            let cleaned = c.trim().replace("-", "").replace(" ", "");
            if !cleaned.is_empty() { return Some(cleaned); }
        }
    }
    None
}

// ─── Main scraping engine ─────────────────────────────────────────────────────

/// Scrape toutes les données d'un SKU en une seule passe.
/// Paramètres optionnels : contexte de lancement depuis le frontend (VPC, MPN, marque).
/// Résultat sauvegardé dans {network_path}/scrape_cache/{SKU}.json.
pub async fn scrape_all_for_sku(
    app_handle: &tauri::AppHandle,
    sku: &str,
    network_path: &str,
    cancel_token: CancellationToken,
    launch_params: Option<ScrapeParams>,
) -> Result<ScrapeCandidates, String> {
    let sku_upper = sku.to_uppercase();
    let existing_opt = load_candidates(network_path, &sku_upper);
    let mut candidates = if let Some(mut existing) = existing_opt {
        existing.status = ScrapeStatus::InProgress;
        existing.progress = 0.05;
        existing
    } else {
        ScrapeCandidates::new(&sku_upper)
    };
    candidates.status = ScrapeStatus::InProgress;
    candidates.progress = 0.05;
    save_candidates(network_path, &candidates)?;

    // Émettre l'événement de début
    emit_progress(app_handle, &sku_upper, 0.05, "Démarrage du scraping...");

    // Charger les infos produit (DB)
    let product = get_product_info(&sku_upper);
    let config = crate::config::load_config_internal();
    let vpc_urls = config.as_ref().map(|c| c.vpc_urls.clone()).unwrap_or_default();
    let api_keys = config.as_ref().map(|c| &c.vpc_api_keys);

    // Fusionner DB + params de lancement (les params ont priorité si fournis)
    let (mut vpc_site, mut vpc_code) = if let Some(ref p) = product {
        get_vpc_info(&p.attributes)
    } else {
        (String::new(), String::new())
    };
    let mut brand = product.as_ref().map(|p| p.brand.clone()).unwrap_or_default();
    let mut mpn = product.as_ref().map(|p| p.mpn.clone()).unwrap_or_default();
    let label = product.as_ref().map(|p| p.label.clone()).unwrap_or_default();

    if let Some(ref lp) = launch_params {
        if let Some(ref s) = lp.vpc_site { if !s.is_empty() { vpc_site = s.clone(); } }
        if let Some(ref c) = lp.vpc_code { if !c.is_empty() { vpc_code = c.clone(); } }
        if let Some(ref m) = lp.mpn      { if !m.is_empty() { mpn = m.clone(); } }
        if let Some(ref b) = lp.brand    { if !b.is_empty() { brand = b.clone(); } }
    }

    // ── Phase 0 : Découverte de revendeur via SearxNG (si aucun VPC connu) ─────────
    if cancel_token.is_cancelled() { return finish_cancelled(&mut candidates, network_path); }

    if vpc_site.is_empty() || vpc_code.is_empty() {
        let search_sku = if !mpn.is_empty() { mpn.clone() } else { sku_upper.clone() };
        emit_progress(app_handle, &sku_upper, 0.05, "Phase 0 : Recherche de revendeur via SearxNG...");
        if let Ok(Some(reseller)) = find_reseller_in_engine(app_handle, &search_sku, &brand, &label, &config).await {
            emit_progress(app_handle, &sku_upper, 0.10,
                &format!("Phase 0 : Revendeur trouvé — {} ({})", reseller.provider, reseller.code));
            vpc_site = reseller.provider;
            vpc_code = reseller.code;
            // Signaler au frontend qu'un revendeur a été détecté
            use tauri::Emitter;
            let _ = app_handle.emit("scrape-reseller-found", serde_json::json!({
                "sku": sku_upper,
                "provider": vpc_site,
                "code": vpc_code,
            }));
        }
    }

    // Dériver le code RS nettoyé (après Phase 0 qui peut avoir mis à jour vpc_site/vpc_code)
    let rs_code: Option<String> = {
        let from_db = product.as_ref().and_then(|p| get_rs_stock_code(&p.attributes));
        let from_vpc = if vpc_site.to_lowercase().contains("rs") && !vpc_code.is_empty() {
            let clean = vpc_code.trim().replace("-", "").replace(" ", "");
            if !clean.is_empty() { Some(clean) } else { None }
        } else { None };
        from_vpc.or(from_db)
    };

    // Déterminer s'il faut sauter la phase 1 :
    // - S'il y a des params de lancement FRAIS (vpc_code fourni par l'utilisateur), NE PAS sauter
    // - Sinon, sauter si déjà scrappé avec succès pour ce fournisseur
    let has_fresh_params = launch_params.as_ref().map(|lp| {
        lp.vpc_code.as_ref().map(|c| !c.is_empty()).unwrap_or(false)
        || lp.mpn.as_ref().map(|m| !m.is_empty()).unwrap_or(false)
    }).unwrap_or(false);
    let skip_phase1 = !has_fresh_params && !vpc_site.is_empty() && !vpc_code.is_empty() && (
        candidates.sources_visited.iter().any(|s| s.success && s.provider == vpc_site)
        || !candidates.label_candidates.is_empty()
    );

    // ── Phase 1 : Scraping direct VPC ─────────────────────────────────────
    if cancel_token.is_cancelled() { return finish_cancelled(&mut candidates, network_path); }

    let mut source_idx = 0;
    
    if !vpc_site.is_empty() && !vpc_code.is_empty() {
        if skip_phase1 {
            emit_progress(app_handle, &sku_upper, 0.15, &format!("Phase 1 : Données directes de {} déjà présentes, sautée.", vpc_site));
        } else if let Some(vpc_url) = build_vpc_product_url(&vpc_site, &vpc_code, &vpc_urls) {
            candidates.progress = 0.15;
            emit_progress(app_handle, &sku_upper, 0.15, &format!("Phase 1 : Scraping direct {} pour {}", vpc_site, vpc_code));
            if let Err(e) = save_candidates(network_path, &candidates) {
                emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
            }

            // Rate limit pour RS
            if vpc_site.to_lowercase().contains("rs") {
                scraper_http::enforce_rs_rate_limit().await;
            }

            // Essai HTTP direct
            let html_opt = scraper_http::fetch_page_stealth(&vpc_url).await;
            
            // Fallback RS → ma.rsdelivers.com
            let html_opt = if html_opt.is_none() && vpc_site.to_lowercase().contains("rs") {
                if let Some(ref r_code) = rs_code {
                    let ma_url = format!("https://ma.rsdelivers.com/product/a/a/a/{}", r_code);
                    emit_progress(app_handle, &sku_upper, 0.20, "Phase 1 : Fallback RS ma.rsdelivers.com...");
                    scraper_http::fetch_page_stealth(&ma_url).await
                } else {
                    None
                }
            } else {
                html_opt
            };

            if let Some(html) = html_opt {
                let data = scraper_extractor::extract_all_from_html(&html, &vpc_url);
                let screenshot_rel: Option<String> = None;
                
                candidates.sources_visited.push(SourceInfo {
                    url: vpc_url.clone(),
                    provider: vpc_site.clone(),
                    screenshot_path: screenshot_rel.clone(),
                    visited_at: chrono::Utc::now().to_rfc3339(),
                    success: true,
                });

                candidates.ingest_extracted_data(&data, &vpc_site, Some(&vpc_url), screenshot_rel.as_deref());
                emit_progress(app_handle, &sku_upper, 0.25, &format!("Phase 1 : {} données extraites de {}", candidates.total_candidates(), vpc_site));
                source_idx += 1;
            } else {
                let err_msg = format!("Phase 1 : HTTP échoué pour {} ({})", vpc_site, vpc_url);
                emit_progress(app_handle, &sku_upper, 0.25, &err_msg);
                candidates.error_message = Some(err_msg);
                candidates.sources_visited.push(SourceInfo {
                    url: vpc_url.clone(),
                    provider: vpc_site.clone(),
                    screenshot_path: None,
                    visited_at: chrono::Utc::now().to_rfc3339(),
                    success: false,
                });
            }

            if let Err(e) = save_candidates(network_path, &candidates) {
                emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
            }
        }
    }

    // ── Phase 2 : WebView fallback (masqué) ───────────────────────────────
    if cancel_token.is_cancelled() { return finish_cancelled(&mut candidates, network_path); }

    let skip_phase2 = candidates.sources_visited.iter().any(|s| s.success && s.provider == "WebView")
        || !candidates.label_candidates.is_empty();

    // WebView uniquement pour RS si HTTP a échoué et qu'on n'a pas de données
    if !vpc_site.is_empty() && vpc_site.to_lowercase().contains("rs") {
        if skip_phase2 {
            emit_progress(app_handle, &sku_upper, 0.30, "Phase 2 : Données WebView déjà présentes, sautée.");
        } else if candidates.label_candidates.is_empty() {
            if let Some(vpc_url) = build_vpc_product_url(&vpc_site, &vpc_code, &vpc_urls) {
                candidates.progress = 0.30;
                emit_progress(app_handle, &sku_upper, 0.30, "Phase 2 : Fallback WebView (masqué)...");
                if let Err(e) = save_candidates(network_path, &candidates) {
                    emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
                }

                if let Ok(details) = crate::scraper::scrape_url_via_webview(app_handle, &vpc_url).await {
                    let source = CandidateSource {
                        url: Some(vpc_url.clone()),
                        screenshot_path: details.screenshot.clone(),
                        provider: "WebView".to_string(),
                    };
                    
                    candidates.sources_visited.push(SourceInfo {
                        url: vpc_url.clone(),
                        provider: "WebView".to_string(),
                        screenshot_path: details.screenshot.clone(),
                        visited_at: chrono::Utc::now().to_rfc3339(),
                        success: true,
                    });

                    if let Some(ref lbl) = Some(details.label.clone()).filter(|s| !s.is_empty()) {
                        candidates.add_label(lbl, source.clone(), 0.85);
                    }
                    if let Some(ref b) = Some(details.brand.clone()).filter(|s| !s.is_empty() && s != "Inconnue") {
                        candidates.add_brand(b, source.clone(), 0.85);
                    }
                    if let Some(ref m) = Some(details.mpn.clone()).filter(|s| !s.is_empty()) {
                        candidates.add_mpn(m, source.clone(), 0.85);
                    }
                    if details.price > 0.0 {
                        candidates.add_price(PriceInfo {
                            price: details.price,
                            currency: "EUR".to_string(),
                            tax_type: "unknown".to_string(),
                            label: "WebView".to_string(),
                            pack_size: details.pack_size,
                        }, source.clone(), 0.85);
                    }
                    if details.pack_size > 0 {
                        candidates.add_pack_size(details.pack_size, source.clone(), 0.85);
                    }
                    // Price candidates from webview
                    if let Some(ref pcs) = details.price_candidates {
                        for pc in pcs {
                            candidates.add_price(PriceInfo {
                                price: pc.price,
                                currency: "EUR".to_string(),
                                tax_type: pc.tax_type.clone(),
                                label: pc.label.clone(),
                                pack_size: pc.pack_size,
                            }, source.clone(), 0.80);
                        }
                    }
                }
                if let Err(e) = save_candidates(network_path, &candidates) {
                    emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
                }
            }
        }
    }

    // ── Phase 3 : APIs spécialisées (Farnell/Mouser) ──────────────────────
    if cancel_token.is_cancelled() { return finish_cancelled(&mut candidates, network_path); }

    let vpc_lower = vpc_site.to_lowercase();
    let skip_phase3_farnell = candidates.sources_visited.iter().any(|s| s.success && s.provider == "Farnell API")
        || !candidates.label_candidates.is_empty();
    let skip_phase3_mouser = candidates.sources_visited.iter().any(|s| s.success && s.provider == "Mouser API")
        || !candidates.label_candidates.is_empty();

    if vpc_lower.contains("farnell") {
        if skip_phase3_farnell {
            emit_progress(app_handle, &sku_upper, 0.45, "Phase 3 : Données API Farnell déjà présentes, sautée.");
        } else if let Some(keys) = api_keys {
            if let Some(key) = keys.get("Farnell").or_else(|| keys.get("farnell")) {
                candidates.progress = 0.45;
                emit_progress(app_handle, &sku_upper, 0.45, "Phase 3 : API Farnell...");
                if let Ok(details) = crate::scraper::scrape_farnell_api(&sku_upper, key).await {
                    let source = CandidateSource {
                        url: details.source_url.clone(),
                        screenshot_path: None,
                        provider: "Farnell API".to_string(),
                    };
                    if !details.label.is_empty() { candidates.add_label(&details.label, source.clone(), 0.95); }
                    if !details.brand.is_empty() { candidates.add_brand(&details.brand, source.clone(), 0.95); }
                    if !details.mpn.is_empty() { candidates.add_mpn(&details.mpn, source.clone(), 0.95); }
                    if details.price > 0.0 {
                        candidates.add_price(PriceInfo {
                            price: details.price,
                            currency: "EUR".to_string(),
                            tax_type: "HT".to_string(),
                            label: "Farnell API".to_string(),
                            pack_size: details.pack_size,
                        }, source.clone(), 0.95);
                    }
                    if details.pack_size > 0 {
                        candidates.add_pack_size(details.pack_size, source.clone(), 0.95);
                    }
                }
                if let Err(e) = save_candidates(network_path, &candidates) {
                    emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
                }
            }
        }
    } else if vpc_lower.contains("mouser") {
        if skip_phase3_mouser {
            emit_progress(app_handle, &sku_upper, 0.45, "Phase 3 : Données API Mouser déjà présentes, sautée.");
        } else if let Some(keys) = api_keys {
            if let Some(key) = keys.get("Mouser").or_else(|| keys.get("mouser")) {
                candidates.progress = 0.45;
                emit_progress(app_handle, &sku_upper, 0.45, "Phase 3 : API Mouser...");
                if let Ok(details) = crate::scraper::scrape_mouser_api(&sku_upper, key).await {
                    let source = CandidateSource {
                        url: details.source_url.clone(),
                        screenshot_path: None,
                        provider: "Mouser API".to_string(),
                    };
                    if !details.label.is_empty() { candidates.add_label(&details.label, source.clone(), 0.95); }
                    if !details.brand.is_empty() { candidates.add_brand(&details.brand, source.clone(), 0.95); }
                    if !details.mpn.is_empty() { candidates.add_mpn(&details.mpn, source.clone(), 0.95); }
                    if details.price > 0.0 {
                        candidates.add_price(PriceInfo {
                            price: details.price,
                            currency: "EUR".to_string(),
                            tax_type: "HT".to_string(),
                            label: "Mouser API".to_string(),
                            pack_size: details.pack_size,
                        }, source.clone(), 0.95);
                    }
                    if details.pack_size > 0 {
                        candidates.add_pack_size(details.pack_size, source.clone(), 0.95);
                    }
                }
                if let Err(e) = save_candidates(network_path, &candidates) {
                    emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
                }
            }
        }
    }

    // ── Phase 4 : SearxNG fallback (si données insuffisantes) ─────────────
    if cancel_token.is_cancelled() { return finish_cancelled(&mut candidates, network_path); }

    let has_searxng_run = candidates.sources_visited.iter().any(|s| s.provider == "SearxNG");
    let needs_searxng = candidates.price_candidates.is_empty() 
        || candidates.label_candidates.is_empty()
        || candidates.pdf_candidates.is_empty()
        || candidates.image_candidates.len() < 3;

    if needs_searxng && has_searxng_run {
        emit_progress(app_handle, &sku_upper, 0.60, "Phase 4 : Recherche SearxNG déjà effectuée, sautée.");
    } else if needs_searxng {
        let searxng_urls = scraper_http::get_searxng_urls(&config);
        
        candidates.progress = 0.60;
        emit_progress(app_handle, &sku_upper, 0.60, "Phase 4 : Recherche SearxNG...");
        if let Err(e) = save_candidates(network_path, &candidates) {
            emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
        }

        // Build search queries
        let code_to_search = if !vpc_code.is_empty() { vpc_code.clone() } 
            else if !mpn.is_empty() { mpn.clone() }
            else { sku_upper.clone() };

        for searxng_url in &searxng_urls {
            if cancel_token.is_cancelled() { return finish_cancelled(&mut candidates, network_path); }

            // Query pour les détails produit
            if candidates.price_candidates.is_empty() || candidates.label_candidates.is_empty() {
                let query = if !vpc_site.is_empty() && !vpc_site.to_lowercase().contains("mpn") {
                    format!("\"{}\" {} prix", code_to_search, vpc_site)
                } else {
                    format!("\"{}\" {} prix", code_to_search, brand)
                };

                let results = scraper_http::search_searxng(searxng_url, &query, None).await;
                for r in results.iter().take(3) {
                    if cancel_token.is_cancelled() { return finish_cancelled(&mut candidates, network_path); }
                    
                    // Tenter de récupérer la page directement
                    if r.url.starts_with("http") && !r.url.to_lowercase().ends_with(".pdf") {
                        if let Some(html) = scraper_http::fetch_page_stealth(&r.url).await {
                            let data = scraper_extractor::extract_all_from_html(&html, &r.url);
                            let screenshot_rel: Option<String> = None;
                            let source_info = SourceInfo {
                                url: r.url.clone(),
                                provider: "SearxNG".to_string(),
                                screenshot_path: screenshot_rel.clone(),
                                visited_at: chrono::Utc::now().to_rfc3339(),
                                success: true,
                            };
                            candidates.sources_visited.push(source_info);
                            candidates.ingest_extracted_data(&data, "SearxNG", Some(&r.url), screenshot_rel.as_deref());
                            source_idx += 1;
                        }
                    }

                    // Extraire prix des snippets SearxNG
                    if !r.snippet.is_empty() {
                        if let Some(price) = scraper_extractor::extract_price_from_text(&r.snippet) {
                            let source = CandidateSource {
                                url: Some(r.url.clone()),
                                screenshot_path: None,
                                provider: "SearxNG snippet".to_string(),
                            };
                            candidates.add_price(PriceInfo {
                                price,
                                currency: "EUR".to_string(),
                                tax_type: "unknown".to_string(),
                                label: "SearxNG snippet".to_string(),
                                pack_size: 1,
                            }, source, 0.5);
                        }
                    }
                }
            }

            // Query pour les PDFs
            if candidates.pdf_candidates.is_empty() {
                let pdf_query = format!("\"{}\" {} datasheet pdf", code_to_search, brand);
                let pdf_results = scraper_http::search_searxng(searxng_url, &pdf_query, None).await;
                for r in &pdf_results {
                    let ll = r.url.to_lowercase();
                    if ll.contains(".pdf") || ll.contains("filetype=pdf") || ll.contains("format=pdf") {
                        let domain = r.url.replace("https://", "").replace("http://", "")
                            .split('/').next().unwrap_or("").to_string();
                        let source = CandidateSource {
                            url: Some(r.url.clone()),
                            screenshot_path: None,
                            provider: "SearxNG".to_string(),
                        };
                        candidates.add_pdf(&r.url, &r.title, &domain, source);
                    }
                }
            }

            // Query pour les images
            if candidates.image_candidates.len() < 3 {
                let img_query = format!("\"{}\" {} photo produit", mpn, brand);
                let img_results = scraper_http::search_searxng_images(searxng_url, &img_query).await;
                for r in &img_results {
                    if !scraper_extractor::is_valid_product_image_url(&r.url) {
                        continue;
                    }
                    let domain = r.url.replace("https://", "").replace("http://", "")
                        .split('/').next().unwrap_or("").to_string();
                    let ext = if r.url.to_lowercase().ends_with(".png") { "png" }
                        else if r.url.to_lowercase().ends_with(".webp") { "webp" }
                        else { "jpg" };
                    let source = CandidateSource {
                        url: Some(r.url.clone()),
                        screenshot_path: None,
                        provider: "SearxNG images".to_string(),
                    };
                    candidates.add_image(&r.url, &r.title, &domain, ext, source);
                }
            }

            if let Err(e) = save_candidates(network_path, &candidates) {
                emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
            }

            // Si on a assez de données, on arrête
            if !candidates.price_candidates.is_empty() 
                && !candidates.label_candidates.is_empty() 
                && !candidates.pdf_candidates.is_empty() 
            {
                break;
            }
        }
    }

    // ── Phase 5 : RS Cloudinary images (si RS et peu d'images) ────────────
    if cancel_token.is_cancelled() { return finish_cancelled(&mut candidates, network_path); }

    let skip_phase5 = candidates.image_candidates.iter().any(|img| img.source.provider == "RS Cloudinary");

    if candidates.image_candidates.len() < 3 {
        if skip_phase5 {
            emit_progress(app_handle, &sku_upper, 0.85, "Phase 5 : Images RS Cloudinary déjà présentes, sautée.");
        } else if let Some(ref r_code) = rs_code {
            candidates.progress = 0.85;
            emit_progress(app_handle, &sku_upper, 0.85, "Phase 5 : Validation images RS Cloudinary...");
            
            let source = CandidateSource {
                url: None,
                screenshot_path: None,
                provider: "RS Cloudinary".to_string(),
            };
            // Valider chaque URL Cloudinary avec un HEAD request avant de l'ajouter
            let mut validated_count = 0;
            'outer: for idx in 1..=5u32 {
                for prefix_char in &["Y", "F"] {
                    if cancel_token.is_cancelled() { break 'outer; }
                    let url = format!(
                        "https://res.cloudinary.com/rsc/image/upload/b_rgb:FFFFFF,c_pad,dpr_1.0,f_auto,q_auto,w_700/c_pad,w_700/{}{}-{:02}.jpg",
                        prefix_char, r_code, idx
                    );
                    if scraper_http::url_exists(&url).await {
                        candidates.add_image(&url, &format!("RS #{}{}", prefix_char, idx), "res.cloudinary.com", "jpg", source.clone());
                        validated_count += 1;
                    }
                }
            }
            emit_progress(app_handle, &sku_upper, 0.90, &format!("Phase 5 : {} image(s) RS validée(s)", validated_count));
            if let Err(e) = save_candidates(network_path, &candidates) {
                emit_progress(app_handle, &sku_upper, candidates.progress, &format!("⚠ Erreur sauvegarde: {}", e));
            }
        }
    }

    // ── Finalisation ────────────────────────────────────────────────────────────────────────────────────
    candidates.status = ScrapeStatus::Complete;
    candidates.progress = 1.0;
    let now_fin = chrono::Utc::now();
    candidates.scraped_at = now_fin.to_rfc3339();
    candidates.scraped_at_ms = now_fin.timestamp_millis();
    // Effacer le message d'erreur si on a quand même trouvé des données
    if candidates.total_candidates() > 0 {
        candidates.error_message = None;
    }
    if let Err(e) = save_candidates(network_path, &candidates) {
        emit_progress(app_handle, &sku_upper, 1.0, &format!("⚠ Erreur finale de sauvegarde: {}", e));
    }

    emit_progress(app_handle, &sku_upper, 1.0, &format!(
        "Scraping terminé : {} candidats trouvés", candidates.total_candidates()
    ));

    // Émettre événement de fin
    use tauri::Emitter;
    let _ = app_handle.emit("scrape-task-complete", serde_json::json!({
        "sku": sku_upper,
        "candidates_count": candidates.total_candidates(),
    }));

    Ok(candidates)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn finish_cancelled(candidates: &mut ScrapeCandidates, network_path: &str) -> Result<ScrapeCandidates, String> {
    candidates.status = ScrapeStatus::Cancelled;
    save_candidates(network_path, candidates)?;
    Err("Scraping annulé par l'utilisateur".to_string())
}

fn emit_progress(app_handle: &tauri::AppHandle, sku: &str, progress: f32, message: &str) {
    use tauri::Emitter;
    let _ = app_handle.emit("scrape-task-progress", serde_json::json!({
        "sku": sku,
        "progress": progress,
        "message": message,
    }));
}

/// Capture un screenshot de l'URL via un WebView masqué et html2canvas,
/// sauvegarde en JPG compressé dans scrape_cache/screenshots/.
/// Retourne le chemin relatif depuis network_path en cas de succès.
async fn capture_screenshot_via_webview(
    app_handle: &tauri::AppHandle,
    url: &str,
    network_path: &str,
    sku: &str,
    source_idx: usize,
) -> Option<String> {
    // Script JS minimaliste : attendre le chargement, capturer via html2canvas, renvoyer le data-URL
    let screenshot_js = r#"
(function() {
    function capture() {
        const executeCapture = () => {
            try {
                window.html2canvas(document.body, {
                    logging: false,
                    useCORS: true,
                    allowTaint: true,
                    scale: 0.75,
                    backgroundColor: '#ffffff'
                })
                .then(canvas => {
                    try {
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
                        window.location.href = 'https://scraped/#scraped:' + encodeURIComponent(JSON.stringify({ screenshot: dataUrl }));
                    } catch(e) {
                        window.location.href = 'https://scraped/#scraped:' + encodeURIComponent(JSON.stringify({ screenshot: null }));
                    }
                })
                .catch(() => {
                    window.location.href = 'https://scraped/#scraped:' + encodeURIComponent(JSON.stringify({ screenshot: null }));
                });
            } catch(e) {
                window.location.href = 'https://scraped/#scraped:' + encodeURIComponent(JSON.stringify({ screenshot: null }));
            }
        };

        if (window.html2canvas) {
            executeCapture();
        } else {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            script.onload = () => setTimeout(executeCapture, 300);
            script.onerror = () => {
                window.location.href = 'https://scraped/#scraped:' + encodeURIComponent(JSON.stringify({ screenshot: null }));
            };
            document.head.appendChild(script);
        }
    }

    // Attendre un peu que la page charge ses ressources
    if (document.readyState === 'complete') {
        setTimeout(capture, 1500);
    } else {
        window.addEventListener('load', () => setTimeout(capture, 1500));
        // Fallback timeout si load ne se déclenche pas
        setTimeout(capture, 8000);
    }
})();
"#;

    // Utiliser evaluate_js_in_webview existant avec un timeout court
    match tokio::time::timeout(
        std::time::Duration::from_secs(20),
        crate::scraper::evaluate_js_in_webview(app_handle, url, screenshot_js),
    ).await {
        Ok(Ok(decoded)) => {
            // Extraire le data-URL du JSON résultat
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&decoded) {
                if let Some(data_url) = json_val["screenshot"].as_str() {
                    if data_url.starts_with("data:image/jpeg;base64,") {
                        let base64_data = &data_url["data:image/jpeg;base64,".len()..];
                        if let Ok(bytes) = base64_decode(base64_data) {
                            let rel_path = crate::scraper_candidates::get_screenshot_relative_path(sku, source_idx);
                            let abs_path = crate::scraper_candidates::get_screenshot_absolute_path(network_path, sku, source_idx);
                            
                            // Créer le répertoire screenshots si nécessaire
                            if let Some(parent) = abs_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            
                            // Sauvegarder le fichier JPG
                            if std::fs::write(&abs_path, &bytes).is_ok() {
                                return Some(rel_path);
                            }
                        }
                    }
                }
            }
            None
        },
        _ => None,
    }
}

/// Décode une chaîne base64 (standard avec padding).
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Décodage base64 manuel — pas de dépendance supplémentaire nécessaire
    // On utilise le décodeur de data_encoding ou une implémentation simple
    let input = input.trim();
    let input_bytes = input.as_bytes();
    let mut output = Vec::with_capacity(input_bytes.len() * 3 / 4);
    
    let decode_char = |c: u8| -> Result<u8, String> {
        match c {
            b'A'..=b'Z' => Ok(c - b'A'),
            b'a'..=b'z' => Ok(c - b'a' + 26),
            b'0'..=b'9' => Ok(c - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0), // padding
            _ => Err(format!("Invalid base64 character: {}", c as char)),
        }
    };

    let clean: Vec<u8> = input_bytes.iter()
        .filter(|&&c| c != b'\n' && c != b'\r' && c != b' ')
        .cloned()
        .collect();
    
    let mut i = 0;
    while i + 3 < clean.len() {
        let a = decode_char(clean[i])?;
        let b = decode_char(clean[i + 1])?;
        let c = decode_char(clean[i + 2])?;
        let d = decode_char(clean[i + 3])?;
        
        output.push((a << 2) | (b >> 4));
        if clean[i + 2] != b'=' {
            output.push((b << 4) | (c >> 2));
        }
        if clean[i + 3] != b'=' {
            output.push((c << 6) | d);
        }
        i += 4;
    }
    
    Ok(output)
}

// ─── Détection de revendeur intégrée ──────────────────────────────────────────

struct DetectedReseller {
    provider: String,
    code: String,
}

/// Recherche un revendeur VPC via SearxNG (version async pour le moteur de scraping).
async fn find_reseller_in_engine(
    _app_handle: &tauri::AppHandle,
    sku: &str,
    brand: &str,
    label: &str,
    config: &Option<crate::config::AppConfig>,
) -> Result<Option<DetectedReseller>, String> {
    let config = match config {
        Some(c) => c.clone(),
        None => return Ok(None),
    };

    let searxng_url = config.searxng_url.clone()
        .unwrap_or_else(|| "http://localhost:8080".to_string());

    let sku_owned = sku.to_string();
    let brand_owned = brand.to_string();
    let label_owned = label.to_string();
    let vpc_urls_clone = config.vpc_urls.clone();

    let mut domains = vec![
        "fr.rs-online.com".to_string(),
        "fr.farnell.com".to_string(),
        "www.mouser.fr".to_string(),
        "www.conrad.fr".to_string(),
    ];
    for (_, custom_url) in &vpc_urls_clone {
        let clean = custom_url
            .replace("https://", "").replace("http://", "")
            .trim_end_matches('/').to_string();
        if !clean.is_empty() && !domains.contains(&clean) { domains.push(clean); }
    }

    let site_filters = domains.iter().map(|d| format!("site:{}", d)).collect::<Vec<_>>().join(" OR ");
    let search_terms = [brand_owned.as_str(), sku_owned.as_str()]
        .iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(" ");
    let query = format!("({}) {}", site_filters, search_terms);

    let url = format!("{}/search?q={}&format=json",
        searxng_url.trim_end_matches('/'),
        urlencoding::encode(&query));

    let response = crate::scraper_http::ASYNC_HTTP_CLIENT.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() { return Ok(None); }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let results = match json["results"].as_array() {
        Some(r) => r.clone(),
        None => return Ok(None),
    };

    let sku_clean = sku_owned.to_lowercase().replace([' ', '-', '(', ')'], "");

    for r in &results {
        if let Some(link) = r["url"].as_str() {
            let url_lower = link.to_lowercase();
            let title = r["title"].as_str().unwrap_or("").to_lowercase();
            let is_relevant = !sku_clean.is_empty() && sku_clean.len() >= 3
                && (title.contains(&sku_clean) || url_lower.contains(&sku_clean));
            if !is_relevant { continue; }

            // Identifier le provider depuis le domaine de l'URL
            let provider_code = if url_lower.contains("rs-online.com") || url_lower.contains("rsdelivers.com") {
                if url_lower.contains("/web/p/") || url_lower.contains("/product/") {
                    if let Ok(parsed) = reqwest::Url::parse(link) {
                        parsed.path_segments()
                            .and_then(|segs| segs.last().map(|s| s.split('?').next().unwrap_or(s).to_string()))
                            .filter(|s| !s.is_empty())
                            .map(|code| ("RS".to_string(), code))
                    } else { None }
                } else { None }
            } else if url_lower.contains("farnell.com") {
                if let Ok(parsed) = reqwest::Url::parse(link) {
                    let segs: Vec<&str> = parsed.path_segments().map(|s| s.collect()).unwrap_or_default();
                    segs.iter().position(|&s| s == "dp" || s == "p")
                        .and_then(|i| segs.get(i + 1))
                        .map(|code| ("Farnell".to_string(), code.split('?').next().unwrap_or(code).to_string()))
                } else { None }
            } else if url_lower.contains("mouser.") {
                if let Ok(parsed) = reqwest::Url::parse(link) {
                    let segs: Vec<&str> = parsed.path_segments().map(|s| s.collect()).unwrap_or_default();
                    segs.iter().position(|&s| s.to_lowercase() == "productdetail")
                        .and_then(|_| segs.last())
                        .map(|code| ("Mouser".to_string(), code.split('?').next().unwrap_or(code).to_string()))
                } else { None }
            } else if url_lower.contains("conrad.") {
                if let Ok(parsed) = reqwest::Url::parse(link) {
                    let segs: Vec<&str> = parsed.path_segments().map(|s| s.collect()).unwrap_or_default();
                    segs.last().map(|s| {
                        let s = s.split('?').next().unwrap_or(s);
                        let s = s.trim_end_matches(".html").trim_end_matches(".htm");
                        let parts: Vec<&str> = s.split('-').collect();
                        let code = parts.last().unwrap_or(&s).to_string();
                        ("Conrad".to_string(), code)
                    })
                } else { None }
            } else {
                None
            };

            if let Some((provider, code)) = provider_code {
                if !code.is_empty() {
                    return Ok(Some(DetectedReseller { provider, code }));
                }
            }
        }
    }
    Ok(None)
}
