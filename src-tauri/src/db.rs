use rusqlite::{Connection, Result};
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
    pub reserved_stock: f64,
    pub attributes: String, // JSON String
    pub image_path: Option<String>,
    pub pdf_path: Option<String>,
    pub pack_size: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Bom {
    pub id: String,
    pub name: String,
    pub status: String, // "DRAFT", "RESERVED", "COMPLETED"
    pub created_at: String,
    pub updated_at: String,
    pub equipment_note: Option<String>,
    pub items: Vec<BomItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BomItem {
    pub sku: String,
    pub qty: f64,
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProductHistoryItem {
    pub timestamp: String,
    pub trigramme: String,
    pub event_type: String,
    pub qty: f64,
    pub note: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuditLogItem {
    pub audit_id: String,
    pub timestamp: String,
    pub trigramme: String,
    pub action: String,
    pub field: Option<String>,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub source_url: Option<String>,
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
            reserved_stock REAL DEFAULT 0,
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

    // Vérifier si la colonne reserved_stock existe, sinon l'ajouter
    let has_reserved_stock: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('products') WHERE name='reserved_stock')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_reserved_stock {
        let _ = conn.execute("ALTER TABLE products ADD COLUMN reserved_stock REAL DEFAULT 0", []);
    }

    // Table pour les nomenclatures (BOMs)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS boms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            equipment_note TEXT
        )",
        [],
    )?;

    // Migration pour ajouter la colonne equipment_note si elle n'existe pas
    let has_equipment_note: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('boms') WHERE name='equipment_note')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_equipment_note {
        let _ = conn.execute("ALTER TABLE boms ADD COLUMN equipment_note TEXT", []);
    }

    // Table pour les éléments des nomenclatures
    conn.execute(
        "CREATE TABLE IF NOT EXISTS bom_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bom_id TEXT NOT NULL,
            sku TEXT NOT NULL,
            qty REAL NOT NULL,
            note TEXT,
            FOREIGN KEY(bom_id) REFERENCES boms(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Migration pour ajouter la colonne note si elle n'existe pas
    let has_bom_item_note: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('bom_items') WHERE name='note')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_bom_item_note {
        let _ = conn.execute("ALTER TABLE bom_items ADD COLUMN note TEXT", []);
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

    // 4. Table du journal d'audit (modifications champ par champ)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS product_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            audit_id TEXT NOT NULL UNIQUE,
            sku TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            trigramme TEXT NOT NULL,
            action TEXT NOT NULL,
            field TEXT,
            old_value TEXT,
            new_value TEXT,
            source_url TEXT
        )",
        [],
    )?;

    // 5. Table de déduplication des fichiers audit déjà appliqués
    conn.execute(
        "CREATE TABLE IF NOT EXISTS applied_audits (
            filename TEXT PRIMARY KEY,
            processed_at TEXT NOT NULL
        )",
        [],
    )?;

    // Migration: migrer les clés historiques codeRS vers l'objet vpc dans attributes
    if let Ok(mut stmt) = conn.prepare("SELECT sku, attributes FROM products WHERE attributes LIKE '%codeRS%'") {
        let mut updates = Vec::new();
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            for r in rows.flatten() {
                let sku = r.0;
                let attr_str = r.1;
                if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&attr_str) {
                    if let Some(obj) = val.as_object_mut() {
                        if let Some(code_rs_val) = obj.remove("codeRS") {
                            if let Some(code_rs_str) = code_rs_val.as_str() {
                                if !code_rs_str.trim().is_empty() {
                                    let mut vpc_obj = obj.get("vpc")
                                        .and_then(|v| v.as_object())
                                        .cloned()
                                        .unwrap_or_default();
                                    
                                    if !vpc_obj.contains_key("RS") {
                                        vpc_obj.insert("RS".to_string(), serde_json::Value::String(code_rs_str.trim().to_string()));
                                    }
                                    obj.insert("vpc".to_string(), serde_json::Value::Object(vpc_obj));
                                }
                            }
                        }
                    }
                    if let Ok(serialized) = serde_json::to_string(&val) {
                        updates.push((sku, serialized));
                    }
                }
            }
        }
        for (sku, new_attr) in updates {
            let _ = conn.execute("UPDATE products SET attributes = ? WHERE sku = ?", (new_attr, sku));
        }
    }

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
                item_type, min_stock, price, current_stock, reserved_stock, attributes, image_path, pdf_path, pack_size 
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
            reserved_stock: row.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
            attributes: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
            image_path: row.get(13)?,
            pdf_path: row.get(14)?,
            pack_size: row.get::<_, Option<i64>>(15)?.unwrap_or(1),
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
         WHERE sku = ? AND event_type IN ('STOCK_IN', 'STOCK_OUT')
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

pub fn get_audit_log(conn: &Connection, sku: &str) -> Result<Vec<AuditLogItem>> {
    let mut stmt = conn.prepare(
        "SELECT audit_id, timestamp, trigramme, action, field, old_value, new_value, source_url
         FROM product_audit_log
         WHERE sku = ?
         ORDER BY timestamp DESC",
    )?;

    let audit_iter = stmt.query_map([sku], |row| {
        Ok(AuditLogItem {
            audit_id: row.get(0)?,
            timestamp: row.get(1)?,
            trigramme: row.get(2)?,
            action: row.get(3)?,
            field: row.get(4)?,
            old_value: row.get(5)?,
            new_value: row.get(6)?,
            source_url: row.get(7)?,
        })
    })?;

    let mut list = Vec::new();
    for a in audit_iter {
        list.push(a?);
    }
    Ok(list)
}

pub fn get_boms(conn: &Connection) -> Result<Vec<Bom>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, status, created_at, updated_at, equipment_note FROM boms ORDER BY updated_at DESC",
    )?;

    let bom_iter = stmt.query_map([], |row| {
        Ok(Bom {
            id: row.get(0)?,
            name: row.get(1)?,
            status: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            equipment_note: row.get(5)?,
            items: Vec::new(),
        })
    })?;

    let mut boms = Vec::new();
    for b in bom_iter {
        let mut bom = b?;
        bom.items = get_bom_items(conn, &bom.id)?;
        boms.push(bom);
    }
    Ok(boms)
}

pub fn get_bom_items(conn: &Connection, bom_id: &str) -> Result<Vec<BomItem>> {
    let mut stmt = conn.prepare(
        "SELECT sku, qty, note FROM bom_items WHERE bom_id = ?",
    )?;

    let item_iter = stmt.query_map([bom_id], |row| {
        Ok(BomItem {
            sku: row.get(0)?,
            qty: row.get(1)?,
            note: row.get(2)?,
        })
    })?;

    let mut items = Vec::new();
    for item in item_iter {
        items.push(item?);
    }
    Ok(items)
}
