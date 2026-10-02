export interface Product {
  sku: string;
  mpn: string;
  label: string;
  brand: string;
  category: string;
  sub_category: string;
  location: string;
  item_type: string;
  min_stock: number;
  price: number;
  current_stock: number;
  reserved_stock?: number;
  attributes: string; // JSON string
  image_path?: string | null;
  pdf_path?: string | null;
  pack_size: number;
}

export interface BomItem {
  sku: string;
  qty: number;
  note?: string;
}

export interface Bom {
  id: string;
  name: string;
  status: string; // "DRAFT", "RESERVED", "COMPLETED"
  created_at: string;
  updated_at: string;
  items: BomItem[];
  equipment_note?: string;
}

export interface ProductHistoryItem {
  sku: string;
  timestamp: string;
  trigramme: string;
  event_type: string;
  qty: number;
  note: string;
}

export interface AuditLogItem {
  audit_id: string;
  sku: string;
  timestamp: string;
  trigramme: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  source_url: string | null;
}

export interface DashboardStats {
  total_references: number;
  total_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
  recent_movements: Array<{
    sku: string;
    timestamp: string;
    trigramme: string;
    event_type: string;
    qty: number;
    note: string;
  }>;
  recent_audits: AuditLogItem[];
}

export interface AppConfig {
  trigramme: string;
  network_path: string;
  theme?: string;
  searxng_url?: string;
  searxng_urls?: string[];
  max_image_candidates?: number;
  vpc_sites?: string[];
  pdf_rename_convention?: string;
  image_rename_convention?: string;
  pdf_size_threshold?: number;
  price_tax_type?: string;
  vpc_api_keys?: Record<string, string>;
  vpc_urls?: Record<string, string>;
  enable_scrape_fallback?: boolean;
  auto_backup_enabled?: boolean;
  backup_interval_hours?: number;
}

export interface StockflowEvent {
  event_id: string;
  event_type: string; // "PRODUCT_CREATE", "PRODUCT_UPDATE", "PRODUCT_DELETE", "STOCK_IN", "STOCK_OUT", "STOCK_REVERSAL", "BOM_SAVE", "BOM_DELETE"
  timestamp: string;
  trigramme: string;
  payload: any;
}
