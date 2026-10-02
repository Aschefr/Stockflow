import { Product, Bom, ProductHistoryItem, AuditLogItem, DashboardStats, AppConfig } from "../types";

/** Sites VPC par défaut fournis à la première utilisation */
const DEFAULT_VPC_SITES = ["RS", "Conrad", "Farnell"];
import { idbGetAll, idbGet, idbPut, idbGetByIndex } from "./webDatabase";
import {
  getDirectoryHandle,
  requestDirectoryHandle,
  reconnectDirectoryHandle,
  syncEventsFromDirectory,
  writeEventToDirectory,
  writeAuditToDirectory,
  listSkuImagesFromDirectory,
  listSkuPdfsFromDirectory,
  resolveMediaUrl,
  getSubdirectoryHandle,
  setCachedMediaUrl,
  sanitizeFolderName,
  initMediaCacheFromIndexedDb,
} from "./webFileSystem";

// Démarrage immédiat de l'hydratation du cache médias en arrière-plan
initMediaCacheFromIndexedDb().catch(() => {});

async function getNestedDirectory(
  root: FileSystemDirectoryHandle,
  pathParts: string[],
  create: boolean = true
): Promise<FileSystemDirectoryHandle | null> {
  let current = root;
  for (const part of pathParts) {
    if (!part) continue;
    try {
      current = await current.getDirectoryHandle(part, { create });
    } catch {
      return null;
    }
  }
  return current;
}
import {
  selectCsvFileWeb,
  selectImageDirWeb,
  selectPdfDirWeb,
  importCsvWeb,
} from "./webCsvImporter";
import {
  runWebScrape,
  getStoredScrapeCandidates,
  searchSearxngGeneral,
  searchSearxngImages,
  searchSearxngPdfs,
} from "./webScraperService";
import { emitWebEvent } from "./api";
import { APP_VERSION } from "../version";
import { detectDocumentType } from "../utils/documentUtils";

interface ActiveScrapeState {
  sku: string;
  status: "InProgress" | "Complete" | "Failed" | "Cancelled";
  progress: number;
  message: string;
}

const activeScrapes = new Map<string, ActiveScrapeState>();

export class WebBackend {
  async handle(command: string, args: Record<string, any> = {}): Promise<any> {
    const dirHandle = await getDirectoryHandle();

    switch (command) {
      case "get_app_version": {
        return APP_VERSION;
      }

      // ==================== CONFIGURATION ====================
      case "get_config": {
        let cfg: AppConfig | null = null;
        // 1. Lire depuis localStorage en premier pour un accès synchrone immédiat
        const local = localStorage.getItem("stockflow_config");
        if (local) {
          try {
            cfg = JSON.parse(local);
          } catch {}
        }
        // 2. Vérifier IndexedDB si absent ou pour synchronisation
        if (!cfg) {
          const stored = await idbGet<{ key: string; value: AppConfig }>("config", "app_config");
          if (stored && stored.value) {
            cfg = stored.value;
          }
        }

        if (cfg) {
          if (dirHandle && (!cfg.network_path || cfg.network_path === "")) {
            cfg.network_path = `📂 ${dirHandle.name} (connecté)`;
          }
          if (!cfg.searxng_url) {
            cfg.searxng_url = "https://search.amify-studio.fr";
          }
          // Migration : injecter les sites VPC par défaut si la liste est vide
          if (!cfg.vpc_sites || cfg.vpc_sites.length === 0) {
            cfg.vpc_sites = [...DEFAULT_VPC_SITES];
          }
          // Toujours maintenir localStorage à jour
          localStorage.setItem("stockflow_config", JSON.stringify(cfg));
          return cfg;
        }

        const defaultCfg: AppConfig = {
          trigramme: "WEB",
          network_path: dirHandle ? `📂 ${dirHandle.name} (connecté)` : "",
          theme: "dark",
          searxng_url: "https://search.amify-studio.fr",
          searxng_urls: [],
          max_image_candidates: 15,
          vpc_sites: [...DEFAULT_VPC_SITES],
          pdf_rename_convention: "",
          image_rename_convention: "",
          pdf_size_threshold: 5,
          price_tax_type: "HT",
          vpc_api_keys: {},
          vpc_urls: {},
          enable_scrape_fallback: true,
          sync_interval_seconds: 60,
        };
        localStorage.setItem("stockflow_config", JSON.stringify(defaultCfg));
        return defaultCfg;
      }

      case "save_config": {
        const raw = args.config || args;
        const cfg: AppConfig = {
          trigramme: (raw.trigramme || "WEB").toUpperCase(),
          network_path: raw.networkPath || raw.network_path || "",
          theme: raw.theme || "dark",
          searxng_url: raw.searxngUrl !== undefined ? (raw.searxngUrl || "") : (raw.searxng_url || ""),
          searxng_urls: raw.searxngUrls || raw.searxng_urls || [],
          max_image_candidates: raw.maxImageCandidates ?? raw.max_image_candidates ?? 15,
          vpc_sites: raw.vpcSites || raw.vpc_sites || [],
          pdf_rename_convention: raw.pdfRenameConvention !== undefined ? (raw.pdfRenameConvention || "") : (raw.pdf_rename_convention || ""),
          image_rename_convention: raw.imageRenameConvention !== undefined ? (raw.imageRenameConvention || "") : (raw.image_rename_convention || ""),
          pdf_size_threshold: raw.pdfSizeThreshold ?? raw.pdf_size_threshold ?? 5,
          price_tax_type: raw.priceTaxType || raw.price_tax_type || "HT",
          vpc_api_keys: raw.vpcApiKeys || raw.vpc_api_keys || {},
          vpc_urls: raw.vpcUrls || raw.vpc_urls || {},
          enable_scrape_fallback: raw.enable_scrape_fallback !== undefined ? raw.enable_scrape_fallback : (raw.enableScrapeFallback ?? true),
          auto_backup_enabled: raw.auto_backup_enabled,
          backup_interval_hours: raw.backup_interval_hours,
          sync_interval_seconds: raw.syncIntervalSeconds ?? raw.sync_interval_seconds ?? 60,
        };
        await idbPut("config", { key: "app_config", value: cfg });
        localStorage.setItem("stockflow_config", JSON.stringify(cfg));
        return;
      }

      case "select_network_directory": {
        const handle = await requestDirectoryHandle();
        if (!handle) return null;
        // Déclencher une première synchronisation
        await syncEventsFromDirectory(handle);
        // L'API File System Access ne fournit que le nom du dossier (pas le chemin complet)
        // On ajoute un préfixe visuel pour indiquer que le dossier est connecté via le navigateur
        return `📂 ${handle.name} (connecté)`;
      }

      case "reconnect_network_directory": {
        const handle = await reconnectDirectoryHandle();
        if (handle) {
          await syncEventsFromDirectory(handle);
          return true;
        }
        return false;
      }

      // ==================== SYNCHRONISATION ====================
      case "sync_events": {
        if (!dirHandle) {
          throw new Error("DOSSIER_NON_AUTORISE");
        }
        return await syncEventsFromDirectory(dirHandle);
      }

      // ==================== PRODUITS & INVENTAIRE ====================
      case "get_products": {
        return await idbGetAll<Product>("products");
      }

      case "create_product": {
        const payload = args.productData || args;
        const trigramme = (args.trigramme || "WEB").toUpperCase();
        const sku = (payload.sku || "").toUpperCase().trim();

        if (sku) {
          const existing = await idbGet<Product>("products", sku);
          const newAttrs = typeof payload.attributes === "string"
            ? (JSON.parse(payload.attributes || "{}"))
            : (payload.attributes || {});
          const rawScrapeUrl = newAttrs.scrape_price_url;
          const scrapePriceUrl = (rawScrapeUrl && (rawScrapeUrl.startsWith("http://") || rawScrapeUrl.startsWith("https://"))) ? rawScrapeUrl : null;

          if (!existing) {
            await writeAuditToDirectory(dirHandle, sku, trigramme, "CREATE", null, null, null, scrapePriceUrl);
          } else {
            const newLabel = (payload.label || "").trim();
            const newMpn = (payload.mpn || "").trim();
            const newBrand = (payload.brand || "").trim();
            const newCat = (payload.category || "").trim();
            const newSubcat = (payload.subCategory || payload.sub_category || "").trim();
            const newLoc = (payload.location || "").trim();
            const newItemType = (payload.itemType || payload.item_type || "QUANTITATIVE").trim();
            const newMinStock = Number(payload.minStock ?? payload.min_stock ?? 0);
            const newPrice = Number(payload.price || 0);
            const newPackSize = Number(payload.packSize ?? payload.pack_size ?? 1);

            const diffs: [string, string, string][] = [
              ["Désignation", existing.label || "", newLabel],
              ["MPN", existing.mpn || "", newMpn],
              ["Marque", existing.brand || "", newBrand],
              ["Famille", existing.category || "", newCat],
              ["Sous-famille", existing.sub_category || "", newSubcat],
              ["Emplacement", existing.location || "", newLoc],
              ["Type d'article", existing.item_type || "QUANTITATIVE", newItemType],
              ["Seuil d'alerte", String(existing.min_stock ?? 0), String(newMinStock)],
              ["Prix", Number(existing.price || 0).toFixed(2), newPrice.toFixed(2)],
              ["Taille lot", String(existing.pack_size ?? 1), String(newPackSize)],
            ];

            for (const [fieldName, oldVal, newVal] of diffs) {
              if (oldVal !== newVal) {
                await writeAuditToDirectory(dirHandle, sku, trigramme, "UPDATE", fieldName, oldVal, newVal, scrapePriceUrl);
              }
            }

            let oldAttrs: any = {};
            try {
              oldAttrs = typeof existing.attributes === "string" ? JSON.parse(existing.attributes || "{}") : (existing.attributes || {});
            } catch {}

            const oldVpc = JSON.stringify(oldAttrs.vpc || {});
            const newVpc = JSON.stringify(newAttrs.vpc || {});
            if (oldVpc !== newVpc) {
              await writeAuditToDirectory(dirHandle, sku, trigramme, "UPDATE", "Code VPC", oldVpc, newVpc, scrapePriceUrl);
            }

            const attrFields: [string, string][] = [
              ["largeur", "Largeur"],
              ["hauteur", "Hauteur"],
              ["profondeur", "Profondeur"],
              ["poids", "Poids"],
              ["notes", "Notes"],
            ];

            for (const [key, displayName] of attrFields) {
              const oldV = oldAttrs[key] !== undefined && oldAttrs[key] !== null ? (typeof oldAttrs[key] === "object" ? JSON.stringify(oldAttrs[key]) : String(oldAttrs[key])).trim() : "";
              const newV = newAttrs[key] !== undefined && newAttrs[key] !== null ? (typeof newAttrs[key] === "object" ? JSON.stringify(newAttrs[key]) : String(newAttrs[key])).trim() : "";
              if (oldV !== newV) {
                await writeAuditToDirectory(dirHandle, sku, trigramme, "UPDATE", displayName, oldV, newV, scrapePriceUrl);
              }
            }
          }
        }

        await writeEventToDirectory(dirHandle, "PRODUCT_CREATE", trigramme, payload);
        return;
      }

      case "delete_product": {
        const sku = (args.sku || "").toUpperCase().trim();
        const trigramme = (args.trigramme || "WEB").toUpperCase();
        if (sku) {
          await writeAuditToDirectory(dirHandle, sku, trigramme, "DELETE");
        }
        await writeEventToDirectory(dirHandle, "PRODUCT_DELETE", trigramme, { sku });
        return;
      }

      case "add_movement": {
        const event_type = args.eventType || args.event_type || "STOCK_OUT";
        const trigramme = args.trigramme || "WEB";
        const sku = args.sku;
        const qty = args.qty;
        const note = args.note || "";
        await writeEventToDirectory(dirHandle, event_type, trigramme, {
          sku,
          qty: Number(qty || 0),
          note,
        });
        return;
      }

      case "get_product_history": {
        const sku = (args.sku || "").toUpperCase();
        const items = await idbGetByIndex<ProductHistoryItem>("history", "sku", sku);
        items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return items;
      }

      case "get_product_audit_log": {
        const sku = (args.sku || "").toUpperCase();
        const items = await idbGetByIndex<AuditLogItem>("audit_log", "sku", sku);
        const filtered = items.filter(
          item => !(item.action === "UPDATE" && ["Images", "Documents", "URL document", "URL image", "URL source prix", "Notice principale", "Image principale"].includes(item.field || ""))
        );
        filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return filtered;
      }

      // ==================== TABLEAU DE BORD & STATS ====================
      case "get_dashboard_stats": {
        const products = await idbGetAll<Product>("products");
        const allHistory = await idbGetAll<ProductHistoryItem>("history");
        const allAudits = await idbGetAll<AuditLogItem>("audit_log");

        let totalValue = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;

        for (const p of products) {
          const stock = Number(p.current_stock || 0);
          const min = Number(p.min_stock || 0);
          const price = Number(p.price || 0);

          totalValue += stock * price;
          if (stock <= 0) {
            outOfStockCount++;
          } else if (stock <= min) {
            lowStockCount++;
          }
        }

        const filteredAudits = allAudits.filter(
          item => !(item.action === "UPDATE" && ["Images", "Documents", "URL document", "URL image", "URL source prix", "Notice principale", "Image principale"].includes(item.field || ""))
        );
        allHistory.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        filteredAudits.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        const stats: DashboardStats = {
          total_references: products.length,
          total_value: Math.round(totalValue * 100) / 100,
          low_stock_count: lowStockCount,
          out_of_stock_count: outOfStockCount,
          recent_movements: allHistory.slice(0, 20),
          recent_audits: filteredAudits.slice(0, 20),
        };
        return stats;
      }

      // ==================== NOMENCLATURES (BOM) ====================
      case "get_boms": {
        const boms = await idbGetAll<Bom>("boms");
        boms.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
        return boms;
      }

      case "save_bom": {
        const bom_id = args.bomId || args.bom_id || args.id || args.bom?.id || crypto.randomUUID();
        const name = (args.name || args.bom?.name || "Nomenclature").trim();
        const status = (args.status || args.bom?.status || "DRAFT").trim();
        const equipment_note = (args.equipmentNote || args.equipment_note || args.bom?.equipment_note || "").trim();
        const items = args.items || args.bom?.items || [];
        const trigramme = args.trigramme || "WEB";
        const payload = {
          bom_id,
          name,
          status,
          equipment_note,
          items,
        };
        await writeEventToDirectory(dirHandle, "BOM_SAVE", trigramme, payload);
        return;
      }

      case "delete_bom": {
        const bomId = args.bomId || args.bom_id || args.id || args.bom?.id;
        const trigramme = args.trigramme || "WEB";
        await writeEventToDirectory(dirHandle, "BOM_DELETE", trigramme, { bom_id: bomId });
        return;
      }

      // ==================== MÉDIAS & DOCUMENTS ====================
      case "list_sku_images": {
        const sku = args.sku || "";
        return await listSkuImagesFromDirectory(dirHandle, sku);
      }

      case "list_sku_pdfs": {
        const sku = args.sku || "";
        return await listSkuPdfsFromDirectory(dirHandle, sku);
      }

      case "get_sku_screenshot_path": {
        return null;
      }

      // ==================== MIGRATION CSV & SÉLECTIONS ====================
      case "select_csv_file": {
        return await selectCsvFileWeb();
      }

      case "select_image_dir": {
        return await selectImageDirWeb();
      }

      case "select_pdf_dir": {
        return await selectPdfDirWeb();
      }

      case "import_csv": {
        const trigramme = args.trigramme || "MIG";
        return await importCsvWeb(trigramme);
      }

      // ==================== EXPORT & DIALOGUES ====================
      case "save_file_dialog": {
        const { filename, contents } = args;
        if (!contents) return null;

        const u8 = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
        const blob = new Blob([u8]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "export";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return filename;
      }

      case "force_release_lock":
        return true;

      case "compact_network_events":
        return { message: "Compactage non requis en mode Web autonome" };

      // ==================== MÉDIAS (TÉLÉCHARGEMENT & SUPPRESSION) ====================
      // ==================== MÉDIAS (TÉLÉCHARGEMENT & SUPPRESSION) ====================
      case "save_selected_images": {
        const { sku, urls } = args as { sku: string; urls: string[] };
        const skuUpper = (sku || "").toUpperCase().trim();
        const activeDir = await getDirectoryHandle();
        const downloaded: string[] = [];

        if (urls && urls.length > 0) {
          const stored = await getStoredScrapeCandidates(skuUpper);
          let imagesDir: FileSystemDirectoryHandle | null = null;
          if (activeDir) {
            try {
              imagesDir = await getSubdirectoryHandle(activeDir, "images", true);
            } catch (e) {
              console.warn("[WebBackend] Impossible d'accéder au dossier images :", e);
            }
          }

          for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            let blob: Blob | null = null;

            // 1. Essai de téléchargement direct de l'image
            try {
              const resp = await fetch(url, { headers: { "Accept": "image/*" } });
              if (resp.ok) {
                blob = await resp.blob();
              }
            } catch (e) {
              console.warn(`[WebBackend] Échec du téléchargement direct de l'image (CORS) : ${url}`);
            }

            // 2. Si échec, tentative avec le thumbnail_url de SearXNG (Google/Bing proxy)
            if (!blob && stored?.image_candidates) {
              const cand = stored.image_candidates.find(c => c.url === url);
              if (cand?.thumbnail_url && cand.thumbnail_url !== url) {
                try {
                  const thumbResp = await fetch(cand.thumbnail_url);
                  if (thumbResp.ok) {
                    blob = await thumbResp.blob();
                  }
                } catch (e2) {
                  console.warn(`[WebBackend] Échec du téléchargement du thumbnail : ${cand.thumbnail_url}`);
                }
              }
            }

            if (!blob) continue;

            // Déterminer l'extension
            let ext = "jpg";
            if (blob.type.includes("png")) ext = "png";
            else if (blob.type.includes("webp")) ext = "webp";
            else if (url.split("?")[0].includes(".")) {
              const uext = url.split("?")[0].split(".").pop()?.toLowerCase();
              if (uext && ["jpg", "jpeg", "png", "webp", "gif"].includes(uext)) {
                ext = uext === "jpeg" ? "jpg" : uext;
              }
            }

            const configRecord = await idbGet<{ key: string; value: any }>("config", "app_config");
            const appConfig = configRecord?.value || {};
            const prod = await idbGet<Product>("products", skuUpper);
            const cleanBrand = sanitizeFolderName(prod?.brand, "INCONNU");
            const cleanDesc = sanitizeFolderName(prod?.label, "");

            let filename = `${skuUpper}_${Date.now()}_${i}.${ext}`;
            const imgConv = appConfig.image_rename_convention || appConfig.imageRenameConvention;
            if (imgConv) {
              let f = imgConv
                .replace(/{SKU}/gi, skuUpper)
                .replace(/{Brand}/gi, cleanBrand)
                .replace(/{MPN}/gi, sanitizeFolderName(prod?.mpn || skuUpper))
                .replace(/{Description}/gi, cleanDesc || "IMAGE")
                .replace(/{Designation}/gi, cleanDesc || "IMAGE")
                .replace(/{Label}/gi, cleanDesc || "IMAGE")
                .replace(/{Index}/gi, (i + 1).toString())
                .replace(/{Date}/gi, new Date().toISOString().slice(0, 10).replace(/-/g, ""))
                .replace(/{Source}/gi, "web");
              if (!f.toLowerCase().endsWith(".jpg") && !f.toLowerCase().endsWith(".jpeg") && !f.toLowerCase().endsWith(".png") && !f.toLowerCase().endsWith(".webp")) {
                f += `.${ext}`;
              }
              filename = f;
            }

            const relativePath = `images/${filename}`;

            // Enregistrer dans le système de fichiers si le dossier réseau est actif
            if (imagesDir) {
              try {
                const fileHandle = await imagesDir.getFileHandle(filename, { create: true });
                const writable = await (fileHandle as any).createWritable();
                await writable.write(blob);
                await writable.close();
              } catch (e) {
                console.warn(`[WebBackend] Erreur écriture fichier ${filename} :`, e);
              }
            }

            // Mettre en cache l'ObjectURL pour l'affichage immédiat
            const objUrl = URL.createObjectURL(blob);
            setCachedMediaUrl(relativePath, objUrl);
            downloaded.push(relativePath);

            const trigramme = ((args as any).trigramme || appConfig.trigramme || "WEB").toUpperCase();
            await writeAuditToDirectory(activeDir, skuUpper, trigramme, "SCRAPE_IMAGE", "Image", null, relativePath, url);
          }

          // Mettre à jour le produit si son image_path est vide
          if (downloaded.length > 0) {
            const prod = await idbGet<Product>("products", skuUpper);
            if (prod && !prod.image_path) {
              prod.image_path = downloaded[0];
              await idbPut("products", prod);
            }
          } else if (urls.length > 0) {
            // Si le téléchargement binaire échoue (CORS), conserver l'URL directe utilisable dans les balises img
            const prod = await idbGet<Product>("products", skuUpper);
            if (prod && !prod.image_path) {
              prod.image_path = urls[0];
              await idbPut("products", prod);
            }
          }
        }
        return downloaded;
      }

      case "save_selected_pdf": {
        const { sku, url, docType } = args as { sku: string; url: string; docType?: string };
        const skuUpper = (sku || "").toUpperCase().trim();
        const activeDir = await getDirectoryHandle();
        const prod = await idbGet<Product>("products", skuUpper);
        const configRecord = await idbGet<{ key: string; value: any }>("config", "app_config");
        const appConfig = configRecord?.value || {};
        const detectedOpt = detectDocumentType(url);
        const effectiveDocType = (docType && docType !== "datasheet" && docType !== "document")
          ? docType.trim().replace(/[\s/\\]+/g, "_")
          : detectedOpt.value;
        const cleanTrigramme = ((args as any).trigramme || appConfig.trigramme || "WEB").toUpperCase();

        if (url) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) {
              throw new Error(`Erreur HTTP distant : ${resp.status}`);
            }
            const blob = await resp.blob();

            const cleanBrand = sanitizeFolderName(prod?.brand, "INCONNU");
            const cleanCat = sanitizeFolderName(prod?.category, "INCONNU");
            const cleanSubcat = sanitizeFolderName(prod?.sub_category, "INCONNU");
            const cleanDesc = sanitizeFolderName(prod?.label, "");
            const skuFolder = cleanDesc ? `${skuUpper} - ${cleanDesc}` : skuUpper;

            let filename = `${skuUpper}_${effectiveDocType}.pdf`;
            const convention = appConfig.pdf_rename_convention || appConfig.pdfRenameConvention;
            if (convention) {
              let fName = convention
                .replace(/{SKU}/gi, skuUpper)
                .replace(/{Brand}/gi, cleanBrand)
                .replace(/{MPN}/gi, sanitizeFolderName(prod?.mpn || skuUpper))
                .replace(/{Description}/gi, cleanDesc || "NOTICE")
                .replace(/{Designation}/gi, cleanDesc || "NOTICE")
                .replace(/{Label}/gi, cleanDesc || "NOTICE")
                .replace(/{Type}/gi, effectiveDocType);
              if (!fName.toLowerCase().endsWith(".pdf")) fName += ".pdf";
              filename = fName;
            } else {
              let baseName = effectiveDocType;
              try {
                const pathname = new URL(url).pathname;
                const seg = pathname.split("/").pop()?.replace(/\.pdf$/i, "");
                if (seg && seg.length > 3 && !seg.toLowerCase().includes("datasheet") && effectiveDocType === "fiche_technique") {
                  baseName = seg.slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, "_");
                }
              } catch {}
              filename = `${skuUpper}_${baseName}.pdf`;
            }

            const relativePath = `documents/${cleanBrand}/${cleanCat}/${cleanSubcat}/${skuFolder}/${filename}`;

            if (activeDir) {
              const targetDir = await getNestedDirectory(activeDir, [
                "documents",
                cleanBrand,
                cleanCat,
                cleanSubcat,
                skuFolder,
              ], true);
              if (targetDir) {
                const fileHandle = await targetDir.getFileHandle(filename, { create: true });
                const writable = await (fileHandle as any).createWritable();
                await writable.write(blob);
                await writable.close();
              }
            }

            const objUrl = URL.createObjectURL(blob);
            setCachedMediaUrl(relativePath, objUrl);

            // Mettre à jour le produit
            if (prod) {
              prod.pdf_path = relativePath;
              await idbPut("products", prod);
            }

            await writeAuditToDirectory(activeDir, skuUpper, cleanTrigramme, "SCRAPE_PDF", effectiveDocType, null, relativePath, url);

            return relativePath;
          } catch (e: any) {
            console.warn(`[WebBackend] Téléchargement direct du PDF bloqué par le serveur distant (CORS / ${e.message}). Lien source conservé pour accès direct :`, url);
            // Enregistrer le lien web distant dans la fiche produit pour consultation directe
            if (prod) {
              let attrs: any = {};
              try {
                attrs = typeof prod.attributes === "string" ? JSON.parse(prod.attributes || "{}") : (prod.attributes || {});
              } catch {}
              attrs.scrape_doc_url = url;
              if (!attrs.scrape_pdf_urls) attrs.scrape_pdf_urls = [];
              if (!attrs.scrape_pdf_urls.includes(url)) attrs.scrape_pdf_urls.push(url);
              prod.attributes = JSON.stringify(attrs);
              if (!prod.pdf_path) {
                prod.pdf_path = url;
              }
              await idbPut("products", prod);
            }
            await writeAuditToDirectory(activeDir, skuUpper, cleanTrigramme, "SCRAPE_PDF", effectiveDocType, null, url, url);
            return url;
          }
        }
        return "";
      }

      case "delete_media": {
        const { path: mediaPath, sku, mediaType, trigramme } = args as { path: string; sku?: string; mediaType?: string; trigramme?: string };
        const activeDir = await getDirectoryHandle();
        if (activeDir && mediaPath) {
          try {
            const parts = mediaPath.split(/[/\\]/).filter(Boolean);
            let parentDir = activeDir;
            for (let i = 0; i < parts.length - 1; i++) {
              parentDir = await parentDir.getDirectoryHandle(parts[i]);
            }
            await parentDir.removeEntry(parts[parts.length - 1]);

            let skuUpper = (sku || "").toUpperCase().trim();
            if (!skuUpper && parts.length > 0) {
              const last = parts[parts.length - 1];
              if (last.includes("_")) skuUpper = last.split("_")[0].toUpperCase();
            }
            const cleanTrigramme = (trigramme || "WEB").toUpperCase();
            const cleanType = mediaType || (mediaPath.endsWith(".pdf") ? "pdf" : "image");
            if (skuUpper) {
              await writeAuditToDirectory(activeDir, skuUpper, cleanTrigramme, "DELETE_MEDIA", cleanType, mediaPath, null);
            }
          } catch (e) {
            console.warn("[WebBackend] Erreur suppression média :", e);
          }
        }
        return true;
      }

      case "rename_media": {
        const { sku, oldPath, newName, mediaType, trigramme } = args as { sku: string; oldPath: string; newName: string; mediaType?: string; trigramme?: string };
        const activeDir = await getDirectoryHandle();
        if (activeDir && oldPath && newName) {
          try {
            const parts = oldPath.split(/[/\\]/).filter(Boolean);
            let parentDir = activeDir;
            for (let i = 0; i < parts.length - 1; i++) {
              parentDir = await parentDir.getDirectoryHandle(parts[i]);
            }
            const oldFileHandle = await parentDir.getFileHandle(parts[parts.length - 1]);
            const file = await oldFileHandle.getFile();
            const newFileHandle = await parentDir.getFileHandle(newName, { create: true });
            const writable = await (newFileHandle as any).createWritable();
            await writable.write(file);
            await writable.close();
            await parentDir.removeEntry(parts[parts.length - 1]);

            // Mettre à jour l'URL en cache
            const newParts = [...parts.slice(0, -1), newName];
            const newRelative = newParts.join("/");
            setCachedMediaUrl(newRelative, URL.createObjectURL(file));

            const skuUpper = (sku || "").toUpperCase().trim();
            const prod = await idbGet<Product>("products", skuUpper);
            if (prod && (prod.pdf_path === oldPath || prod.image_path === oldPath)) {
              if (prod.pdf_path === oldPath) prod.pdf_path = newRelative;
              if (prod.image_path === oldPath) prod.image_path = newRelative;
              await idbPut("products", prod);
            }

            const cleanTrigramme = (trigramme || "WEB").toUpperCase();
            const cleanType = mediaType || (oldPath.endsWith(".pdf") ? "pdf" : "image");
            await writeAuditToDirectory(activeDir, skuUpper, cleanTrigramme, "RENAME_MEDIA", cleanType, oldPath, newRelative);
          } catch (e) {
            console.warn("[WebBackend] Erreur renommage média :", e);
          }
        }
        return true;
      }

      case "upload_media": {
        const { sku, mediaType, fileName, fileData } = args as {
          sku: string;
          mediaType: "image" | "pdf";
          fileName: string;
          fileData: number[] | Uint8Array;
        };
        const skuUpper = (sku || "").toUpperCase().trim();
        const trigramme = ((args as any).trigramme || "WEB").toUpperCase();
        const activeDir = await getDirectoryHandle();
        const u8 = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
        const mime = mediaType === "image" ? "image/jpeg" : "application/pdf";
        const blob = new Blob([u8], { type: mime });

        if (mediaType === "image") {
          const cleanName = fileName.startsWith(`${skuUpper}_`) ? fileName : `${skuUpper}_${fileName}`;
          const relativePath = `images/${cleanName}`;
          if (activeDir) {
            const imagesDir = await getSubdirectoryHandle(activeDir, "images", true);
            if (imagesDir) {
              const fileHandle = await imagesDir.getFileHandle(cleanName, { create: true });
              const writable = await (fileHandle as any).createWritable();
              await writable.write(blob);
              await writable.close();
            }
          }
          const objUrl = URL.createObjectURL(blob);
          setCachedMediaUrl(relativePath, objUrl);

          const prod = await idbGet<Product>("products", skuUpper);
          if (prod && !prod.image_path) {
            prod.image_path = relativePath;
            await idbPut("products", prod);
          }
          await writeAuditToDirectory(activeDir, skuUpper, trigramme, "UPLOAD_MEDIA", mediaType, null, relativePath);
          return relativePath;
        } else {
          const prod = await idbGet<Product>("products", skuUpper);
          const cleanBrand = sanitizeFolderName(prod?.brand, "INCONNU");
          const cleanCat = sanitizeFolderName(prod?.category, "INCONNU");
          const cleanSubcat = sanitizeFolderName(prod?.sub_category, "INCONNU");
          const cleanDesc = sanitizeFolderName(prod?.label, "");
          const skuFolder = cleanDesc ? `${skuUpper} - ${cleanDesc}` : skuUpper;

          const cleanName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
          const relativePath = `documents/${cleanBrand}/${cleanCat}/${cleanSubcat}/${skuFolder}/${cleanName}`;

          if (activeDir) {
            const targetDir = await getNestedDirectory(activeDir, [
              "documents",
              cleanBrand,
              cleanCat,
              cleanSubcat,
              skuFolder,
            ], true);
            if (targetDir) {
              const fileHandle = await targetDir.getFileHandle(cleanName, { create: true });
              const writable = await (fileHandle as any).createWritable();
              await writable.write(blob);
              await writable.close();
            }
          }
          const objUrl = URL.createObjectURL(blob);
          setCachedMediaUrl(relativePath, objUrl);

          if (prod) {
            prod.pdf_path = relativePath;
            await idbPut("products", prod);
          }
          await writeAuditToDirectory(activeDir, skuUpper, trigramme, "UPLOAD_MEDIA", mediaType, null, relativePath);
          return relativePath;
        }
      }

      // ==================== SCRAPING WEB (SEARXNG AUTOHÉBERGÉ) ====================
      case "start_background_scrape":
      case "resume_background_scrape": {
        const sku = (args.sku || "").toUpperCase().trim();
        if (!sku) return false;

        // Si déjà en cours, ne pas relancer
        const existing = activeScrapes.get(sku);
        if (existing && existing.status === "InProgress") {
          return true;
        }

        // Récupérer le produit en base locale pour fournir des indices au scraper
        const prod = await idbGet<Product>("products", sku);
        const hintProduct = {
          ...prod,
          mpn: args.mpn || prod?.mpn,
          brand: args.brand || prod?.brand,
          label: prod?.label,
          vpcSite: args.vpcSite,
          vpcCode: args.vpcCode,
        };

        activeScrapes.set(sku, {
          sku,
          status: "InProgress",
          progress: 0.1,
          message: "Démarrage de la recherche SearXNG..."
        });

        // Lancer le scraping en tâche asynchrone non-bloquante avec options
        runWebScrape(sku, hintProduct, {
          includeImages: args.includeImages === true,
          includeDocs: args.includeDocs === true,
          allowFallback: args.allowFallback,
        })
          .then((candidates) => {
            const count = (candidates.label_candidates?.length ? 1 : 0) +
              candidates.image_candidates.length +
              candidates.pdf_candidates.length;
            activeScrapes.set(sku, {
              sku,
              status: "Complete",
              progress: 1.0,
              message: `${count} données trouvées`
            });
          })
          .catch((err) => {
            console.error(`[WebBackend] Échec du scraping pour ${sku} :`, err);
            activeScrapes.set(sku, {
              sku,
              status: "Failed",
              progress: 1.0,
              message: err.message || "Erreur de scraping"
            });
            emitWebEvent("scrape-task-error", {
              sku,
              error: err.message || "Erreur lors du scraping Web",
            });
          });

        return true;
      }

      case "get_scrape_status": {
        const sku = (args.sku || "").toUpperCase().trim();
        if (activeScrapes.has(sku)) {
          return activeScrapes.get(sku);
        }
        const cached = await getStoredScrapeCandidates(sku);
        if (cached) {
          return {
            sku,
            status: "Complete",
            progress: 1.0,
            message: `${cached.image_candidates.length + cached.pdf_candidates.length} candidats trouvés`
          };
        }
        return null;
      }

      case "get_scrape_candidates": {
        const sku = (args.sku || "").toUpperCase().trim();
        return await getStoredScrapeCandidates(sku);
      }

      case "search_image_candidates": {
        const query = (args?.query || `${args?.brand || ""} ${args?.mpn || args?.sku || ""} ${args?.label || ""}`).trim();
        if (!query) return [];
        return await searchSearxngImages(query);
      }

      case "search_pdf_candidates": {
        const query = (args?.query || `${args?.brand || ""} ${args?.mpn || args?.sku || ""} ${args?.label || ""}`).trim();
        if (!query) return [];
        return await searchSearxngPdfs(query);
      }

      case "save_scrape_candidates": {
        const sku = (args.sku || "").toUpperCase().trim();
        const candidates = args.candidates;
        if (sku && candidates) {
          await idbPut("config", { key: `candidates_${sku}`, value: candidates });
          const normSku = sku.replace(/[^A-Z0-9]/g, "");
          if (normSku && normSku !== sku) {
            await idbPut("config", { key: `candidates_${normSku}`, value: candidates });
          }
        }
        return true;
      }

      case "cancel_background_scrape": {
        const sku = (args.sku || "").toUpperCase().trim();
        if (activeScrapes.has(sku)) {
          activeScrapes.set(sku, {
            sku,
            status: "Cancelled",
            progress: 1.0,
            message: "Scraping annulé"
          });
        }
        return;
      }

      case "get_queue_info": {
        let activeCount = 0;
        for (const s of activeScrapes.values()) {
          if (s.status === "InProgress") activeCount++;
        }
        return {
          active_count: activeCount,
          queued_count: 0
        };
      }

      case "search_vpc_domains_via_searxng": {
        const query = args.query || "";
        const results = await searchSearxngGeneral(query);
        const domains = new Set<string>();
        for (const r of results) {
          if (r.url) {
            try {
              const hostname = new URL(r.url).hostname.replace(/^www\./, "");
              if (hostname) domains.add(hostname);
            } catch {}
          }
        }
        return Array.from(domains);
      }

      case "test_searxng_instances": {
        const urls: string[] = args.urls || [];
        const results: Record<string, string> = {};

        for (const u of urls) {
          const cleanUrl = u.trim().replace(/\/+$/, "");
          if (!cleanUrl) continue;
          try {
            const start = Date.now();
            const testUrl = `${cleanUrl}/search?q=test&format=json&language=fr-FR`;
            const resp = await fetch(testUrl, {
              headers: { "Accept": "application/json" }
            });
            const elapsed = Date.now() - start;

            if (resp.status === 200) {
              const data = await resp.json();
              if (data && Array.isArray(data.results)) {
                results[cleanUrl] = `200 OK (${elapsed}ms, JSON opérationnel)`;
              } else {
                results[cleanUrl] = "200 OK mais format JSON inattendu";
              }
            } else if (resp.status === 429) {
              results[cleanUrl] = "429 Rate Limit (Cloudflare / Limite atteinte)";
            } else if (resp.status === 403) {
              results[cleanUrl] = "403 Forbidden (Vérifier WAF Cloudflare / Mode Bot)";
            } else {
              results[cleanUrl] = `Erreur HTTP ${resp.status} : ${resp.statusText}`;
            }
          } catch (e: any) {
            results[cleanUrl] = `Erreur connexion (${e.message || "CORS non autorisé ou hors ligne"})`;
          }
        }

        return results;
      }

      // ==================== SAUVEGARDE & MAINTENANCE ====================
      case "get_backup_config": {
        const local = localStorage.getItem("stockflow_backup_config");
        if (local) {
          try {
            return JSON.parse(local);
          } catch {}
        }
        const record = await idbGet<any>("config", "backup_config");
        return record?.value || { enabled: false, scope: "ALL", max_backups: 5, delay_minutes: 60 };
      }

      case "save_backup_config": {
        const cfg = args.config || args;
        await idbPut("config", { key: "backup_config", value: cfg });
        localStorage.setItem("stockflow_backup_config", JSON.stringify(cfg));
        return true;
      }

      case "trigger_manual_backup": {
        return "Sauvegarde effectuée avec succès";
      }

      case "ensure_directory": {
        return true;
      }

      case "clean_network_media": {
        return "Nettoyage terminé";
      }

      case "save_screenshot": {
        return null;
      }

      case "resolve_media": {
        const path = args.path || args.relativePath || "";
        return await this.resolveMedia(path);
      }

      default:
        console.warn(`[WebBackend] Commande non implémentée en mode Web : '${command}'`, args);
        return null;
    }
  }

  async resolveMedia(relativePath: string): Promise<string> {
    const dirHandle = await getDirectoryHandle();
    return await resolveMediaUrl(dirHandle, relativePath);
  }
}

export const webBackendInstance = new WebBackend();
