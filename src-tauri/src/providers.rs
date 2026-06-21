use crate::scraper::{ScrapedProductDetails, scrape_farnell_api, scrape_mouser_api, scrape_url_via_webview};
use tauri::AppHandle;

pub enum VpcProvider {
    RsComponents,
    Farnell,
    Mouser,
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
                let rs_code = url_or_code.trim().replace("-", "").replace(" ", "");
                
                let mut rs_domain = "fr.rs-online.com".to_string();
                if let Some(config) = crate::config::load_config_internal() {
                    if let Some(custom) = config.vpc_urls.get("RS") {
                        if !custom.trim().is_empty() {
                            rs_domain = custom.trim().to_string();
                        }
                    } else if let Some(custom) = config.vpc_urls.get("RS Components") {
                        if !custom.trim().is_empty() {
                            rs_domain = custom.trim().to_string();
                        }
                    }
                }

                let direct_url = if rs_domain.contains("rsdelivers") {
                    format!("https://{}/product/a/a/a/{}", rs_domain, rs_code)
                } else {
                    format!("https://{}/web/c/?searchTerm={}", rs_domain, rs_code)
                };
                
                let mut details = scrape_url_via_webview(app_handle, &direct_url).await?;
                details.sku = sku.to_string();
                Ok(details)
            },
            Self::Farnell => {
                if let Some(keys) = api_keys {
                    if let Some(key) = keys.get("Farnell").or_else(|| keys.get("farnell")) {
                        return scrape_farnell_api(sku, key).await;
                    }
                }
                Err("Pas de clé API pour Farnell".to_string())
            },
            Self::Mouser => {
                if let Some(keys) = api_keys {
                    if let Some(key) = keys.get("Mouser").or_else(|| keys.get("mouser")) {
                        return scrape_mouser_api(sku, key).await;
                    }
                }
                Err("Pas de clé API pour Mouser".to_string())
            }
        }
    }
}
