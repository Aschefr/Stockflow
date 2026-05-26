mod config;
mod db;
mod events;
mod csv_importer;
mod scraper;

use config::{AppConfig, load_config_internal, save_config_internal};
use db::{Product, ProductHistoryItem};
use rusqlite::Connection;
use serde_json::json;

#[tauri::command]
fn get_config() -> Option<AppConfig> {
    load_config_internal()
}

#[tauri::command]
fn save_config(
    trigramme: String,
    network_path: String,
    searxng_url: Option<String>,
    vpc_sites: Vec<String>,
    pdf_rename_convention: Option<String>,
    image_rename_convention: Option<String>,
    pdf_size_threshold: Option<f64>,
) -> Result<(), String> {
    let clean_trigramme = trigramme.trim().to_uppercase();
    if clean_trigramme.len() != 3 {
        return Err("Le trigramme doit comporter exactement 3 caractères.".to_string());
    }
    
    let old_path = load_config_internal().map(|c| c.network_path).unwrap_or_default();
    let new_path = network_path.trim().to_string();
    let path_changed = old_path != new_path;
    
    let config = AppConfig {
        trigramme: clean_trigramme,
        network_path: new_path,
        searxng_url: searxng_url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        vpc_sites,
        pdf_rename_convention: pdf_rename_convention.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        image_rename_convention: image_rename_convention.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        pdf_size_threshold,
    };
    
    // Initialiser les dossiers réseau
    save_config_internal(&config)?;

    // Initialiser la base de données cache locale SQLite
    if let Some(db_path) = events::get_db_path() {
        if let Ok(conn) = Connection::open(db_path) {
            let _ = db::init_db(&conn);
            if path_changed {
                let _ = db::clear_db(&conn);
            }
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
fn select_image_dir() -> Option<String> {
    let dir = rfd::FileDialog::new()
        .set_title("Sélectionner le dossier des images")
        .pick_folder();
    dir.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn select_pdf_dir() -> Option<String> {
    let dir = rfd::FileDialog::new()
        .set_title("Sélectionner le dossier des PDF")
        .pick_folder();
    dir.map(|p| p.to_string_lossy().to_string())
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
    pack_size: i64,
) -> Result<(), String> {
    let clean_sku = db::sanitize_sku(&sku);
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
        "packSize": pack_size,
    });

    events::write_event_file(&network_path, "PRODUCT_CREATE", &trigramme, payload)
}

#[tauri::command]
fn delete_product(
    network_path: String,
    trigramme: String,
    sku: String,
) -> Result<(), String> {
    let clean_sku = db::sanitize_sku(&sku);
    if clean_sku.is_empty() {
        return Err("Le SKU/Référence interne ne peut pas être vide.".to_string());
    }

    // Récupérer les métadonnées (brand, category, sub_category) pour construire le chemin cascade des PDF
    if let Some(db_path) = events::get_db_path() {
        if let Ok(conn) = Connection::open(&db_path) {
            let row_opt: Option<(String, String, String)> = conn.query_row(
                "SELECT brand, category, sub_category FROM products WHERE sku = ?",
                [&clean_sku],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    ))
                }
            ).ok();

            if let Some((brand, category, sub_category)) = row_opt {
                // 1. Supprimer le dossier cascade de notices PDF
                let clean_brand = csv_importer::sanitize_folder_name(&brand, "INCONNUE");
                let clean_cat = csv_importer::sanitize_folder_name(&category, "SANS_FAMILLE");
                let clean_subcat = csv_importer::sanitize_folder_name(&sub_category, "SANS_SOUS_FAMILLE");
                
                let doc_dir = std::path::Path::new(&network_path)
                    .join("documents")
                    .join(&clean_brand)
                    .join(&clean_cat)
                    .join(&clean_subcat)
                    .join(&clean_sku);
                    
                if doc_dir.exists() {
                    let _ = std::fs::remove_dir_all(&doc_dir);
                }

                // 2. Supprimer les images associées dans le dossier images/
                let img_dir = std::path::Path::new(&network_path).join("images");
                if img_dir.exists() {
                    if let Ok(entries) = std::fs::read_dir(img_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.is_file() {
                                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                                    if file_name.starts_with(&format!("{}_", clean_sku.to_uppercase())) 
                                        || file_name.starts_with(&format!("{}_", clean_sku)) {
                                        let _ = std::fs::remove_file(&path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let payload = json!({
        "sku": clean_sku,
    });

    events::write_event_file(&network_path, "PRODUCT_DELETE", &trigramme, payload)
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
    images_dir: Option<String>,
    pdf_dir: Option<String>,
) -> Result<csv_importer::ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        csv_importer::import_csv_file(
            &csv_path,
            &network_path,
            &trigramme,
            images_dir.as_deref(),
            pdf_dir.as_deref()
        )
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn upload_media(
    network_path: String,
    sku: String,
    media_type: String, // "image" ou "pdf"
    file_name: String,
    file_data: Vec<u8>
) -> Result<String, String> {
    let dest_dir = if media_type == "image" {
        std::path::Path::new(&network_path).join("images")
    } else {
        std::path::Path::new(&network_path).join("documents").join(&sku)
    };
    
    let _ = std::fs::create_dir_all(&dest_dir);
    let dest_path = dest_dir.join(&file_name);
    
    std::fs::write(&dest_path, file_data).map_err(|e| e.to_string())?;
    
    let relative_path = if media_type == "image" {
        format!("images/{}", file_name)
    } else {
        format!("documents/{}/{}", sku, file_name)
    };
    
    Ok(relative_path)
}

#[tauri::command]
fn list_sku_images(network_path: String, sku: String) -> Result<Vec<String>, String> {
    let images_dir = std::path::Path::new(&network_path).join("images");
    if !images_dir.exists() {
        return Ok(Vec::new());
    }
    let mut images = Vec::new();
    let sku_upper = sku.to_uppercase();
    if let Ok(entries) = std::fs::read_dir(images_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    let name_upper = file_name.to_uppercase();
                    if name_upper.starts_with(&format!("{}_", sku_upper)) || name_upper.starts_with(&format!("{}.", sku_upper)) {
                        images.push(format!("images/{}", file_name));
                    }
                }
            }
        }
    }
    images.sort();
    Ok(images)
}

#[tauri::command]
fn list_sku_pdfs(network_path: String, sku: String) -> Result<Vec<String>, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    let pdf_path_opt: Option<String> = conn.query_row(
        "SELECT pdf_path FROM products WHERE sku = ?",
        [&sku],
        |row| row.get(0)
    ).unwrap_or(None);

    let pdfs_dir = if let Some(ref path) = pdf_path_opt {
        let full_path = std::path::Path::new(&network_path).join(path);
        if full_path.is_file() {
            full_path.parent().unwrap_or(std::path::Path::new("")).to_path_buf()
        } else {
            full_path
        }
    } else {
        std::path::Path::new(&network_path).join("documents").join(&sku)
    };

    if !pdfs_dir.exists() {
        return Ok(Vec::new());
    }

    let mut pdfs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&pdfs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    if file_name.to_lowercase().ends_with(".pdf") {
                        let relative_to_network = path.strip_prefix(&network_path)
                            .map(|p| p.to_string_lossy().to_string().replace("\\", "/"))
                            .unwrap_or_else(|_| format!("documents/{}", file_name));
                        pdfs.push(relative_to_network);
                    }
                }
            }
        }
    }
    pdfs.sort();
    Ok(pdfs)
}

#[tauri::command]
fn get_dashboard_stats() -> Result<serde_json::Value, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let total_refs: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |row| row.get(0)).unwrap_or(0);
    
    let total_value: f64 = conn.query_row(
        "SELECT SUM((current_stock / CAST(pack_size AS REAL)) * price) FROM products",
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

#[tauri::command]
async fn compact_network_events(network_path: String, trigramme: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        
        let products = db::get_all_products(&conn).map_err(|e| e.to_string())?;
        
        let net_events_dir = std::path::PathBuf::from(&network_path).join("events");
        if !net_events_dir.exists() {
            return Err("Dossier réseau inaccessible".to_string());
        }
        
        if let Ok(entries) = std::fs::read_dir(&net_events_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        
        conn.execute("DELETE FROM applied_events", []).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM product_history", []).map_err(|e| e.to_string())?;
        
        for p in products {
            let create_payload = json!({
                "sku": p.sku,
                "mpn": p.mpn,
                "label": p.label,
                "brand": p.brand,
                "category": p.category,
                "subCategory": p.sub_category,
                "location": p.location,
                "type": p.item_type,
                "minStock": p.min_stock,
                "price": p.price,
                "image_path": p.image_path,
                "pdf_path": p.pdf_path,
                "initial_stock": p.current_stock,
                "attributes": serde_json::from_str::<serde_json::Value>(&p.attributes).unwrap_or(json!({}))
            });
            
            events::write_event_file(&network_path, "PRODUCT_CREATE", &trigramme, create_payload)?;
        }
        
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clean_network_media(network_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        
        let products = db::get_all_products(&conn).map_err(|e| e.to_string())?;
        let active_skus: std::collections::HashSet<String> = products.into_iter().map(|p| p.sku.to_uppercase()).collect();
        
        let mut deleted_images = 0;
        let mut deleted_folders = 0;
        
        let images_dir = std::path::Path::new(&network_path).join("images");
        if images_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&images_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                            let name_upper = file_name.to_uppercase();
                            let mut belongs_to_active = false;
                            for sku in &active_skus {
                                if name_upper.starts_with(&format!("{}_", sku)) || name_upper.starts_with(&format!("{}.", sku)) {
                                    belongs_to_active = true;
                                    break;
                                }
                            }
                            if !belongs_to_active {
                                if std::fs::remove_file(path).is_ok() {
                                    deleted_images += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        let docs_dir = std::path::Path::new(&network_path).join("documents");
        if docs_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&docs_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                            let dir_upper = dir_name.to_uppercase();
                            if !active_skus.contains(&dir_upper) {
                                if std::fs::remove_dir_all(path).is_ok() {
                                    deleted_folders += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        Ok(format!("Nettoyage réussi : {} images et {} dossiers de documents obsolètes supprimés.", deleted_images, deleted_folders))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn delete_media(
    network_path: String,
    sku: String,
    media_type: String,
    file_path: String,
) -> Result<(), String> {
    let full_path = std::path::Path::new(&network_path).join(&file_path);
    if !full_path.exists() {
        return Err("Le fichier média spécifié n'existe pas.".to_string());
    }
    
    let path_str = file_path.replace("\\", "/");
    let safe = (media_type == "image" && path_str.starts_with("images/"))
        || (media_type == "pdf" && path_str.starts_with("documents/"));
        
    if !safe {
        return Err("Chemin de média non autorisé.".to_string());
    }
    
    std::fs::remove_file(&full_path).map_err(|e| format!("Erreur lors de la suppression : {}", e))?;
    
    if let Some(db_path) = events::get_db_path() {
        if let Ok(conn) = Connection::open(db_path) {
            let sku_upper = sku.to_uppercase();
            if media_type == "pdf" {
                let current_pdf: Option<String> = conn.query_row(
                    "SELECT pdf_path FROM products WHERE sku = ?",
                    [&sku_upper],
                    |row| row.get(0)
                ).unwrap_or(None);
                
                if let Some(ref cp) = current_pdf {
                    if cp.replace("\\", "/") == path_str {
                        let _ = conn.execute("UPDATE products SET pdf_path = NULL WHERE sku = ?", [&sku_upper]);
                    }
                }
            } else if media_type == "image" {
                let current_img: Option<String> = conn.query_row(
                    "SELECT image_path FROM products WHERE sku = ?",
                    [&sku_upper],
                    |row| row.get(0)
                ).unwrap_or(None);
                
                if let Some(ref ci) = current_img {
                    if ci.replace("\\", "/") == path_str {
                        let remaining_images = list_sku_images(network_path.clone(), sku.clone()).unwrap_or_default();
                        let next_img = remaining_images.first().cloned();
                        let _ = conn.execute("UPDATE products SET image_path = ? WHERE sku = ?", (next_img, &sku_upper));
                    }
                }
            }
        }
    }
    
    Ok(())
}

#[tauri::command]
fn rename_media(
    network_path: String,
    sku: String,
    media_type: String,
    old_path: String,
    new_name: String,
) -> Result<String, String> {
    let old_full = std::path::Path::new(&network_path).join(&old_path);
    if !old_full.exists() {
        return Err("Le fichier à renommer n'existe pas.".to_string());
    }

    let parent = old_full.parent().ok_or("Dossier parent introuvable")?;
    
    let mut clean_new_name = new_name.trim().to_string();
    let ext = old_full.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !clean_new_name.to_lowercase().ends_with(&format!(".{}", ext.to_lowercase())) {
        clean_new_name = format!("{}.{}", clean_new_name, ext);
    }

    let sanitized_name = db::sanitize_sku(&clean_new_name.replace(".pdf", "").replace(".jpg", "").replace(".jpeg", ""));
    let final_name = format!("{}.{}", sanitized_name, ext);

    let new_full = parent.join(&final_name);
    if new_full.exists() {
        return Err("Un fichier avec ce nom existe déjà.".to_string());
    }

    std::fs::rename(&old_full, &new_full).map_err(|e| format!("Erreur système rename : {}", e))?;

    let new_relative = new_full.strip_prefix(&network_path)
        .map(|p| p.to_string_lossy().to_string().replace("\\", "/"))
        .map_err(|e| e.to_string())?;

    if let Some(db_path) = events::get_db_path() {
        if let Ok(conn) = Connection::open(db_path) {
            let sku_upper = sku.to_uppercase();
            if media_type == "pdf" {
                let current_pdf: Option<String> = conn.query_row(
                    "SELECT pdf_path FROM products WHERE sku = ?",
                    [&sku_upper],
                    |row| row.get(0)
                ).unwrap_or(None);
                if let Some(ref cp) = current_pdf {
                    if cp.replace("\\", "/") == old_path.replace("\\", "/") {
                        let _ = conn.execute("UPDATE products SET pdf_path = ? WHERE sku = ?", (&new_relative, &sku_upper));
                    }
                }
            } else if media_type == "image" {
                let current_img: Option<String> = conn.query_row(
                    "SELECT image_path FROM products WHERE sku = ?",
                    [&sku_upper],
                    |row| row.get(0)
                ).unwrap_or(None);
                if let Some(ref ci) = current_img {
                    if ci.replace("\\", "/") == old_path.replace("\\", "/") {
                        let _ = conn.execute("UPDATE products SET image_path = ? WHERE sku = ?", (&new_relative, &sku_upper));
                    }
                }
            }
        }
    }

    Ok(new_relative)
}

#[tauri::command]
fn ensure_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn force_release_lock(network_path: String) {
    scraper::force_release_lock(&network_path);
}

#[tauri::command]
async fn scrape_price(sku: String, provider: String, network_path: String, trigramme: String) -> Result<f64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scraper::scrape_price_internal(&sku, &provider, &network_path, &trigramme)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scrape_pdf(window: tauri::Window, sku: String, query: String, network_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_config_internal().ok_or("Configuration introuvable")?;
        let url = config.searxng_url.clone().unwrap_or_else(|| "http://localhost:8080".to_string());
        let conv = config.pdf_rename_convention.clone().unwrap_or_else(|| "{SKU}_datasheet.pdf".to_string());
        
        scraper::scrape_pdf_internal(&window, &sku, &url, &query, &conv, &network_path)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scrape_images(sku: String, query: String, network_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_config_internal().ok_or("Configuration introuvable")?;
        let url = config.searxng_url.clone().unwrap_or_else(|| "http://localhost:8080".to_string());
        let conv = config.image_rename_convention.clone().unwrap_or_else(|| "{SKU}_{Index}.jpg".to_string());
        
        scraper::scrape_images_internal(&sku, &url, &query, &conv, &network_path)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scrape_product_details(vpc_site: String, vpc_code: String, sku: String) -> Result<scraper::ScrapedProductDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scraper::scrape_product_details_internal(&vpc_site, &vpc_code, &sku)
    }).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            select_network_directory,
            select_csv_file,
            select_image_dir,
            select_pdf_dir,
            get_products,
            get_product_history,
            sync_events,
            create_product,
            delete_product,
            add_movement,
            import_csv,
            upload_media,
            list_sku_images,
            list_sku_pdfs,
            get_dashboard_stats,
            compact_network_events,
            clean_network_media,
            delete_media,
            rename_media,
            force_release_lock,
            scrape_price,
            scrape_pdf,
            scrape_images,
            ensure_directory,
            scrape_product_details
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
