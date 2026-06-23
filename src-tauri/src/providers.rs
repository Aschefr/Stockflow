use crate::scraper::{ScrapedProductDetails, scrape_farnell_api, scrape_mouser_api, scrape_url_via_webview};
use tauri::AppHandle;

pub enum VpcProvider {
    RsComponents,
    Farnell,
    Mouser,
    Conrad,
}

impl VpcProvider {
    pub fn from_site(site: &str) -> Option<Self> {
        let l = site.to_lowercase();
        if l == "rs" || l.contains("rs component") || l.contains("rs-online") || l.contains("rsdelivers") {
            Some(Self::RsComponents)
        } else if l.contains("farnell") {
            Some(Self::Farnell)
        } else if l.contains("mouser") {
            Some(Self::Mouser)
        } else if l.contains("conrad") {
            Some(Self::Conrad)
        } else {
            None
        }
    }
    
    pub async fn scrape_details(
        &self,
        app_handle: &AppHandle,
        sku: &str,
        url_or_code: &str,
        api_keys: Option<&std::collections::HashMap<String, String>>,
    ) -> Result<ScrapedProductDetails, String> {
        match self {
            Self::RsComponents => {
                let vpc_urls = crate::config::load_config_internal().map(|c| c.vpc_urls).unwrap_or_default();
                if let Some(direct_url) = crate::scraper::build_vpc_product_url("RS", url_or_code, &vpc_urls) {
                    let mut details = scrape_url_via_webview(app_handle, &direct_url).await?;
                    details.sku = sku.to_string();
                    return Ok(details);
                }
                Err("Impossible de générer l'URL RS".to_string())
            },
            Self::Farnell => {
                if let Some(keys) = api_keys {
                    if let Some(key) = keys.get("Farnell").or_else(|| keys.get("farnell")) {
                        if let Ok(details) = scrape_farnell_api(sku, key).await {
                            return Ok(details);
                        }
                    }
                }
                // Désactivation temporaire de la WebView pour Farnell (souvent en 404/bloqué) pour passer directement au scraper générique
                Err("Scraping WebView désactivé pour Farnell (passage direct au scraper générique)".to_string())
            },
            Self::Mouser => {
                if let Some(keys) = api_keys {
                    if let Some(key) = keys.get("Mouser").or_else(|| keys.get("mouser")) {
                        if let Ok(details) = scrape_mouser_api(sku, key).await {
                            return Ok(details);
                        }
                    }
                }
                // Désactivation du scraping WebView pour Mouser (bloqué par Cloudflare et provoque des timeouts de 60s)
                Err("Scraping WebView désactivé pour Mouser (passage direct au scraper générique)".to_string())
            },
            Self::Conrad => {
                // Désactivation du scraping WebView pour Conrad (deadlocks et captcha fréquents) pour passer directement au scraper générique
                Err("Scraping WebView désactivé pour Conrad (passage direct au scraper générique)".to_string())
            }
        }
    }
}
