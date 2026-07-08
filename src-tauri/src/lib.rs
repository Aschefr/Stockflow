#![allow(clippy::all, dead_code, unused_variables, unused_imports, unused_mut)]
mod config;
mod db;
mod events;
mod csv_importer;
mod scraper;
mod scraper_http;
mod scraper_extractor;
mod scraper_candidates;
mod scraper_engine;
mod scraper_task;
mod backup;
mod providers;
mod searxng;

use config::{AppConfig, load_config_internal, save_config_internal};
use db::{Product, ProductHistoryItem, AuditLogItem};
use rusqlite::Connection;
use serde_json::json;
use tauri::Manager;

#[tauri::command]
fn get_config() -> Option<AppConfig> {
    load_config_internal()
}

#[tauri::command]
fn save_config(
    trigramme: String,
    network_path: String,
    searxng_url: Option<String>,
    searxng_urls: Vec<String>,
    max_image_candidates: usize,
    vpc_sites: Vec<String>,
    pdf_rename_convention: Option<String>,
    image_rename_convention: Option<String>,
    pdf_size_threshold: Option<f64>,
    price_tax_type: Option<String>,
    vpc_api_keys: std::collections::HashMap<String, String>,
    vpc_urls: std::collections::HashMap<String, String>,
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
        searxng_urls,
        max_image_candidates,
        vpc_sites,
        pdf_rename_convention: pdf_rename_convention.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        image_rename_convention: image_rename_convention.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        pdf_size_threshold,
        price_tax_type,
        vpc_api_keys,
        vpc_urls,
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
fn select_image_file() -> Option<String> {
    let file = rfd::FileDialog::new()
        .set_title("Sélectionner une image (Logo)")
        .add_filter("Images (*.png;*.jpg;*.jpeg)", &["png", "jpg", "jpeg"])
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
fn get_product_audit_log(sku: String) -> Result<Vec<AuditLogItem>, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let _ = db::init_db(&conn);
    db::get_audit_log(&conn, &sku).map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_events(network_path: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let event_count = events::sync_events_network(&network_path)?;
        let _ = events::sync_audit_files(&network_path);
        Ok(event_count)
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

    let mut final_attributes = attributes.clone();
    let mut final_scrape_price_url = attributes.get("scrape_price_url").and_then(|v| v.as_str()).map(|s| s.to_string());
    let mut final_scrape_image_url = attributes.get("scrape_image_url").and_then(|v| v.as_str()).map(|s| s.to_string());
    if final_scrape_image_url.is_none() {
        final_scrape_image_url = attributes.get("scrape_image_urls").and_then(|v| v.as_str()).and_then(|s| {
            serde_json::from_str::<Vec<String>>(s).ok().and_then(|arr| arr.into_iter().next())
        });
    }
    let mut final_scrape_doc_url = attributes.get("scrape_doc_url").and_then(|v| v.as_str()).map(|s| s.to_string());

    // Diff champ par champ pour l'audit log
    if let Some(db_path) = events::get_db_path() {
        if let Ok(conn) = Connection::open(&db_path) {
            let existing: Option<Product> = conn.query_row(
                "SELECT sku, mpn, label, brand, category, sub_category, location, item_type, min_stock, price, current_stock, reserved_stock, attributes, image_path, pdf_path, pack_size FROM products WHERE sku = ?",
                [&clean_sku],
                |row| Ok(Product {
                    sku: row.get(0)?,
                    mpn: row.get(1)?,
                    label: row.get(2)?,
                    brand: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    category: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    sub_category: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    location: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    item_type: row.get(7)?,
                    min_stock: row.get(8)?,
                    price: row.get(9)?,
                    current_stock: row.get(10)?,
                    reserved_stock: row.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
                    attributes: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    image_path: row.get(13)?,
                    pdf_path: row.get(14)?,
                    pack_size: row.get::<_, Option<i64>>(15)?.unwrap_or(1),
                })
            ).ok();

            if let Some(ref old) = existing {
                if let Ok(old_attrs) = serde_json::from_str::<serde_json::Value>(&old.attributes) {
                    if final_scrape_price_url.is_none() {
                        final_scrape_price_url = old_attrs.get("scrape_price_url").and_then(|v| v.as_str()).map(|s| s.to_string());
                    }
                    if final_scrape_image_url.is_none() {
                        final_scrape_image_url = old_attrs.get("scrape_image_url").and_then(|v| v.as_str()).map(|s| s.to_string());
                    }
                    if final_scrape_doc_url.is_none() {
                        final_scrape_doc_url = old_attrs.get("scrape_doc_url").and_then(|v| v.as_str()).map(|s| s.to_string());
                    }
                }
            }

            if let Some(ref url) = final_scrape_price_url {
                if final_attributes.get("scrape_price_url").is_none() {
                    if let Some(obj) = final_attributes.as_object_mut() {
                        obj.insert("scrape_price_url".to_string(), serde_json::Value::String(url.clone()));
                    }
                }
            }
            if let Some(ref url) = final_scrape_image_url {
                if final_attributes.get("scrape_image_url").is_none() {
                    if let Some(obj) = final_attributes.as_object_mut() {
                        obj.insert("scrape_image_url".to_string(), serde_json::Value::String(url.clone()));
                    }
                }
            }
            if let Some(ref url) = final_scrape_doc_url {
                if final_attributes.get("scrape_doc_url").is_none() {
                    if let Some(obj) = final_attributes.as_object_mut() {
                        obj.insert("scrape_doc_url".to_string(), serde_json::Value::String(url.clone()));
                    }
                }
            }

            if let Some(ref old) = existing {
                // Produit existant -> audit des modifications
                let diffs: Vec<(&str, String, String)> = vec![
                    ("Désignation", old.label.clone(), label.trim().to_string()),
                    ("MPN", old.mpn.clone(), mpn.trim().to_string()),
                    ("Marque", old.brand.clone(), brand.trim().to_string()),
                    ("Famille", old.category.clone(), category.trim().to_string()),
                    ("Sous-famille", old.sub_category.clone(), sub_category.trim().to_string()),
                    ("Emplacement", old.location.clone(), location.trim().to_string()),
                    ("Seuil d'alerte", format!("{}", old.min_stock), format!("{}", min_stock)),
                    ("Prix", format!("{:.2}", old.price), format!("{:.2}", price)),
                    ("Taille lot", format!("{}", old.pack_size), format!("{}", pack_size)),
                ];

                for (field_name, old_val, new_val) in diffs {
                    if old_val != new_val {
                        let _ = events::write_audit_file(
                            &network_path, &clean_sku, &trigramme, "UPDATE",
                            Some(field_name), Some(&old_val), Some(&new_val), final_scrape_price_url.as_deref(),
                        );
                    }
                }

                // Comparer les VPC dans les attributs
                let old_vpc = serde_json::from_str::<serde_json::Value>(&old.attributes)
                    .ok().and_then(|a| a.get("vpc").cloned())
                    .unwrap_or(json!({})).to_string();
                let new_vpc = final_attributes.get("vpc").cloned()
                    .unwrap_or(json!({})).to_string();
                if old_vpc != new_vpc {
                    let _ = events::write_audit_file(
                        &network_path, &clean_sku, &trigramme, "UPDATE",
                        Some("Code VPC"), Some(&old_vpc), Some(&new_vpc), final_scrape_price_url.as_deref(),
                    );
                }

                // Comparer les dimensions, poids et notes dans les attributs
                if let Ok(old_attrs) = serde_json::from_str::<serde_json::Value>(&old.attributes) {
                    let fields_to_check: Vec<(&str, &str)> = vec![
                        ("largeur", "Largeur"),
                        ("hauteur", "Hauteur"),
                        ("profondeur", "Profondeur"),
                        ("poids", "Poids"),
                        ("notes", "Notes"),
                        ("scrape_image_urls", "Images"),
                    ];
                    for (key, display_name) in fields_to_check {
                        let old_val = old_attrs.get(key).map(|v| match v {
                            serde_json::Value::String(s) => s.clone(),
                            serde_json::Value::Number(n) => n.to_string(),
                            serde_json::Value::Null => "".to_string(),
                            other => other.to_string(),
                        }).unwrap_or_default().trim().to_string();
                        let new_val = final_attributes.get(key).map(|v| match v {
                            serde_json::Value::String(s) => s.clone(),
                            serde_json::Value::Number(n) => n.to_string(),
                            serde_json::Value::Null => "".to_string(),
                            other => other.to_string(),
                        }).unwrap_or_default().trim().to_string();
                        
                        if old_val != new_val {
                            let _ = events::write_audit_file(
                                &network_path, &clean_sku, &trigramme, "UPDATE",
                                Some(display_name), Some(&old_val), Some(&new_val), final_scrape_price_url.as_deref(),
                            );
                        }
                    }
                }
            } else {
                // Nouveau produit -> audit de création
                let _ = events::write_audit_file(
                    &network_path, &clean_sku, &trigramme, "CREATE",
                    None, None, None, final_scrape_price_url.as_deref(),
                );
            }
        }
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
        "attributes": final_attributes,
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

    let _ = events::write_audit_file(
        &network_path,
        &clean_sku,
        &trigramme,
        "DELETE",
        None,
        None,
        None,
        None,
    );

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
    file_data: Vec<u8>,
    trigramme: String,
) -> Result<String, String> {
    let sku_upper = sku.to_uppercase();

    let dest_dir = if media_type == "image" {
        std::path::Path::new(&network_path).join("images")
    } else {
        // Résoudre la structure hiérarchique documents/{Brand}/{Category}/{SubCategory}/{SKU}/
        // comme le fait le scraper, avec fallback si la DB est inaccessible.
        let hierarchical = events::get_db_path().and_then(|db_path| {
            Connection::open(&db_path).ok().and_then(|conn| {
                conn.query_row(
                    "SELECT brand, category, sub_category FROM products WHERE sku = ?",
                    [&sku_upper],
                    |row| {
                        Ok((
                            row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                            row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        ))
                    },
                ).ok()
            })
        });

        if let Some((brand, category, sub_category)) = hierarchical {
            std::path::Path::new(&network_path)
                .join("documents")
                .join(csv_importer::sanitize_folder_name(&brand, "INCONNU"))
                .join(csv_importer::sanitize_folder_name(&category, "INCONNU"))
                .join(csv_importer::sanitize_folder_name(&sub_category, "INCONNU"))
                .join(&sku_upper)
        } else {
            // Fallback : structure plate si la DB est inaccessible
            std::path::Path::new(&network_path).join("documents").join(&sku_upper)
        }
    };

    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("Impossible de créer le dossier destination : {}", e))?;
    let dest_path = dest_dir.join(&file_name);

    std::fs::write(&dest_path, file_data).map_err(|e| e.to_string())?;

    // Calculer le chemin relatif au network_path (séparateurs UNIX pour cohérence)
    let relative_path = dest_path
        .strip_prefix(&network_path)
        .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
        .unwrap_or_else(|_| {
            if media_type == "image" {
                format!("images/{}", file_name)
            } else {
                format!("documents/{}/{}", sku_upper, file_name)
            }
        });

    let _ = events::write_audit_file(
        &network_path,
        &sku_upper,
        &trigramme,
        "UPLOAD_MEDIA",
        Some(&media_type),
        Some(&relative_path),
        None,
        None,
    );

    // Mettre à jour image_path / pdf_path en DB si aucune référence n'est encore définie
    if let Some(db_path) = events::get_db_path() {
        if let Ok(conn) = Connection::open(&db_path) {
            let col = if media_type == "image" { "image_path" } else { "pdf_path" };
            let current: Option<String> = conn.query_row(
                &format!("SELECT {} FROM products WHERE sku = ?", col),
                [&sku_upper],
                |row| row.get(0),
            ).unwrap_or(None);
            if current.is_none() {
                let _ = conn.execute(
                    &format!("UPDATE products SET {} = ? WHERE sku = ?", col),
                    (&relative_path, &sku_upper),
                );
            }
        }
    }

    Ok(relative_path)
}

/// Version synchrone interne — utilisable depuis un contexte bloquant (ex: delete_media).
fn list_sku_images_sync(network_path: &str, sku: &str) -> Result<Vec<String>, String> {
    let images_dir = std::path::Path::new(network_path).join("images");
    if !images_dir.exists() {
        return Ok(Vec::new());
    }
    let mut images = Vec::new();
    let sku_upper = sku.to_uppercase();
    if let Ok(entries) = std::fs::read_dir(&images_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    let name_upper = file_name.to_uppercase();
                    // Exclure les thumbnails du listing principal
                    if name_upper.starts_with("THUMB_") { continue; }
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
async fn list_sku_images(network_path: String, sku: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_sku_images_sync(&network_path, &sku)
    }).await.map_err(|e| e.to_string())?
}

/// Version synchrone interne — utilisable depuis un contexte bloquant (ex: delete_media).
fn list_sku_pdfs_sync(network_path: &str, sku: &str) -> Result<Vec<String>, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    let sku_upper = sku.to_uppercase();
    let (pdf_path_opt, brand, category, sub_category) = conn.query_row(
        "SELECT pdf_path, brand, category, sub_category FROM products WHERE sku = ?",
        [&sku_upper],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            ))
        }
    ).unwrap_or((None, String::new(), String::new(), String::new()));

    let pdfs_dir = if let Some(ref path) = pdf_path_opt {
        let full_path = std::path::Path::new(network_path).join(path);
        if full_path.is_file() {
            full_path.parent().unwrap_or(std::path::Path::new("")).to_path_buf()
        } else {
            full_path
        }
    } else {
        let clean_brand = csv_importer::sanitize_folder_name(&brand, "INCONNU");
        let clean_category = csv_importer::sanitize_folder_name(&category, "INCONNU");
        let clean_subcategory = csv_importer::sanitize_folder_name(&sub_category, "INCONNU");
        let clean_sku = db::sanitize_sku(sku);
        std::path::Path::new(network_path)
            .join("documents")
            .join(&clean_brand)
            .join(&clean_category)
            .join(&clean_subcategory)
            .join(&clean_sku)
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
                        let relative_to_network = path.strip_prefix(network_path)
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
async fn list_sku_pdfs(network_path: String, sku: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_sku_pdfs_sync(&network_path, &sku)
    }).await.map_err(|e| e.to_string())?
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

    // Récupérer les 100 derniers mouvements (uniquement les flux physiques STOCK_IN et STOCK_OUT)
    let mut stmt = conn.prepare(
        "SELECT sku, timestamp, trigramme, event_type, qty, note 
         FROM product_history 
         WHERE event_type IN ('STOCK_IN', 'STOCK_OUT')
         ORDER BY timestamp DESC LIMIT 100"
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

    // Récupérer les 100 dernières modifications
    let mut audit_stmt = conn.prepare(
        "SELECT sku, timestamp, trigramme, action, field, old_value, new_value, source_url 
         FROM product_audit_log 
         ORDER BY timestamp DESC LIMIT 100"
    ).map_err(|e| e.to_string())?;

    let recent_audits_iter = audit_stmt.query_map([], |row| {
        Ok(json!({
            "sku": row.get::<_, String>(0)?,
            "timestamp": row.get::<_, String>(1)?,
            "trigramme": row.get::<_, String>(2)?,
            "action": row.get::<_, String>(3)?,
            "field": row.get::<_, Option<String>>(4)?,
            "old_value": row.get::<_, Option<String>>(5)?,
            "new_value": row.get::<_, Option<String>>(6)?,
            "source_url": row.get::<_, Option<String>>(7)?,
        }))
    }).map_err(|e| e.to_string())?;

    let mut recent_audits = Vec::new();
    for item in recent_audits_iter {
        if let Ok(val) = item {
            recent_audits.push(val);
        }
    }

    Ok(json!({
        "total_references": total_refs,
        "total_value": total_value,
        "low_stock_count": low_stock_count,
        "out_of_stock_count": out_of_stock_count,
        "recent_movements": recent_moves,
        "recent_audits": recent_audits,
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
                            // Les thumbnails sont gérés conjointement à leur image parente
                            if name_upper.starts_with("THUMB_") { continue; }
                            let mut belongs_to_active = false;
                            for sku in &active_skus {
                                if name_upper.starts_with(&format!("{}_", sku)) || name_upper.starts_with(&format!("{}.", sku)) {
                                    belongs_to_active = true;
                                    break;
                                }
                            }
                            if !belongs_to_active {
                                if std::fs::remove_file(&path).is_ok() {
                                    deleted_images += 1;
                                }
                                // Supprimer également le thumbnail associé s'il existe
                                let thumb = images_dir.join(format!("thumb_{}", file_name));
                                let _ = std::fs::remove_file(&thumb);
                            }
                        }
                    }
                }
            }
        }
        
        // Parcours récursif de documents/{Brand}/{Category}/{SubCategory}/{SKU}/
        // On descend jusqu'aux dossiers-feuille (sans sous-dossiers) et on vérifie
        // si leur nom correspond à un SKU actif.
        let docs_dir = std::path::Path::new(&network_path).join("documents");
        if docs_dir.exists() {
            fn collect_sku_leaf_dirs(
                dir: &std::path::Path,
                active_skus: &std::collections::HashSet<String>,
                deleted: &mut i32,
            ) {
                let Ok(entries) = std::fs::read_dir(dir) else { return };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() { continue; }

                    // Un dossier-feuille n'a aucun sous-dossier
                    let has_subdirs = std::fs::read_dir(&path)
                        .map(|mut e| e.any(|e| e.map(|e| e.path().is_dir()).unwrap_or(false)))
                        .unwrap_or(false);

                    if has_subdirs {
                        // Descendre dans la hiérarchie
                        collect_sku_leaf_dirs(&path, active_skus, deleted);
                    } else {
                        // Dossier-feuille : comparer son nom au SKU attendu
                        if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                            if !active_skus.contains(&dir_name.to_uppercase()) {
                                if std::fs::remove_dir_all(&path).is_ok() {
                                    *deleted += 1;
                                }
                            }
                        }
                    }
                }
            }
            collect_sku_leaf_dirs(&docs_dir, &active_skus, &mut deleted_folders);
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
    trigramme: String,
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

    // Supprimer le thumbnail associé s'il existe (ne pas remonter d'erreur si absent)
    if media_type == "image" {
        if let Some(file_name) = full_path.file_name().and_then(|n| n.to_str()) {
            if let Some(parent) = full_path.parent() {
                let thumb_path = parent.join(format!("thumb_{}", file_name));
                let _ = std::fs::remove_file(&thumb_path);
            }
        }
    }
    
    let _ = events::write_audit_file(
        &network_path,
        &sku,
        &trigramme,
        "DELETE_MEDIA",
        Some(&media_type),
        Some(&file_path),
        None,
        None,
    );
    
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
                        // Utiliser la variante synchrone (on est déjà dans un contexte bloquant)
                        let remaining_pdfs = list_sku_pdfs_sync(&network_path, &sku).unwrap_or_default();
                        let next_pdf = remaining_pdfs.first().cloned();
                        let _ = conn.execute("UPDATE products SET pdf_path = ? WHERE sku = ?", (next_pdf, &sku_upper));
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
                        // Utiliser la variante synchrone (on est déjà dans un contexte bloquant)
                        let remaining_images = list_sku_images_sync(&network_path, &sku).unwrap_or_default();
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
    trigramme: String,
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

    let _ = events::write_audit_file(
        &network_path,
        &sku,
        &trigramme,
        "RENAME_MEDIA",
        Some(&media_type),
        Some(&old_path),
        Some(&new_relative),
        None,
    );

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
async fn scrape_price(app_handle: tauri::AppHandle, sku: String, provider: String, network_path: String, trigramme: String) -> Result<f64, String> {
    scraper::scrape_price_internal(&app_handle, &sku, &provider, &network_path, &trigramme).await
}

#[tauri::command]
async fn scrape_pdf(window: tauri::Window, sku: String, query: String, network_path: String, brand: Option<String>, label: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_config_internal().ok_or("Configuration introuvable")?;
        let url = config.searxng_url.clone().unwrap_or_else(|| "http://localhost:8080".to_string());
        let conv = config.pdf_rename_convention.clone().unwrap_or_else(|| "{SKU}_datasheet.pdf".to_string());
        let brand_str = brand.as_deref().unwrap_or("");
        let label_str = label.as_deref().unwrap_or("");
        scraper::scrape_pdf_internal(&window, &sku, &url, &query, &conv, &network_path, brand_str, label_str)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scrape_images(window: tauri::Window, sku: String, query: String, network_path: String, brand: Option<String>, label: Option<String>) -> Result<Vec<String>, String> {
    let config = load_config_internal().ok_or("Configuration introuvable")?;
    let url = config.searxng_url.clone().unwrap_or_else(|| "http://localhost:8080".to_string());
    let conv = config.image_rename_convention.clone().unwrap_or_else(|| "{SKU}_{Index}.jpg".to_string());
    let brand_str = brand.as_deref().unwrap_or("");
    let label_str = label.as_deref().unwrap_or("");
    scraper::scrape_images_internal(&window, &sku, &url, &query, &conv, &network_path, brand_str, label_str).await
}

#[tauri::command]
async fn search_image_candidates(
    window: tauri::Window,
    sku: String,
    brand: Option<String>,
    label: Option<String>,
) -> Result<Vec<scraper::ScrapedImageCandidate>, String> {
    let config = load_config_internal().ok_or("Configuration introuvable")?;
    let url = config.searxng_url.clone().unwrap_or_else(|| "http://localhost:8080".to_string());
    let brand_str = brand.as_deref().unwrap_or("");
    let label_str = label.as_deref().unwrap_or("");
    scraper::search_image_candidates_internal(&window, &sku, &url, brand_str, label_str).await
}

#[tauri::command]
async fn save_selected_images(
    sku: String,
    urls: Vec<String>,
    network_path: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_config_internal().ok_or("Configuration introuvable")?;
        let conv = config.image_rename_convention.clone().unwrap_or_else(|| "{SKU}_{Index}.jpg".to_string());
        scraper::save_selected_images_internal(&sku, urls, &conv, &network_path)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn search_pdf_candidates(
    window: tauri::Window,
    sku: String,
    brand: Option<String>,
    label: Option<String>,
) -> Result<Vec<scraper::ScrapedPdfCandidate>, String> {
    let config = load_config_internal().ok_or("Configuration introuvable")?;
    let url = config.searxng_url.clone().unwrap_or_else(|| "http://localhost:8080".to_string());
    let brand_str = brand.as_deref().unwrap_or("");
    let label_str = label.as_deref().unwrap_or("");
    scraper::search_pdf_candidates_internal(&window, &sku, &url, brand_str, label_str).await
}

#[tauri::command]
async fn save_selected_pdf(
    sku: String,
    url: String,
    network_path: String,
    trigramme: String,
    doc_type: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_config_internal().ok_or("Configuration introuvable")?;
        let conv = config.pdf_rename_convention.clone().unwrap_or_else(|| "{SKU}_datasheet.pdf".to_string());
        scraper::save_selected_pdf_internal(&sku, &url, &conv, &network_path, &trigramme, doc_type.as_deref())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scrape_product_details(
    app_handle: tauri::AppHandle,
    vpc_site: String, 
    vpc_code: String, 
    sku: String,
    brand: Option<String>,
    label: Option<String>,
) -> Result<scraper::ScrapedProductDetails, String> {
    let mut details = scraper::scrape_product_details_internal(&app_handle, &vpc_site, &vpc_code, &sku, brand.as_deref(), label.as_deref()).await?;
    
    // Récupérer la taille de lot du produit en base pour évaluer la pertinence
    let target_pack_size = if let Some(db_path) = events::get_db_path() {
        if let Ok(conn) = Connection::open(db_path) {
            conn.query_row(
                "SELECT pack_size FROM products WHERE sku = ?",
                [&sku],
                |row| row.get::<_, i64>(0)
            ).unwrap_or(1)
        } else {
            1
        }
    } else {
        1
    };
    if let Some(config) = load_config_internal() {
        let is_ttc = config.price_tax_type.as_deref() == Some("TTC");
        if is_ttc {
            details.price = details.price * 1.20;
        }
        if let Some(ref mut candidates) = details.price_candidates {
            // Evaluer les scores de pertinence pour chaque candidat
            let mut scored_indices: Vec<(usize, i32)> = Vec::new();
            for (idx, c) in candidates.iter().enumerate() {
                let mut score = 0;
                // Favorise la correspondance avec le type de taxe attendu par l'utilisateur
                if (is_ttc && c.tax_type == "TTC") || (!is_ttc && c.tax_type == "HT") {
                    score += 50;
                }
                
                // Correspondance de la taille du lot
                if c.pack_size == target_pack_size {
                    score += 100;
                } else if target_pack_size > 1 && c.pack_size == 1 {
                    score -= 50; // Pénalité pour les prix unitaires si on gère un lot
                }
                
                // Valeurs directes vs calculées
                if c.label.contains("calculé") {
                    score -= 20;
                }
                
                // Priorité aux blocs non-JSON-LD pour le grattage de page si dispo
                if c.label.contains("JSON-LD") {
                    score -= 10;
                }

                scored_indices.push((idx, score));
            }

            // Trier par score décroissant
            scored_indices.sort_by(|a, b| b.1.cmp(&a.1));
            let best_idx = scored_indices.first().map(|&(idx, _)| idx);

            for (idx, c) in candidates.iter_mut().enumerate() {
                c.recommended = Some(Some(idx) == best_idx);
                // Normaliser le prix en fonction du paramétrage de l'application
                if is_ttc && c.tax_type == "HT" {
                    c.price = parse_float_two_decimals(c.price * 1.20);
                    c.tax_type = "TTC".to_string();
                } else if !is_ttc && c.tax_type == "TTC" {
                    c.price = parse_float_two_decimals(c.price / 1.20);
                    c.tax_type = "HT".to_string();
                }
            }
        }
    }
    Ok(details)
}
fn parse_float_two_decimals(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct DetectedReseller {
    pub provider: String,
    pub code: String,
    pub url: String,
}

fn parse_vpc_url(url_str: &str, sku: &str, vpc_urls: &std::collections::HashMap<String, String>) -> Option<(String, String)> {
    let parsed = reqwest::Url::parse(url_str).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    
    let segments: Vec<&str> = parsed.path_segments()?
        .filter(|s| !s.is_empty())
        .collect();

    // Check built-in ones first
    if host.contains("rs-online") || host.contains("rsdelivers") {
        let is_prod = url_str.contains("/web/p/") || url_str.contains("/product/");
        if !is_prod {
            return None;
        }
        let code = segments.last()?;
        let clean_code = code.split('?').next()?.trim().to_string();
        if !clean_code.is_empty() {
            return Some(("RS".to_string(), clean_code));
        }
    } else if host.contains("farnell") {
        let dp_idx = segments.iter().position(|&s| s == "dp" || s == "p")?;
        let code = segments.get(dp_idx + 1)?;
        let clean_code = code.split('?').next()?.trim().to_string();
        if !clean_code.is_empty() {
            return Some(("Farnell".to_string(), clean_code));
        }
    } else if host.contains("mouser") {
        let _pd_idx = segments.iter().position(|&s| s.to_lowercase() == "productdetail")?;
        let code = segments.last()?;
        let clean_code = code.split('?').next()?.trim().to_string();
        if !clean_code.is_empty() {
            return Some(("Mouser".to_string(), clean_code));
        }
    } else if host.contains("conrad") {
        let _p_idx = segments.iter().position(|&s| s == "p")?;
        let last_seg = segments.last()?;
        let mut clean_seg = last_seg.split('?').next()?;
        if clean_seg.ends_with(".html") {
            clean_seg = &clean_seg[..clean_seg.len() - 5];
        } else if clean_seg.ends_with(".htm") {
            clean_seg = &clean_seg[..clean_seg.len() - 4];
        }
        let parts: Vec<&str> = clean_seg.split('-').collect();
        let code = parts.last()?;
        let clean_code = code.trim().to_string();
        if !clean_code.is_empty() {
            return Some(("Conrad".to_string(), clean_code));
        }
    } else {
        // Generic fallback for user-added sites!
        for (provider_name, configured_domain) in vpc_urls {
            let clean_domain = configured_domain
                .replace("https://", "")
                .replace("http://", "")
                .replace("www.", "")
                .trim_end_matches('/')
                .to_lowercase();
            if !clean_domain.is_empty() && host.contains(&clean_domain) {
                // 1. Try to check common query parameters for a product code / id
                let common_params = ["code", "id", "partnumber", "part_number", "part", "product", "prod", "ref", "reference", "sku"];
                for (k, v) in parsed.query_pairs() {
                    let k_lower = k.to_lowercase();
                    if common_params.iter().any(|&p| k_lower == p) {
                        let val = v.trim().to_string();
                        if !val.is_empty() {
                            return Some((provider_name.clone(), val));
                        }
                    }
                }
                
                // 2. Try to search query parameters matching SKU (as in original code)
                let sku_clean = sku.to_lowercase().replace(" ", "").replace("-", "").replace("(", "").replace(")", "");
                if !sku_clean.is_empty() {
                    for (_k, v) in parsed.query_pairs() {
                        let v_clean = v.to_lowercase().replace(" ", "").replace("-", "").replace("(", "").replace(")", "");
                        if v_clean.contains(&sku_clean) {
                            return Some((provider_name.clone(), v.trim().to_string()));
                        }
                    }
                }

                // 3. Try to extract from path segments
                if !sku_clean.is_empty() {
                    for seg in &segments {
                        let seg_clean = seg.to_lowercase().replace(" ", "").replace("-", "").replace("(", "").replace(")", "");
                        if seg_clean.contains(&sku_clean) || sku_clean.contains(&seg_clean) {
                            let clean_code = seg.split('?').next().unwrap_or(seg).trim().to_string();
                            if !clean_code.is_empty() {
                                return Some((provider_name.clone(), clean_code));
                            }
                        }
                    }
                }

                // 4. Try to extract the last non-empty segment of the path
                if let Some(last_seg) = segments.last() {
                    let mut clean_code = last_seg.split('?').next().unwrap_or(last_seg).trim();
                    if clean_code.ends_with(".html") {
                        clean_code = &clean_code[..clean_code.len() - 5];
                    } else if clean_code.ends_with(".htm") {
                        clean_code = &clean_code[..clean_code.len() - 4];
                    }
                    let clean_str = clean_code.to_string();
                    if !clean_str.is_empty() {
                        return Some((provider_name.clone(), clean_str));
                    }
                }
                
                return Some((provider_name.clone(), sku.to_string()));
            }
        }
    }
    
    None
}

#[tauri::command]
async fn find_reseller_via_searxng(
    sku: String,
    brand: Option<String>,
    label: Option<String>,
) -> Result<Option<DetectedReseller>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_config_internal().ok_or("Configuration introuvable")?;
        let searxng_url = config.searxng_url.clone().unwrap_or_else(|| "http://localhost:8080".to_string());
        
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
            .map_err(|e| e.to_string())?;

        let brand_word = brand.as_deref().unwrap_or("").trim();
        let ref_word = sku.trim();
        let label_words = label.as_deref().unwrap_or("")
            .split_whitespace()
            .take(4)
            .collect::<Vec<&str>>()
            .join(" ");
            
        let mut terms = Vec::new();
        if !brand_word.is_empty() {
            terms.push(brand_word.to_string());
        }
        if !ref_word.is_empty() {
            terms.push(ref_word.to_string());
        }
        if !label_words.is_empty() {
            terms.push(label_words);
        }
        let search_terms = terms.join(" ");

        let mut domains = vec![
            "fr.rs-online.com".to_string(),
            "fr.farnell.com".to_string(),
            "www.mouser.fr".to_string(),
            "www.conrad.fr".to_string(),
        ];
        
        for (_, custom_url) in &config.vpc_urls {
            let clean = custom_url
                .replace("https://", "")
                .replace("http://", "")
                .trim_end_matches('/')
                .to_string();
            if !clean.is_empty() && !domains.contains(&clean) {
                domains.push(clean);
            }
        }
        
        let site_filters = domains.iter().map(|d| format!("site:{}", d)).collect::<Vec<String>>().join(" OR ");
        let query = format!("({}) {}", site_filters, search_terms);
        
        let url = format!("{}/search?q={}&format=json", searxng_url.trim_end_matches('/'), urlencoding::encode(&query));
        let response = client.get(&url).send().map_err(|e| format!("Erreur connexion SearxNG : {}", e))?;
        
        if !response.status().is_success() {
            return Err(format!("SearxNG a retourné une erreur {}", response.status()));
        }
        
        let json: serde_json::Value = response.json().map_err(|e| format!("JSON invalide : {}", e))?;
        let results = json["results"].as_array().ok_or("Aucun résultat dans la réponse SearxNG")?;
        
        for r in results {
            if let Some(link) = r["url"].as_str() {
                let title = r["title"].as_str().unwrap_or("").to_lowercase();
                let snippet = r["content"].as_str().or_else(|| r["snippet"].as_str()).unwrap_or("").to_lowercase();
                let url_lower = link.to_lowercase();
                
                let sku_clean = sku.to_lowercase().replace(" ", "").replace("-", "").replace("(", "").replace(")", "");
                let brand_clean = brand.as_deref().unwrap_or("").to_lowercase().trim().to_string();
                
                let mut is_relevant = false;
                
                // 1. Exact match on clean SKU
                if !sku_clean.is_empty() && sku_clean.len() >= 3 && (title.contains(&sku_clean) || url_lower.contains(&sku_clean) || snippet.contains(&sku_clean)) {
                    is_relevant = true;
                }
                
                // 2. Match on digits of SKU + Brand
                if !is_relevant && !brand_clean.is_empty() && brand_clean != "inconnue" && brand_clean != "inconnu" {
                    let digits: String = sku_clean.chars().filter(|c| c.is_ascii_digit()).collect();
                    if !digits.is_empty() && digits.len() >= 3 {
                        let has_brand = title.contains(&brand_clean) || url_lower.contains(&brand_clean) || snippet.contains(&brand_clean);
                        let has_digits = title.contains(&digits) || url_lower.contains(&digits) || snippet.contains(&digits);
                        if has_brand && has_digits {
                            is_relevant = true;
                        }
                    }
                }
                
                // 3. Match on label parts if label is provided
                if !is_relevant {
                    if let Some(ref l) = label {
                        let label_clean = l.to_lowercase();
                        let digits: String = sku_clean.chars().filter(|c| c.is_ascii_digit()).collect();
                        if !digits.is_empty() && (title.contains(&digits) || url_lower.contains(&digits)) {
                            let label_words: Vec<&str> = label_clean.split_whitespace().filter(|w| w.len() >= 4).collect();
                            let mut matches = 0;
                            for w in &label_words {
                                if title.contains(w) || snippet.contains(w) {
                                    matches += 1;
                                }
                            }
                            if matches >= 2 {
                                is_relevant = true;
                            }
                        }
                    }
                }
                
                if !is_relevant {
                    continue;
                }

                if let Some((provider, code)) = parse_vpc_url(link, &sku, &config.vpc_urls) {
                    return Ok(Some(DetectedReseller {
                        provider,
                        code,
                        url: link.to_string(),
                    }));
                }
            }
        }
        
        Ok(None)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn search_vpc_domains_via_searxng(query: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = load_config_internal().ok_or("Configuration introuvable")?;
        let searxng_url = config.searxng_url.clone().unwrap_or_else(|| "http://localhost:8080".to_string());
        
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
            .map_err(|e| e.to_string())?;
            
        let url = format!("{}/search?q={}&format=json", searxng_url.trim_end_matches('/'), urlencoding::encode(&query));
        let response = client.get(&url).send().map_err(|e| format!("Erreur connexion SearxNG : {}", e))?;
        
        if !response.status().is_success() {
            return Err(format!("SearxNG a retourné une erreur {}", response.status()));
        }
        
        let json: serde_json::Value = response.json().map_err(|e| format!("JSON invalide : {}", e))?;
        let results = json["results"].as_array().ok_or("Aucun résultat dans la réponse SearxNG")?;
        
        let mut domains = std::collections::HashSet::new();
        for r in results {
            if let Some(link) = r["url"].as_str() {
                if let Ok(parsed) = reqwest::Url::parse(link) {
                    if let Some(host) = parsed.host_str() {
                        let cleaned = host.trim_start_matches("www.");
                        if !cleaned.is_empty() {
                            domains.insert(cleaned.to_string());
                        }
                    }
                }
            }
        }
        
        let mut list: Vec<String> = domains.into_iter().collect();
        list.sort();
        Ok(list)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_backup_config(network_path: String) -> Result<backup::BackupConfig, String> {
    Ok(backup::load_backup_config_internal(&network_path))
}

#[tauri::command]
fn save_backup_config(network_path: String, config: backup::BackupConfig) -> Result<(), String> {
    backup::save_backup_config_internal(&network_path, &config)
}

#[tauri::command]
fn trigger_manual_backup(network_path: String) -> Result<String, String> {
    let config = backup::load_backup_config_internal(&network_path);
    backup::perform_backup(&network_path, &config)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_boms() -> Result<Vec<db::Bom>, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let _ = db::init_db(&conn);
    db::get_boms(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_bom(
    network_path: String,
    trigramme: String,
    bom_id: String,
    name: String,
    status: String,
    equipment_note: String,
    items: Vec<serde_json::Value>,
) -> Result<(), String> {
    let payload = json!({
        "bom_id": bom_id,
        "name": name.trim(),
        "status": status.trim(),
        "equipment_note": equipment_note.trim(),
        "created_at": chrono::Utc::now().to_rfc3339(),
        "updated_at": chrono::Utc::now().to_rfc3339(),
        "items": items,
    });
    events::write_event_file(&network_path, "BOM_SAVE", &trigramme, payload)
}

#[tauri::command]
fn delete_bom(
    network_path: String,
    trigramme: String,
    bom_id: String,
) -> Result<(), String> {
    let payload = json!({
        "bom_id": bom_id,
    });
    events::write_event_file(&network_path, "BOM_DELETE", &trigramme, payload)
}

#[tauri::command]
fn save_file_dialog(
    filename: String,
    contents: Vec<u8>,
    filter_name: String,
    filter_ext: String,
) -> Result<Option<String>, String> {
    let file_path = rfd::FileDialog::new()
        .set_title("Enregistrer le fichier")
        .set_file_name(&filename)
        .add_filter(&filter_name, &[&filter_ext])
        .save_file();
        
    if let Some(path) = file_path {
        std::fs::write(&path, contents).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn save_screenshot(
    network_path: String,
    sku: String,
    base64_image: String,
    trigramme: String,
) -> Result<(), String> {
    let base64_data = if let Some(pos) = base64_image.find(",") {
        &base64_image[pos + 1..]
    } else {
        &base64_image
    };

    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;

    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    let sku_upper = sku.to_uppercase();
    let (brand, category, sub_category) = conn.query_row(
        "SELECT brand, category, sub_category FROM products WHERE sku = ?",
        [&sku_upper],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            ))
        }
    ).unwrap_or((String::new(), String::new(), String::new()));

    let clean_brand = csv_importer::sanitize_folder_name(&brand, "INCONNU");
    let clean_category = csv_importer::sanitize_folder_name(&category, "INCONNU");
    let clean_subcategory = csv_importer::sanitize_folder_name(&sub_category, "INCONNU");
    let clean_sku = db::sanitize_sku(&sku);

    let dest_dir = std::path::Path::new(&network_path)
        .join("documents")
        .join(&clean_brand)
        .join(&clean_category)
        .join(&clean_subcategory)
        .join(&clean_sku);

    println!("[save_screenshot] Destination directory: {:?}", dest_dir);
    if let Err(e) = std::fs::create_dir_all(&dest_dir) {
        println!("[save_screenshot] Failed to create directories: {:?}", e);
        return Err(format!("Failed to create directories: {}", e));
    }
    let dest_path = dest_dir.join("screenshot_source.jpg");

    if let Err(e) = std::fs::write(&dest_path, decoded) {
        println!("[save_screenshot] Failed to write file: {:?}", e);
        return Err(format!("Failed to write file: {}", e));
    }
    println!("[save_screenshot] Screenshot successfully written to: {:?}", dest_path);

    let relative_path = format!(
        "documents/{}/{}/{}/{}/screenshot_source.jpg", 
        clean_brand, clean_category, clean_subcategory, clean_sku
    );

    let _ = events::write_audit_file(
        &network_path,
        &sku,
        &trigramme,
        "UPLOAD_MEDIA",
        Some("screenshot"),
        None,
        Some(&relative_path),
        None,
    );

    Ok(())
}

#[tauri::command]
fn get_sku_screenshot_path(network_path: String, sku: String) -> Result<Option<String>, String> {
    let db_path = events::get_db_path().ok_or("Base de données cache introuvable")?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    let sku_upper = sku.to_uppercase();
    let (pdf_path_opt, brand, category, sub_category) = conn.query_row(
        "SELECT pdf_path, brand, category, sub_category FROM products WHERE sku = ?",
        [&sku_upper],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            ))
        }
    ).unwrap_or((None, String::new(), String::new(), String::new()));

    let pdfs_dir = if let Some(ref path) = pdf_path_opt {
        let full_path = std::path::Path::new(&network_path).join(path);
        if full_path.is_file() {
            full_path.parent().unwrap_or(std::path::Path::new("")).to_path_buf()
        } else {
            full_path
        }
    } else {
        let clean_brand = csv_importer::sanitize_folder_name(&brand, "INCONNU");
        let clean_category = csv_importer::sanitize_folder_name(&category, "INCONNU");
        let clean_subcategory = csv_importer::sanitize_folder_name(&sub_category, "INCONNU");
        let clean_sku = db::sanitize_sku(&sku);
        std::path::Path::new(&network_path)
            .join("documents")
            .join(&clean_brand)
            .join(&clean_category)
            .join(&clean_subcategory)
            .join(&clean_sku)
    };

    let screenshot_path = pdfs_dir.join("screenshot_source.jpg");
    if screenshot_path.exists() {
        if let Ok(relative) = screenshot_path.strip_prefix(&network_path) {
            return Ok(Some(relative.to_string_lossy().to_string().replace("\\", "/")));
        }
    }
    Ok(None)
}

#[tauri::command]
async fn test_searxng_instances(urls: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
        
    let mut results = std::collections::HashMap::new();
    for url in urls {
        let test_url = format!("{}/search?q=test&format=json", url.trim_end_matches('/'));
        match client.get(&test_url).send().await {
            Ok(res) => {
                if res.status().is_success() {
                    let content_type = res.headers().get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                        
                    if content_type.contains("json") {
                        results.insert(url, "✅ Support JSON OK".to_string());
                    } else {
                        // Tenter de parser
                        if res.json::<serde_json::Value>().await.is_ok() {
                            results.insert(url, "✅ Support JSON OK (Détecté)".to_string());
                        } else {
                            results.insert(url, "⚠️ Format JSON non supporté (HTML/Page uniquement)".to_string());
                        }
                    }
                } else {
                    results.insert(url, format!("❌ Erreur HTTP {}", res.status()));
                }
            }
            Err(e) => {
                results.insert(url, format!("❌ Inaccessible : {}", e));
            }
        }
    }
    Ok(results)
}

// ─── New Universal Scraper Commands ───────────────────────────────────────────

#[tauri::command]
async fn start_background_scrape(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<scraper_task::ScrapeTaskManager>>,
    sku: String,
    vpc_site: Option<String>,
    vpc_code: Option<String>,
    mpn: Option<String>,
    brand: Option<String>,
) -> Result<(), String> {
    let has_params = vpc_site.is_some() || vpc_code.is_some() || mpn.is_some() || brand.is_some();
    if has_params {
        let params = scraper_task::ScrapeParams { vpc_site, vpc_code, mpn, brand };
        state.enqueue_with_params(sku, scraper_task::TaskPriority::High, Some(params)).await;
    } else {
        state.enqueue(sku, scraper_task::TaskPriority::Normal).await;
    }
    Ok(())
}

#[tauri::command]
async fn cancel_background_scrape(state: tauri::State<'_, std::sync::Arc<scraper_task::ScrapeTaskManager>>, sku: String) -> Result<(), String> {
    state.cancel(&sku).await;
    Ok(())
}

#[tauri::command]
async fn resume_background_scrape(state: tauri::State<'_, std::sync::Arc<scraper_task::ScrapeTaskManager>>, sku: String) -> Result<(), String> {
    state.resume(sku).await;
    Ok(())
}

#[tauri::command]
async fn get_scrape_candidates(sku: String) -> Result<Option<scraper_candidates::ScrapeCandidates>, String> {
    let config = load_config_internal().ok_or("Configuration introuvable")?;
    Ok(scraper_candidates::load_candidates(&config.network_path, &sku))
}

#[tauri::command]
async fn get_scrape_status(state: tauri::State<'_, std::sync::Arc<scraper_task::ScrapeTaskManager>>, sku: String) -> Result<Option<serde_json::Value>, String> {
    if let Some(status) = state.get_status(&sku).await {
        Ok(Some(json!({
            "sku": status.sku,
            "status": format!("{:?}", status.status),
            "progress": status.progress,
            "message": status.message,
        })))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn get_queue_info(state: tauri::State<'_, std::sync::Arc<scraper_task::ScrapeTaskManager>>) -> Result<serde_json::Value, String> {
    let (pending_count, pending_skus, active_sku, active_skus) = state.get_queue_info().await;
    Ok(json!({
        "pending_count": pending_count,
        "pending_skus": pending_skus,
        "active_sku": active_sku,
        "active_skus": active_skus,
    }))
}

/// Applique les sélections de l'AutoFillModal : télécharge les images et PDFs sélectionnés
/// depuis les candidats scrapés vers le stockage réseau.
#[tauri::command]
async fn apply_scrape_selections(
    window: tauri::Window,
    sku: String,
    network_path: String,
    trigramme: String,
    selected_image_urls: Vec<String>,
    selected_pdf_url: Option<String>,
    selected_pdf_type: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = load_config_internal().ok_or("Configuration introuvable")?;
    let image_conv = config.image_rename_convention.clone().unwrap_or_else(|| "{SKU}_{Index}.jpg".to_string());
    let pdf_conv = config.pdf_rename_convention.clone().unwrap_or_else(|| "{SKU}_datasheet.pdf".to_string());

    let mut saved_images: Vec<String> = Vec::new();
    let mut saved_pdf: Option<String> = None;
    let mut errors: Vec<String> = Vec::new();

    // Télécharger les images sélectionnées
    if !selected_image_urls.is_empty() {
        match scraper::save_selected_images_internal(&sku, selected_image_urls, &image_conv, &network_path) {
            Ok(paths) => saved_images = paths,
            Err(e) => errors.push(format!("Images : {}", e)),
        }
    }

    // Télécharger le PDF sélectionné
    if let Some(ref pdf_url) = selected_pdf_url {
        if !pdf_url.is_empty() {
            let doc_type = selected_pdf_type.as_deref();
            match scraper::save_selected_pdf_internal(&sku, pdf_url, &pdf_conv, &network_path, &trigramme, doc_type) {
                Ok(path) => saved_pdf = Some(path),
                Err(e) => errors.push(format!("PDF : {}", e)),
            }
        }
    }

    Ok(json!({
        "saved_images": saved_images,
        "saved_pdf": saved_pdf,
        "errors": errors,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {

    // Planificateur de sauvegarde automatique
    std::thread::spawn(|| {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            backup::check_and_run_scheduler();
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let task_manager = std::sync::Arc::new(scraper_task::ScrapeTaskManager::new(app.handle().clone()));
            app.manage(task_manager);
            Ok(())
        })
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
            search_image_candidates,
            save_selected_images,
            search_pdf_candidates,
            save_selected_pdf,
            ensure_directory,
            scrape_product_details,
            get_product_audit_log,
            search_vpc_domains_via_searxng,
            find_reseller_via_searxng,
            get_app_version,
            get_backup_config,
            save_backup_config,
            trigger_manual_backup,
            get_boms,
            save_bom,
            delete_bom,
            save_file_dialog,
            select_image_file,
            save_screenshot,
            get_sku_screenshot_path,
            test_searxng_instances,
            // New universal scraper commands
            start_background_scrape,
            cancel_background_scrape,
            resume_background_scrape,
            get_scrape_candidates,
            get_scrape_status,
            get_queue_info,
            apply_scrape_selections
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

