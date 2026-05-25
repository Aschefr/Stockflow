mod config;
mod db;
mod events;
mod csv_importer;

use config::{AppConfig, load_config_internal, save_config_internal};
use db::{Product, ProductHistoryItem};
use rusqlite::Connection;
use serde_json::json;

#[tauri::command]
fn get_config() -> Option<AppConfig> {
    load_config_internal()
}

#[tauri::command]
fn save_config(trigramme: String, network_path: String) -> Result<(), String> {
    let clean_trigramme = trigramme.trim().to_uppercase();
    if clean_trigramme.len() != 3 {
        return Err("Le trigramme doit comporter exactement 3 caractères.".to_string());
    }
    
    let config = AppConfig {
        trigramme: clean_trigramme,
        network_path: network_path.trim().to_string(),
    };
    
    // Initialiser les dossiers réseau
    save_config_internal(&config)?;

    // Initialiser la base de données cache locale SQLite
    if let Some(db_path) = events::get_db_path() {
        if let Ok(conn) = Connection::open(db_path) {
            let _ = db::init_db(&conn);
        }
    }

    Ok(())
}

#[tauri::command]
fn select_network_directory() -> Option<String> {
    let dir = rfd::FileDialog::new()
        .set_title("Sélectionner le dossier réseau Stockflow")
        .pick_folder();
    dir.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn select_csv_file() -> Option<String> {
    let file = rfd::FileDialog::new()
        .set_title("Sélectionner le fichier CSV à importer")
        .add_filter("CSV Files (*.csv)", &["csv"])
        .pick_file();
    file.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn get_products() -> Result<Vec<Product>, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    // S'assurer de la présence des tables
    let _ = db::init_db(&conn);

    db::get_all_products(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_product_history(sku: String) -> Result<Vec<ProductHistoryItem>, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    db::get_history(&conn, &sku).map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_events(network_path: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        events::sync_events_network(&network_path)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn create_product(
    network_path: String,
    trigramme: String,
    sku: String,
    mpn: String,
    label: String,
    brand: String,
    category: String,
    sub_category: String,
    location: String,
    item_type: String,
    min_stock: f64,
    price: f64,
    image_path: Option<String>,
    pdf_path: Option<String>,
    attributes: serde_json::Value,
) -> Result<(), String> {
    let clean_sku = sku.trim().replace(" ", "").replace("/", "-").to_uppercase();
    if clean_sku.is_empty() {
        return Err("Le SKU/Référence interne ne peut pas être vide.".to_string());
    }

    let payload = json!({
        "sku": clean_sku,
        "mpn": mpn.trim(),
        "label": label.trim(),
        "brand": brand.trim(),
        "category": category.trim(),
        "subCategory": sub_category.trim(),
        "location": location.trim(),
        "type": item_type,
        "minStock": min_stock,
        "price": price,
        "image_path": image_path,
        "pdf_path": pdf_path,
        "attributes": attributes,
    });

    events::write_event_file(&network_path, "PRODUCT_CREATE", &trigramme, payload)
}

#[tauri::command]
fn add_movement(
    network_path: String,
    trigramme: String,
    event_type: String, // "STOCK_IN" ou "STOCK_OUT"
    sku: String,
    qty: f64,
    note: String,
) -> Result<(), String> {
    if qty <= 0.0 {
        return Err("La quantité doit être supérieure à 0.".to_string());
    }

    let payload = json!({
        "sku": sku,
        "qty": qty,
        "note": note.trim(),
    });

    events::write_event_file(&network_path, &event_type, &trigramme, payload)
}

#[tauri::command]
async fn import_csv(
    csv_path: String,
    network_path: String,
    trigramme: String,
    media_dir: Option<String>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        csv_importer::import_csv_file(
            &csv_path,
            &network_path,
            &trigramme,
            media_dir.as_deref()
        )
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_dashboard_stats() -> Result<serde_json::Value, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let total_refs: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |row| row.get(0)).unwrap_or(0);
    
    let total_value: f64 = conn.query_row(
        "SELECT SUM(price * current_stock) FROM products",
        [],
        |row| row.get(0)
    ).unwrap_or(0.0);

    let low_stock_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM products WHERE current_stock <= min_stock AND min_stock > 0 AND current_stock > 0",
        [],
        |row| row.get(0)
    ).unwrap_or(0);

    let out_of_stock_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM products WHERE current_stock = 0",
        [],
        |row| row.get(0)
    ).unwrap_or(0);

    // Récupérer les 5 derniers mouvements
    let mut stmt = conn.prepare(
        "SELECT sku, timestamp, trigramme, event_type, qty, note 
         FROM product_history 
         ORDER BY timestamp DESC LIMIT 5"
    ).map_err(|e| e.to_string())?;

    let recent_moves_iter = stmt.query_map([], |row| {
        Ok(json!({
            "sku": row.get::<_, String>(0)?,
            "timestamp": row.get::<_, String>(1)?,
            "trigramme": row.get::<_, String>(2)?,
            "event_type": row.get::<_, String>(3)?,
            "qty": row.get::<_, f64>(4)?,
            "note": row.get::<_, String>(5)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut recent_moves = Vec::new();
    for item in recent_moves_iter {
        if let Ok(val) = item {
            recent_moves.push(val);
        }
    }

    Ok(json!({
        "total_references": total_refs,
        "total_value": total_value,
        "low_stock_count": low_stock_count,
        "out_of_stock_count": out_of_stock_count,
        "recent_movements": recent_moves,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            select_network_directory,
            select_csv_file,
            get_products,
            get_product_history,
            sync_events,
            create_product,
            add_movement,
            import_csv,
            get_dashboard_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
