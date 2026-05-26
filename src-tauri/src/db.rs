use rusqlite::{Connection, Result};
use std::path::Path;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Product {
    pub sku: String,
    pub mpn: String,
    pub label: String,
    pub brand: String,
    pub category: String,
    pub sub_category: String,
    pub location: String,
    pub item_type: String, // "QUANTITATIVE" ou "SERIALIZED"
    pub min_stock: f64,
    pub price: f64,
    pub current_stock: f64,
    pub attributes: String, // JSON String
    pub image_path: Option<String>,
    pub pdf_path: Option<String>,
    pub pack_size: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProductHistoryItem {
    pub timestamp: String,
    pub trigramme: String,
    pub event_type: String,
    pub qty: f64,
    pub note: String,
}

pub fn get_db_connection<P: AsRef<Path>>(path: P) -> Result<Connection> {
    Connection::open(path)
}

pub fn init_db(conn: &Connection) -> Result<()> {
    // 1. Table des produits
    conn.execute(
        "CREATE TABLE IF NOT EXISTS products (
            sku TEXT PRIMARY KEY,
            mpn TEXT NOT NULL,
            label TEXT NOT NULL,
            brand TEXT,
            category TEXT,
            sub_category TEXT,
            location TEXT,
            item_type TEXT NOT NULL,
            min_stock REAL DEFAULT 0,
            price REAL DEFAULT 0,
            current_stock REAL DEFAULT 0,
            attributes TEXT,
            image_path TEXT,
            pdf_path TEXT,
            pack_size INTEGER DEFAULT 1
        )",
        [],
    )?;

    // Vérifier si la colonne pack_size existe, sinon l'ajouter
    let has_pack_size: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('products') WHERE name='pack_size')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_pack_size {
        let _ = conn.execute("ALTER TABLE products ADD COLUMN pack_size INTEGER DEFAULT 1", []);
    }

    // 2. Table pour le suivi des fichiers événements déjà appliqués
    conn.execute(
        "CREATE TABLE IF NOT EXISTS applied_events (
            filename TEXT PRIMARY KEY,
            processed_at TEXT NOT NULL
        )",
        [],
    )?;

    // 3. Table de l'historique des mouvements pour un accès direct ultra-rapide
    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            trigramme TEXT NOT NULL,
            event_type TEXT NOT NULL,
            qty REAL NOT NULL,
            note TEXT
        )",
        [],
    )?;

    Ok(())
}

pub fn sanitize_sku(sku: &str) -> String {
    sku.trim()
        .replace(" ", "")
        .replace("/", "-")
        .replace("\\", "-")
        .replace(":", "-")
        .replace("*", "-")
        .replace("?", "-")
        .replace("\"", "-")
        .replace("<", "-")
        .replace(">", "-")
        .replace("|", "-")
        .to_uppercase()
}

pub fn clear_db(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM products", [])?;
    conn.execute("DELETE FROM applied_events", [])?;
    conn.execute("DELETE FROM product_history", [])?;
    Ok(())
}


pub fn get_all_products(conn: &Connection) -> Result<Vec<Product>> {
    let mut stmt = conn.prepare(
        "SELECT sku, mpn, label, brand, category, sub_category, location, 
                item_type, min_stock, price, current_stock, attributes, image_path, pdf_path, pack_size 
         FROM products ORDER BY sku ASC",
    )?;
    
    let product_iter = stmt.query_map([], |row| {
        Ok(Product {
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
            attributes: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
            image_path: row.get(12)?,
            pdf_path: row.get(13)?,
            pack_size: row.get::<_, Option<i64>>(14)?.unwrap_or(1),
        })
    })?;

    let mut list = Vec::new();
    for p in product_iter {
        list.push(p?);
    }
    Ok(list)
}

pub fn get_history(conn: &Connection, sku: &str) -> Result<Vec<ProductHistoryItem>> {
    let mut stmt = conn.prepare(
        "SELECT timestamp, trigramme, event_type, qty, note 
         FROM product_history 
         WHERE sku = ? 
         ORDER BY timestamp DESC",
    )?;

    let history_iter = stmt.query_map([sku], |row| {
        Ok(ProductHistoryItem {
            timestamp: row.get(0)?,
            trigramme: row.get(1)?,
            event_type: row.get(2)?,
            qty: row.get(3)?,
            note: row.get(4)?,
        })
    })?;

    let mut list = Vec::new();
    for h in history_iter {
        list.push(h?);
    }
    Ok(list)
}
