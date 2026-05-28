use serde::{Serialize, Deserialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use chrono::Utc;
use std::sync::{Mutex, OnceLock};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackupConfig {
    pub enabled: bool,
    pub scope: String, // "all", "events", "media", etc.
    pub max_backups: usize,
    pub delay_minutes: u64,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            scope: "all".to_string(),
            max_backups: 5,
            delay_minutes: 30,
        }
    }
}

// L'instant de démarrage de l'application
static START_TIME: OnceLock<SystemTime> = OnceLock::new();
// Stockage local de la configuration de sauvegarde pour cette instance
static LOCAL_BACKUP_CONFIG: OnceLock<Mutex<Option<BackupConfig>>> = OnceLock::new();

fn get_start_time() -> SystemTime {
    *START_TIME.get_or_init(SystemTime::now)
}

fn get_local_backup_config() -> &'static Mutex<Option<BackupConfig>> {
    LOCAL_BACKUP_CONFIG.get_or_init(|| Mutex::new(None))
}

pub fn get_backup_config_path(network_path: &str) -> PathBuf {
    PathBuf::from(network_path).join("backup_config.json")
}

pub fn get_backup_lock_path(network_path: &str) -> PathBuf {
    PathBuf::from(network_path).join("backup.lock")
}

pub fn load_backup_config_internal(network_path: &str) -> BackupConfig {
    let path = get_backup_config_path(network_path);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<BackupConfig>(&content) {
                // Mettre à jour notre copie locale
                if let Ok(mut local) = get_local_backup_config().lock() {
                    *local = Some(config.clone());
                }
                return config;
            }
        }
    }
    
    // Si absent sur le réseau, regarder si on a une copie locale
    if let Ok(local) = get_local_backup_config().lock() {
        if let Some(ref config) = *local {
            return config.clone();
        }
    }
    
    BackupConfig::default()
}

pub fn save_backup_config_internal(network_path: &str, config: &BackupConfig) -> Result<(), String> {
    let path = get_backup_config_path(network_path);
    
    // Mettre à jour notre copie locale
    if let Ok(mut local) = get_local_backup_config().lock() {
        *local = Some(config.clone());
    }

    // Écrire sur le réseau
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Erreur sérialisation config backup : {}", e))?;
    fs::write(path, data)
        .map_err(|e| format!("Erreur écriture config backup réseau : {}", e))?;
    
    Ok(())
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(&dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

pub fn perform_backup(network_path: &str, config: &BackupConfig) -> Result<String, String> {
    let net_path = PathBuf::from(network_path);
    if !net_path.exists() {
        return Err("Le dossier réseau partagé est inaccessible.".to_string());
    }

    // 1. Gestion du Verrou de Concurrence (backup.lock)
    let lock_path = get_backup_lock_path(network_path);
    
    // Tenter de créer/lire le fichier de lock pour voir s'il y a un verrou valide actif
    if lock_path.exists() {
        if let Ok(metadata) = fs::metadata(&lock_path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    // Si le fichier de lock a moins de 5 minutes, on considère qu'un backup est en cours
                    if elapsed.as_secs() < 300 {
                        return Err("Un autre processus de sauvegarde est actuellement en cours (verrou actif).".to_string());
                    }
                }
            }
        }
    }
    
    // Créer ou rafraîchir le verrou
    let instance_info = format!("instance_trigramme_{}", Utc::now().to_rfc3339());
    if let Err(e) = fs::write(&lock_path, instance_info) {
        return Err(format!("Impossible d'acquérir le verrou de sauvegarde : {}", e));
    }

    // Assurer que le verrou est supprimé à la fin (RAII-like)
    struct LockGuard(PathBuf);
    impl Drop for LockGuard {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let _guard = LockGuard(lock_path);

    // 2. Détection des modifications
    // Trouver le fichier d'événement le plus récent sur le réseau
    let events_dir = net_path.join("events");
    let mut newest_event_time: Option<SystemTime> = None;
    if events_dir.exists() {
        if let Ok(entries) = fs::read_dir(events_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if newest_event_time.is_none() || modified > newest_event_time.unwrap() {
                            newest_event_time = Some(modified);
                        }
                    }
                }
            }
        }
    }

    // Trouver le dernier backup existant pour comparer les dates
    let backups_dir = net_path.join("backups");
    let mut newest_backup_time: Option<SystemTime> = None;
    if backups_dir.exists() {
        if let Ok(entries) = fs::read_dir(&backups_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if newest_backup_time.is_none() || modified > newest_backup_time.unwrap() {
                            newest_backup_time = Some(modified);
                        }
                    }
                }
            }
        }
    }

    // S'il y a un dernier backup et qu'il n'y a eu aucun nouvel événement depuis, on annule
    if let (Some(last_evt), Some(last_bk)) = (newest_event_time, newest_backup_time) {
        if last_evt <= last_bk {
            return Ok("Aucune modification détectée depuis la dernière sauvegarde.".to_string());
        }
    }

    // 3. Exécution de la Sauvegarde (Création du sous-dossier)
    let backup_name = format!("backup_{}", Utc::now().format("%Y%m%dT%H%M%SZ"));
    let target_backup_dir = backups_dir.join(&backup_name);
    fs::create_dir_all(&target_backup_dir)
        .map_err(|e| format!("Impossible de créer le dossier de sauvegarde : {}", e))?;

    // Déterminer les dossiers à copier selon le scope
    let mut folders_to_copy = Vec::new();
    if config.scope == "all" || config.scope == "Tout" {
        folders_to_copy.push("events");
        folders_to_copy.push("images");
        folders_to_copy.push("documents");
        folders_to_copy.push("audit");
    } else {
        // Optionnel : périmètre plus restreint (ex: événements uniquement)
        folders_to_copy.push("events");
        folders_to_copy.push("audit");
    }

    for folder in folders_to_copy {
        let src_folder = net_path.join(folder);
        if src_folder.exists() {
            let dst_folder = target_backup_dir.join(folder);
            if let Err(e) = copy_dir_all(&src_folder, &dst_folder) {
                return Err(format!("Échec de la copie du dossier '{}' : {}", folder, e));
            }
        }
    }

    // 4. Conservation (max_backups de rétention)
    if backups_dir.exists() {
        if let Ok(entries) = fs::read_dir(&backups_dir) {
            let mut backups = Vec::new();
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with("backup_") {
                            if let Ok(metadata) = entry.metadata() {
                                if let Ok(modified) = metadata.modified() {
                                    backups.push((path, modified));
                                }
                            }
                        }
                    }
                }
            }

            // Trier par date de modification croissante (plus ancien en premier)
            backups.sort_by_key(|b| b.1);

            // Si on dépasse max_backups, supprimer les plus anciens
            if backups.len() > config.max_backups {
                let to_delete_count = backups.len() - config.max_backups;
                for i in 0..to_delete_count {
                    let _ = fs::remove_dir_all(&backups[i].0);
                }
            }
        }
    }

    Ok(format!("Sauvegarde réussie : {}", backup_name))
}

// Fonction appelée en boucle par le scheduler en arrière-plan
pub fn check_and_run_scheduler() {
    // Récupérer la configuration générale
    let app_config = match super::config::load_config_internal() {
        Some(c) => c,
        None => return,
    };

    if app_config.network_path.trim().is_empty() {
        return;
    }

    let backup_config = load_backup_config_internal(&app_config.network_path);
    if !backup_config.enabled {
        return;
    }

    // Vérifier le délai d'activité de l'application
    if let Ok(elapsed) = get_start_time().elapsed() {
        let elapsed_minutes = elapsed.as_secs() / 60;
        if elapsed_minutes < backup_config.delay_minutes {
            return;
        }
    }

    // Vérifier si on doit exécuter un backup maintenant
    // Pour ne pas lancer la sauvegarde en continu, on vérifie la date du dernier backup
    let backups_dir = PathBuf::from(&app_config.network_path).join("backups");
    let mut last_backup_time: Option<SystemTime> = None;
    if backups_dir.exists() {
        if let Ok(entries) = fs::read_dir(&backups_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with("backup_") {
                            if let Ok(metadata) = entry.metadata() {
                                if let Ok(modified) = metadata.modified() {
                                    if last_backup_time.is_none() || modified > last_backup_time.unwrap() {
                                        last_backup_time = Some(modified);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(last_bk) = last_backup_time {
        if let Ok(elapsed) = last_bk.elapsed() {
            // Si le dernier backup a moins de 60 minutes, on n'en refait pas un
            // (on peut adapter ou laisser le scheduler réguler l'intervalle)
            if elapsed.as_secs() < 3600 {
                return;
            }
        }
    }

    // Lancer le backup
    let _ = perform_backup(&app_config.network_path, &backup_config);
}
