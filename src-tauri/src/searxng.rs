#![allow(dead_code, unused_variables)]
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearxngResult {
    pub url: String,
    pub title: String,
    pub content: String,
    pub engine: Option<String>,
}

pub async fn searxng_search_async(
    client: &reqwest::Client,
    searxng_url: &str,
    query: &str,
) -> Result<Vec<SearxngResult>, String> {
    let search_url = format!(
        "{}/search?q={}&format=json",
        searxng_url.trim_end_matches('/'),
        urlencoding::encode(query)
    );
    
    let req = client.get(&search_url);
    let req = crate::scraper::apply_stealth_headers_async(req, &search_url);
    
    let res = req.send().await.map_err(|e| format!("SearxNG request failed: {}", e))?;
    
    if res.status().is_success() {
        let json: serde_json::Value = res.json().await.map_err(|e| format!("SearxNG JSON error: {}", e))?;
        if let Some(results) = json["results"].as_array() {
            let mut items = Vec::new();
            for r in results {
                if let (Some(url), Some(title)) = (r["url"].as_str(), r["title"].as_str()) {
                    items.push(SearxngResult {
                        url: url.to_string(),
                        title: title.to_string(),
                        content: r["content"].as_str().unwrap_or("").to_string(),
                        engine: r["engine"].as_str().map(|s| s.to_string()),
                    });
                }
            }
            return Ok(items);
        }
    }
    
    Err("No results found or invalid response from SearxNG".to_string())
}
