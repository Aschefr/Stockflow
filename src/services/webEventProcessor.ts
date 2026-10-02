import { StockflowEvent, Product, Bom, ProductHistoryItem, AuditLogItem } from "../types";
import { idbGet, idbPut, idbDelete } from "./webDatabase";

export async function applySingleEventWeb(event: StockflowEvent): Promise<void> {
  const eventType = event.event_type;
  const p = event.payload || {};

  switch (eventType) {
    case "PRODUCT_CREATE":
    case "PRODUCT_UPDATE": {
      const sku = (p.sku || "").toUpperCase();
      if (!sku) return;

      const existing = await idbGet<Product>("products", sku);
      const initialStock = Number(p.initial_stock || 0);

      const product: Product = {
        sku,
        mpn: p.mpn || "",
        label: p.label || "",
        brand: p.brand || "",
        category: p.category || "",
        sub_category: p.subCategory || p.sub_category || "",
        location: p.location || "",
        item_type: p.type || p.item_type || "QUANTITATIVE",
        min_stock: Number(p.minStock ?? p.min_stock ?? 0),
        price: Number(p.price || 0),
        current_stock: existing ? existing.current_stock : initialStock,
        reserved_stock: existing ? (existing.reserved_stock || 0) : 0,
        attributes: typeof p.attributes === "string" ? p.attributes : JSON.stringify(p.attributes || {}),
        image_path: p.image_path || p.imagePath || null,
        pdf_path: p.pdf_path || p.pdfPath || null,
        pack_size: Number(p.packSize ?? p.pack_size ?? 1),
      };

      await idbPut("products", product);

      if (!existing) {
        const historyItem: ProductHistoryItem = {
          sku,
          timestamp: event.timestamp || new Date().toISOString(),
          trigramme: (event.trigramme || "").toUpperCase(),
          event_type: "PRODUCT_CREATE",
          qty: initialStock,
          note: "",
        };
        await idbPut("history", historyItem);
      }
      break;
    }

    case "PRODUCT_DELETE": {
      const sku = (p.sku || "").toUpperCase();
      if (!sku) return;
      await idbDelete("products", sku);
      break;
    }

    case "STOCK_IN": {
      const sku = (p.sku || "").toUpperCase();
      const qty = Number(p.qty || 0);
      const note = p.note || "";
      const existing = await idbGet<Product>("products", sku);
      if (existing) {
        existing.current_stock = Number(existing.current_stock || 0) + qty;
        await idbPut("products", existing);
      }

      const historyItem: ProductHistoryItem = {
        sku,
        timestamp: event.timestamp || new Date().toISOString(),
        trigramme: (event.trigramme || "").toUpperCase(),
        event_type: "STOCK_IN",
        qty,
        note,
      };
      await idbPut("history", historyItem);
      break;
    }

    case "STOCK_OUT": {
      const sku = (p.sku || "").toUpperCase();
      const qty = Number(p.qty || 0);
      const note = p.note || "";
      const existing = await idbGet<Product>("products", sku);
      if (existing) {
        existing.current_stock = Math.max(0, Number(existing.current_stock || 0) - qty);
        await idbPut("products", existing);
      }

      const historyItem: ProductHistoryItem = {
        sku,
        timestamp: event.timestamp || new Date().toISOString(),
        trigramme: (event.trigramme || "").toUpperCase(),
        event_type: "STOCK_OUT",
        qty,
        note,
      };
      await idbPut("history", historyItem);
      break;
    }

    case "STOCK_RESERVE": {
      const sku = (p.sku || "").toUpperCase();
      const qty = Number(p.qty || 0);
      const note = p.note || "";
      const existing = await idbGet<Product>("products", sku);
      if (existing) {
        existing.reserved_stock = Number(existing.reserved_stock || 0) + qty;
        await idbPut("products", existing);
      }

      const historyItem: ProductHistoryItem = {
        sku,
        timestamp: event.timestamp || new Date().toISOString(),
        trigramme: (event.trigramme || "").toUpperCase(),
        event_type: "STOCK_RESERVE",
        qty,
        note,
      };
      await idbPut("history", historyItem);
      break;
    }

    case "STOCK_UNRESERVE": {
      const sku = (p.sku || "").toUpperCase();
      const qty = Number(p.qty || 0);
      const note = p.note || "";
      const existing = await idbGet<Product>("products", sku);
      if (existing) {
        existing.reserved_stock = Math.max(0, Number(existing.reserved_stock || 0) - qty);
        await idbPut("products", existing);
      }

      const historyItem: ProductHistoryItem = {
        sku,
        timestamp: event.timestamp || new Date().toISOString(),
        trigramme: (event.trigramme || "").toUpperCase(),
        event_type: "STOCK_UNRESERVE",
        qty,
        note,
      };
      await idbPut("history", historyItem);
      break;
    }

    case "BOM_SAVE": {
      let bomId = p.bom_id || p.bomId || p.id;
      if (!bomId || bomId === "undefined" || bomId === "null") {
        bomId = crypto.randomUUID();
      }
      const bom: Bom = {
        id: String(bomId),
        name: (p.name || "").trim() || "Nomenclature",
        status: (p.status || "DRAFT").trim(),
        created_at: p.created_at || new Date().toISOString(),
        updated_at: p.updated_at || new Date().toISOString(),
        items: (p.items || []).map((item: any) => ({
          sku: item.sku,
          qty: Number(item.qty || 0),
          note: item.note || "",
        })),
        equipment_note: p.equipment_note || p.equipmentNote || "",
      };
      await idbPut("boms", bom);
      break;
    }

    case "BOM_DELETE": {
      const bomId = p.bom_id || p.bomId || p.id;
      if (bomId && bomId !== "undefined" && bomId !== "null") {
        await idbDelete("boms", String(bomId));
      }
      break;
    }

    default:
      console.warn(`[WebEventProcessor] Type d'événement inconnu : ${eventType}`);
      break;
  }
}

export async function applySingleAuditWeb(audit: AuditLogItem): Promise<void> {
  await idbPut("audit_log", audit);
}
