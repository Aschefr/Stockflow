#![allow(dead_code, unused_variables)]
//! Module HTTP mutualisé pour le scraper.
//! Centralise les headers stealth, user agents, délais anti-bot,
//! et les fonctions de récupération de pages.

use std::time::Duration;
use reqwest::header::{HeaderMap, HeaderValue};

// ─── Rate limiting par domaine ────────────────────────────────────────────────

pub static LAST_RS_REQUEST: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// Enregistre une requête RS et attend si nécessaire pour respecter le rate-limit (1.5s entre requêtes).
pub async fn enforce_rs_rate_limit() {
    let sleep_duration = if let Ok(mut last_req) = LAST_RS_REQUEST.lock() {
        let now = std::time::Instant::now();
        let elapsed = last_req.map(|last| last.elapsed());
        *last_req = Some(now);
        if let Some(el) = elapsed {
            if el < Duration::from_millis(1500) {
                Some(Duration::from_millis(1500) - el)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    if let Some(delay) = sleep_duration {
        tokio::time::sleep(delay).await;
    }
}

// ─── User Agents ──────────────────────────────────────────────────────────────
// Mis à jour vers Chrome 131 / Firefox 133 (2025)

static USER_AGENTS: &[&str] = &[
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

pub fn get_random_user_agent() -> &'static str {
    // Utiliser le temps en millis pour une meilleure rotation (subsec_nanos se répète)
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_micros() as usize;
    USER_AGENTS[millis % USER_AGENTS.len()]
}

// ─── Stealth Headers ──────────────────────────────────────────────────────────

pub fn apply_stealth_headers(builder: reqwest::RequestBuilder, url: &str) -> reqwest::RequestBuilder {
    let mut builder = builder
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
        .header("Accept-Language", "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Cache-Control", "max-age=0")
        .header("Sec-Ch-Ua", "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"")
        .header("Sec-Ch-Ua-Mobile", "?0")
        .header("Sec-Ch-Ua-Platform", "\"Windows\"")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "none")
        .header("Sec-Fetch-User", "?1")
        .header("Upgrade-Insecure-Requests", "1");

    if let Ok(parsed_url) = reqwest::Url::parse(url) {
        if let Some(host) = parsed_url.host_str() {
            let referer = format!("https://{}/", host);
            builder = builder.header("Referer", referer);
        }
    }
    builder
}

pub fn apply_stealth_headers_blocking(builder: reqwest::blocking::RequestBuilder, url: &str) -> reqwest::blocking::RequestBuilder {
    let mut builder = builder
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
        .header("Accept-Language", "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Cache-Control", "max-age=0")
        .header("Sec-Ch-Ua", "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"")
        .header("Sec-Ch-Ua-Mobile", "?0")
        .header("Sec-Ch-Ua-Platform", "\"Windows\"")
        .header("Sec-Fetch-Dest", "document")
        .header("Sec-Fetch-Mode", "navigate")
        .header("Sec-Fetch-Site", "none")
        .header("Sec-Fetch-User", "?1")
        .header("Upgrade-Insecure-Requests", "1");

    if let Ok(parsed_url) = reqwest::Url::parse(url) {
        if let Some(host) = parsed_url.host_str() {
            let referer = format!("https://{}/", host);
            builder = builder.header("Referer", referer);
        }
    }
    builder
}

// ─── Human Delays ─────────────────────────────────────────────────────────────

/// Délai anti-bot pour les sites VPC publics (RS, Farnell, Mouser, Conrad).
/// 1.5–4s avec 5% de chance de pause longue (8–15s) pour simuler un humain.
fn get_human_delay_duration() -> Duration {
    let micros = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_micros() as u64;
    let mut next = micros.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let mut rand_double = || {
        next = next.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (next as f64) / (u64::MAX as f64)
    };

    // Délai standard : 1.5–4s (au lieu de 2–7s)
    let delay = 1.5 + rand_double() * 2.5;
    // Pause longue : 5% de chance, 8–15s (au lieu de 10% × 15–30s)
    let long_pause_chance = rand_double();
    if long_pause_chance < 0.05 {
        Duration::from_secs_f64(8.0 + rand_double() * 7.0)
    } else {
        Duration::from_secs_f64(delay)
    }
}

/// Délai minimal pour les serveurs locaux / SearxNG auto-hébergé (200–400ms).
fn get_searxng_delay_duration() -> Duration {
    let micros = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_micros() as u64;
    let pseudo = micros.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let frac = (pseudo as f64) / (u64::MAX as f64);
    Duration::from_millis(200 + (frac * 200.0) as u64)
}

pub fn human_delay_blocking() {
    std::thread::sleep(get_human_delay_duration());
}

pub async fn human_delay_async() {
    tokio::time::sleep(get_human_delay_duration()).await;
}

/// Délai court pour SearxNG (serveur local) — 200–400ms seulement.
pub async fn searxng_delay_async() {
    tokio::time::sleep(get_searxng_delay_duration()).await;
}

// ─── Global HTTP Client ───────────────────────────────────────────────────────
// Cookie store activé pour les sites nécessitant des cookies (Mouser, Conrad)

lazy_static::lazy_static! {
    pub static ref ASYNC_HTTP_CLIENT: reqwest::Client = {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .cookie_store(true)
            .user_agent(USER_AGENTS[0])
            .build()
            .expect("Failed to build global async HTTP client")
    };
}

// ─── Fetch Functions ──────────────────────────────────────────────────────────

/// Récupère le HTML d'une page avec retry HTTP/2 → HTTP/1 fallback.
/// Retourne None si la page est bloquée ou inaccessible.
pub async fn fetch_page_stealth(url: &str) -> Option<String> {
    human_delay_async().await;
    let client = ASYNC_HTTP_CLIENT.clone();
    let req = client.get(url);
    let req = apply_stealth_headers(req, url);
    if let Ok(r) = req.send().await {
        if r.status().is_success() {
            if let Ok(text) = r.text().await {
                return Some(text);
            }
        }
    }

    // Fallback HTTP/1.1 avec nouveau client
    human_delay_async().await;
    if let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .cookie_store(true)
        .user_agent(get_random_user_agent())
        .build()
    {
        let req = client.get(url);
        let req = apply_stealth_headers(req, url);
        if let Ok(r) = req.send().await {
            if r.status().is_success() {
                if let Ok(text) = r.text().await {
                    return Some(text);
                }
            }
        }
    }
    None
}

/// Récupère le HTML d'une page VPC en mode blocking (pour les anciennes fonctions).
pub fn fetch_page_stealth_blocking(url: &str) -> Option<String> {
    human_delay_blocking();
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(get_random_user_agent())
        .cookie_store(true)
        .build()
        .ok()?;
    let req = client.get(url);
    let req = apply_stealth_headers_blocking(req, url);
    match req.send() {
        Ok(r) if r.status().is_success() => r.text().ok(),
        _ => None,
    }
}

// ─── SearxNG ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SearxngResult {
    pub url: String,
    pub title: String,
    pub snippet: String,
}

/// Récupère les URLs d'instances SearxNG configurées.
pub fn get_searxng_urls(config: &Option<crate::config::AppConfig>) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(c) = config {
        if let Some(ref u) = c.searxng_url {
            if !u.trim().is_empty() {
                urls.push(u.trim().to_string());
            }
        }
        for u in &c.searxng_urls {
            let trimmed = u.trim().to_string();
            if !trimmed.is_empty() && !urls.contains(&trimmed) {
                urls.push(trimmed);
            }
        }
    }
    if urls.is_empty() {
        urls.push("https://search.amify-studio.fr".to_string());
    }
    urls
}

/// Teste si une instance SearxNG supporte le format JSON.
pub async fn test_searxng_json_support(client: &reqwest::Client, base_url: &str) -> bool {
    let test_url = format!("{}/search?q=test&format=json", base_url.trim_end_matches('/'));
    match client.get(&test_url).send().await {
        Ok(res) if res.status().is_success() => {
            if let Some(ct) = res.headers().get("content-type") {
                if ct.to_str().unwrap_or("").contains("json") {
                    return true;
                }
            }
            res.json::<serde_json::Value>().await.is_ok()
        }
        _ => false,
    }
}

/// Exécute une recherche SearxNG et retourne les résultats structurés.
/// Utilise un délai court (serveur local) au lieu du délai VPC standard.
pub async fn search_searxng(
    searxng_url: &str,
    query: &str,
    categories: Option<&str>,
) -> Vec<SearxngResult> {
    let mut url = format!(
        "{}/search?q={}&format=json",
        searxng_url.trim_end_matches('/'),
        urlencoding::encode(query)
    );
    if let Some(cat) = categories {
        url.push_str(&format!("&categories={}", cat));
    }

    // Délai court pour SearxNG (serveur local)
    searxng_delay_async().await;
    let client = ASYNC_HTTP_CLIENT.clone();
    let req = client.get(&url);
    let req = apply_stealth_headers(req, &url);

    if let Ok(res) = req.send().await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(results) = json["results"].as_array() {
                    return results.iter().filter_map(|r| {
                        let url = r["url"].as_str()?.to_string();
                        let title = r["title"].as_str().unwrap_or("").to_string();
                        let snippet = r["content"].as_str()
                            .or_else(|| r["snippet"].as_str())
                            .unwrap_or("").to_string();
                        Some(SearxngResult { url, title, snippet })
                    }).collect();
                }
            }
        }
    }
    Vec::new()
}

/// Exécute une recherche SearxNG images et retourne les URLs d'images.
pub async fn search_searxng_images(
    searxng_url: &str,
    query: &str,
) -> Vec<SearxngResult> {
    let url = format!(
        "{}/search?q={}&categories=images&format=json",
        searxng_url.trim_end_matches('/'),
        urlencoding::encode(query)
    );

    // Délai court pour SearxNG
    searxng_delay_async().await;
    let client = ASYNC_HTTP_CLIENT.clone();
    let req = client.get(&url);
    let req = apply_stealth_headers(req, &url);

    if let Ok(res) = req.send().await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(results) = json["results"].as_array() {
                    return results.iter().filter_map(|r| {
                        let img_url = r["img_src"].as_str()?.to_string();
                        let title = r["title"].as_str().unwrap_or("").to_string();
                        let snippet = r["content"].as_str().unwrap_or("").to_string();
                        Some(SearxngResult { url: img_url, title, snippet })
                    }).collect();
                }
            }
        }
    }
    Vec::new()
}

// ─── HEAD request helper ──────────────────────────────────────────────────────

/// Vérifie si une URL existe via HEAD request (timeout court).
/// Utilisé pour valider les images Cloudinary avant de les ajouter.
pub async fn url_exists(url: &str) -> bool {
    if let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        match client.head(url).send().await {
            Ok(r) => r.status().is_success(),
            Err(_) => false,
        }
    } else {
        false
    }
}

// ─── Currency Conversion ──────────────────────────────────────────────────────

pub fn convert_to_eur(amount: f64, currency: &str) -> f64 {
    match currency.to_uppercase().as_str() {
        "USD" => amount * 0.92,
        "CHF" => amount * 1.04,
        "GBP" => amount * 1.17,
        "MAD" => amount * 0.093,
        _ => amount,
    }
}
