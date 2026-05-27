use serde::{Serialize, Deserialize};
use std::path::{Path, PathBuf};
use std::fs;
use rusqlite::{Connection, Transaction};
use uuid::Uuid;
use chrono::Utc;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Event {
    pub event_id: String,
    pub event_type: String, // "PRODUCT_CREATE", "PRODUCT_UPDATE", "STOCK_IN", "STOCK_OUT", "STOCK_REVERSAL"
    pub timestamp: String,
    pub trigramme: String,
    pub payload: serde_json::Value,
}

pub fn get_db_path() -> Option<PathBuf> {
    super::config::get_config_dir().map(|mut p| {
        p.push("stockflow.db");
        p
    })
}

pub fn write_event_file(network_path: &str, event_type: &str, trigramme: &str, payload: serde_json::Value) -> Result<(), String> {
    let event = Event {
        event_id: Uuid::new_v4().to_string(),
        event_type: event_type.to_string(),
        timestamp: Utc::now().to_rfc3339(),
        trigramme: trigramme.to_uppercase(),
        payload,
    };

    // Extraire le SKU du payload pour un nom de fichier explicite et lisible
    let sku = event.payload["sku"]
        .as_str()
        .unwrap_or("GLOBAL")
        .to_string();

    let filename = format!(
        "{}_{}_{}_{}_{}.json",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        event.trigramme,
        event.event_type,
        sku,
        &event.event_id[..4]
    );

    let net_events_dir = PathBuf::from(network_path).join("events");
    
    // Si le dossier réseau existe, on écrit directement dessus
    if net_events_dir.exists() {
        let file_path = net_events_dir.join(&filename);
        let data = serde_json::to_string_pretty(&event)
            .map_err(|e| format!("Erreur sérialisation événement : {}", e))?;
        fs::write(&file_path, data)
            .map_err(|e| format!("Erreur écriture réseau : {}", e))?;
        
        // Enregistrer également dans applied_events pour éviter de le relire en sync
        if let Some(db_path) = get_db_path() {
            if let Ok(conn) = Connection::open(db_path) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO applied_events (filename, processed_at) VALUES (?, ?)",
                    [filename, Utc::now().to_rfc3339()],
                );
                // On applique directement l'événement localement pour réactivité immédiate
                let _ = apply_single_event(&conn, &event);
            }
        }
    } else {
        // Mode Hors-ligne : enregistrer dans les événements en attente locaux
        let db_path = get_db_path().ok_or("Impossible de trouver le chemin de la base de données cache")?;
        let conn = Connection::open(db_path).map_err(|e| format!("Erreur SQLite : {}", e))?;
        
        // Créer la table des événements en attente si absente
        let _ = conn.execute(
            "CREATE TABLE IF NOT EXISTS pending_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                event_data TEXT NOT NULL
            )",
            [],
        );

        let data = serde_json::to_string_pretty(&event)
            .map_err(|e| format!("Erreur sérialisation événement : {}", e))?;
        
        conn.execute(
            "INSERT INTO pending_events (filename, event_data) VALUES (?, ?)",
            [filename, data],
        ).map_err(|e| format!("Erreur enregistrement événement hors-ligne : {}", e))?;

        // Appliquer l'événement sur le stock local pour que l'utilisateur voie la modification
        let _ = apply_single_event(&conn, &event);
        
        return Err("RÉSEAU_HORS_LIGNE : Mouvement stocké localement en attente de reconnexion.".to_string());
    }

    Ok(())
}

pub fn sync_events_network(network_path: &str) -> Result<usize, String> {
    let db_path = get_db_path().ok_or("Base de données cache introuvable")?;
    let mut conn = Connection::open(db_path).map_err(|e| format!("Erreur SQLite : {}", e))?;

    let net_events_dir = PathBuf::from(network_path).join("events");
    if !net_events_dir.exists() {
        return Err("Le dossier réseau partagé est inaccessible.".to_string());
    }

    // 1. Pousser les événements en attente (hors-ligne résolu)
    let _ = push_pending_events(&mut conn, &net_events_dir);

    // 2. Récupérer la liste des événements sur le réseau
    let mut entries = fs::read_dir(&net_events_dir)
        .map_err(|e| format!("Impossible de lire le dossier d'événements réseau : {}", e))?
        .filter_map(|res| res.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_ok())
        .collect::<Vec<String>>();

    // Si le dossier réseau d'événements existe mais ne contient aucun fichier JSON,
    // et que notre base locale contient des événements déjà appliqués, cela signifie
    // que nous avons changé pour un dossier réseau vide. On vide le cache local.
    let local_applied_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM applied_events",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    if entries.is_empty() && local_applied_count > 0 {
        let _ = super::db::clear_db(&conn);
    }

    // Trier par nom de fichier chronologiquement
    entries.sort();

    let tx = conn.transaction().map_err(|e| format!("Erreur début de transaction : {}", e))?;
    let mut sync_count = 0;

    for filename in entries {
        // Vérifier si déjà appliqué
        let already_applied: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM applied_events WHERE filename = ?)",
            [&filename],
            |row| row.get(0),
        ).unwrap_or(false);

        if !already_applied {
            let file_path = net_events_dir.join(&filename);
            let content = fs::read_to_string(file_path).unwrap_or_default();
            if let Ok(event) = serde_json::from_str::<Event>(&content) {
                if apply_single_event_in_tx(&tx, &event).is_ok() {
                    tx.execute(
                        "INSERT INTO applied_events (filename, processed_at) VALUES (?, ?)",
                        [&filename, &Utc::now().to_rfc3339()],
                    ).unwrap_or(0);
                    sync_count += 1;
                }
            }
        }
    }

    tx.commit().map_err(|e| format!("Erreur validation transaction : {}", e))?;
    Ok(sync_count)
}

fn push_pending_events(conn: &mut Connection, net_events_dir: &Path) -> Result<(), String> {
    // Créer la table si absente au cas où
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS pending_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            event_data TEXT NOT NULL
        )",
        [],
    );

    let mut stmt = conn.prepare("SELECT id, filename, event_data FROM pending_events ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    
    let pending_rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    }).map_err(|e| e.to_string())?;

    let mut to_delete = Vec::new();

    for row in pending_rows {
        if let Ok((id, filename, event_data)) = row {
            let file_path = net_events_dir.join(&filename);
            if fs::write(&file_path, &event_data).is_ok() {
                to_delete.push(id);
                // Enregistrer en appliqué local
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO applied_events (filename, processed_at) VALUES (?, ?)",
                    [filename, Utc::now().to_rfc3339()],
                );
            } else {
                // Le réseau est toujours en panne, on s'arrête
                break;
            }
        }
    }

    for id in to_delete {
        let _ = conn.execute("DELETE FROM pending_events WHERE id = ?", [id]);
    }

    Ok(())
}

trait EndsOk {
    fn ends_ok(&self) -> bool;
}

impl EndsOk for String {
    fn ends_ok(&self) -> bool {
        self.ends_with(".json")
    }
}

// Applique un événement en dehors d'une transaction active
fn apply_single_event(conn: &Connection, event: &Event) -> Result<(), String> {
    match event.event_type.as_str() {
        "PRODUCT_CREATE" | "PRODUCT_UPDATE" => {
            let p = event.payload.clone();
            let sku = p["sku"].as_str().unwrap_or("");
            let initial_stock = p["initial_stock"].as_f64().unwrap_or(0.0);
            conn.execute(
                "INSERT OR REPLACE INTO products (
                    sku, mpn, label, brand, category, sub_category, location, 
                    item_type, min_stock, price, current_stock, attributes, image_path, pdf_path, pack_size
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT current_stock FROM products WHERE sku = ?), ?), ?, ?, ?, ?)",
                (
                    sku,
                    p["mpn"].as_str().unwrap_or(""),
                    p["label"].as_str().unwrap_or(""),
                    p["brand"].as_str().or(None),
                    p["category"].as_str().or(None),
                    p["subCategory"].as_str().or(None),
                    p["location"].as_str().or(None),
                    p["type"].as_str().unwrap_or("QUANTITATIVE"),
                    p["minStock"].as_f64().unwrap_or(0.0),
                    p["price"].as_f64().unwrap_or(0.0),
                    sku, // pour COALESCE
                    initial_stock, // fallback pour COALESCE
                    p["attributes"].to_string(),
                    p["image_path"].as_str().or(None),
                    p["pdf_path"].as_str().or(None),
                    p["packSize"].as_i64().unwrap_or(1),
                )
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "INSERT INTO product_history (sku, timestamp, trigramme, event_type, qty, note) VALUES (?, ?, ?, ?, ?, ?)",
                (sku, &event.timestamp, &event.trigramme, event.event_type.as_str(), initial_stock, ""),
            ).map_err(|e| e.to_string())?;
        }
        "PRODUCT_DELETE" => {
            let sku = event.payload["sku"].as_str().unwrap_or("");
            conn.execute("DELETE FROM products WHERE sku = ?", [sku]).map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM product_history WHERE sku = ?", [sku]).map_err(|e| e.to_string())?;
        }
        "STOCK_IN" => {
            let sku = event.payload["sku"].as_str().unwrap_or("");
            let qty = event.payload["qty"].as_f64().unwrap_or(0.0);
            let note = event.payload["note"].as_str().unwrap_or("");

            conn.execute(
                "UPDATE products SET current_stock = current_stock + ? WHERE sku = ?",
                (qty, sku),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "INSERT INTO product_history (sku, timestamp, trigramme, event_type, qty, note) VALUES (?, ?, ?, ?, ?, ?)",
                (sku, &event.timestamp, &event.trigramme, "STOCK_IN", qty, note),
            ).map_err(|e| e.to_string())?;
        }
        "STOCK_OUT" => {
            let sku = event.payload["sku"].as_str().unwrap_or("");
            let qty = event.payload["qty"].as_f64().unwrap_or(0.0);
            let note = event.payload["note"].as_str().unwrap_or("");

            conn.execute(
                "UPDATE products SET current_stock = MAX(0.0, current_stock - ?) WHERE sku = ?",
                (qty, sku),
            ).map_err(|e| e.to_string())?;

            conn.execute(
                "INSERT INTO product_history (sku, timestamp, trigramme, event_type, qty, note) VALUES (?, ?, ?, ?, ?, ?)",
                (sku, &event.timestamp, &event.trigramme, "STOCK_OUT", qty, note),
            ).map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    Ok(())
}

// Applique un événement à l'intérieur d'une transaction
fn apply_single_event_in_tx(tx: &Transaction, event: &Event) -> Result<(), String> {
    match event.event_type.as_str() {
        "PRODUCT_CREATE" | "PRODUCT_UPDATE" => {
            let p = event.payload.clone();
            let sku = p["sku"].as_str().unwrap_or("");
            let initial_stock = p["initial_stock"].as_f64().unwrap_or(0.0);
            tx.execute(
                "INSERT OR REPLACE INTO products (
                    sku, mpn, label, brand, category, sub_category, location, 
                    item_type, min_stock, price, current_stock, attributes, image_path, pdf_path, pack_size
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT current_stock FROM products WHERE sku = ?), ?), ?, ?, ?, ?)",
                (
                    sku,
                    p["mpn"].as_str().unwrap_or(""),
                    p["label"].as_str().unwrap_or(""),
                    p["brand"].as_str().or(None),
                    p["category"].as_str().or(None),
                    p["subCategory"].as_str().or(None),
                    p["location"].as_str().or(None),
                    p["type"].as_str().unwrap_or("QUANTITATIVE"),
                    p["minStock"].as_f64().unwrap_or(0.0),
                    p["price"].as_f64().unwrap_or(0.0),
                    sku, // pour COALESCE
                    initial_stock, // fallback pour COALESCE
                    p["attributes"].to_string(),
                    p["image_path"].as_str().or(None),
                    p["pdf_path"].as_str().or(None),
                    p["packSize"].as_i64().unwrap_or(1),
                )
            ).map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO product_history (sku, timestamp, trigramme, event_type, qty, note) VALUES (?, ?, ?, ?, ?, ?)",
                (sku, &event.timestamp, &event.trigramme, event.event_type.as_str(), initial_stock, ""),
            ).map_err(|e| e.to_string())?;
        }
        "PRODUCT_DELETE" => {
            let sku = event.payload["sku"].as_str().unwrap_or("");
            tx.execute("DELETE FROM products WHERE sku = ?", [sku]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM product_history WHERE sku = ?", [sku]).map_err(|e| e.to_string())?;
        }
        "STOCK_IN" => {
            let sku = event.payload["sku"].as_str().unwrap_or("");
            let qty = event.payload["qty"].as_f64().unwrap_or(0.0);
            let note = event.payload["note"].as_str().unwrap_or("");

            tx.execute(
                "UPDATE products SET current_stock = current_stock + ? WHERE sku = ?",
                (qty, sku),
            ).map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO product_history (sku, timestamp, trigramme, event_type, qty, note) VALUES (?, ?, ?, ?, ?, ?)",
                (sku, &event.timestamp, &event.trigramme, "STOCK_IN", qty, note),
            ).map_err(|e| e.to_string())?;
        }
        "STOCK_OUT" => {
            let sku = event.payload["sku"].as_str().unwrap_or("");
            let qty = event.payload["qty"].as_f64().unwrap_or(0.0);
            let note = event.payload["note"].as_str().unwrap_or("");

            tx.execute(
                "UPDATE products SET current_stock = MAX(0.0, current_stock - ?) WHERE sku = ?",
                (qty, sku),
            ).map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO product_history (sku, timestamp, trigramme, event_type, qty, note) VALUES (?, ?, ?, ?, ?, ?)",
                (sku, &event.timestamp, &event.trigramme, "STOCK_OUT", qty, note),
            ).map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    Ok(())
}

// ==================== AUDIT LOG (fichiers JSON réseau dans audit/) ====================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditEntry {
    pub audit_id: String,
    pub sku: String,
    pub timestamp: String,
    pub trigramme: String,
    pub action: String,
    pub field: Option<String>,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub source_url: Option<String>,
}

pub fn write_audit_file(
    network_path: &str,
    sku: &str,
    trigramme: &str,
    action: &str,
    field: Option<&str>,
    old_value: Option<&str>,
    new_value: Option<&str>,
    source_url: Option<&str>,
) -> Result<(), String> {
    let audit_id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().to_rfc3339();

    let entry = AuditEntry {
        audit_id: audit_id.clone(),
        sku: sku.to_uppercase(),
        timestamp: timestamp.clone(),
        trigramme: trigramme.to_uppercase(),
        action: action.to_string(),
        field: field.map(|s| s.to_string()),
        old_value: old_value.map(|s| s.to_string()),
        new_value: new_value.map(|s| s.to_string()),
        source_url: source_url.map(|s| s.to_string()),
    };

    let filename = format!(
        "{}_{}_{}_AUDIT_{}_{}.json",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        entry.trigramme,
        action,
        sku.to_uppercase(),
        &audit_id[..4]
    );

    let audit_dir = PathBuf::from(network_path).join("audit");
    if !audit_dir.exists() {
        fs::create_dir_all(&audit_dir).map_err(|e| format!("Erreur création dossier audit : {}", e))?;
    }

    let file_path = audit_dir.join(&filename);
    let data = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Erreur sérialisation audit : {}", e))?;
    fs::write(&file_path, data)
        .map_err(|e| format!("Erreur écriture audit réseau : {}", e))?;

    // Appliquer directement en local pour réactivité immédiate
    if let Some(db_path) = get_db_path() {
        if let Ok(conn) = Connection::open(db_path) {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO product_audit_log (audit_id, sku, timestamp, trigramme, action, field, old_value, new_value, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    &entry.audit_id,
                    &entry.sku,
                    &entry.timestamp,
                    &entry.trigramme,
                    &entry.action,
                    &entry.field,
                    &entry.old_value,
                    &entry.new_value,
                    &entry.source_url,
                ),
            );
            let _ = conn.execute(
                "INSERT OR IGNORE INTO applied_audits (filename, processed_at) VALUES (?, ?)",
                [&filename, &Utc::now().to_rfc3339()],
            );
        }
    }

    Ok(())
}

pub fn sync_audit_files(network_path: &str) -> Result<usize, String> {
    let db_path = get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| format!("Erreur SQLite : {}", e))?;

    // S'assurer que les tables existent
    let _ = super::db::init_db(&conn);

    let audit_dir = PathBuf::from(network_path).join("audit");
    if !audit_dir.exists() {
        return Ok(0);
    }

    let mut entries: Vec<String> = fs::read_dir(&audit_dir)
        .map_err(|e| format!("Impossible de lire le dossier audit : {}", e))?
        .filter_map(|res| res.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".json"))
        .collect();

    entries.sort();

    let mut sync_count = 0;

    for filename in entries {
        let already_applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM applied_audits WHERE filename = ?)",
            [&filename],
            |row| row.get(0),
        ).unwrap_or(false);

        if !already_applied {
            let file_path = audit_dir.join(&filename);
            let content = fs::read_to_string(&file_path).unwrap_or_default();
            if let Ok(entry) = serde_json::from_str::<AuditEntry>(&content) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO product_audit_log (audit_id, sku, timestamp, trigramme, action, field, old_value, new_value, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        &entry.audit_id,
                        &entry.sku,
                        &entry.timestamp,
                        &entry.trigramme,
                        &entry.action,
                        &entry.field,
                        &entry.old_value,
                        &entry.new_value,
                        &entry.source_url,
                    ),
                );
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO applied_audits (filename, processed_at) VALUES (?, ?)",
                    [&filename, &Utc::now().to_rfc3339()],
                );
                sync_count += 1;
            }
        }
    }

    Ok(sync_count)
}
