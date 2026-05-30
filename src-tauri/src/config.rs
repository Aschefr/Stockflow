use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use std::fs;

fn default_vpc_sites() -> Vec<String> {
    vec!["RS".to_string(), "Farnell".to_string(), "Mouser".to_string(), "Conrad".to_string()]
}

fn default_pdf_rename() -> Option<String> {
    Some("{SKU}_datasheet.pdf".to_string())
}

fn default_image_rename() -> Option<String> {
    Some("{SKU}_{Index}.jpg".to_string())
}

fn default_pdf_size_threshold() -> Option<f64> {
    Some(5.0)
}

fn default_price_tax_type() -> Option<String> {
    Some("HT".to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub trigramme: String,
    pub network_path: String,
    #[serde(default)]
    pub searxng_url: Option<String>,
    #[serde(default = "default_vpc_sites")]
    pub vpc_sites: Vec<String>,
    #[serde(default = "default_pdf_rename")]
    pub pdf_rename_convention: Option<String>,
    #[serde(default = "default_image_rename")]
    pub image_rename_convention: Option<String>,
    #[serde(default = "default_pdf_size_threshold")]
    pub pdf_size_threshold: Option<f64>,
    #[serde(default = "default_price_tax_type")]
    pub price_tax_type: Option<String>,
    #[serde(default)]
    pub vpc_api_keys: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub vpc_urls: std::collections::HashMap<String, String>,
}

pub fn get_config_dir() -> Option<PathBuf> {
    // Dans un environnement Windows standard, on récupère APPDATA
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|mut p| {
            p.push("Stockflow");
            p
        })
}

pub fn get_config_path() -> Option<PathBuf> {
    get_config_dir().map(|mut p| {
        p.push("config.json");
        p
    })
}

pub fn load_config_internal() -> Option<AppConfig> {
    let path = get_config_path()?;
    if !path.exists() {
        return None;
    }
    let data = fs::read_to_string(path).ok()?;
    let mut config: AppConfig = serde_json::from_str(&data).ok()?;
    
    // S'assurer que les 4 fournisseurs intégrés sont toujours présents
    let builtins = ["RS", "Farnell", "Mouser", "Conrad"];
    for builtin in &builtins {
        if !config.vpc_sites.iter().any(|s| s.to_lowercase() == builtin.to_lowercase()) {
            config.vpc_sites.push(builtin.to_string());
        }
    }
    
    Some(config)
}

pub fn save_config_internal(config: &AppConfig) -> Result<(), String> {
    let mut config_to_save = config.clone();
    
    // S'assurer que les 4 fournisseurs intégrés sont toujours présents
    let builtins = ["RS", "Farnell", "Mouser", "Conrad"];
    for builtin in &builtins {
        if !config_to_save.vpc_sites.iter().any(|s| s.to_lowercase() == builtin.to_lowercase()) {
            config_to_save.vpc_sites.push(builtin.to_string());
        }
    }

    // 1. Sauvegarde locale du fichier de config
    let dir = get_config_dir().ok_or("Impossible de localiser le dossier APPDATA")?;
    fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier config : {}", e))?;
    
    let path = dir.join("config.json");
    let data = serde_json::to_string_pretty(&config_to_save)
        .map_err(|e| format!("Erreur sérialisation config : {}", e))?;
    fs::write(path, data).map_err(|e| format!("Erreur écriture config : {}", e))?;

    // 2. Initialisation et vérification des sous-dossiers sur le lecteur réseau partagé
    let net_path = PathBuf::from(&config_to_save.network_path);
    if !net_path.exists() {
        return Err("Le chemin réseau spécifié est introuvable ou inaccessible.".to_string());
    }

    let folders = ["events", "images", "documents"];
    for folder in &folders {
        let f_path = net_path.join(folder);
        fs::create_dir_all(&f_path)
            .map_err(|e| format!("Impossible de créer le sous-dossier réseau '{}' : {}", folder, e))?;
    }

    Ok(())
}
