use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use std::fs;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub trigramme: String,
    pub network_path: String,
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
    serde_json::from_str(&data).ok()
}

pub fn save_config_internal(config: &AppConfig) -> Result<(), String> {
    // 1. Sauvegarde locale du fichier de config
    let dir = get_config_dir().ok_or("Impossible de localiser le dossier APPDATA")?;
    fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier config : {}", e))?;
    
    let path = dir.join("config.json");
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Erreur sérialisation config : {}", e))?;
    fs::write(path, data).map_err(|e| format!("Erreur écriture config : {}", e))?;

    // 2. Initialisation et vérification des sous-dossiers sur le lecteur réseau partagé
    let net_path = PathBuf::from(&config.network_path);
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
