import BomTab from "./BomTab";
import { useState, useEffect, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import logoImg from "./assets/logo.png";
import "./App.css";

interface AppConfig {
  trigramme: string;
  network_path: string;
  searxng_url?: string;
  vpc_sites: string[];
  pdf_rename_convention?: string;
  image_rename_convention?: string;
  pdf_size_threshold?: number;
  price_tax_type?: string;
  vpc_api_keys?: Record<string, string>;
  vpc_urls?: Record<string, string>;
}

interface Product {
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
  attributes: string;
  image_path?: string | null;
  pdf_path?: string | null;
  pack_size: number;
}

interface ColumnConfig {
  id: string;
  label: string;
  width: number;
  visible: boolean;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "sku", label: "SKU (Interne)", width: 140, visible: true },
  { id: "mpn", label: "Ref Fabricant", width: 140, visible: true },
  { id: "vpc_code", label: "Code VPC", width: 120, visible: true },
  { id: "brand", label: "Marque", width: 120, visible: true },
  { id: "category", label: "Famille", width: 120, visible: true },
  { id: "sub_category", label: "Sous-famille", width: 120, visible: true },
  { id: "label", label: "Désignation", width: 250, visible: true },
  { id: "location", label: "Emplacement", width: 110, visible: true },
  { id: "current_stock", label: "Stock Actuel", width: 100, visible: true },
  { id: "min_stock", label: "Seuil Alerte", width: 100, visible: true },
  { id: "price", label: "Prix Unit.", width: 100, visible: true },
  { id: "total_value", label: "Valeur Total", width: 110, visible: true },
  { id: "largeur", label: "Largeur (mm)", width: 100, visible: true },
  { id: "hauteur", label: "Hauteur (mm)", width: 100, visible: true },
  { id: "profondeur", label: "Profondeur (mm)", width: 110, visible: true },
  { id: "poids", label: "Poids (g)", width: 90, visible: true },
];

function getVpcCode(prod: Product): string {
  try {
    const attrs = typeof prod.attributes === "string" ? JSON.parse(prod.attributes || "{}") : prod.attributes;
    if (attrs && attrs.vpc) {
      const keys = Object.keys(attrs.vpc);
      if (keys.length > 0) {
        const site = keys[0];
        return `${site}: ${attrs.vpc[site]}`;
      }
    }
    if (attrs && attrs.codeRS && attrs.codeRS.trim() !== "") {
      return `RS: ${attrs.codeRS}`;
    }
  } catch (e) {}
  return "";
}

function getAttribute(prod: Product, key: string): string {
  try {
    const attrs = typeof prod.attributes === "string" ? JSON.parse(prod.attributes || "{}") : prod.attributes;
    if (attrs && attrs[key] !== undefined && attrs[key] !== null) {
      return attrs[key].toString();
    }
  } catch (e) {}
  return "";
}



interface ProductHistoryItem {
  timestamp: string;
  trigramme: string;
  event_type: string;
  qty: number;
  note: string;
}

interface AuditLogItem {
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

interface DashboardStats {
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

function App() {
  // Theme & Configuration States
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("sf_theme");
    return (saved === "light" || saved === "dark") ? saved : "dark";
  });

  // Column definitions & settings
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem("sf_inventory_columns");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ColumnConfig[];
        return DEFAULT_COLUMNS.map(def => {
          const found = parsed.find(p => p.id === def.id);
          return found ? { ...def, width: found.width, visible: found.visible } : def;
        });
      } catch (e) {
        return DEFAULT_COLUMNS;
      }
    }
    return DEFAULT_COLUMNS;
  });

  const [appVersion, setAppVersion] = useState("1.4.0");



  const [autofillType, setAutofillType] = useState<string>("mpn");
  const [autofillCodeInput, setAutofillCodeInput] = useState<string>("");

  function cleanNumericInput(value: string): string {
    let cleaned = value.replace(/\./g, ",");
    cleaned = cleaned.replace(/[^0-9,-]/g, "");
    return cleaned;
  }

  useEffect(() => {
    invoke<string>("get_app_version")
      .then((ver) => setAppVersion(ver))
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("sf_inventory_columns", JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    localStorage.setItem("sf_theme", theme);
  }, [theme]);

  const [showColumnSettings, setShowColumnSettings] = useState(false);

  const handleMouseDown = (e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columns.find(c => c.id === colId)?.width || 100;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(50, startWidth + deltaX);
      setColumns(prev => prev.map(c => c.id === colId ? { ...c, width: newWidth } : c));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [trigrammeInput, setTrigrammeInput] = useState("");
  const [networkPathInput, setNetworkPathInput] = useState("");
  const [searxngUrlInput, setSearxngUrlInput] = useState("");
  const [vpcSitesInput, setVpcSitesInput] = useState<string[]>([]);
  const [vpcKeysInput, setVpcKeysInput] = useState<Record<string, string>>({});
  const [vpcUrlsInput, setVpcUrlsInput] = useState<Record<string, string>>({});
  const [newVpcSiteInput, setNewVpcSiteInput] = useState("");
  const [pdfRenameInput, setPdfRenameInput] = useState("");
  const [imageRenameInput, setImageRenameInput] = useState("");
  const [pdfSizeThresholdInput, setPdfSizeThresholdInput] = useState(5);
  const [priceTaxTypeInput, setPriceTaxTypeInput] = useState<string>("HT");

  // Backup configuration states
  const [backupEnabled, setBackupEnabled] = useState<boolean>(false);
  const [backupScope, setBackupScope] = useState<string>("all");
  const [backupMaxBackups, setBackupMaxBackups] = useState<number>(5);
  const [backupDelay, setBackupDelay] = useState<number>(30);
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [isBackupRunning, setIsBackupRunning] = useState<boolean>(false);

  const [editingPdfPath, setEditingPdfPath] = useState<string | null>(null);
  const [newPdfName, setNewPdfName] = useState("");
  const [configError, setConfigError] = useState("");
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  function showToast(message: string, type: "success" | "error" | "info" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  // Navigation & View States
  const [activeTab, setActiveTab] = useState<"dashboard" | "inventory" | "add_product" | "migration" | "settings" | "backup" | "bom">("dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const selectedProductRef = useRef<Product | null>(null);
  selectedProductRef.current = selectedProduct;
  const [productHistory, setProductHistory] = useState<ProductHistoryItem[]>([]);
  const [productAuditLog, setProductAuditLog] = useState<AuditLogItem[]>([]);

  // States for custom VPC URL Search via SearXNG
  const [activeSearchSite, setActiveSearchSite] = useState<string | null>(null);
  const [searchSiteResults, setSearchSiteResults] = useState<string[]>([]);
  const [isSearchingSite, setIsSearchingSite] = useState(false);
  const [searchSiteError, setSearchSiteError] = useState<string | null>(null);
  
  // Dashboard statistics
  const [stats, setStats] = useState<DashboardStats>({
    total_references: 0,
    total_value: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
    recent_movements: [],
    recent_audits: []
  });

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [subCategoryFilter, setSubCategoryFilter] = useState("all");

  // Creation & Editing Forms
  const [newProduct, setNewProduct] = useState({
    sku: "",
    mpn: "",
    label: "",
    brand: "",
    category: "",
    sub_category: "",
    location: "",
    min_stock: "0",
    price: "0",
    pack_size: "1",
    attributes: "{}",
    largeur: "",
    hauteur: "",
    profondeur: "",
    poids: "",
    initial_stock: "0"
  });
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [createError, setCreateError] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editProduct, setEditProduct] = useState({
    sku: "",
    mpn: "",
    label: "",
    brand: "",
    category: "",
    sub_category: "",
    location: "",
    min_stock: "0",
    price: "0",
    item_type: "QUANTITATIVE",
    image_path: null as string | null,
    pdf_path: null as string | null,
    attributes: "{}",
    pack_size: "1",
    largeur: "",
    hauteur: "",
    profondeur: "",
    poids: ""
  });
  const [newVpcSite, setNewVpcSite] = useState("");
  const [newVpcCode, setNewVpcCode] = useState("");
  const [editVpcSite, setEditVpcSite] = useState("");
  const [editVpcCode, setEditVpcCode] = useState("");
  const [editSuccess, setEditSuccess] = useState("");
  const [editError, setEditError] = useState("");

  // States for transient scraping status
  const [autoFillLoading, setAutoFillLoading] = useState<Record<string, boolean>>({});
  const [autoFillSource, setAutoFillSource] = useState<string | null>(null);
  const [autoFillFallbackInfo, setAutoFillFallbackInfo] = useState<string | null>(null);

  // Helper function to scrape and auto-fill either a specific field or all fields
  async function handleAutoFill(isEdit: boolean, targetField?: string) {
    const vpcSite = isEdit ? editVpcSite : newVpcSite;
    const vpcCode = isEdit ? editVpcCode : newVpcCode;
    const mpn = isEdit ? editProduct.mpn : newProduct.mpn;
    const sku = isEdit ? editProduct.sku : newProduct.sku;
    const brand = isEdit ? editProduct.brand : newProduct.brand;
    const label = isEdit ? editProduct.label : newProduct.label;

    const isGeneral = !vpcSite || vpcSite === "mpn";
    const codeToUse = vpcCode.trim() || (isGeneral ? (mpn || sku) : sku).trim();
    if (!codeToUse) {
      const errorMsg = "Veuillez renseigner un SKU ou un Code VPC pour le remplissage.";
      if (isEdit) setEditError(errorMsg); else setCreateError(errorMsg);
      return;
    }

    if (isEdit) {
      setEditError("");
      setEditSuccess("");
    } else {
      setCreateError("");
      setCreateSuccess("");
    }

    const fieldKey = targetField || "ALL";
    setAutoFillLoading(prev => ({ ...prev, [fieldKey]: true }));

    try {
      const details: any = await invoke("scrape_product_details", {
        vpcSite: vpcSite || "mpn",
        vpcCode: vpcCode,
        sku: codeToUse,
        brand: brand || null,
        label: label || null
      });

      if (details.source_url) {
        setAutoFillSource(details.source_url);
      }
      setAutoFillFallbackInfo(details.fallback_info || null);

      const parsedAttrs = (isEdit ? editProduct.largeur || editProduct.hauteur || editProduct.profondeur || editProduct.poids : false) 
        ? {
            largeur: isEdit ? editProduct.largeur : newProduct.largeur,
            hauteur: isEdit ? editProduct.hauteur : newProduct.hauteur,
            profondeur: isEdit ? editProduct.profondeur : newProduct.profondeur,
            poids: isEdit ? editProduct.poids : newProduct.poids
          }
        : {
            largeur: details.dimensions ? details.dimensions.split('x')[0] : undefined,
            hauteur: details.dimensions ? details.dimensions.split('x')[1] : undefined,
            profondeur: details.dimensions ? details.dimensions.split('x')[2] : undefined,
            poids: details.weight || undefined
          };

      const FIELD_NAMES_FR: Record<string, string> = {
        label: "désignation",
        brand: "marque",
        price: "prix",
        pack_size: "taille du lot",
        mpn: "référence fabricant",
        largeur: "largeur",
        hauteur: "hauteur",
        profondeur: "profondeur",
        poids: "poids"
      };

      let wasFound = true;
      if (targetField) {
        if (targetField === "label") wasFound = !!details.label;
        else if (targetField === "brand") wasFound = !!details.brand && details.brand !== "Inconnue";
        else if (targetField === "price") wasFound = details.price > 0;
        else if (targetField === "pack_size") wasFound = details.pack_size > 0;
        else if (targetField === "mpn") wasFound = !!details.mpn;
        else if (targetField === "largeur") wasFound = !!parsedAttrs.largeur;
        else if (targetField === "hauteur") wasFound = !!parsedAttrs.hauteur;
        else if (targetField === "profondeur") wasFound = !!parsedAttrs.profondeur;
        else if (targetField === "poids") wasFound = !!parsedAttrs.poids;
      }

      if (!wasFound && targetField) {
        const errMsg = `Propriété '${FIELD_NAMES_FR[targetField] || targetField}' n'a pas pu être trouvée.`;
        if (isEdit) setEditError(errMsg); else setCreateError(errMsg);
        return;
      }

      if (isEdit) {
        setEditProduct(prev => {
          const next = { ...prev };
          if (!targetField || targetField === "label") next.label = details.label || prev.label;
          if (!targetField || targetField === "brand") next.brand = details.brand || prev.brand;
          if (!targetField || targetField === "price") next.price = details.price > 0 ? details.price : prev.price;
          if (!targetField || targetField === "pack_size") next.pack_size = details.pack_size > 0 ? details.pack_size : prev.pack_size;
          if (!targetField || targetField === "mpn") next.mpn = details.mpn || prev.mpn;
          if (!targetField || targetField === "largeur") next.largeur = parsedAttrs.largeur || prev.largeur;
          if (!targetField || targetField === "hauteur") next.hauteur = parsedAttrs.hauteur || prev.hauteur;
          if (!targetField || targetField === "profondeur") next.profondeur = parsedAttrs.profondeur || prev.profondeur;
          if (!targetField || targetField === "poids") next.poids = parsedAttrs.poids || prev.poids;
          return next;
        });
        setEditSuccess(targetField ? `Champ '${FIELD_NAMES_FR[targetField] || targetField}' mis à jour !` : "Champs pré-remplis avec succès !");
      } else {
        setNewProduct(prev => {
          const next = { ...prev };
          if (!targetField || targetField === "label") next.label = details.label || prev.label;
          if (!targetField || targetField === "brand") next.brand = details.brand || prev.brand;
          if (!targetField || targetField === "price") next.price = details.price > 0 ? details.price : prev.price;
          if (!targetField || targetField === "pack_size") next.pack_size = details.pack_size > 0 ? details.pack_size : prev.pack_size;
          if (!targetField || targetField === "mpn") next.mpn = details.mpn || prev.mpn;
          if (!targetField || targetField === "largeur") next.largeur = parsedAttrs.largeur || prev.largeur;
          if (!targetField || targetField === "hauteur") next.hauteur = parsedAttrs.hauteur || prev.hauteur;
          if (!targetField || targetField === "profondeur") next.profondeur = parsedAttrs.profondeur || prev.profondeur;
          if (!targetField || targetField === "poids") next.poids = parsedAttrs.poids || prev.poids;
          return next;
        });
        setCreateSuccess(targetField ? `Champ '${FIELD_NAMES_FR[targetField] || targetField}' mis à jour !` : "Champs pré-remplis avec succès !");
      }
    } catch (err: any) {
      const errMsg = `Échec de l'auto-remplissage : ${err.toString()}`;
      if (isEdit) setEditError(errMsg); else setCreateError(errMsg);
    } finally {
      setAutoFillLoading(prev => ({ ...prev, [fieldKey]: false }));
    }
  }

  async function triggerAutoFillAction(isEdit: boolean) {
    if (!autofillCodeInput.trim()) {
      const errorMsg = "Veuillez saisir un code ou une référence pour l'auto-remplissage.";
      if (isEdit) setEditError(errorMsg); else setCreateError(errorMsg);
      return;
    }
    
    if (isEdit) {
      setEditError("");
      setEditSuccess("");
    } else {
      setCreateError("");
      setCreateSuccess("");
    }
    
    setAutoFillLoading(prev => ({ ...prev, ["ALL"]: true }));
    
    try {
      const vpcSite = autofillType;
      const vpcCode = autofillType === "mpn" ? "" : autofillCodeInput;
      const sku = autofillType === "mpn" ? autofillCodeInput : "";
      const brand = isEdit ? editProduct.brand : newProduct.brand;
      const label = isEdit ? editProduct.label : newProduct.label;
      
      const details: any = await invoke("scrape_product_details", {
        vpcSite: vpcSite,
        vpcCode: vpcCode,
        sku: sku,
        brand: brand || null,
        label: label || null
      });

      if (details.source_url) {
        setAutoFillSource(details.source_url);
      }
      setAutoFillFallbackInfo(details.fallback_info || null);

      const formatNum = (v: any) => {
        if (v === null || v === undefined) return "";
        return v.toString().replace(/\./g, ",");
      };

      if (isEdit) {
        setEditProduct(prev => ({
          ...prev,
          mpn: details.mpn || prev.mpn || autofillCodeInput,
          label: details.label || prev.label,
          brand: details.brand || prev.brand,
          price: details.price > 0 ? formatNum(details.price) : prev.price,
          pack_size: details.pack_size > 0 ? formatNum(details.pack_size) : prev.pack_size,
          largeur: details.dimensions ? formatNum(details.dimensions.split('x')[0]) : prev.largeur,
          hauteur: details.dimensions ? formatNum(details.dimensions.split('x')[1]) : prev.hauteur,
          profondeur: details.dimensions ? formatNum(details.dimensions.split('x')[2]) : prev.profondeur,
          poids: details.weight ? formatNum(details.weight) : prev.poids,
        }));
        if (autofillType !== "mpn") {
          setEditVpcSite(autofillType);
          setEditVpcCode(autofillCodeInput);
        }
        setEditSuccess("Champs pré-remplis avec succès !");
      } else {
        setNewProduct(prev => ({
          ...prev,
          sku: prev.sku || details.sku || autofillCodeInput,
          mpn: details.mpn || prev.mpn || autofillCodeInput,
          label: details.label || prev.label,
          brand: details.brand || prev.brand,
          price: details.price > 0 ? formatNum(details.price) : prev.price,
          pack_size: details.pack_size > 0 ? formatNum(details.pack_size) : prev.pack_size,
          largeur: details.dimensions ? formatNum(details.dimensions.split('x')[0]) : prev.largeur,
          hauteur: details.dimensions ? formatNum(details.dimensions.split('x')[1]) : prev.hauteur,
          profondeur: details.dimensions ? formatNum(details.dimensions.split('x')[2]) : prev.profondeur,
          poids: details.weight ? formatNum(details.weight) : prev.poids,
        }));
        if (autofillType !== "mpn") {
          setNewVpcSite(autofillType);
          setNewVpcCode(autofillCodeInput);
        }
        setCreateSuccess("Champs pré-remplis avec succès !");
      }
    } catch (err: any) {
      const errMsg = `Échec de l'auto-remplissage : ${err.toString()}`;
      if (isEdit) setEditError(errMsg); else setCreateError(errMsg);
    } finally {
      setAutoFillLoading(prev => ({ ...prev, ["ALL"]: false }));
    }
  }

  // Inventory movement dialog/state inside detail panel
  const [movementQty, setMovementQty] = useState("1");
  const [movementNote, setMovementNote] = useState("");
  const [movementError, setMovementError] = useState("");
  const [movementSuccess, setMovementSuccess] = useState("");

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ sku: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchSuccessCount, setBatchSuccessCount] = useState(0);
  const [batchErrorCount, setBatchErrorCount] = useState(0);
  const [batchStatus, setBatchStatus] = useState("");

  // CSV Migration State
  const [csvFilePath, setCsvFilePath] = useState(() => localStorage.getItem("sf_migration_csv_path") || "");
  const [imagesDirPath, setImagesDirPath] = useState(() => localStorage.getItem("sf_migration_images_path") || "");
  const [pdfDirPath, setPdfDirPath] = useState(() => localStorage.getItem("sf_migration_pdf_path") || "");
  const [migrationStatus, setMigrationStatus] = useState("");
  const [migrationError, setMigrationError] = useState("");
  const [migrationReport, setMigrationReport] = useState<{
    success: number;
    missing_files: number;
    errors: string[];
  } | null>(null);

  // Selected Product Medias
  const [productImages, setProductImages] = useState<string[]>([]);
  const [productPdfs, setProductPdfs] = useState<string[]>([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Network sync status
  const [isOnline, setIsOnline] = useState(true);

  // Hover image preview state
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [isScrapingPrice, setIsScrapingPrice] = useState(false);
  const [isScrapingMedia, setIsScrapingMedia] = useState(false);

  interface ScrapeProgressStep {
    label: string;
    status: "pending" | "active" | "success" | "error";
    details?: string;
  }

  const [scrapeModalOpen, setScrapeModalOpen] = useState(false);
  const [scrapeModalTitle, setScrapeModalTitle] = useState("");
  const [scrapeSteps, setScrapeSteps] = useState<ScrapeProgressStep[]>([]);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  interface ConfirmModalConfig {
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }

  interface AlertModalConfig {
    title: string;
    message: string;
  }

  const [confirmModal, setConfirmModal] = useState<ConfirmModalConfig | null>(null);
  const [inlineConfirm, setInlineConfirm] = useState<{ id: string, action: () => void } | null>(null);
  const [alertModal, setAlertModal] = useState<AlertModalConfig | null>(null);

  function getRenamePreview(convention: string, isPdf: boolean): string {
    if (!convention) return "";
    let name = convention
      .replace(/{SKU}/g, "SKU12345")
      .replace(/{Brand}/g, "SIEMENS")
      .replace(/{MPN}/g, "5SY4110-7")
      .replace(/{Type}/g, isPdf ? "datasheet" : "")
      .replace(/{Index}/g, !isPdf ? "1" : "")
      .replace(/{Source}/g, !isPdf ? "searxng" : "")
      .replace(/{Date}/g, !isPdf ? "20260526" : "");
    
    if (isPdf) {
      if (!name.toLowerCase().endsWith(".pdf")) {
        name += ".pdf";
      }
    } else {
      if (!name.toLowerCase().endsWith(".jpg") && !name.toLowerCase().endsWith(".jpeg")) {
        name += ".jpg";
      }
    }
    return name;
  }
  async function executeScrapePriceForSku(sku: string): Promise<number> {
    if (!config) throw new Error("Configuration manquante");
    const prod = products.find(p => p.sku === sku);
    if (!prod) throw new Error(`Produit introuvable : ${sku}`);

    // Extrait les infos VPC du produit (même logique que la loupe de prix du modal)
    let vpcSite = "mpn";
    let vpcCode = "";
    let mpnOrSku = prod.mpn || prod.sku;
    try {
      const attrs = typeof prod.attributes === "string" ? JSON.parse(prod.attributes || "{}") : prod.attributes;
      if (attrs && attrs.vpc) {
        const keys = Object.keys(attrs.vpc);
        if (keys.length > 0) {
          vpcSite = keys[0];
          vpcCode = attrs.vpc[keys[0]]?.toString() || "";
        }
      }
    } catch (e) {}

    // Utilise le même moteur que la loupe de prix du modal (scrape_product_details)
    const details: any = await invoke("scrape_product_details", {
      vpcSite: vpcSite,
      vpcCode: vpcCode,
      sku: vpcCode || mpnOrSku,
      brand: prod.brand || null,
      label: prod.label || null
    });

    const price: number = details.price;
    if (!price || price <= 0) {
      throw new Error("Prix introuvable via scrape_product_details");
    }

    // Sauvegarde le prix mis à jour
    const currentAttrs = typeof prod.attributes === "string" ? JSON.parse(prod.attributes || "{}") : prod.attributes;
    if (details.source_url) {
      currentAttrs.scrape_price_url = details.source_url;
    }
    await invoke("create_product", {
      networkPath: config.network_path,
      trigramme: config.trigramme,
      sku: prod.sku,
      mpn: prod.mpn,
      label: prod.label,
      brand: prod.brand,
      category: prod.category,
      subCategory: prod.sub_category,
      location: prod.location,
      itemType: prod.item_type,
      minStock: prod.min_stock,
      price: price,
      imagePath: prod.image_path,
      pdfPath: prod.pdf_path,
      attributes: currentAttrs,
      packSize: prod.pack_size
    });
    return price;
  }

  async function executeScrapePdfForSku(sku: string): Promise<string> {
    if (!config) throw new Error("Configuration manquante");
    const prod = products.find(p => p.sku === sku);
    if (!prod) throw new Error(`Produit introuvable : ${sku}`);
    // La query est conservée pour compatibilité mais la logique est construite côté Rust
    const query = `${prod.brand || ""} ${prod.mpn || prod.sku} datasheet`.trim();
    return await invoke<string>("scrape_pdf", {
      sku,
      query,
      networkPath: config.network_path,
      brand: prod.brand || null,
      label: prod.label || null,
    });
  }

  async function executeScrapeImageForSku(sku: string): Promise<string[]> {
    if (!config) throw new Error("Configuration manquante");
    const prod = products.find(p => p.sku === sku);
    if (!prod) throw new Error(`Produit introuvable : ${sku}`);
    // La query est conservée pour compatibilité mais la logique est construite côté Rust
    const query = `${prod.brand || ""} ${prod.mpn || prod.sku} photo`.trim();
    return await invoke<string[]>("scrape_images", {
      sku,
      query,
      networkPath: config.network_path,
      brand: prod.brand || null,
      label: prod.label || null,
    });
  }

  async function runBatchScraping(mediaType: "images" | "pdf" | "price") {
    if (selectedSkus.length === 0 || !config) return;
    setIsBatchRunning(true);
    setBatchTotal(selectedSkus.length);
    setBatchProgress(0);
    setBatchSuccessCount(0);
    setBatchErrorCount(0);
    setBatchStatus("Initialisation du scraping par lot...");

    const randomized = [...selectedSkus].sort(() => Math.random() - 0.5);

    for (let i = 0; i < randomized.length; i++) {
      const sku = randomized[i];
      setBatchStatus(`Scraping de ${sku} en cours (${i + 1}/${randomized.length})...`);
      
      try {
        if (mediaType === "pdf") {
          await executeScrapePdfForSku(sku);
        } else if (mediaType === "images") {
          await executeScrapeImageForSku(sku);
        } else if (mediaType === "price") {
          await executeScrapePriceForSku(sku);
        }
        setBatchSuccessCount(prev => prev + 1);
      } catch (err) {
        console.error(err);
        setBatchErrorCount(prev => prev + 1);
      }
      setBatchProgress(i + 1);
      await new Promise(r => setTimeout(r, 1000));
    }

    setBatchStatus("Scraping par lot terminé !");
    setIsBatchRunning(false);
    setSelectedSkus([]);
    syncAndFetch(config);
  }

  async function handleScrapePrice() {
    if (!config || !selectedProduct) return;
    setIsScrapingPrice(true);
    setMovementError("");
    setMovementSuccess("");
    try {
      const price = await executeScrapePriceForSku(selectedProduct.sku);
      setMovementSuccess(`Prix mis à jour : ${price.toFixed(2)} €`);
      syncAndFetch(config);
      await refreshSelectedProduct(selectedProduct.sku);
    } catch (err: any) {
      setMovementError(err.toString());
    } finally {
      setIsScrapingPrice(false);
    }
  }

  async function handleScrapePdfSingle() {
    if (!config || !selectedProduct) return;
    setIsScrapingMedia(true);
    setScrapeError(null);
    setScrapeModalTitle(`Scraping PDF pour : ${selectedProduct.sku}`);
    setScrapeSteps([
      { label: "Recherche SearxNG pour PDF", status: "active" },
      { label: "Téléchargement des documents", status: "pending" },
      { label: "Déduplication par type & taille", status: "pending" },
      { label: "Sauvegarde réseau (cascade)", status: "pending" },
    ]);
    setScrapeModalOpen(true);

    const unlistens: (() => void)[] = [];

    try {
      const unlistenProgress = await listen<any>("pdf-download-progress", (event) => {
        const payload = event.payload;
        setScrapeSteps(prev => {
          const next = [...prev];
          next[0].status = "success";
          next[1].status = "active";
          next[1].details = payload.message + (payload.details ? ` - ${payload.details}` : "");
          return next;
        });
      });
      unlistens.push(unlistenProgress);

      const unlistenDedup = await listen<any>("pdf-dedup-summary", (event) => {
        const payload = event.payload;
        setScrapeSteps(prev => {
          const next = [...prev];
          next[1].status = "success";
          next[2].status = "success";
          next[2].details = payload.message;
          next[3].status = "active";
          return next;
        });
      });
      unlistens.push(unlistenDedup);

      const relativePath = await executeScrapePdfForSku(selectedProduct.sku);

      setScrapeSteps(prev => {
        const next = [...prev];
        next[0].status = "success";
        next[1].status = "success";
        next[2].status = "success";
        next[3].status = "success";
        next[3].details = `Sauvegardé : ${relativePath.split('/').pop()}`;
        return next;
      });
      setMovementSuccess("PDF récupéré avec succès.");
      syncAndFetch(config);
      await refreshSelectedProduct(selectedProduct.sku);
    } catch (err: any) {
      const errMsg = err.toString();
      setScrapeError(errMsg);
      setScrapeSteps(prev => {
        return prev.map(s => s.status === "active" ? { ...s, status: "error", details: errMsg } : s);
      });
      setMovementError(errMsg);
    } finally {
      unlistens.forEach(fn => fn());
      setIsScrapingMedia(false);
    }
  }

  async function handleScrapeImageSingle() {
    if (!config || !selectedProduct) return;
    setIsScrapingMedia(true);
    setScrapeError(null);
    setScrapeModalTitle(`Scraping Images pour : ${selectedProduct.sku}`);
    setScrapeSteps([
      { label: "Recherche SearxNG pour images", status: "active" },
      { label: "Analyse des images trouvées", status: "pending" },
      { label: "Téléchargement & Redimensionnement", status: "pending" },
      { label: "Création des miniatures & Sauvegarde", status: "pending" },
    ]);
    setScrapeModalOpen(true);

    let stepTimer: any;
    const startTime = Date.now();

    const updateSimulatedSteps = () => {
      const elapsed = Date.now() - startTime;
      setScrapeSteps(prev => {
        const next = [...prev];
        if (elapsed > 4000) {
          if (next[2].status === "active") {
            next[2].status = "success";
            next[3].status = "active";
          }
        } else if (elapsed > 2500) {
          if (next[1].status === "active") {
            next[1].status = "success";
            next[2].status = "active";
          }
        } else if (elapsed > 1000) {
          if (next[0].status === "active") {
            next[0].status = "success";
            next[1].status = "active";
          }
        }
        return next;
      });
      stepTimer = setTimeout(updateSimulatedSteps, 500);
    };
    stepTimer = setTimeout(updateSimulatedSteps, 500);

    const unlistens: (() => void)[] = [];
    try {
      const unlistenProgress = await listen<any>("image-scrape-progress", (event) => {
        const payload = event.payload;
        setScrapeSteps(prev => {
          const next = [...prev];
          next[0].details = payload.message + (payload.details ? ` - ${payload.details}` : "");
          return next;
        });
      });
      unlistens.push(unlistenProgress);

      const urls = await executeScrapeImageForSku(selectedProduct.sku);
      clearTimeout(stepTimer);
      setScrapeSteps([
        { label: "Recherche SearxNG pour images", status: "success" },
        { label: "Analyse des images trouvées", status: "success", details: `${urls.length} images trouvées` },
        { label: "Téléchargement & Redimensionnement", status: "success", details: `${urls.length} fichiers JPG` },
        { label: "Création des miniatures & Sauvegarde", status: "success", details: "Sauvegardé avec miniatures" },
      ]);
      setMovementSuccess("Images récupérées avec succès.");
      syncAndFetch(config);
      await refreshSelectedProduct(selectedProduct.sku);
    } catch (err: any) {
      clearTimeout(stepTimer);
      const errMsg = err.toString();
      setScrapeError(errMsg);
      setScrapeSteps(prev => {
        return prev.map(s => s.status === "active" ? { ...s, status: "error", details: errMsg } : s);
      });
      setMovementError(errMsg);
    } finally {
      unlistens.forEach(fn => fn());
      setIsScrapingMedia(false);
    }
  }

  // Maintenance states
  const [maintenanceStatus, setMaintenanceStatus] = useState("");
  const [maintenanceError, setMaintenanceError] = useState("");
  const [isMaintenanceRunning, setIsMaintenanceRunning] = useState(false);

  // 1. Initial configuration load
  useEffect(() => {
    async function loadConfig() {
      try {
        const loaded: any = await invoke("get_config");
        if (loaded) {
          setConfig(loaded);
          setTrigrammeInput(loaded.trigramme);
          setNetworkPathInput(loaded.network_path);
          setSearxngUrlInput(loaded.searxng_url || "");
          setVpcSitesInput(loaded.vpc_sites || []);
          setVpcKeysInput(loaded.vpc_api_keys || {});
          setVpcUrlsInput(loaded.vpc_urls || {});
          setPdfRenameInput(loaded.pdf_rename_convention || "");
          setImageRenameInput(loaded.image_rename_convention || "");
          setPdfSizeThresholdInput(loaded.pdf_size_threshold ?? 5);
          if (loaded.price_tax_type) {
            setPriceTaxTypeInput(loaded.price_tax_type);
          }
          
          if (loaded.network_path) {
            try {
              const bkConfig: any = await invoke("get_backup_config", { networkPath: loaded.network_path });
              if (bkConfig) {
                setBackupEnabled(bkConfig.enabled);
                setBackupScope(bkConfig.scope);
                setBackupMaxBackups(bkConfig.max_backups);
                setBackupDelay(bkConfig.delay_minutes);
              }
            } catch (e) {
              console.warn("Failed to load backup config", e);
            }
          }
          
          // Initial sync and load
          syncAndFetch(loaded);
        }
      } catch (err) {
        console.error("Failed to load config", err);
      } finally {
        setConfigLoaded(true);
      }
    }
    loadConfig();
  }, []);

  // 2. Background Polling for Event Sourcing Updates (every 4 seconds)
  useEffect(() => {
    if (!config) return;
    const interval = setInterval(() => {
      syncAndFetch(config);
    }, 4000);
    return () => clearInterval(interval);
  }, [config]);

  // Sync and fetch data helper
  async function syncAndFetch(appConfig: AppConfig) {
    try {
      // Sync events from network folder to local SQLite cache
      await invoke("sync_events", { networkPath: appConfig.network_path });
      setIsOnline(true);
    } catch (err: any) {
      console.warn("Réseau inaccessible", err);
      if (err.toString().includes("RÉSEAU_HORS_LIGNE")) {
        // Enregistrements locaux poussés, mais réseau coupé pour le reste
      } else {
        setIsOnline(false);
      }
    }

    try {
      // Reload products cache
      const loadedProducts: Product[] = await invoke("get_products");
      setProducts(loadedProducts);
      
      // Update stats
      const loadedStats: DashboardStats = await invoke("get_dashboard_stats");
      setStats(loadedStats);

      // Refresh currently selected product details
      const currentSelected = selectedProductRef.current;
      if (currentSelected) {
        const updated = loadedProducts.find(p => p.sku === currentSelected.sku);
        if (updated) {
          setSelectedProduct(updated);
          // Mettre à jour les médias
          const imgs: string[] = await invoke("list_sku_images", { networkPath: appConfig.network_path, sku: updated.sku });
          setProductImages(imgs);
          const pdfs: string[] = await invoke("list_sku_pdfs", { networkPath: appConfig.network_path, sku: updated.sku });
          setProductPdfs(pdfs);
          // Rafraîchir historique et audit log en temps réel
          try {
            const history: ProductHistoryItem[] = await invoke("get_product_history", { sku: updated.sku });
            setProductHistory(history);
            const audit: AuditLogItem[] = await invoke("get_product_audit_log", { sku: updated.sku });
            setProductAuditLog(audit);
          } catch (e) {
            console.error("Failed to refresh history/audit", e);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch products/stats", err);
    }
  }

  async function handleSaveSettings(
    tri: string,
    net: string,
    searx: string,
    sites: string[],
    pdfConv: string,
    imgConv: string,
    pdfThreshold: number,
    taxType: string
  ) {
    await invoke("save_config", {
      trigramme: tri,
      networkPath: net,
      searxngUrl: searx || null,
      vpcSites: sites,
      pdfRenameConvention: pdfConv || null,
      imageRenameConvention: imgConv || null,
      pdfSizeThreshold: pdfThreshold,
      priceTaxType: taxType || "HT",
      vpcApiKeys: vpcKeysInput,
      vpcUrls: vpcUrlsInput,
    });
    
    const newConfig: AppConfig = {
      trigramme: tri.toUpperCase(),
      network_path: net,
      searxng_url: searx || undefined,
      vpc_sites: sites,
      pdf_rename_convention: pdfConv || undefined,
      image_rename_convention: imgConv || undefined,
      pdf_size_threshold: pdfThreshold,
      price_tax_type: taxType || "HT",
      vpc_api_keys: vpcKeysInput,
      vpc_urls: vpcUrlsInput,
    };
    setConfig(newConfig);
    syncAndFetch(newConfig);
  }

  async function triggerAutoSave(updatedFields?: Partial<AppConfig>) {
    try {
      const tri = updatedFields?.hasOwnProperty("trigramme") ? updatedFields.trigramme! : trigrammeInput;
      const net = updatedFields?.hasOwnProperty("network_path") ? updatedFields.network_path! : networkPathInput;
      const searx = updatedFields?.hasOwnProperty("searxng_url") ? updatedFields.searxng_url! : searxngUrlInput;
      const sites = updatedFields?.hasOwnProperty("vpc_sites") ? updatedFields.vpc_sites! : vpcSitesInput;
      const pdfConv = updatedFields?.hasOwnProperty("pdf_rename_convention") ? updatedFields.pdf_rename_convention! : pdfRenameInput;
      const imgConv = updatedFields?.hasOwnProperty("image_rename_convention") ? updatedFields.image_rename_convention! : imageRenameInput;
      const pdfThreshold = updatedFields?.hasOwnProperty("pdf_size_threshold") ? updatedFields.pdf_size_threshold! : pdfSizeThresholdInput;
      const taxType = updatedFields?.hasOwnProperty("price_tax_type") ? updatedFields.price_tax_type! : priceTaxTypeInput;
      const apiKeys = updatedFields?.hasOwnProperty("vpc_api_keys") ? updatedFields.vpc_api_keys! : vpcKeysInput;
      const urls = updatedFields?.hasOwnProperty("vpc_urls") ? updatedFields.vpc_urls! : vpcUrlsInput;

      if (tri.trim().length !== 3) {
        return;
      }

      await invoke("save_config", {
        trigramme: tri,
        networkPath: net,
        searxngUrl: searx || null,
        vpcSites: sites,
        pdfRenameConvention: pdfConv || null,
        imageRenameConvention: imgConv || null,
        pdfSizeThreshold: pdfThreshold,
        priceTaxType: taxType || "HT",
        vpcApiKeys: apiKeys,
        vpcUrls: urls,
      });

      const newConfig: AppConfig = {
        trigramme: tri.toUpperCase(),
        network_path: net,
        searxng_url: searx || undefined,
        vpc_sites: sites,
        pdf_rename_convention: pdfConv || undefined,
        image_rename_convention: imgConv || undefined,
        pdf_size_threshold: pdfThreshold,
        price_tax_type: taxType || "HT",
        vpc_api_keys: apiKeys,
        vpc_urls: urls,
      };
      setConfig(newConfig);
      syncAndFetch(newConfig);
      showToast("Paramètres auto-enregistrés", "success");
    } catch (err: any) {
      showToast("Auto-enregistrement échoué : " + err.toString(), "error");
    }
  }

  async function searchVpcUrls(site: string) {
    setActiveSearchSite(site);
    setIsSearchingSite(true);
    setSearchSiteError(null);
    setSearchSiteResults([]);
    try {
      const domains: string[] = await invoke("search_vpc_domains_via_searxng", { query: site });
      const filtered = domains.filter(d => {
        const dLower = d.toLowerCase();
        return !dLower.includes("searx") && !dLower.includes("google") && !dLower.includes("wikipedia") && !dLower.includes("youtube") && !dLower.includes("pinterest") && !dLower.includes("github") && !dLower.includes("facebook") && !dLower.includes("twitter") && !dLower.includes("linkedin") && !dLower.includes("instagram") && !dLower.includes("reddit");
      });
      setSearchSiteResults(filtered);
    } catch (err: any) {
      setSearchSiteError(err.toString());
    } finally {
      setIsSearchingSite(false);
    }
  }

  // Handle configuration setup wizard submission
  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setConfigError("");
    try {
      await handleSaveSettings(
        trigrammeInput,
        networkPathInput,
        searxngUrlInput,
        vpcSitesInput,
        pdfRenameInput,
        imageRenameInput,
        pdfSizeThresholdInput,
        priceTaxTypeInput
      );
      setIsEditingConfig(false);
    } catch (err: any) {
      setConfigError(err.toString());
    }
  }

  // Handle directory pickers using RFD in Rust
  async function pickNetworkDir() {
    try {
      const path: string | null = await invoke("select_network_directory");
      if (path) {
        setNetworkPathInput(path);
        triggerAutoSave({ network_path: path });
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function pickCsvFile() {
    // Rust RFD helper for picking CSV file
    try {
      const path: string | null = await invoke("select_csv_file");
      if (path) {
        setCsvFilePath(path);
        localStorage.setItem("sf_migration_csv_path", path);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function pickImagesDir() {
    try {
      const path: string | null = await invoke("select_image_dir");
      if (path) {
        setImagesDirPath(path);
        localStorage.setItem("sf_migration_images_path", path);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function pickPdfDir() {
    try {
      const path: string | null = await invoke("select_pdf_dir");
      if (path) {
        setPdfDirPath(path);
        localStorage.setItem("sf_migration_pdf_path", path);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Product Selection Details Panel
  async function handleSelectProduct(prod: Product) {
    setSelectedProduct(prod);
    setMovementSuccess("");
    setMovementError("");
    setActiveImageIndex(0);
    try {
      const history: ProductHistoryItem[] = await invoke("get_product_history", { sku: prod.sku });
      setProductHistory(history);
      
      try {
        const audit: AuditLogItem[] = await invoke("get_product_audit_log", { sku: prod.sku });
        setProductAuditLog(audit);
      } catch { setProductAuditLog([]); }
      
      if (config) {
        const imgs: string[] = await invoke("list_sku_images", { networkPath: config.network_path, sku: prod.sku });
        setProductImages(imgs);
        const pdfs: string[] = await invoke("list_sku_pdfs", { networkPath: config.network_path, sku: prod.sku });
        setProductPdfs(pdfs);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function refreshSelectedProduct(sku: string) {
    try {
      const latestProducts: Product[] = await invoke("get_products");
      const found = latestProducts.find(p => p.sku === sku);
      if (found) {
        await handleSelectProduct(found);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Form: Duplicate warning check on typing SKU
  function handleSkuChange(skuVal: string) {
    const cleanSku = skuVal.trim().replace(" ", "").replace("/", "-").toUpperCase();
    setNewProduct(prev => ({ ...prev, sku: skuVal }));
    
    if (cleanSku.length > 0) {
      const exists = products.some(p => p.sku === cleanSku);
      if (exists) {
        setDuplicateWarning(`Attention : la référence ${cleanSku} existe déjà dans le référentiel !`);
      } else {
        setDuplicateWarning("");
      }
    } else {
      setDuplicateWarning("");
    }
  }

  // Form: Create a new reference
  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setCreateSuccess("");
    setCreateError("");

    let attributesObj: any = {};
    if (newProduct.attributes) {
      try {
        attributesObj = JSON.parse(newProduct.attributes);
      } catch (e) {}
    }
    if (newVpcSite && newVpcCode) {
      attributesObj.vpc = { [newVpcSite]: newVpcCode };
    }
    
    // Inject physical dimensions & weight into attributes
    if (newProduct.largeur) attributesObj.largeur = newProduct.largeur;
    if (newProduct.hauteur) attributesObj.hauteur = newProduct.hauteur;
    if (newProduct.profondeur) attributesObj.profondeur = newProduct.profondeur;
    if (newProduct.poids) attributesObj.poids = newProduct.poids;
    if (autoFillSource) attributesObj.scrape_price_url = autoFillSource;

    try {
      await invoke("create_product", {
        networkPath: config.network_path,
        trigramme: config.trigramme,
        sku: newProduct.sku,
        mpn: newProduct.mpn || newProduct.sku,
        label: newProduct.label,
        brand: newProduct.brand,
        category: newProduct.category,
        subCategory: newProduct.sub_category,
        location: newProduct.location,
        itemType: "QUANTITATIVE",
        minStock: Number(newProduct.min_stock.toString().replace(",", ".")) || 0,
        price: Number(newProduct.price.toString().replace(",", ".")) || 0,
        imagePath: null,
        pdfPath: null,
        attributes: attributesObj,
        packSize: Number(newProduct.pack_size.toString().replace(",", ".")) || 1
      });

      // Si un stock initial est renseigné, créer un mouvement STOCK_IN
      const initialQty = Number(newProduct.initial_stock?.toString().replace(",", ".")) || 0;
      if (initialQty > 0) {
        try {
          await invoke("add_movement", {
            networkPath: config.network_path,
            trigramme: config.trigramme,
            eventType: "STOCK_IN",
            sku: newProduct.sku,
            qty: initialQty,
            note: "Stock initial à la création",
          });
        } catch (e) {
          console.warn("Stock initial non enregistré :", e);
        }
      }
      setCreateSuccess("Produit créé avec succès ! Événement généré.");
      setNewVpcSite("");
      setNewVpcCode("");
      setAutoFillSource(null);
      setAutoFillFallbackInfo(null);
      setNewProduct({
        sku: "",
        mpn: "",
        label: "",
        brand: "",
        category: "",
        sub_category: "",
        location: "",
        min_stock: "0",
        price: "0",
        pack_size: "1",
        attributes: "{}",
        largeur: "",
        hauteur: "",
        profondeur: "",
        poids: "",
        initial_stock: "0"
      });
      setShowAddModal(false);
      syncAndFetch(config);
    } catch (err: any) {
      setCreateError(err.toString());
    }
  }

  // Form: Edit an existing reference
  async function handleEditProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setEditSuccess("");
    setEditError("");

    let attributesObj: any = {};
    try {
      attributesObj = typeof editProduct.attributes === "string" ? JSON.parse(editProduct.attributes || "{}") : editProduct.attributes;
    } catch (e) {}

    if (editVpcSite && editVpcCode) {
      attributesObj.vpc = { [editVpcSite]: editVpcCode };
    } else {
      delete attributesObj.vpc;
    }

    // Inject physical dimensions & weight into attributes
    if (editProduct.largeur) attributesObj.largeur = editProduct.largeur; else delete attributesObj.largeur;
    if (editProduct.hauteur) attributesObj.hauteur = editProduct.hauteur; else delete attributesObj.hauteur;
    if (editProduct.profondeur) attributesObj.profondeur = editProduct.profondeur; else delete attributesObj.profondeur;
    if (editProduct.poids) attributesObj.poids = editProduct.poids; else delete attributesObj.poids;
    if (autoFillSource) attributesObj.scrape_price_url = autoFillSource;

    try {
      await invoke("create_product", {
        networkPath: config.network_path,
        trigramme: config.trigramme,
        sku: editProduct.sku,
        mpn: editProduct.mpn || editProduct.sku,
        label: editProduct.label,
        brand: editProduct.brand,
        category: editProduct.category,
        subCategory: editProduct.sub_category,
        location: editProduct.location,
        itemType: editProduct.item_type,
        minStock: Number(editProduct.min_stock.toString().replace(",", ".")) || 0,
        price: Number(editProduct.price.toString().replace(",", ".")) || 0,
        imagePath: editProduct.image_path,
        pdfPath: editProduct.pdf_path,
        attributes: attributesObj,
        packSize: Number(editProduct.pack_size.toString().replace(",", ".")) || 1
      });

      setEditSuccess("Produit mis à jour avec succès !");
      setAutoFillSource(null);
      setAutoFillFallbackInfo(null);
      setShowEditModal(false);

      // Update selected product view in real time
      const updated = {
        ...selectedProduct!,
        mpn: editProduct.mpn || editProduct.sku,
        label: editProduct.label,
        brand: editProduct.brand,
        category: editProduct.category,
        sub_category: editProduct.sub_category,
        location: editProduct.location,
        min_stock: Number(editProduct.min_stock.toString().replace(",", ".")) || 0,
        price: Number(editProduct.price.toString().replace(",", ".")) || 0,
        pack_size: Number(editProduct.pack_size.toString().replace(",", ".")) || 1,
        attributes: JSON.stringify(attributesObj)
      };
      setSelectedProduct(updated);

      syncAndFetch(config);
    } catch (err: any) {
      setEditError(err.toString());
    }
  }

  // Inline Cell Editing
  function handleCellDoubleClick(sku: string, field: string, value: any) {
    setEditingCell({ sku, field });
    let valStr = value !== null && value !== undefined ? value.toString() : "";
    if (field === "price" || field === "min_stock" || field === "largeur" || field === "hauteur" || field === "profondeur" || field === "poids" || field === "current_stock") {
      valStr = valStr.replace(/\./g, ",");
    }
    setEditValue(valStr);
  }

  async function handleCellSave(product: Product) {
    if (!config || !editingCell) return;
    
    const updatedProd = { ...product };
    let attributesObj: any = {};
    try {
      attributesObj = typeof updatedProd.attributes === "string" ? JSON.parse(updatedProd.attributes || "{}") : updatedProd.attributes;
    } catch (e) {}

    const cleanVal = editValue.trim();

    if (editingCell.field === "location") {
      updatedProd.location = cleanVal;
    } else if (editingCell.field === "price") {
      updatedProd.price = Number(cleanVal.replace(",", ".")) || 0;
    } else if (editingCell.field === "label") {
      updatedProd.label = cleanVal;
    } else if (editingCell.field === "mpn") {
      updatedProd.mpn = cleanVal;
    } else if (editingCell.field === "brand") {
      updatedProd.brand = cleanVal;
    } else if (editingCell.field === "category") {
      updatedProd.category = cleanVal;
    } else if (editingCell.field === "sub_category") {
      updatedProd.sub_category = cleanVal;
    } else if (editingCell.field === "min_stock") {
      updatedProd.min_stock = Number(cleanVal.replace(",", ".")) || 0;
    } else if (editingCell.field === "largeur" || editingCell.field === "hauteur" || editingCell.field === "profondeur" || editingCell.field === "poids") {
      (attributesObj as any)[editingCell.field] = cleanVal;
      updatedProd.attributes = JSON.stringify(attributesObj);
    } else if (editingCell.field === "current_stock") {
      // Saisie directe du stock : calcule la différence et crée un mouvement
      const targetQty = Number(cleanVal.replace(",", ".")) || 0;
      const currentQty = product.current_stock || 0;
      const diff = targetQty - currentQty;
      if (diff !== 0 && config) {
        try {
          await invoke("add_movement", {
            networkPath: config.network_path,
            trigramme: config.trigramme,
            eventType: diff > 0 ? "STOCK_IN" : "STOCK_OUT",
            sku: product.sku,
            qty: Math.abs(diff),
            note: diff > 0 ? "Ajustement stock (entrée)" : "Ajustement stock (sortie)",
          });
          setEditingCell(null);
          syncAndFetch(config);
        } catch (err) {
          console.error("Erreur mouvement stock :", err);
        }
      } else {
        setEditingCell(null);
      }
      return; // Court-circuit : pas de invoke create_product pour le stock
    }

    try {
      await invoke("create_product", {
        networkPath: config.network_path,
        trigramme: config.trigramme,
        sku: updatedProd.sku,
        mpn: updatedProd.mpn || updatedProd.sku,
        label: updatedProd.label,
        brand: updatedProd.brand,
        category: updatedProd.category,
        subCategory: updatedProd.sub_category,
        location: updatedProd.location,
        itemType: updatedProd.item_type,
        minStock: updatedProd.min_stock,
        price: updatedProd.price,
        imagePath: updatedProd.image_path,
        pdfPath: updatedProd.pdf_path,
        attributes: attributesObj,
        packSize: updatedProd.pack_size
      });
      setEditingCell(null);
      syncAndFetch(config);
    } catch (err) {
      console.error(err);
    }
  }

  // Inventory movements: Stock In / Stock Out
  async function handleStockMovement(type: "STOCK_IN" | "STOCK_OUT") {
    if (!config || !selectedProduct) return;
    setMovementError("");
    setMovementSuccess("");

    try {
      await invoke("add_movement", {
        networkPath: config.network_path,
        trigramme: config.trigramme,
        eventType: type,
        sku: selectedProduct.sku,
        qty: Number(movementQty.toString().replace(",", ".")),
        note: movementNote || (type === "STOCK_IN" ? "Entrée manuelle" : "Sortie manuelle"),
      });

      setMovementSuccess("Mouvement enregistré !");
      setMovementQty("1");
      setMovementNote("");
      syncAndFetch(config);
      await refreshSelectedProduct(selectedProduct.sku);
    } catch (err: any) {
      setMovementError(err.toString());
    }
  }

  // CSV Migration Execution
  async function handleCsvMigration(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setMigrationStatus("Migration en cours... Veuillez patienter.");
    setMigrationError("");
    setMigrationReport(null);

    try {
      const report: any = await invoke("import_csv", {
        csvPath: csvFilePath,
        networkPath: config.network_path,
        trigramme: config.trigramme,
        imagesDir: imagesDirPath || null,
        pdfDir: pdfDirPath || null
      });
      setMigrationReport(report);
      setMigrationStatus(`Migration terminée ! ${report.success} références importées.`);
      syncAndFetch(config);
    } catch (err: any) {
      setMigrationStatus("");
      setMigrationError(err.toString());
    }
  }

  async function handleCompaction() {
    if (!config) return;
    setConfirmModal({
      title: "Confirmer la compaction",
      message: "Êtes-vous sûr de vouloir compacter le dossier d'événements ? Cela va supprimer l'historique brut des fichiers JSON intermédiaires et générer des états de création et stock consolidés propres pour chaque produit actif.",
      onConfirm: async () => {
        setIsMaintenanceRunning(true);
        setMaintenanceStatus("Compaction en cours... Veuillez patienter.");
        setMaintenanceError("");
        try {
          await invoke("compact_network_events", {
            networkPath: config.network_path,
            trigramme: config.trigramme
          });
          setMaintenanceStatus("Compaction réussie ! Tous les événements ont été consolidés.");
          syncAndFetch(config);
        } catch (err: any) {
          setMaintenanceError(err.toString());
        } finally {
          setIsMaintenanceRunning(false);
        }
      }
    });
  }

  async function handleMediaCleanup() {
    if (!config) return;
    setConfirmModal({
      title: "Confirmer le nettoyage des médias",
      message: "Êtes-vous sûr de vouloir nettoyer le stockage des fichiers médias ? Toutes les images et tous les dossiers PDF qui ne correspondent à aucune référence de produit active dans la base de données seront définitivement supprimés.",
      onConfirm: async () => {
        setIsMaintenanceRunning(true);
        setMaintenanceStatus("Nettoyage en cours... Veuillez patienter.");
        setMaintenanceError("");
        try {
          const result: string = await invoke("clean_network_media", {
            networkPath: config.network_path
          });
          setMaintenanceStatus(result);
          syncAndFetch(config);
        } catch (err: any) {
          setMaintenanceError(err.toString());
        } finally {
          setIsMaintenanceRunning(false);
        }
      }
    });
  }

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (!config || !selectedProduct) return;
    
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    setMovementError("");
    setMovementSuccess("");

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImg = file.type.startsWith("image/") || file.name.endsWith(".jpg") || file.name.endsWith(".jpeg") || file.name.endsWith(".png");
      const isPdf = file.type === "application/pdf" || file.name.endsWith(".pdf");
      
      if (!isImg && !isPdf) {
        setMovementError("Format non supporté. Déposez des images (.jpg, .png) ou des PDF uniquement.");
        continue;
      }
      
      const mediaType = isImg ? "image" : "pdf";
      let fileName = file.name;
      
      if (isImg) {
        const nextNum = productImages.length + 1;
        const ext = file.name.split(".").pop() || "jpg";
        fileName = `${selectedProduct.sku}_${nextNum}.${ext}`.toUpperCase();
      }
      
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const arrayBuffer = reader.result as ArrayBuffer;
          const fileData = Array.from(new Uint8Array(arrayBuffer));
          
          await invoke("upload_media", {
            networkPath: config.network_path,
            sku: selectedProduct.sku,
            mediaType,
            fileName,
            fileData
          });
          
          if (isImg) {
            const updatedImgs: string[] = await invoke("list_sku_images", { networkPath: config.network_path, sku: selectedProduct.sku });
            setProductImages(updatedImgs);
          } else {
            const updatedPdfs: string[] = await invoke("list_sku_pdfs", { networkPath: config.network_path, sku: selectedProduct.sku });
            setProductPdfs(updatedPdfs);
          }
          
          setMovementSuccess(`Média ${fileName} ajouté.`);
        };
        reader.readAsArrayBuffer(file);
      } catch (err: any) {
        setMovementError(`Erreur upload : ${err.toString()}`);
      }
    }
  };

  // Hover Thumbnail handler
  function handleImageHover(e: React.MouseEvent, imageRelativePath: string | null | undefined) {
    if (!imageRelativePath || !config) return;
    
    // Resolve absolute path through standard Windows file path format on network share
    const absolutePath = convertFileSrc(`${config.network_path}/${imageRelativePath}`);
    setHoveredImage(absolutePath);
    setHoverPosition({ x: e.clientX + 15, y: e.clientY + 15 });
  }

  // Render Theme Class
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }
  }, [theme]);

  // Filtered Products List
  const filteredProducts = products.filter(p => {
    const matchQuery = 
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchCategory = categoryFilter === "all" || p.category === categoryFilter;
    const matchSubCategory = subCategoryFilter === "all" || p.sub_category === subCategoryFilter;
    return matchQuery && matchCategory && matchSubCategory;
  });

  // Unique Categories for filters
  const categories = ["all", ...Array.from(new Set(products.map(p => p.category).filter(Boolean)))];

  // Unique Sub-Categories based on selected Category
  const subCategories = ["all", ...Array.from(new Set(
    products
      .filter(p => categoryFilter === "all" || p.category === categoryFilter)
      .map(p => p.sub_category)
      .filter(Boolean)
  ))];

  // If App config has not loaded yet
  if (!configLoaded) {
    return (
      <div className="wizard-overlay">
        <div style={{ color: "#fff", fontSize: "1.2rem", fontWeight: 600 }}>
          Chargement de StockFlow...
        </div>
      </div>
    );
  }

  // Setup Wizard if Config is missing or being edited
  if (!config || isEditingConfig) {
    return (
      <div className="wizard-overlay">
        <form onSubmit={handleSetup} className="wizard-card">
          <div className="wizard-logo">
            <img src={logoImg} alt="StockFlow Logo" className="wizard-logo-img" />
            <span>StockFlow</span>
          </div>
          <div className="wizard-subtitle">
            {config ? "Modifier la configuration" : "Configuration du poste de travail"}
          </div>
          
          {configError && <div className="wizard-error">{configError}</div>}

          <div className="form-group">
            <label htmlFor="trigramme">Trigramme Utilisateur (ex: JDO)</label>
            <input
              id="trigramme"
              type="text"
              required
              maxLength={3}
              value={trigrammeInput}
              onChange={(e) => setTrigrammeInput(e.target.value)}
              placeholder="3 lettres"
              style={{ textTransform: "uppercase" }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="network-path">Chemin du dossier réseau partagé (ex: Z:\Stockflow)</label>
            <div className="input-with-button">
              <input
                id="network-path"
                type="text"
                required
                value={networkPathInput}
                onChange={(e) => setNetworkPathInput(e.target.value)}
                placeholder="Entrez ou sélectionnez le chemin"
              />
              <button type="button" className="btn btn-secondary" onClick={pickNetworkDir}>
                Parcourir
              </button>
            </div>
          </div>

          <button type="submit" className="btn" style={{ width: "100%", marginTop: "1rem" }}>
            {config ? "Enregistrer les modifications" : "Valider et Créer l'environnement"}
          </button>
          
          {config && (
            <button 
              type="button" 
              className="btn btn-secondary" 
              style={{ width: "100%", marginTop: "0.5rem" }}
              onClick={() => {
                setTrigrammeInput(config.trigramme);
                setNetworkPathInput(config.network_path);
                setIsEditingConfig(false);
              }}
            >
              Annuler
            </button>
          )}
        </form>
      </div>
    );
  }

  // Autocompletion lists
  const uniqueBrands = Array.from(new Set(products.map(p => p.brand).filter(Boolean))).sort();
  const uniqueCategories = Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort();

  // Sub-Categories for Add Modal based on chosen Category
  const addModalSubCategories = Array.from(new Set(
    products
      .filter(p => !newProduct.category || p.category.toLowerCase() === newProduct.category.toLowerCase())
      .map(p => p.sub_category)
      .filter(Boolean)
  )).sort();

  // Sub-Categories for Edit Modal based on chosen Category
  const editModalSubCategories = Array.from(new Set(
    products
      .filter(p => !editProduct.category || p.category.toLowerCase() === editProduct.category.toLowerCase())
      .map(p => p.sub_category)
      .filter(Boolean)
  )).sort();

  const uniqueLocations = Array.from(new Set(products.map(p => p.location).filter(Boolean))).sort();
  const uniqueSkus = Array.from(new Set(products.map(p => p.sku).filter(Boolean))).sort();
  const uniqueMpns = Array.from(new Set(products.map(p => p.mpn).filter(Boolean))).sort();
  const uniqueLabels = Array.from(new Set(products.map(p => p.label).filter(Boolean))).sort();
  const uniquePrices = Array.from(new Set(products.map(p => p.price.toString()).filter(Boolean))).sort();
  const uniqueMinStocks = Array.from(new Set(products.map(p => p.min_stock.toString()).filter(Boolean))).sort();


  const renderProductTable = (productsToRender: Product[], isPickerMode: boolean = false) => (
              <div className="table-container">
                <table 
                  className="spreadsheet"
                  style={{ 
                    tableLayout: "fixed", 
                    width: columns.filter(c => c.visible).reduce((sum, c) => sum + c.width, 0) + 40
                  }}
                >
                  <thead>
                    <tr>
                      <th style={{ width: isPickerMode ? "55px" : "40px", minWidth: isPickerMode ? "55px" : "40px", maxWidth: isPickerMode ? "55px" : "40px", textAlign: "center", position: "sticky", top: 0, zIndex: 11 }}>
                        <input
                          type="checkbox"
                          checked={productsToRender.length > 0 && selectedSkus.length === productsToRender.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSkus(productsToRender.map(p => p.sku));
                            } else {
                              setSelectedSkus([]);
                            }
                          }}
                        />
                      </th>
                      {columns.map(col => {
                        if (!col.visible) return null;
                        return (
                          <th
                            key={col.id}
                            style={{
                              width: col.width,
                              minWidth: col.width,
                              maxWidth: col.width,
                              position: "relative",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}
                          >
                            {col.label}
                            <div
                              className="column-resize-handle"
                              onMouseDown={(e) => handleMouseDown(e, col.id)}
                            />
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {productsToRender.length === 0 ? (
                       <tr>
                         <td 
                          colSpan={columns.filter(c => c.visible).length + 1} 
                          style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}
                        >
                          Aucun produit correspondant.
                        </td>
                      </tr>
                    ) : (
                      productsToRender.map((prod) => {
                        let stockClass = "stock-ok";
                        if (prod.current_stock === 0) stockClass = "stock-empty";
                        else if (prod.min_stock > 0 && prod.current_stock <= prod.min_stock) stockClass = "stock-low";

                        return (
                          <tr 
                            key={prod.sku}
                            className={`${selectedProduct?.sku === prod.sku ? "selected" : ""} ${selectedSkus.includes(prod.sku) ? "batch-selected" : ""}`}
                            onClick={() => handleSelectProduct(prod)}
                            onDoubleClick={isPickerMode ? () => {
                              if (selectedSkus.includes(prod.sku)) {
                                setSelectedSkus(selectedSkus.filter(s => s !== prod.sku));
                              } else {
                                setSelectedSkus([...selectedSkus, prod.sku]);
                              }
                            } : undefined}
                            onMouseMove={(e) => handleImageHover(e, prod.image_path)}
                            onMouseLeave={() => setHoveredImage(null)}
                          >
                            <td 
                              style={{ width: isPickerMode ? "55px" : "40px", minWidth: isPickerMode ? "55px" : "40px", maxWidth: isPickerMode ? "55px" : "40px", textAlign: "center" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div style={{ display: "flex", gap: "0.25rem", alignItems: "center", justifyContent: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={selectedSkus.includes(prod.sku)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedSkus([...selectedSkus, prod.sku]);
                                    } else {
                                      setSelectedSkus(selectedSkus.filter(s => s !== prod.sku));
                                    }
                                  }}
                                />
                                {isPickerMode && (
                                  <button
                                    type="button"
                                    title="Modifier la référence"
                                    onClick={() => {
                                      let site = "";
                                      let code = "";
                                      let attributesObj: any = {};
                                      try {
                                        attributesObj = typeof prod.attributes === "string" ? JSON.parse(prod.attributes || "{}") : prod.attributes;
                                        if (attributesObj && attributesObj.vpc) {
                                          const keys = Object.keys(attributesObj.vpc);
                                          if (keys.length > 0) {
                                            site = keys[0];
                                            code = attributesObj.vpc[site];
                                          }
                                        }
                                      } catch (e) {}
                                      setEditVpcSite(site);
                                      setEditVpcCode(code);
                                      
                                      const formatNum = (v: any) => {
                                        if (v === null || v === undefined) return "";
                                        return v.toString().replace(/\./g, ",");
                                      };
                                      
                                      setEditProduct({
                                        sku: prod.sku,
                                        mpn: prod.mpn,
                                        label: prod.label,
                                        brand: prod.brand,
                                        category: prod.category,
                                        sub_category: prod.sub_category,
                                        location: prod.location,
                                        min_stock: formatNum(prod.min_stock),
                                        price: formatNum(prod.price),
                                        item_type: prod.item_type,
                                        image_path: prod.image_path || null,
                                        pdf_path: prod.pdf_path || null,
                                        attributes: typeof prod.attributes === "string" ? prod.attributes : JSON.stringify(prod.attributes || {}),
                                        pack_size: formatNum(prod.pack_size || 1),
                                        largeur: formatNum(attributesObj.largeur || ""),
                                        hauteur: formatNum(attributesObj.hauteur || ""),
                                        profondeur: formatNum(attributesObj.profondeur || ""),
                                        poids: formatNum(attributesObj.poids || "")
                                      });
                                      setAutofillType(site || "mpn");
                                      setAutofillCodeInput(code || prod.mpn || "");
                                      setShowEditModal(true);
                                    }}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      padding: 0,
                                      fontSize: "11px",
                                      display: "inline-flex"
                                    }}
                                  >
                                    ✏️
                                  </button>
                                )}
                              </div>
                            </td>
                            {columns.map(col => {
                              if (!col.visible) return null;
                              
                              let displayValue: any = "";
                              let rawValue: any = "";
                              let isEditable = false;
                              
                              if (col.id === "sku") {
                                displayValue = <strong>{prod.sku}</strong>;
                                rawValue = prod.sku;
                              } else if (col.id === "mpn") {
                                displayValue = prod.mpn;
                                rawValue = prod.mpn;
                                isEditable = true;
                              } else if (col.id === "vpc_code") {
                                displayValue = getVpcCode(prod);
                                rawValue = displayValue;
                              } else if (col.id === "brand") {
                                displayValue = prod.brand;
                                rawValue = prod.brand;
                                isEditable = true;
                              } else if (col.id === "category") {
                                displayValue = prod.category;
                                rawValue = prod.category;
                                isEditable = true;
                              } else if (col.id === "sub_category") {
                                displayValue = prod.sub_category;
                                rawValue = prod.sub_category;
                                isEditable = true;
                              } else if (col.id === "label") {
                                displayValue = prod.label;
                                rawValue = prod.label;
                                isEditable = true;
                              } else if (col.id === "location") {
                                displayValue = prod.location || "-";
                                rawValue = prod.location;
                                isEditable = true;
                              } else if (["largeur", "hauteur", "profondeur", "poids"].includes(col.id)) {
                                const attrVal = getAttribute(prod, col.id);
                                displayValue = attrVal || "-";
                                rawValue = attrVal;
                                isEditable = true;
                              } else if (col.id === "current_stock") {
                                displayValue = (
                                  <span className={`stock-status-badge ${stockClass}`}>
                                    {prod.current_stock}
                                  </span>
                                );
                                rawValue = prod.current_stock;
                                isEditable = true; // Double-clic → saisie directe → mouvement STOCK_IN/OUT
                              } else if (col.id === "min_stock") {
                                displayValue = prod.min_stock;
                                rawValue = prod.min_stock;
                                isEditable = true;
                              } else if (col.id === "price") {
                                displayValue = prod.pack_size > 1 
                                  ? `${prod.price.toFixed(2).replace(".", ",")} € (Lot ${prod.pack_size})` 
                                  : `${prod.price.toFixed(2).replace(".", ",")} €`;
                                rawValue = prod.price;
                                isEditable = true;
                              } else if (col.id === "total_value") {
                                displayValue = `${(prod.price * prod.current_stock).toFixed(2).replace(".", ",")} €`;
                                rawValue = prod.price * prod.current_stock;
                              }

                              const isEditing = editingCell?.sku === prod.sku && editingCell.field === col.id;
                              const isNumericField = ["price", "min_stock", "largeur", "hauteur", "profondeur", "poids"].includes(col.id);

                              return (
                                <td
                                  key={col.id}
                                  onDoubleClick={(!isPickerMode && isEditable) ? () => handleCellDoubleClick(prod.sku, col.id, rawValue) : undefined}
                                  style={{
                                    cursor: (!isPickerMode && isEditable) ? "edit" : "default",
                                    width: col.width,
                                    minWidth: col.width,
                                    maxWidth: col.width,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                  }}
                                >
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      autoFocus
                                      value={editValue}
                                      onChange={(e) => {
                                        let val = e.target.value;
                                        if (isNumericField) {
                                          val = cleanNumericInput(val);
                                        }
                                        setEditValue(val);
                                      }}
                                      onBlur={() => handleCellSave(prod)}
                                      onKeyDown={(e) => e.key === "Enter" && handleCellSave(prod)}
                                    />
                                  ) : (
                                    displayValue
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
  );

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <img src={logoImg} alt="StockFlow" className="header-logo-img" />
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <span className="header-logo" style={{ lineHeight: 1.1 }}>StockFlow</span>
            <span className="version-badge" style={{ fontSize: "9px", alignSelf: "flex-start", backgroundColor: "var(--bg-tertiary)", color: "var(--text-secondary)", padding: "1px 5px", borderRadius: "4px", fontWeight: "bold", border: "1px solid var(--border-color)", marginTop: "2px", lineHeight: 1 }}>v{appVersion}</span>
          </div>
          <span className="text-muted">|</span>
          <span className={`status-badge ${isOnline ? "status-online" : "status-offline"}`}>
            ● {isOnline ? "Connecté au réseau" : "Hors-ligne"}
          </span>
        </div>

        <div className="header-actions">
          <button 
            className="theme-toggle-btn" 
            title="Changer de thème"
            onClick={() => setTheme(prev => prev === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          
          <div 
            className="user-info header-clickable" 
            onClick={() => setIsEditingConfig(true)}
            title="Cliquez pour modifier la configuration (trigramme ou chemin réseau)"
            style={{ cursor: "pointer" }}
          >
            Poste : <span className="trigramme-tag">{config.trigramme}</span>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{config.network_path}</span>
          </div>
        </div>
      </header>

      {/* Main Area */}
      <div className="workspace">
        {/* Sidebar Nav */}
        <aside className="sidebar">
          <div 
            className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            📊 Tableau de Bord
          </div>
          <div 
            className={`nav-item ${activeTab === "inventory" ? "active" : ""}`}
            onClick={() => setActiveTab("inventory")}
          >
            📋 Liste d'Inventaire
          </div>
          <div 
            className={`nav-item ${activeTab === "bom" ? "active" : ""}`}
            onClick={() => setActiveTab("bom")}
          >
            📦 Projets & Nomenclatures
          </div>
          <div 
            className={`nav-item ${activeTab === "migration" ? "active" : ""}`}
            onClick={() => setActiveTab("migration")}
          >
            ⚙️ Importation Excel/CSV
          </div>
          <div 
            className={`nav-item ${activeTab === "backup" ? "active" : ""}`}
            onClick={() => setActiveTab("backup")}
          >
            💾 Sauvegardes
          </div>
          <div 
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            🔧 Paramètres
          </div>
        </aside>

        {/* Dynamic View Panel */}
        <main className="view-content">
          
          {/* TAB 1: DASHBOARD */}
          {activeTab === "dashboard" && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div className="dashboard-grid">
                <div className="stat-card">
                  <span className="label">Total Références</span>
                  <span className="value">{stats.total_references}</span>
                </div>
                <div className="stat-card">
                  <span className="label">Valeur du Stock</span>
                  <span className="value">
                    {stats.total_value.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                  </span>
                </div>
                <div className="stat-card" style={{ borderLeft: "4px solid var(--warning)" }}>
                  <span className="label" style={{ color: "var(--warning)" }}>Stock Bas Alertes</span>
                  <span className="value" style={{ color: "var(--warning)" }}>{stats.low_stock_count}</span>
                </div>
                <div className="stat-card" style={{ borderLeft: "4px solid var(--danger)" }}>
                  <span className="label" style={{ color: "var(--danger)" }}>Ruptures Totales</span>
                  <span className="value" style={{ color: "var(--danger)" }}>{stats.out_of_stock_count}</span>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", padding: "0 1.5rem 1.5rem" }}>
                {/* Colonne 1 : Derniers Mouvements */}
                <div style={{ flex: "1 1 400px", minWidth: 0 }}>
                  <h3 style={{ fontFamily: "var(--font-title)", marginBottom: "1rem" }}>Derniers Mouvements de Stock</h3>
                  <div className="history-list" style={{ maxHeight: "400px" }}>
                    {stats.recent_movements.length === 0 ? (
                      <div style={{ padding: "1.5rem", color: "var(--text-muted)" }}>Aucun mouvement enregistré.</div>
                    ) : (
                      stats.recent_movements.map((move, i) => (
                        <div key={i} className="history-item">
                          <div className="history-meta">
                            <span>{new Date(move.timestamp).toLocaleString("fr-FR")}</span>
                            <span>Par : <strong>{move.trigramme}</strong></span>
                          </div>
                          <div>
                            <strong>{move.sku}</strong> — {move.event_type === "STOCK_IN" ? "📥 Entrée" : "📤 Sortie"} de{" "}
                            <strong style={{ color: move.event_type === "STOCK_IN" ? "var(--success)" : "var(--danger)" }}>
                              {move.qty}
                            </strong>{" "}
                            unités ({move.note})
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Colonne 2 : Dernières Modifications de Références */}
                <div style={{ flex: "1 1 400px", minWidth: 0 }}>
                  <h3 style={{ fontFamily: "var(--font-title)", marginBottom: "1rem" }}>Dernières Modifications de Références</h3>
                  <div className="history-list" style={{ maxHeight: "400px" }}>
                    {stats.recent_audits.length === 0 ? (
                      <div style={{ padding: "1.5rem", color: "var(--text-muted)" }}>Aucune modification enregistrée.</div>
                    ) : (
                      stats.recent_audits.map((item, i) => {
                        const date = new Date(item.timestamp);
                        const dateStr = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
                        const timeStr = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

                        let badge = "🔵";
                        let badgeClass = "audit-badge-update";
                        let content: React.ReactNode = "";

                        if (item.action === "CREATE") {
                          badge = "🟢";
                          badgeClass = "audit-badge-create";
                          content = <span>Création de la référence</span>;
                        } else if (item.action === "UPDATE") {
                          badge = "🔵";
                          badgeClass = "audit-badge-update";
                          content = (
                            <span>
                              <strong>{item.field}</strong> : <span className="audit-old-value">{item.old_value || "—"}</span> → <span className="audit-new-value">{item.new_value || "—"}</span>
                              {item.source_url && (
                                <> {" "}
                                  <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="audit-link" title={item.source_url}>
                                    🔗 source
                                  </a>
                                </>
                              )}
                            </span>
                          );
                        } else if (item.action === "SCRAPE_PRICE") {
                          badge = "🟠";
                          badgeClass = "audit-badge-scrape";
                          content = (
                            <span>
                              Prix scrappé : <strong>{item.new_value} €</strong>
                              {item.source_url && (
                                <> {" "}
                                  <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="audit-link" title={item.source_url}>
                                    🔗 source
                                  </a>
                                </>
                              )}
                            </span>
                          );
                        } else if (item.action === "SCRAPE_PDF") {
                          badge = "📄";
                          badgeClass = "audit-badge-scrape";
                          content = (
                            <span>
                              Notice téléchargée{item.field ? ` (${item.field})` : ""}
                              {item.source_url && (
                                <> {" "}
                                  <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="audit-link" title={item.source_url}>
                                    🔗 source
                                  </a>
                                </>
                              )}
                            </span>
                          );
                        } else if (item.action === "SCRAPE_IMAGE") {
                          badge = "🖼️";
                          badgeClass = "audit-badge-scrape";
                          content = (
                            <span>
                              Image téléchargée
                              {item.source_url && (
                                <> {" "}
                                  <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="audit-link" title={item.source_url}>
                                    🔗 source
                                  </a>
                                </>
                              )}
                            </span>
                          );
                        }

                        return (
                          <div key={item.audit_id || i} className={`audit-item ${badgeClass}`} style={{ borderBottom: "1px solid var(--border-color)", padding: "0.5rem" }}>
                            <div className="audit-meta" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <span className="audit-badge" style={{ marginRight: "0.4rem" }}>{badge}</span>
                                <span className="audit-date">{dateStr} {timeStr}</span>
                              </div>
                              <span className="audit-trigramme">Par : <strong>{item.trigramme}</strong></span>
                            </div>
                            <div className="audit-content" style={{ marginTop: "0.2rem" }}>
                              <strong>{item.sku}</strong> — {content}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: BOM */}
          {activeTab === "bom" && (
            <BomTab
              networkPath={config?.network_path}
              trigramme={config?.trigramme}
              products={products}
              renderProductTable={renderProductTable}
              selectedSkus={selectedSkus}
              setSelectedSkus={setSelectedSkus}
            />
          )}

          {/* TAB 2: INVENTORY TABLE */}
          {activeTab === "inventory" && (
            <>
              <div className="toolbar">
                <div className="search-bar">
                  🔍
                  <input
                    type="text"
                    placeholder="Rechercher référence, marque, désignation..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {selectedSkus.length > 0 && (
                  <div className="batch-actions-panel" style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.3rem 0.6rem", backgroundColor: "var(--accent-light)", border: "1px solid var(--accent)", borderRadius: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "bold" }}>{selectedSkus.length} sélectionnés</span>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "11px" }}
                      onClick={() => runBatchScraping("images")}
                      disabled={isBatchRunning}
                    >
                      📷 Scraper Images
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "11px" }}
                      onClick={() => runBatchScraping("pdf")}
                      disabled={isBatchRunning}
                    >
                      📄 Scraper PDF
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "11px" }}
                      onClick={() => runBatchScraping("price")}
                      disabled={isBatchRunning}
                    >
                      💰 Scraper Prix
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "11px" }}
                      onClick={() => setSelectedSkus([])}
                      disabled={isBatchRunning}
                    >
                      Annuler
                    </button>
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <label htmlFor="cat-filter">Famille :</label>
                  <select
                    id="cat-filter"
                    value={categoryFilter}
                    onChange={(e) => {
                      setCategoryFilter(e.target.value);
                      setSubCategoryFilter("all");
                    }}
                    style={{ width: "auto" }}
                  >
                    {categories.map((c, i) => (
                      <option key={i} value={c}>{c === "all" ? "Toutes" : c}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <label htmlFor="subcat-filter">Sous-Famille :</label>
                  <select
                    id="subcat-filter"
                    value={subCategoryFilter}
                    onChange={(e) => setSubCategoryFilter(e.target.value)}
                    style={{ width: "auto" }}
                  >
                    {subCategories.map((sc, i) => (
                      <option key={i} value={sc}>{sc === "all" ? "Toutes" : sc}</option>
                    ))}
                  </select>
                </div>

                <button 
                  type="button" 
                  className="btn" 
                  style={{ marginLeft: "auto", marginRight: "0.5rem", padding: "0.4rem 0.8rem", fontSize: "12px", display: "flex", alignItems: "center", gap: "0.3rem" }}
                  onClick={() => {
                    setCreateSuccess("");
                    setCreateError("");
                    setDuplicateWarning("");
                    setAutoFillSource(null);
                    setAutoFillFallbackInfo(null);
                    setNewProduct({
                      sku: "",
                      mpn: "",
                      label: "",
                      brand: "",
                      category: "",
                      sub_category: "",
                      location: "",
                      min_stock: "0",
                      price: "0",
                      pack_size: "1",
                      attributes: "{}",
                      largeur: "",
                      hauteur: "",
                      profondeur: "",
                      poids: "",
                      initial_stock: "0"
                    });
                    setAutofillCodeInput("");
                    setAutofillType("mpn");
                    setShowAddModal(true);
                  }}
                >
                  ➕ Ajouter un SKU
                </button>

                <div style={{ position: "relative" }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ padding: "0.4rem 0.8rem", fontSize: "12px", display: "flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => setShowColumnSettings(prev => !prev)}
                  >
                    ⚙️ Colonnes
                  </button>
                  {showColumnSettings && (
                    <div className="column-settings-popover">
                      <div style={{ fontWeight: 600, marginBottom: "0.5rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.3rem" }}>
                        Afficher les colonnes
                      </div>
                      {columns.map(col => (
                        <label key={col.id} className="column-setting-item">
                          <input
                            type="checkbox"
                            checked={col.visible}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setColumns(prev => prev.map(c => c.id === col.id ? { ...c, visible: checked } : c));
                            }}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {isBatchRunning && (
                <div className="batch-progress-bar-container" style={{ margin: "0.5rem 1rem", backgroundColor: "var(--bg-secondary)", padding: "0.8rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "0.3rem" }}>
                    <span>{batchStatus}</span>
                    <span>{batchProgress} / {batchTotal} ({batchTotal > 0 ? Math.round((batchProgress / batchTotal) * 100) : 0}%)</span>
                  </div>
                  <div style={{ width: "100%", height: "8px", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${batchTotal > 0 ? (batchProgress / batchTotal) * 100 : 0}%`, height: "100%", backgroundColor: "var(--accent)", transition: "width 0.3s ease" }}></div>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", fontSize: "11px", marginTop: "0.4rem", color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--success)" }}>🟢 Succès: {batchSuccessCount}</span>
                    <span style={{ color: "var(--danger)" }}>🔴 Échecs: {batchErrorCount}</span>
                  </div>
                </div>
              )}

              {renderProductTable(filteredProducts, false)}
            </>
          )}

          {/* TAB 3: CREATE PRODUCT REMOVED */}

          {/* TAB 4: CSV MIGRATION */}
          {activeTab === "migration" && (
            <div style={{ padding: "2rem", overflowY: "auto", maxWidth: "600px", margin: "0 auto", width: "100%" }}>
              <h2 style={{ fontFamily: "var(--font-title)", marginBottom: "1.5rem" }}>Outil de Migration CSV</h2>
              <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                Importez les données de l'ancien fichier Excel exporté au format CSV (séparateur point-virgule) pour générer les événements de stock initial et copier les fichiers multimédias vers la structure réseau partagée.
              </p>

              {migrationStatus && <div className="wizard-error" style={{ color: "var(--success)", backgroundColor: "var(--success-light)", borderColor: "rgba(16,185,129,0.2)" }}>{migrationStatus}</div>}
              {migrationError && <div className="wizard-error">{migrationError}</div>}

              <form onSubmit={handleCsvMigration} style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
                <div className="form-group">
                  <label htmlFor="csv-path">Fichier CSV à importer *</label>
                  <div className="input-with-button">
                    <input
                      id="csv-path"
                      type="text"
                      required
                      disabled={migrationStatus.includes("en cours")}
                      value={csvFilePath}
                      onChange={(e) => { setCsvFilePath(e.target.value); localStorage.setItem("sf_migration_csv_path", e.target.value); }}
                      placeholder="Chemin absolu vers le fichier .csv"
                    />
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      disabled={migrationStatus.includes("en cours")}
                      onClick={pickCsvFile}
                    >
                      Parcourir
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="images-path">Dossier source des images (Optionnel)</label>
                  <div className="input-with-button">
                    <input
                      id="images-path"
                      type="text"
                      disabled={migrationStatus.includes("en cours")}
                      value={imagesDirPath}
                      onChange={(e) => { setImagesDirPath(e.target.value); localStorage.setItem("sf_migration_images_path", e.target.value); }}
                      placeholder="Chemin du dossier contenant les images produits"
                    />
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      disabled={migrationStatus.includes("en cours")}
                      onClick={pickImagesDir}
                    >
                      Parcourir
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="pdf-path">Dossier source des PDF (Optionnel)</label>
                  <div className="input-with-button">
                    <input
                      id="pdf-path"
                      type="text"
                      disabled={migrationStatus.includes("en cours")}
                      value={pdfDirPath}
                      onChange={(e) => { setPdfDirPath(e.target.value); localStorage.setItem("sf_migration_pdf_path", e.target.value); }}
                      placeholder="Chemin du dossier contenant les manuels PDF"
                    />
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      disabled={migrationStatus.includes("en cours")}
                      onClick={pickPdfDir}
                    >
                      Parcourir
                    </button>
                  </div>
                </div>

                {migrationReport && (
                  <div className="migration-report" style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "var(--background-card)", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                    <h4 style={{ fontFamily: "var(--font-title)", marginBottom: "0.5rem" }}>Bilan de migration :</h4>
                    <ul style={{ fontSize: "13px", paddingLeft: "1.2rem", margin: 0 }}>
                      <li>Références importées : <strong>{migrationReport.success}</strong></li>
                      <li>Fichiers médias manquants : <strong>{migrationReport.missing_files}</strong></li>
                      {migrationReport.errors.length > 0 && (
                        <li style={{ color: "var(--danger)" }}>
                          Erreurs ({migrationReport.errors.length}) :
                          <div style={{ maxHeight: "100px", overflowY: "auto", fontSize: "11px", marginTop: "0.3rem" }}>
                            {migrationReport.errors.map((err, idx) => <div key={idx}>{err}</div>)}
                          </div>
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                <button 
                  type="submit" 
                  className="btn" 
                  disabled={migrationStatus.includes("en cours")}
                  style={{ marginTop: "1rem" }}
                >
                  {migrationStatus.includes("en cours") ? "Migration en cours..." : "Lancer la Migration"}
                </button>
              </form>

              <div style={{ borderTop: "1px solid var(--border-color)", marginTop: "2.5rem", paddingTop: "2rem" }}>
                <h3 style={{ fontFamily: "var(--font-title)", marginBottom: "1rem" }}>Maintenance & Nettoyage Réseau</h3>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.2rem", fontSize: "12px" }}>
                  Utilisez ces outils pour consolider les événements et nettoyer le stockage réseau partagé des fichiers obsolètes ou inutilisés.
                </p>
                
                {maintenanceStatus && <div className="wizard-error" style={{ color: "var(--success)", backgroundColor: "var(--success-light)", borderColor: "rgba(16,185,129,0.2)" }}>{maintenanceStatus}</div>}
                {maintenanceError && <div className="wizard-error">{maintenanceError}</div>}

                <div style={{ display: "flex", gap: "1rem" }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 1, padding: "0.8rem", fontSize: "12px" }}
                    onClick={handleCompaction}
                    disabled={isMaintenanceRunning}
                  >
                    📦 Compacter les Événements (JSON)
                  </button>
                  
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 1, padding: "0.8rem", fontSize: "12px" }}
                    onClick={handleMediaCleanup}
                    disabled={isMaintenanceRunning}
                  >
                    🧹 Nettoyer Médias (Images & PDF)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: SETTINGS */}
          {activeTab === "settings" && (
            <div style={{ padding: "2rem", overflowY: "auto", width: "100%", height: "100%" }}>
              <div style={{ maxWidth: "600px", margin: "0 auto", width: "100%" }}>
                <h2 style={{ fontFamily: "var(--font-title)", marginBottom: "1.5rem" }}>Paramètres StockFlow</h2>
              
              <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
                <div className="form-group">
                  <label htmlFor="settings-tri">Trigramme Utilisateur (3 caractères)</label>
                  <input
                    id="settings-tri"
                    type="text"
                    required
                    maxLength={3}
                    style={{ textTransform: "uppercase" }}
                    value={trigrammeInput}
                    onChange={(e) => setTrigrammeInput(e.target.value)}
                    onBlur={() => triggerAutoSave()}
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="settings-net">Chemin du dossier réseau partagé</label>
                  <div className="input-with-button">
                    <input
                      id="settings-net"
                      type="text"
                      required
                      value={networkPathInput}
                      onChange={(e) => setNetworkPathInput(e.target.value)}
                      onBlur={() => triggerAutoSave()}
                    />
                    <button type="button" className="btn btn-secondary" onClick={pickNetworkDir}>Parcourir</button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="settings-searx">URL de l'instance SearxNG</label>
                  <input
                    id="settings-searx"
                    type="text"
                    placeholder="ex: http://localhost:8080"
                    value={searxngUrlInput}
                    onChange={(e) => setSearxngUrlInput(e.target.value)}
                    onBlur={() => triggerAutoSave()}
                  />
                </div>

                <div className="form-group">
                  <label>Sites de VPC / Fournisseurs</label>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <input
                      type="text"
                      placeholder="Ajouter un site (ex: Farnell)"
                      value={newVpcSiteInput}
                      onChange={(e) => setNewVpcSiteInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const s = newVpcSiteInput.trim();
                        if (s && !vpcSitesInput.includes(s)) {
                          const updated = [...vpcSitesInput, s];
                          setVpcSitesInput(updated);
                          setNewVpcSiteInput("");
                          triggerAutoSave({ vpc_sites: updated });
                        }
                      }}
                    >
                      Ajouter
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {vpcSitesInput.map((site, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--bg-secondary)", padding: "0.4rem 0.6rem", borderRadius: "4px", border: "1px solid var(--border-color)" }}>
                        <span style={{ fontWeight: "bold", minWidth: "80px", fontSize: "12px" }}>{site}</span>
                        <select
                          value={(() => {
                            const val = vpcUrlsInput[site] || "";
                            const presetsKey = Object.keys({
                              rs: ["fr.rs-online.com", "ma.rsdelivers.com", "ie.rsdelivers.com", "uk.rs-online.com"],
                              mouser: ["www.mouser.fr", "www.mouser.com"],
                              farnell: ["fr.farnell.com", "uk.farnell.com"],
                              conrad: ["www.conrad.fr", "www.conrad.com"]
                            }).find(k => site.toLowerCase().includes(k));

                            const presets = presetsKey ? ({
                              rs: ["fr.rs-online.com", "ma.rsdelivers.com", "ie.rsdelivers.com", "uk.rs-online.com"],
                              mouser: ["www.mouser.fr", "www.mouser.com"],
                              farnell: ["fr.farnell.com", "uk.farnell.com"],
                              conrad: ["www.conrad.fr", "www.conrad.com"]
                            } as Record<string, string[]>)[presetsKey] : [];

                            if (val === "") return "";
                            if (presets.includes(val)) return val;
                            return "custom";
                          })()}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val !== "custom") {
                              const updatedUrls = { ...vpcUrlsInput, [site]: val };
                              setVpcUrlsInput(updatedUrls);
                              triggerAutoSave({ vpc_urls: updatedUrls });
                            }
                          }}
                          style={{ width: "120px", padding: "0.2rem", fontSize: "11px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "3px", color: "var(--text-primary)", height: "24px" }}
                        >
                          <option value="">URL par défaut</option>
                          {site.toLowerCase().includes("rs") && (
                            <>
                              <option value="fr.rs-online.com">fr.rs-online.com (FR)</option>
                              <option value="ma.rsdelivers.com">ma.rsdelivers.com (MA)</option>
                              <option value="ie.rsdelivers.com">ie.rsdelivers.com (IE)</option>
                              <option value="uk.rs-online.com">uk.rs-online.com (UK)</option>
                            </>
                          )}
                          {site.toLowerCase().includes("mouser") && (
                            <>
                              <option value="www.mouser.fr">www.mouser.fr (FR)</option>
                              <option value="www.mouser.com">www.mouser.com (US)</option>
                            </>
                          )}
                          {site.toLowerCase().includes("farnell") && (
                            <>
                              <option value="fr.farnell.com">fr.farnell.com (FR)</option>
                              <option value="uk.farnell.com">uk.farnell.com (UK)</option>
                            </>
                          )}
                          {site.toLowerCase().includes("conrad") && (
                            <>
                              <option value="www.conrad.fr">www.conrad.fr (FR)</option>
                              <option value="www.conrad.com">www.conrad.com (Intl)</option>
                            </>
                          )}
                          <option value="custom">Autre / Personnalisé</option>
                        </select>

                        <div style={{ display: "flex", gap: "0.25rem", flex: 1, maxWidth: "160px", position: "relative" }}>
                          <input
                            type="text"
                            placeholder="URL / Domaine (ex: fr.rs-online.com)"
                            value={vpcUrlsInput[site] || ""}
                            onChange={(e) => {
                              const updatedUrls = { ...vpcUrlsInput, [site]: e.target.value };
                              setVpcUrlsInput(updatedUrls);
                              triggerAutoSave({ vpc_urls: updatedUrls });
                            }}
                            style={{ flex: 1, padding: "0.2rem 0.4rem", fontSize: "11px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "3px", color: "var(--text-primary)", height: "24px" }}
                          />
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "0 0.4rem", height: "24px", minWidth: "24px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--accent)" }}
                            title="Rechercher des domaines avec SearXNG"
                            onClick={() => {
                              if (activeSearchSite === site) {
                                setActiveSearchSite(null);
                              } else {
                                setActiveSearchSite(site);
                                setSearchSiteResults([]);
                                setSearchSiteError(null);
                              }
                            }}
                          >
                            🔍
                          </button>
                          
                          {activeSearchSite === site && (() => {
                            const presetsKey = Object.keys({
                              rs: ["fr.rs-online.com", "ma.rsdelivers.com", "ie.rsdelivers.com", "uk.rs-online.com"],
                              mouser: ["www.mouser.fr", "www.mouser.com"],
                              farnell: ["fr.farnell.com", "uk.farnell.com"],
                              conrad: ["www.conrad.fr", "www.conrad.com"]
                            }).find(k => site.toLowerCase().includes(k));

                            const presets = presetsKey ? ({
                              rs: ["fr.rs-online.com", "ma.rsdelivers.com", "ie.rsdelivers.com", "uk.rs-online.com"],
                              mouser: ["www.mouser.fr", "www.mouser.com"],
                              farnell: ["fr.farnell.com", "uk.farnell.com"],
                              conrad: ["www.conrad.fr", "www.conrad.com"]
                            } as Record<string, string[]>)[presetsKey] : [];

                            return (
                              <div style={{
                                position: "absolute",
                                top: "26px",
                                left: 0,
                                right: 0,
                                background: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                zIndex: 1000,
                                maxHeight: "200px",
                                overflowY: "auto",
                                boxShadow: "var(--shadow-lg)",
                                padding: "0.4rem"
                              }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.2rem", marginBottom: "0.2rem" }}>
                                  <span style={{ fontSize: "9px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>Options {site}</span>
                                  <button
                                    type="button"
                                    onClick={() => setActiveSearchSite(null)}
                                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "10px" }}
                                  >
                                    Fermer
                                  </button>
                                </div>

                                <div
                                  style={{
                                    padding: "0.2rem 0.4rem",
                                    cursor: "pointer",
                                    borderRadius: "2px",
                                    fontSize: "11px",
                                    color: "var(--text-secondary)",
                                    transition: "background 0.15s"
                                  }}
                                  className="search-domain-item"
                                  onClick={() => {
                                    const updatedUrls = { ...vpcUrlsInput, [site]: "" };
                                    setVpcUrlsInput(updatedUrls);
                                    triggerAutoSave({ vpc_urls: updatedUrls });
                                    setActiveSearchSite(null);
                                  }}
                                >
                                  ❌ URL par défaut
                                </div>

                                {presets.length > 0 && (
                                  <>
                                    <div style={{ fontSize: "9px", color: "var(--text-muted)", padding: "0.2rem 0.4rem", fontWeight: "bold", borderTop: "1px solid rgba(255,255,255,0.05)", marginTop: "0.2rem" }}>💡 Suggestions locales :</div>
                                    {presets.map(p => (
                                      <div
                                        key={p}
                                        style={{
                                          padding: "0.2rem 0.4rem",
                                          cursor: "pointer",
                                          borderRadius: "2px",
                                          fontSize: "11px",
                                          transition: "background 0.15s"
                                        }}
                                        className="search-domain-item"
                                        onClick={() => {
                                          const updatedUrls = { ...vpcUrlsInput, [site]: p };
                                          setVpcUrlsInput(updatedUrls);
                                          triggerAutoSave({ vpc_urls: updatedUrls });
                                          setActiveSearchSite(null);
                                        }}
                                      >
                                        🌐 {p}
                                      </div>
                                    ))}
                                  </>
                                )}

                                <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", marginTop: "0.2rem", paddingTop: "0.2rem" }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => searchVpcUrls(site)}
                                    style={{ width: "100%", fontSize: "10px", padding: "0.2rem" }}
                                    disabled={isSearchingSite}
                                  >
                                    {isSearchingSite ? "Recherche SearXNG..." : "🔍 Lancer recherche SearXNG"}
                                  </button>
                                </div>

                                {isSearchingSite && (
                                  <div style={{ fontSize: "10px", color: "var(--text-muted)", padding: "0.4rem", textAlign: "center" }}>Recherche active...</div>
                                )}
                                {searchSiteError && (
                                  <div style={{ fontSize: "9px", color: "var(--danger)", padding: "0.4rem" }}>Erreur : {searchSiteError}</div>
                                )}
                                {searchSiteResults.length > 0 && (
                                  <>
                                    <div style={{ fontSize: "9px", color: "var(--text-muted)", padding: "0.2rem 0.4rem", fontWeight: "bold" }}>🌍 Trouvé en ligne :</div>
                                    {searchSiteResults.map(r => (
                                      <div
                                        key={r}
                                        style={{
                                          padding: "0.2rem 0.4rem",
                                          cursor: "pointer",
                                          borderRadius: "2px",
                                          fontSize: "11px",
                                          transition: "background 0.15s"
                                        }}
                                        className="search-domain-item"
                                        onClick={() => {
                                          const updatedUrls = { ...vpcUrlsInput, [site]: r };
                                          setVpcUrlsInput(updatedUrls);
                                          triggerAutoSave({ vpc_urls: updatedUrls });
                                          setActiveSearchSite(null);
                                        }}
                                      >
                                        🌐 {r}
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        <input
                          type="text"
                          placeholder="Clé API (Optionnelle)"
                          value={vpcKeysInput[site] || ""}
                          onChange={(e) => setVpcKeysInput({ ...vpcKeysInput, [site]: e.target.value })}
                          onBlur={() => triggerAutoSave()}
                          style={{ flex: 1, padding: "0.2rem 0.5rem", fontSize: "11px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "3px", color: "var(--text-primary)", height: "24px" }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: "0 0.4rem", height: "24px", minWidth: "24px", display: "flex", alignItems: "center", justifyContent: "center" }}
                          onClick={() => {
                            const updatedSites = vpcSitesInput.filter(s => s !== site);
                            setVpcSitesInput(updatedSites);
                            const updatedKeys = { ...vpcKeysInput };
                            delete updatedKeys[site];
                            setVpcKeysInput(updatedKeys);
                            const updatedUrls = { ...vpcUrlsInput };
                            delete updatedUrls[site];
                            setVpcUrlsInput(updatedUrls);
                            triggerAutoSave({ vpc_sites: updatedSites, vpc_api_keys: updatedKeys, vpc_urls: updatedUrls });
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "0.5rem", fontStyle: "italic" }}>
                    ℹ️ Sans clé API, la récupération directe du site VPC est limitée ou simulée, avec fallback automatique sur SearxNG.
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="settings-pdf-rename">Convention de renommage PDF</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
                    {["{SKU}", "{Brand}", "{MPN}", "{Type}"].map((badge) => (
                      <button
                        key={badge}
                        type="button"
                        className="badge-btn"
                        onClick={() => {
                          const current = pdfRenameInput;
                          const needsSeparator = current.length > 0 && !current.endsWith("_") && !current.endsWith("-");
                          const newVal = current + (needsSeparator ? "_" : "") + badge;
                          setPdfRenameInput(newVal);
                          triggerAutoSave({ pdf_rename_convention: newVal });
                        }}
                      >
                        {badge}
                      </button>
                    ))}
                    <button type="button" className="badge-btn badge-btn-sep" onClick={() => {
                      const newVal = pdfRenameInput + "_";
                      setPdfRenameInput(newVal);
                      triggerAutoSave({ pdf_rename_convention: newVal });
                    }}>_</button>
                    <button type="button" className="badge-btn badge-btn-sep" onClick={() => {
                      const newVal = pdfRenameInput + "-";
                      setPdfRenameInput(newVal);
                      triggerAutoSave({ pdf_rename_convention: newVal });
                    }}>-</button>
                    <button type="button" className="badge-btn badge-btn-clear" onClick={() => {
                      setPdfRenameInput("");
                      triggerAutoSave({ pdf_rename_convention: "" });
                    }}>Effacer</button>
                  </div>
                  <input
                    id="settings-pdf-rename"
                    type="text"
                    placeholder="ex: {SKU}_datasheet.pdf"
                    value={pdfRenameInput}
                    onChange={(e) => setPdfRenameInput(e.target.value)}
                    onBlur={() => triggerAutoSave()}
                  />
                  <div className="filename-preview">
                    <span>Aperçu :</span>
                    <code>{getRenamePreview(pdfRenameInput, true)}</code>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="settings-img-rename">Convention de renommage Images</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
                    {["{SKU}", "{Index}", "{Brand}", "{MPN}", "{Source}", "{Date}"].map((badge) => (
                      <button
                        key={badge}
                        type="button"
                        className="badge-btn"
                        onClick={() => {
                          const current = imageRenameInput;
                          const needsSeparator = current.length > 0 && !current.endsWith("_") && !current.endsWith("-");
                          const newVal = current + (needsSeparator ? "_" : "") + badge;
                          setImageRenameInput(newVal);
                          triggerAutoSave({ image_rename_convention: newVal });
                        }}
                      >
                        {badge}
                      </button>
                    ))}
                    <button type="button" className="badge-btn badge-btn-sep" onClick={() => {
                      const newVal = imageRenameInput + "_";
                      setImageRenameInput(newVal);
                      triggerAutoSave({ image_rename_convention: newVal });
                    }}>_</button>
                    <button type="button" className="badge-btn badge-btn-sep" onClick={() => {
                      const newVal = imageRenameInput + "-";
                      setImageRenameInput(newVal);
                      triggerAutoSave({ image_rename_convention: newVal });
                    }}>-</button>
                    <button type="button" className="badge-btn badge-btn-clear" onClick={() => {
                      setImageRenameInput("");
                      triggerAutoSave({ image_rename_convention: "" });
                    }}>Effacer</button>
                  </div>
                  <input
                    id="settings-img-rename"
                    type="text"
                    placeholder="ex: {SKU}_{Index}.jpg"
                    value={imageRenameInput}
                    onChange={(e) => setImageRenameInput(e.target.value)}
                    onBlur={() => triggerAutoSave()}
                  />
                  <div className="filename-preview">
                    <span>Aperçu :</span>
                    <code>{getRenamePreview(imageRenameInput, false)}</code>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="settings-pdf-threshold">Seuil de similarité de taille PDF (%)</label>
                  <input
                    id="settings-pdf-threshold"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={pdfSizeThresholdInput}
                    onChange={(e) => setPdfSizeThresholdInput(Number(e.target.value) || 0)}
                    onBlur={() => triggerAutoSave()}
                  />
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Seuil en pourcentage pour considérer deux PDF comme doublons (valeur par défaut : 5%).</span>
                </div>

                <div className="form-group">
                  <label htmlFor="settings-tax-type">Type de taxe pour les prix scrapés</label>
                  <select
                    id="settings-tax-type"
                    value={priceTaxTypeInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPriceTaxTypeInput(val);
                      triggerAutoSave({ price_tax_type: val });
                    }}
                  >
                    <option value="HT">Hors Taxe (HT)</option>
                    <option value="TTC">Toutes Taxes Comprises (TTC - 1.20 TVA)</option>
                  </select>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Détermine si le prix récupéré sur internet doit être enregistré directement (HT) ou multiplié par 1.20 (TTC).</span>
                </div>

                <div style={{ fontSize: "12px", color: "var(--success)", display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "1rem", fontWeight: 500 }}>
                  <span>✔️ Les modifications sont enregistrées automatiquement.</span>
                </div>
              </form>
            </div>
            </div>
          )}

          {/* TAB 6: BACKUP */}
          {activeTab === "backup" && (
            <div style={{ padding: "2rem", overflowY: "auto", width: "100%", height: "100%" }}>
              <div style={{ maxWidth: "600px", margin: "0 auto", width: "100%" }}>
                <h2 style={{ fontFamily: "var(--font-title)", marginBottom: "1.5rem" }}>Sauvegarde Automatique Partagée</h2>
                <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
                  Activez et configurez la sauvegarde automatique dans votre dossier réseau partagé. Les paramètres de sauvegarde configurés ici sont stockés de manière partagée et appliqués à l'ensemble des instances StockFlow connectées au même réseau.
                </p>

                {backupStatus && (
                  <div className="wizard-error" style={{ color: backupStatus.includes("Erreur") || backupStatus.includes("échec") ? "var(--danger)" : "var(--success)", backgroundColor: backupStatus.includes("Erreur") || backupStatus.includes("échec") ? "var(--danger-light)" : "var(--success-light)", borderColor: backupStatus.includes("Erreur") || backupStatus.includes("échec") ? "rgba(220,38,38,0.2)" : "rgba(16,185,129,0.2)", marginBottom: "1.5rem" }}>
                    {backupStatus}
                  </div>
                )}

                <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  <div className="form-group">
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={backupEnabled}
                        onChange={async (e) => {
                          const val = e.target.checked;
                          setBackupEnabled(val);
                          try {
                            await invoke("save_backup_config", {
                              networkPath: config.network_path,
                              config: { enabled: val, scope: backupScope, max_backups: backupMaxBackups, delay_minutes: backupDelay }
                            });
                            showToast(val ? "Sauvegarde automatique activée" : "Sauvegarde automatique désactivée", "success");
                          } catch (err: any) {
                            showToast("Erreur modification sauvegarde : " + err.toString(), "error");
                          }
                        }}
                        style={{ width: "18px", height: "18px" }}
                      />
                      <span style={{ fontSize: "14px", fontWeight: "600" }}>Activer la sauvegarde automatique globale</span>
                    </label>
                  </div>

                  <div className="form-group">
                    <label htmlFor="backup-scope">Périmètre de la sauvegarde</label>
                    <select
                      id="backup-scope"
                      value={backupScope}
                      disabled={!backupEnabled}
                      onChange={async (e) => {
                        const val = e.target.value;
                        setBackupScope(val);
                        try {
                          await invoke("save_backup_config", {
                            networkPath: config.network_path,
                            config: { enabled: backupEnabled, scope: val, max_backups: backupMaxBackups, delay_minutes: backupDelay }
                          });
                          showToast("Périmètre de sauvegarde enregistré", "success");
                        } catch (err: any) {
                          showToast("Erreur modification sauvegarde : " + err.toString(), "error");
                        }
                      }}
                    >
                      <option value="all">Tout inclure (Événements, Images, Documents, Audits)</option>
                      <option value="events">Événements et Audits uniquement (Base de données)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="backup-retention">Nombre maximum de sauvegardes à conserver</label>
                    <input
                      id="backup-retention"
                      type="number"
                      min={1}
                      max={20}
                      disabled={!backupEnabled}
                      value={backupMaxBackups}
                      onChange={(e) => setBackupMaxBackups(Number(e.target.value) || 5)}
                      onBlur={async () => {
                        try {
                          await invoke("save_backup_config", {
                            networkPath: config.network_path,
                            config: { enabled: backupEnabled, scope: backupScope, max_backups: backupMaxBackups, delay_minutes: backupDelay }
                          });
                          showToast("Rétention enregistrée", "success");
                        } catch (err: any) {
                          showToast("Erreur modification sauvegarde : " + err.toString(), "error");
                        }
                      }}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="backup-delay">Délai d'activité minimum requis au démarrage (minutes)</label>
                    <input
                      id="backup-delay"
                      type="number"
                      min={0}
                      max={120}
                      disabled={!backupEnabled}
                      value={backupDelay}
                      onChange={(e) => setBackupDelay(Number(e.target.value) || 30)}
                      onBlur={async () => {
                        try {
                          await invoke("save_backup_config", {
                            networkPath: config.network_path,
                            config: { enabled: backupEnabled, scope: backupScope, max_backups: backupMaxBackups, delay_minutes: backupDelay }
                          });
                          showToast("Délai d'activité enregistré", "success");
                        } catch (err: any) {
                          showToast("Erreur modification sauvegarde : " + err.toString(), "error");
                        }
                      }}
                    />
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Délai avant exécution automatique afin d'éviter la surcharge réseau à l'ouverture de l'application (Défaut : 30 minutes).</span>
                  </div>

                  <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ flex: 1, padding: "0.8rem" }}
                      disabled={isBackupRunning}
                      onClick={async () => {
                        setIsBackupRunning(true);
                        setBackupStatus("Exécution d'une sauvegarde manuelle immédiate...");
                        try {
                          const res: string = await invoke("trigger_manual_backup", { networkPath: config.network_path });
                          setBackupStatus(res);
                        } catch (err: any) {
                          setBackupStatus("Erreur : " + err.toString());
                        } finally {
                          setIsBackupRunning(false);
                        }
                      }}
                    >
                      {isBackupRunning ? "Sauvegarde en cours..." : "💾 Lancer une sauvegarde manuelle immédiate"}
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "0.8rem", color: "var(--danger)", borderColor: "rgba(220,38,38,0.2)" }}
                      onClick={async () => {
                        try {
                          await invoke("force_release_lock", { networkPath: config.network_path });
                          setBackupStatus("Verrou libéré de force avec succès.");
                          showToast("Verrou libéré", "success");
                        } catch (err: any) {
                          showToast("Erreur : " + err.toString(), "error");
                        }
                      }}
                    >
                      🔓 Libérer le verrou de sauvegarde
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

        </main>

        {/* Right Details Panel */}
        {activeTab === "inventory" && selectedProduct && (
          <aside 
            className={`details-panel ${isDragging ? "dragging" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="panel-header">
              <span className="panel-title">Fiche : {selectedProduct.sku}</span>
              <button className="panel-close" onClick={() => setSelectedProduct(null)}>×</button>
            </div>
            
            <div className="panel-content">
              {/* Image Container / Carousel */}
              <div className="image-preview-container">
                {productImages.length > 0 ? (
                  <div className="carousel" style={{ position: "relative", width: "100%", height: "100%" }}>
                     <img 
                      src={convertFileSrc(`${config.network_path}/${productImages[activeImageIndex]}`.replace(/\\/g, "/"))} 
                      alt={selectedProduct.label} 
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                    {inlineConfirm?.id === "image-delete" ? (
                      <div className="inline-confirm" style={{ position: "absolute", top: "10px", right: "10px", backgroundColor: "rgba(239, 68, 68, 0.9)", padding: "4px 6px", borderRadius: "4px", zIndex: 10, display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{ color: "white", fontSize: "11px", fontWeight: "bold" }}>Supprimer ?</span>
                        <button onClick={(e) => { e.stopPropagation(); inlineConfirm.action(); setInlineConfirm(null); }} style={{ background: "#fff", color: "var(--danger)", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontWeight: "bold", padding: "2px 6px" }}>Oui</button>
                        <button onClick={(e) => { e.stopPropagation(); setInlineConfirm(null); }} style={{ background: "rgba(0,0,0,0.3)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "11px", padding: "2px 6px" }}>Non</button>
                      </div>
                    ) : (
                      <button
                        className="btn-delete-media"
                        title="Supprimer cette image"
                        style={{ position: "absolute", top: "10px", right: "10px", backgroundColor: "rgba(239, 68, 68, 0.8)", border: "none", color: "#fff", borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontWeight: "bold", zIndex: 10 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setInlineConfirm({
                            id: "image-delete",
                            action: async () => {
                              try {
                                const imgPath = productImages[activeImageIndex];
                                await invoke("delete_media", {
                                  networkPath: config.network_path,
                                  sku: selectedProduct.sku,
                                  mediaType: "image",
                                  filePath: imgPath
                                });
                                const updatedImgs: string[] = await invoke("list_sku_images", { networkPath: config.network_path, sku: selectedProduct.sku });
                                setProductImages(updatedImgs);
                                setActiveImageIndex(0);
                                syncAndFetch(config);
                              } catch (err: any) {
                                setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                              }
                            }
                          });
                        }}
                      >
                        🗑️
                      </button>
                    )}
                    {productImages.length > 1 && (
                      <div className="carousel-controls" style={{ position: "absolute", bottom: "10px", left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "0 10px", alignItems: "center" }}>
                        <button 
                          className="carousel-btn"
                          style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: "24px", height: "24px", cursor: "pointer" }}
                          onClick={(e) => { e.stopPropagation(); setActiveImageIndex(prev => (prev === 0 ? productImages.length - 1 : prev - 1)); }}
                        >
                          ◀
                        </button>
                        <span className="carousel-indicator" style={{ backgroundColor: "rgba(0,0,0,0.6)", padding: "2px 6px", borderRadius: "10px", fontSize: "11px", color: "#fff" }}>
                          {activeImageIndex + 1} / {productImages.length}
                        </span>
                        <button 
                          className="carousel-btn"
                          style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: "24px", height: "24px", cursor: "pointer" }}
                          onClick={(e) => { e.stopPropagation(); setActiveImageIndex(prev => (prev === productImages.length - 1 ? 0 : prev + 1)); }}
                        >
                          ▶
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "12px", border: "2px dashed var(--border-color)", borderRadius: "8px" }}>
                    <span>Pas d'image disponible</span>
                    <span style={{ fontSize: "10px", marginTop: "4px" }}>Déposez des images ou PDFs ici</span>
                  </div>
                )}
              </div>

              {/* General Metadata */}
              <div>
                <h4 style={{ fontFamily: "var(--font-title)", marginBottom: "0.5rem" }}>{selectedProduct.label}</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "12px" }}>
                  <div>Marque: <strong>{selectedProduct.brand || "Inconnue"}</strong></div>
                  <div>MPN: <strong>{selectedProduct.mpn}</strong></div>
                  <div>SKU (Interne): <strong>{selectedProduct.sku}</strong></div>
                  <div>Type d'article: <strong>{selectedProduct.item_type === "consumable" ? "Consommable" : "Standard"}</strong></div>
                  <div>Famille: <strong>{selectedProduct.category || "-"}</strong></div>
                  <div>Sous-Famille: <strong>{selectedProduct.sub_category || "-"}</strong></div>
                  <div>Emplacement: <strong>{selectedProduct.location || "Non assigné"}</strong></div>
                  <div>Stock Actuel: <strong>{selectedProduct.current_stock} u</strong></div>
                  <div>Seuil Alerte: <strong>{selectedProduct.min_stock} u</strong></div>
                  {(() => {
                    const vpcCodeFull = getVpcCode(selectedProduct);
                    if (vpcCodeFull) {
                      const idx = vpcCodeFull.indexOf(":");
                      const site = idx !== -1 ? vpcCodeFull.substring(0, idx).trim() : "VPC";
                      const code = idx !== -1 ? vpcCodeFull.substring(idx + 1).trim() : vpcCodeFull;
                      
                      let url = `https://www.google.com/search?q=${encodeURIComponent(vpcCodeFull)}`;
                      if (site.toLowerCase() === "rs" || site.toLowerCase().includes("rs component") || site.toLowerCase().includes("rs online")) {
                        url = `https://fr.rs-online.com/web/c/?searchTerm=${encodeURIComponent(code)}`;
                      } else if (site.toLowerCase().includes("farnell")) {
                        url = `https://fr.farnell.com/w/c/?st=${encodeURIComponent(code)}`;
                      } else if (site.toLowerCase().includes("mouser")) {
                        url = `https://www.mouser.fr/Search/Refine?Keyword=${encodeURIComponent(code)}`;
                      }
                      
                      return (
                        <div style={{ gridColumn: "span 2", marginTop: "0.2rem" }}>
                          Code VPC:{" "}
                          <button
                            type="button"
                            className="btn-link"
                            style={{ 
                              background: "none", 
                              border: "none", 
                              color: "var(--primary)", 
                              textDecoration: "underline", 
                              cursor: "pointer", 
                              padding: 0, 
                              font: "inherit",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.2rem"
                            }}
                            onClick={async () => {
                              try {
                                await openPath(url);
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                          >
                            🌐 {site} ({code})
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {(() => {
                    const width = getAttribute(selectedProduct, "largeur");
                    const height = getAttribute(selectedProduct, "hauteur");
                    const depth = getAttribute(selectedProduct, "profondeur");
                    const weight = getAttribute(selectedProduct, "poids");
                    const tension = getAttribute(selectedProduct, "tension");
                    
                    if (width || height || depth || weight || tension) {
                      return (
                        <div style={{ gridColumn: "span 2", borderTop: "1px solid var(--border-color)", paddingTop: "0.4rem", marginTop: "0.4rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.3rem" }}>
                          {width && <div>Largeur: <strong>{width} mm</strong></div>}
                          {height && <div>Hauteur: <strong>{height} mm</strong></div>}
                          {depth && <div>Profondeur: <strong>{depth} mm</strong></div>}
                          {weight && <div>Poids: <strong>{weight} g</strong></div>}
                          {tension && <div style={{ gridColumn: "span 2" }}>Tension: <strong>{tension}</strong></div>}
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <div>
                    {selectedProduct.pack_size > 1 ? "Prix du lot: " : "Prix unitaire: "}
                    <strong>{selectedProduct.price.toFixed(2)} €</strong>
                  </div>
                  {selectedProduct.pack_size > 1 && (
                    <>
                      <div>Taille du lot: <strong>{selectedProduct.pack_size} u</strong></div>
                      <div>Prix unitaire: <strong>{(selectedProduct.price / selectedProduct.pack_size).toFixed(4)} €</strong></div>
                    </>
                  )}
                  <div>Valeur totale stock: <strong>{((selectedProduct.current_stock / (selectedProduct.pack_size || 1)) * selectedProduct.price).toFixed(2)} €</strong></div>
                  
                  {(() => {
                    const priceUrl = getAttribute(selectedProduct, "scrape_price_url");
                    const imageUrl = getAttribute(selectedProduct, "scrape_image_url");
                    const docUrl = getAttribute(selectedProduct, "scrape_doc_url");
                    
                    if (priceUrl || imageUrl || docUrl) {
                      return (
                        <div style={{ gridColumn: "span 2", borderTop: "1px solid var(--border-color)", paddingTop: "0.4rem", marginTop: "0.4rem" }}>
                          <div style={{ fontWeight: "600", marginBottom: "0.3rem", fontSize: "11px", color: "var(--text-secondary)" }}>Sources de scraping :</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "11px" }}>
                            {priceUrl && (
                              <div>
                                💸 Prix :{" "}
                                <button
                                  type="button"
                                  className="btn-link"
                                  style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}
                                  onClick={() => openPath(priceUrl)}
                                >
                                  Lien source
                                </button>
                              </div>
                            )}
                            {imageUrl && (
                              <div>
                                🖼️ Image :{" "}
                                <button
                                  type="button"
                                  className="btn-link"
                                  style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}
                                  onClick={() => openPath(imageUrl)}
                                >
                                  Lien source
                                </button>
                              </div>
                            )}
                            {docUrl && (
                              <div>
                                📄 Notice :{" "}
                                <button
                                  type="button"
                                  className="btn-link"
                                  style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}
                                  onClick={() => openPath(docUrl)}
                                >
                                  Lien source
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "11px" }}
                    disabled={isScrapingPrice}
                    onClick={handleScrapePrice}
                  >
                    {isScrapingPrice ? "Recherche prix..." : "🔍 Scraper Prix"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "11px" }}
                    disabled={isScrapingMedia}
                    onClick={handleScrapeImageSingle}
                  >
                    🔍 Scraper Image
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "11px" }}
                    disabled={isScrapingMedia}
                    onClick={handleScrapePdfSingle}
                  >
                    🔍 Scraper PDF
                  </button>
                </div>
                {movementError && movementError.includes("déjà en cours") && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: "0.5rem", fontSize: "11px", padding: "0.2rem 0.5rem", width: "100%", backgroundColor: "var(--danger-light)", color: "var(--danger)" }}
                    onClick={async () => {
                      await invoke("force_release_lock", { networkPath: config.network_path });
                      setMovementError("");
                      setAlertModal({ title: "Déverrouillage", message: "Verrou forcé et libéré !" });
                    }}
                  >
                    🔓 Forcer le déverrouillage du Scraping
                  </button>
                )}

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem", marginBottom: "0.8rem" }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "12px" }}
                    onClick={() => {
                      setEditSuccess("");
                      setEditError("");
                      setAutoFillSource(null);
                      setAutoFillFallbackInfo(null);
                      
                      let site = "";
                      let code = "";
                      let attributesObj: any = {};
                      try {
                        attributesObj = typeof selectedProduct.attributes === "string" ? JSON.parse(selectedProduct.attributes || "{}") : selectedProduct.attributes;
                        if (attributesObj && attributesObj.vpc) {
                          const keys = Object.keys(attributesObj.vpc);
                          if (keys.length > 0) {
                            site = keys[0];
                            code = attributesObj.vpc[site];
                          }
                        }
                      } catch (e) {}
                      setEditVpcSite(site);
                      setEditVpcCode(code);

                      const formatNum = (v: any) => {
                        if (v === null || v === undefined) return "";
                        return v.toString().replace(/\./g, ",");
                      };

                      setEditProduct({
                        sku: selectedProduct.sku,
                        mpn: selectedProduct.mpn,
                        label: selectedProduct.label,
                        brand: selectedProduct.brand,
                        category: selectedProduct.category,
                        sub_category: selectedProduct.sub_category,
                        location: selectedProduct.location,
                        min_stock: formatNum(selectedProduct.min_stock),
                        price: formatNum(selectedProduct.price),
                        item_type: selectedProduct.item_type,
                        image_path: selectedProduct.image_path || null,
                        pdf_path: selectedProduct.pdf_path || null,
                        attributes: typeof selectedProduct.attributes === "string" ? selectedProduct.attributes : JSON.stringify(selectedProduct.attributes || {}),
                        pack_size: formatNum(selectedProduct.pack_size || 1),
                        largeur: formatNum(attributesObj.largeur || ""),
                        hauteur: formatNum(attributesObj.hauteur || ""),
                        profondeur: formatNum(attributesObj.profondeur || ""),
                        poids: formatNum(attributesObj.poids || "")
                      });
                      setAutofillType(site || "mpn");
                      setAutofillCodeInput(code || selectedProduct.mpn || "");
                      setShowEditModal(true);
                    }}
                  >
                    ✏️ Modifier
                  </button>
                  {inlineConfirm?.id === "product-delete" ? (
                    <div style={{ flex: 1, display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "6px", padding: "0 0.5rem" }}>
                      <span style={{ color: "var(--danger)", fontSize: "12px", fontWeight: "bold" }}>Sûr ?</span>
                      <button type="button" className="btn" style={{ background: "var(--danger)", color: "#fff", padding: "0.3rem 0.6rem", fontSize: "12px" }} onClick={() => {
                        inlineConfirm.action();
                        setInlineConfirm(null);
                      }}>Oui</button>
                      <button type="button" className="btn" style={{ background: "var(--bg-lighter)", color: "var(--text-color)", padding: "0.3rem 0.6rem", fontSize: "12px" }} onClick={() => setInlineConfirm(null)}>Non</button>
                    </div>
                  ) : (
                    <button 
                      type="button" 
                      className="btn btn-danger" 
                      style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "12px", backgroundColor: "var(--danger)" }}
                      onClick={() => {
                        setInlineConfirm({
                          id: "product-delete",
                          action: async () => {
                            try {
                              await invoke("delete_product", {
                                networkPath: config.network_path,
                                trigramme: config.trigramme,
                                sku: selectedProduct.sku
                              });
                              setSelectedProduct(null);
                              syncAndFetch(config);
                            } catch (err: any) {
                              setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                            }
                          }
                        });
                      }}
                    >
                      🗑️ Supprimer
                    </button>
                  )}
                </div>
              </div>

              {/* PDF Document action */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
                  <h4 style={{ fontFamily: "var(--font-title)", fontSize: "12px", margin: 0 }}>Documents PDF</h4>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "0.25rem 0.5rem", fontSize: "10px" }}
                    onClick={async () => {
                      if (!config || !selectedProduct) return;
                      const sanitizeFolderName = (name: string): string => {
                        const clean = (name || "").trim()
                          .replace(/\//g, "-")
                          .replace(/\\/g, "-")
                          .replace(/:/g, "-")
                          .replace(/\*/g, "-")
                          .replace(/\?/g, "-")
                          .replace(/"/g, "-")
                          .replace(/</g, "-")
                          .replace(/>/g, "-")
                          .replace(/\|/g, "-");
                        return clean || "INCONNU";
                      };
                      const sanitizeSku = (sku: string): string => {
                        return (sku || "").trim()
                          .replace(/\s+/g, "")
                          .replace(/\//g, "-")
                          .replace(/\\/g, "-")
                          .replace(/:/g, "-")
                          .replace(/\*/g, "-")
                          .replace(/\?/g, "-")
                          .replace(/"/g, "-")
                          .replace(/</g, "-")
                          .replace(/>/g, "-")
                          .replace(/\|/g, "-")
                          .toUpperCase();
                      };
                      const brand = sanitizeFolderName(selectedProduct.brand);
                      const cat = sanitizeFolderName(selectedProduct.category);
                      const sub = sanitizeFolderName(selectedProduct.sub_category);
                      const sku = sanitizeSku(selectedProduct.sku);
                      const path = `${config.network_path}/documents/${brand}/${cat}/${sub}/${sku}`.replace(/\//g, "\\");
                      try {
                        await invoke("ensure_directory", { path });
                        await openPath(path);
                      } catch (err: any) {
                        setMovementError(`Impossible d'ouvrir le dossier : ${err.toString()}`);
                      }
                    }}
                  >
                    📂 Ouvrir dossier
                  </button>
                </div>
                {productPdfs.length > 0 ? (
                  productPdfs.map((pdf, idx) => {
                    const fileName = pdf.split("/").pop() || "Manuel PDF";
                    const isEditing = editingPdfPath === pdf;
                    return (
                      <div key={idx} style={{ display: "flex", gap: "0.3rem" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: "0.2rem", flex: 1 }}>
                            <input
                              type="text"
                              style={{ padding: "0.3rem 0.5rem", fontSize: "11px", flex: 1 }}
                              value={newPdfName}
                              onChange={(e) => setNewPdfName(e.target.value)}
                            />
                            <button
                              className="btn"
                              style={{ padding: "0.3rem 0.6rem", fontSize: "11px" }}
                              onClick={async () => {
                                try {
                                  await invoke("rename_media", {
                                    networkPath: config.network_path,
                                    sku: selectedProduct.sku,
                                    mediaType: "pdf",
                                    oldPath: pdf,
                                    newName: newPdfName
                                  });
                                  setEditingPdfPath(null);
                                  const updatedPdfs: string[] = await invoke("list_sku_pdfs", { networkPath: config.network_path, sku: selectedProduct.sku });
                                  setProductPdfs(updatedPdfs);
                                  syncAndFetch(config);
                                } catch (err: any) {
                                  setAlertModal({ title: "Erreur de renommage", message: err.toString() });
                                }
                              }}
                            >
                              ✔️
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: "0.3rem 0.6rem", fontSize: "11px" }}
                              onClick={() => setEditingPdfPath(null)}
                            >
                              ❌
                            </button>
                          </div>
                        ) : (
                          <>
                            <button 
                              className="btn btn-secondary"
                              style={{ flex: 1, padding: "0.4rem 0.6rem", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}
                              onClick={async () => {
                                const fullPath = `${config.network_path}/${pdf}`.replace(/\//g, "\\");
                                try {
                                  await openPath(fullPath);
                                } catch (err: any) {
                                  setMovementError(`Impossible d'ouvrir le PDF : ${err.toString()}`);
                                }
                              }}
                            >
                              📄 {fileName}
                            </button>
                            <button
                              className="btn btn-secondary"
                              title="Renommer"
                              style={{ padding: "0.4rem 0.5rem", fontSize: "11px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                              onClick={() => {
                                setEditingPdfPath(pdf);
                                setNewPdfName(fileName.replace(".pdf", "").replace(".PDF", ""));
                              }}
                            >
                              ✏️
                            </button>
                          </>
                        )}
                        {inlineConfirm?.id === `pdf-delete-${fileName}` ? (
                          <div style={{ display: "flex", gap: "4px", alignItems: "center", backgroundColor: "rgba(239, 68, 68, 0.9)", padding: "2px 4px", borderRadius: "4px", flexShrink: 0 }}>
                            <span style={{ color: "white", fontSize: "10px", fontWeight: "bold" }}>Sûr ?</span>
                            <button onClick={(e) => { e.stopPropagation(); inlineConfirm.action(); setInlineConfirm(null); }} style={{ background: "#fff", color: "var(--danger)", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontWeight: "bold", padding: "2px 6px" }}>Oui</button>
                            <button onClick={(e) => { e.stopPropagation(); setInlineConfirm(null); }} style={{ background: "rgba(0,0,0,0.3)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "10px", padding: "2px 6px" }}>Non</button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-danger"
                            title="Supprimer cette notice"
                            style={{ backgroundColor: "var(--danger)", color: "#fff", padding: "0 0.5rem", border: "none", borderRadius: "6px", cursor: "pointer", flexShrink: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInlineConfirm({
                                id: `pdf-delete-${fileName}`,
                                action: async () => {
                                  try {
                                    await invoke("delete_media", {
                                      networkPath: config.network_path,
                                      sku: selectedProduct.sku,
                                      mediaType: "pdf",
                                      filePath: pdf
                                    });
                                    const updatedPdfs: string[] = await invoke("list_sku_pdfs", { networkPath: config.network_path, sku: selectedProduct.sku });
                                    setProductPdfs(updatedPdfs);
                                    syncAndFetch(config);
                                  } catch (err: any) {
                                    setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                                  }
                                }
                              });
                            }}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", padding: "0.5rem", border: "1px dashed var(--border-color)", borderRadius: "6px" }}>
                    Aucune fiche technique PDF associée.
                  </div>
                )}
              </div>

              {/* Movement controls */}
              <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
                <h4 style={{ fontFamily: "var(--font-title)", marginBottom: "0.8rem" }}>Effectuer un mouvement</h4>
                {movementSuccess && <div className="wizard-error" style={{ color: "var(--success)", backgroundColor: "var(--success-light)", borderColor: "rgba(16,185,129,0.2)" }}>{movementSuccess}</div>}
                {movementError && <div className="wizard-error">{movementError}</div>}
                
                <div className="form-group" style={{ marginBottom: "0.8rem" }}>
                  <label htmlFor="m-qty">Quantité :</label>
                  <input
                    id="m-qty"
                    type="text"
                    value={movementQty}
                    onChange={(e) => setMovementQty(cleanNumericInput(e.target.value))}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "0.8rem" }}>
                  <label htmlFor="m-note">Note / Raison :</label>
                  <input
                    id="m-note"
                    type="text"
                    placeholder="ex: Commande client, Réception lot"
                    value={movementNote}
                    onChange={(e) => setMovementNote(e.target.value)}
                  />
                </div>
                <div className="row" style={{ gap: "0.5rem" }}>
                  <button 
                    type="button" 
                    className="btn" 
                    style={{ flex: 1, backgroundColor: "var(--success)" }}
                    onClick={() => handleStockMovement("STOCK_IN")}
                  >
                    📥 Entrée Stock
                  </button>
                  <button 
                    type="button" 
                    className="btn" 
                    style={{ flex: 1, backgroundColor: "var(--danger)" }}
                    onClick={() => handleStockMovement("STOCK_OUT")}
                  >
                    📤 Sortie Stock
                  </button>
                </div>
              </div>

              {/* Traceability list */}
              <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
                <h4 style={{ fontFamily: "var(--font-title)", marginBottom: "0.8rem" }}>Historique des Mouvements</h4>
                <div className="history-list">
                  {productHistory.length === 0 ? (
                    <div style={{ padding: "0.8rem", color: "var(--text-muted)", fontSize: "11px" }}>
                      Aucun mouvement sur cette référence.
                    </div>
                  ) : (
                    productHistory.map((item, idx) => (
                      <div key={idx} className="history-item">
                        <div className="history-meta">
                          <span>{new Date(item.timestamp).toLocaleString("fr-FR")}</span>
                          <span>Par : {item.trigramme}</span>
                        </div>
                        <div>
                          <strong>{item.event_type === "STOCK_IN" ? "Entrée" : "Sortie"}</strong> de{" "}
                          <strong>{item.qty}</strong> unités — <em>{item.note}</em>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Audit Log */}
              <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
                <h4 style={{ fontFamily: "var(--font-title)", marginBottom: "0.8rem" }}>📋 Journal des Modifications</h4>
                <div className="history-list">
                  {productAuditLog.length === 0 ? (
                    <div style={{ padding: "0.8rem", color: "var(--text-muted)", fontSize: "11px" }}>
                      Aucune modification enregistrée.
                    </div>
                  ) : (
                    productAuditLog.map((item) => {
                      const date = new Date(item.timestamp);
                      const dateStr = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
                      const timeStr = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

                      let badge = "🔵";
                      let badgeClass = "audit-badge-update";
                      let content: React.ReactNode = "";

                      if (item.action === "CREATE") {
                        badge = "🟢";
                        badgeClass = "audit-badge-create";
                        content = <span>Création de la référence</span>;
                      } else if (item.action === "UPDATE") {
                        badge = "🔵";
                        badgeClass = "audit-badge-update";
                        content = (
                          <span>
                            <strong>{item.field}</strong> : <span className="audit-old-value">{item.old_value || "—"}</span> → <span className="audit-new-value">{item.new_value || "—"}</span>
                            {item.source_url && (
                              <> {" "}
                                <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="audit-link" title={item.source_url}>
                                  🔗 source
                                </a>
                              </>
                            )}
                          </span>
                        );
                      } else if (item.action === "SCRAPE_PRICE") {
                        badge = "🟠";
                        badgeClass = "audit-badge-scrape";
                        content = (
                          <span>
                            Prix scrappé : <strong>{item.new_value} €</strong>
                            {item.source_url && (
                              <> {" "}
                                <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="audit-link" title={item.source_url}>
                                  🔗 source
                                </a>
                              </>
                            )}
                          </span>
                        );
                      } else if (item.action === "SCRAPE_PDF") {
                        badge = "📄";
                        badgeClass = "audit-badge-scrape";
                        content = (
                          <span>
                            Notice téléchargée{item.field ? ` (${item.field})` : ""}
                            {item.source_url && (
                              <> {" "}
                                <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="audit-link" title={item.source_url}>
                                  🔗 source
                                </a>
                              </>
                            )}
                          </span>
                        );
                      } else if (item.action === "SCRAPE_IMAGE") {
                        badge = "🖼️";
                        badgeClass = "audit-badge-scrape";
                        content = (
                          <span>
                            Image téléchargée
                            {item.source_url && (
                              <> {" "}
                                <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="audit-link" title={item.source_url}>
                                  🔗 source
                                </a>
                              </>
                            )}
                          </span>
                        );
                      }

                      return (
                        <div key={item.audit_id} className={`audit-item ${badgeClass}`}>
                          <div className="audit-meta">
                            <span className="audit-badge">{badge}</span>
                            <span className="audit-date">{dateStr} {timeStr}</span>
                            <span className="audit-trigramme">{item.trigramme}</span>
                          </div>
                          <div className="audit-content">{content}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Add SKU Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3>Ajouter un nouveau SKU</h3>
              <button className="modal-close" onClick={() => { setShowAddModal(false); setAutoFillSource(null); setAutoFillFallbackInfo(null); }}>×</button>
            </div>
            <form onSubmit={handleCreateProduct}>
              <div className="modal-body">
                {createSuccess && <div className="wizard-error" style={{ color: "var(--success)", backgroundColor: "var(--success-light)", borderColor: "rgba(16,185,129,0.2)" }}>{createSuccess}</div>}
                {createError && <div className="wizard-error">{createError}</div>}
                {duplicateWarning && <div className="wizard-error" style={{ color: "var(--warning)", backgroundColor: "var(--warning-light)", borderColor: "rgba(245,158,11,0.2)" }}>{duplicateWarning}</div>}

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.8rem", backgroundColor: "var(--bg-secondary)", padding: "0.8rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}>
                  <div style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-secondary)" }}>
                    🚀 Auto-remplissage rapide
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <select
                      id="modal-autofill-type"
                      value={autofillType}
                      onChange={(e) => setAutofillType(e.target.value)}
                      style={{ width: "160px", padding: "0.3rem", fontSize: "12px", height: "32px" }}
                    >
                      <option value="mpn">Référence fabricant (MPN)</option>
                      {config?.vpc_sites?.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      id="modal-autofill-code"
                      type="text"
                      placeholder="Saisir la référence / le code..."
                      value={autofillCodeInput}
                      onChange={(e) => setAutofillCodeInput(e.target.value)}
                      style={{ flex: 1, padding: "0.3rem", fontSize: "12px", height: "32px" }}
                    />
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "0 1rem", fontSize: "12px", height: "32px" }}
                      disabled={autoFillLoading["ALL"]}
                      onClick={() => triggerAutoFillAction(false)}
                    >
                      {autoFillLoading["ALL"] ? "⏳ ..." : "Auto-remplir"}
                    </button>
                  </div>
                </div>

                {autoFillSource && (
                  <div className="autofill-source-info">
                    🌐 Source détectée : <a href={autoFillSource} target="_blank" rel="noopener noreferrer">{autoFillSource}</a>
                  </div>
                )}
                {autoFillFallbackInfo && (
                  <div className="autofill-fallback-info" style={{ fontSize: "11px", color: "var(--warning)", marginTop: "0.2rem", backgroundColor: "rgba(245,158,11,0.1)", padding: "0.4rem", borderRadius: "4px", border: "1px solid rgba(245,158,11,0.2)" }}>
                    ⚠️ {autoFillFallbackInfo}
                  </div>
                )}

                {/* 1. Identification */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">1. Identification</div>
                  
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 2 }}>
                      <label htmlFor="modal-p-sku">SKU (Référence Interne) *</label>
                      <input
                        id="modal-p-sku"
                        type="text"
                        required
                        list="skus-datalist"
                        value={newProduct.sku}
                        onChange={(e) => handleSkuChange(e.target.value)}
                        placeholder="ex: 6ES75070RA000AB0"
                      />
                    </div>
                    <div className="form-group" style={{ flex: 2 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-mpn">Référence Fabricant (MPN)</label>
                          <input
                            id="modal-p-mpn"
                            type="text"
                            list="mpns-datalist"
                            value={newProduct.mpn}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, mpn: e.target.value }))}
                            placeholder="Identique SKU si vide"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir MPN"
                          disabled={autoFillLoading["mpn"]}
                          onClick={() => handleAutoFill(false, "mpn")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 3 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-label">Désignation Produit *</label>
                          <input
                            id="modal-p-label"
                            type="text"
                            required
                            list="labels-datalist"
                            value={newProduct.label}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, label: e.target.value }))}
                            placeholder="ex: Siemens S7-1500 PS 60W"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Désignation"
                          disabled={autoFillLoading["label"]}
                          onClick={() => handleAutoFill(false, "label")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 2 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-brand">Marque</label>
                          <input
                            id="modal-p-brand"
                            type="text"
                            list="brands-datalist"
                            value={newProduct.brand}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, brand: e.target.value }))}
                            placeholder="ex: Siemens"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Marque"
                          disabled={autoFillLoading["brand"]}
                          onClick={() => handleAutoFill(false, "brand")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Fournisseur VPC */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">2. Fournisseur VPC</div>
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-vpc-site">Fournisseur VPC</label>
                      <select
                        id="modal-p-vpc-site"
                        value={newVpcSite}
                        onChange={(e) => setNewVpcSite(e.target.value)}
                      >
                        <option value="">Sélectionner</option>
                        {config?.vpc_sites?.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-vpc-code">Code VPC (Catalogue)</label>
                      <input
                        id="modal-p-vpc-code"
                        type="text"
                        placeholder="ex: RS-123-456"
                        value={newVpcCode}
                        onChange={(e) => setNewVpcCode(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Classification */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">3. Classification</div>
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-cat">Famille (Sans auto-remplissage)</label>
                      <input
                        id="modal-p-cat"
                        type="text"
                        list="categories-datalist"
                        value={newProduct.category}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, category: e.target.value }))}
                        placeholder="ex: Automatisme"
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-subcat">Sous-Famille (Sans auto-remplissage)</label>
                      <input
                        id="modal-p-subcat"
                        type="text"
                        list="add-subcategories-datalist"
                        value={newProduct.sub_category}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, sub_category: e.target.value }))}
                        placeholder="ex: Alimentation"
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Logistique */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">4. Logistique</div>
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 2 }}>
                      <label htmlFor="modal-p-loc">Emplacement Physique</label>
                      <input
                        id="modal-p-loc"
                        type="text"
                        list="locations-datalist"
                        value={newProduct.location}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, location: e.target.value }))}
                        placeholder="ex: MAG-A1-E2-B3"
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-min">Seuil Alerte Stock</label>
                      <input
                        id="modal-p-min"
                        type="text"
                        list="minstocks-datalist"
                        value={newProduct.min_stock}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, min_stock: cleanNumericInput(e.target.value) }))}
                      />
                    </div>
                  </div>

                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-initial-stock" style={{ color: "var(--success)", fontWeight: 600 }}>
                        📦 Stock initial (à la création)
                      </label>
                      <input
                        id="modal-p-initial-stock"
                        type="text"
                        placeholder="0"
                        value={newProduct.initial_stock}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, initial_stock: cleanNumericInput(e.target.value) }))}
                        style={{ borderColor: Number(newProduct.initial_stock) > 0 ? "var(--success)" : undefined }}
                      />
                      {Number(newProduct.initial_stock) > 0 && (
                        <span style={{ fontSize: "11px", color: "var(--success)", marginTop: "2px", display: "block" }}>
                          Un mouvement d'entrée de {newProduct.initial_stock} unité(s) sera créé automatiquement.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 2 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-price">Prix d'Achat (€)</label>
                          <input
                            id="modal-p-price"
                            type="text"
                            list="prices-datalist"
                            value={newProduct.price}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, price: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Prix"
                          disabled={autoFillLoading["price"]}
                          onClick={() => handleAutoFill(false, "price")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 2 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-pack">Taille du Lot (pack)</label>
                          <input
                            id="modal-p-pack"
                            type="text"
                            value={newProduct.pack_size}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, pack_size: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Taille Lot"
                          disabled={autoFillLoading["pack_size"]}
                          onClick={() => handleAutoFill(false, "pack_size")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Caractéristiques Physiques */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">5. Caractéristiques Physiques</div>
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-largeur">Largeur (mm)</label>
                          <input
                            id="modal-p-largeur"
                            type="text"
                            placeholder="Largeur"
                            value={newProduct.largeur}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, largeur: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Largeur"
                          disabled={autoFillLoading["largeur"]}
                          onClick={() => handleAutoFill(false, "largeur")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-hauteur">Hauteur (mm)</label>
                          <input
                            id="modal-p-hauteur"
                            type="text"
                            placeholder="Hauteur"
                            value={newProduct.hauteur}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, hauteur: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Hauteur"
                          disabled={autoFillLoading["hauteur"]}
                          onClick={() => handleAutoFill(false, "hauteur")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-profondeur">Profondeur (mm)</label>
                          <input
                            id="modal-p-profondeur"
                            type="text"
                            placeholder="Profondeur"
                            value={newProduct.profondeur}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, profondeur: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Profondeur"
                          disabled={autoFillLoading["profondeur"]}
                          onClick={() => handleAutoFill(false, "profondeur")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="modal-p-poids">Poids (g)</label>
                          <input
                            id="modal-p-poids"
                            type="text"
                            placeholder="Poids"
                            value={newProduct.poids}
                            onChange={(e) => setNewProduct(prev => ({ ...prev, poids: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Poids"
                          disabled={autoFillLoading["poids"]}
                          onClick={() => handleAutoFill(false, "poids")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowAddModal(false); setAutoFillSource(null); }}>Annuler</button>
                <button type="submit" className="btn">Créer le SKU</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit SKU Modal */}
      {showEditModal && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3>Modifier le SKU : {editProduct.sku}</h3>
              <button className="modal-close" onClick={() => { setShowEditModal(false); setAutoFillSource(null); setAutoFillFallbackInfo(null); }}>×</button>
            </div>
            <form onSubmit={handleEditProduct}>
              <div className="modal-body">
                {editSuccess && <div className="wizard-error" style={{ color: "var(--success)", backgroundColor: "var(--success-light)", borderColor: "rgba(16,185,129,0.2)" }}>{editSuccess}</div>}
                {editError && <div className="wizard-error">{editError}</div>}

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.8rem", backgroundColor: "var(--bg-secondary)", padding: "0.8rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}>
                  <div style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-secondary)" }}>
                    🚀 Auto-remplissage rapide
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <select
                      value={autofillType}
                      onChange={(e) => setAutofillType(e.target.value)}
                      style={{ width: "160px", padding: "0.3rem", fontSize: "12px", height: "32px" }}
                    >
                      <option value="mpn">Référence fabricant (MPN)</option>
                      {config?.vpc_sites?.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Saisir la référence / le code..."
                      value={autofillCodeInput}
                      onChange={(e) => setAutofillCodeInput(e.target.value)}
                      style={{ flex: 1, padding: "0.3rem", fontSize: "12px", height: "32px" }}
                    />
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "0 1rem", fontSize: "12px", height: "32px" }}
                      disabled={autoFillLoading["ALL"]}
                      onClick={() => triggerAutoFillAction(true)}
                    >
                      {autoFillLoading["ALL"] ? "⏳ ..." : "Auto-remplir"}
                    </button>
                  </div>
                </div>

                {autoFillSource && (
                  <div className="autofill-source-info">
                    🌐 Source détectée : <a href={autoFillSource} target="_blank" rel="noopener noreferrer">{autoFillSource}</a>
                  </div>
                )}
                {autoFillFallbackInfo && (
                  <div className="autofill-fallback-info" style={{ fontSize: "11px", color: "var(--warning)", marginTop: "0.2rem", backgroundColor: "rgba(245,158,11,0.1)", padding: "0.4rem", borderRadius: "4px", border: "1px solid rgba(245,158,11,0.2)" }}>
                    ⚠️ {autoFillFallbackInfo}
                  </div>
                )}

                {/* 1. Identification */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">1. Identification</div>
                  
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-mpn">Référence Fabricant (MPN)</label>
                          <input
                            id="edit-p-mpn"
                            type="text"
                            list="mpns-datalist"
                            value={editProduct.mpn}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, mpn: e.target.value }))}
                            placeholder="Identique SKU si vide"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir MPN"
                          disabled={autoFillLoading["mpn"]}
                          onClick={() => handleAutoFill(true, "mpn")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 3 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-label">Désignation Produit *</label>
                          <input
                            id="edit-p-label"
                            type="text"
                            required
                            list="labels-datalist"
                            value={editProduct.label}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, label: e.target.value }))}
                            placeholder="ex: Siemens S7-1500 PS 60W"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Désignation"
                          disabled={autoFillLoading["label"]}
                          onClick={() => handleAutoFill(true, "label")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 2 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-brand">Marque</label>
                          <input
                            id="edit-p-brand"
                            type="text"
                            list="brands-datalist"
                            value={editProduct.brand}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, brand: e.target.value }))}
                            placeholder="ex: Siemens"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Marque"
                          disabled={autoFillLoading["brand"]}
                          onClick={() => handleAutoFill(true, "brand")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Fournisseur VPC */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">2. Fournisseur VPC</div>
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="edit-p-vpc-site">Fournisseur VPC</label>
                      <select
                        id="edit-p-vpc-site"
                        value={editVpcSite}
                        onChange={(e) => setEditVpcSite(e.target.value)}
                      >
                        <option value="">Sélectionner</option>
                        {config?.vpc_sites?.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="edit-p-vpc-code">Code VPC (Catalogue)</label>
                      <input
                        id="edit-p-vpc-code"
                        type="text"
                        placeholder="ex: RS-123-456"
                        value={editVpcCode}
                        onChange={(e) => setEditVpcCode(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Classification */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">3. Classification</div>
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="edit-p-cat">Famille (Sans auto-remplissage)</label>
                      <input
                        id="edit-p-cat"
                        type="text"
                        list="categories-datalist"
                        value={editProduct.category}
                        onChange={(e) => setEditProduct(prev => ({ ...prev, category: e.target.value }))}
                        placeholder="ex: Automatisme"
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="edit-p-subcat">Sous-Famille (Sans auto-remplissage)</label>
                      <input
                        id="edit-p-subcat"
                        type="text"
                        list="edit-subcategories-datalist"
                        value={editProduct.sub_category}
                        onChange={(e) => setEditProduct(prev => ({ ...prev, sub_category: e.target.value }))}
                        placeholder="ex: Alimentation"
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Logistique */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">4. Logistique</div>
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 2 }}>
                      <label htmlFor="edit-p-loc">Emplacement Physique</label>
                      <input
                        id="edit-p-loc"
                        type="text"
                        list="locations-datalist"
                        value={editProduct.location}
                        onChange={(e) => setEditProduct(prev => ({ ...prev, location: e.target.value }))}
                        placeholder="ex: MAG-A1-E2-B3"
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="edit-p-min">Seuil Alerte Stock</label>
                      <input
                        id="edit-p-min"
                        type="text"
                        list="minstocks-datalist"
                        value={editProduct.min_stock}
                        onChange={(e) => setEditProduct(prev => ({ ...prev, min_stock: cleanNumericInput(e.target.value) }))}
                      />
                    </div>
                  </div>

                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 2 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-price">Prix d'Achat (€)</label>
                          <input
                            id="edit-p-price"
                            type="text"
                            list="prices-datalist"
                            value={editProduct.price}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, price: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Prix"
                          disabled={autoFillLoading["price"]}
                          onClick={() => handleAutoFill(true, "price")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 2 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-pack">Taille du Lot (pack)</label>
                          <input
                            id="edit-p-pack"
                            type="text"
                            value={editProduct.pack_size}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, pack_size: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Taille Lot"
                          disabled={autoFillLoading["pack_size"]}
                          onClick={() => handleAutoFill(true, "pack_size")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Caractéristiques Physiques */}
                <div className="modal-field-group">
                  <div className="modal-field-group-title">5. Caractéristiques Physiques</div>
                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-largeur">Largeur (mm)</label>
                          <input
                            id="edit-p-largeur"
                            type="text"
                            placeholder="Largeur"
                            value={editProduct.largeur}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, largeur: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Largeur"
                          disabled={autoFillLoading["largeur"]}
                          onClick={() => handleAutoFill(true, "largeur")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-hauteur">Hauteur (mm)</label>
                          <input
                            id="edit-p-hauteur"
                            type="text"
                            placeholder="Hauteur"
                            value={editProduct.hauteur}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, hauteur: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Hauteur"
                          disabled={autoFillLoading["hauteur"]}
                          onClick={() => handleAutoFill(true, "hauteur")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-profondeur">Profondeur (mm)</label>
                          <input
                            id="edit-p-profondeur"
                            type="text"
                            placeholder="Profondeur"
                            value={editProduct.profondeur}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, profondeur: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Profondeur"
                          disabled={autoFillLoading["profondeur"]}
                          onClick={() => handleAutoFill(true, "profondeur")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <div className="field-with-autofill">
                        <div style={{ flex: 1 }}>
                          <label htmlFor="edit-p-poids">Poids (g)</label>
                          <input
                            id="edit-p-poids"
                            type="text"
                            placeholder="Poids"
                            value={editProduct.poids}
                            onChange={(e) => setEditProduct(prev => ({ ...prev, poids: cleanNumericInput(e.target.value) }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-field-autofill"
                          title="Auto-remplir Poids"
                          disabled={autoFillLoading["poids"]}
                          onClick={() => handleAutoFill(true, "poids")}
                        >
                          🔍
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowEditModal(false); setAutoFillSource(null); }}>Annuler</button>
                <button type="submit" className="btn">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Datalists for autocompletion */}
      <datalist id="skus-datalist">
        {uniqueSkus.map(s => <option key={s} value={s} />)}
      </datalist>
      <datalist id="mpns-datalist">
        {uniqueMpns.map(m => <option key={m} value={m} />)}
      </datalist>
      <datalist id="labels-datalist">
        {uniqueLabels.map(l => <option key={l} value={l} />)}
      </datalist>
      <datalist id="brands-datalist">
        {uniqueBrands.map(b => <option key={b} value={b} />)}
      </datalist>
      <datalist id="categories-datalist">
        {uniqueCategories.map(c => <option key={c} value={c} />)}
      </datalist>
      <datalist id="add-subcategories-datalist">
        {addModalSubCategories.map(s => <option key={s} value={s} />)}
      </datalist>
      <datalist id="edit-subcategories-datalist">
        {editModalSubCategories.map(s => <option key={s} value={s} />)}
      </datalist>
      <datalist id="locations-datalist">
        {uniqueLocations.map(l => <option key={l} value={l} />)}
      </datalist>
      <datalist id="minstocks-datalist">
        {uniqueMinStocks.map(ms => <option key={ms} value={ms} />)}
      </datalist>
      <datalist id="prices-datalist">
        {uniquePrices.map(p => <option key={p} value={p} />)}
      </datalist>

      {/* Scrape Progress Modal */}
      {scrapeModalOpen && (
        <div className="modal-overlay">
          <div className="modal-container" style={{ maxWidth: "450px" }}>
            <div className="modal-header">
              <h3>{scrapeModalTitle}</h3>
              <button 
                className="modal-close" 
                onClick={() => setScrapeModalOpen(false)}
                disabled={isScrapingMedia}
              >
                ×
              </button>
            </div>
            <div className="modal-body" style={{ padding: "1.5rem" }}>
              <div className="scrape-steps-list" style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
                {scrapeSteps.map((step, idx) => {
                  let statusIcon = "⏳";
                  let statusClass = "step-pending";
                  if (step.status === "active") {
                    statusIcon = "🌀";
                    statusClass = "step-active";
                  } else if (step.status === "success") {
                    statusIcon = "✔️";
                    statusClass = "step-success";
                  } else if (step.status === "error") {
                    statusIcon = "❌";
                    statusClass = "step-error";
                  }
                  return (
                    <div key={idx} className={`scrape-step ${statusClass}`} style={{ display: "flex", alignItems: "flex-start", gap: "0.8rem" }}>
                      <span className="step-icon" style={{ fontSize: "1.2rem", lineHeight: 1 }}>{statusIcon}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1, minWidth: 0 }}>
                        <span className="step-label" style={{ fontWeight: step.status === "active" ? "600" : "500", color: step.status === "pending" ? "var(--text-muted)" : "var(--text-primary)" }}>
                          {step.label}
                        </span>
                        {step.details && (
                          <span className="step-details" style={{ fontSize: "11px", color: step.status === "error" ? "var(--danger)" : "var(--text-secondary)", wordBreak: "break-all", whiteSpace: "normal", display: "block" }}>
                            {step.details}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {scrapeError && (
                <div className="wizard-error" style={{ marginTop: "1.5rem", marginBottom: 0 }}>
                  {scrapeError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button 
                type="button" 
                className="btn" 
                onClick={() => setScrapeModalOpen(false)}
                disabled={isScrapingMedia}
              >
                {isScrapingMedia ? "Recherche en cours..." : "Fermer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local Confirmation Modal Overlay */}
      {confirmModal && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="modal-container" style={{ maxWidth: "420px" }}>
            <div className="modal-header">
              <h3>{confirmModal.title}</h3>
              <button className="modal-close" onClick={() => {
                if (confirmModal.onCancel) confirmModal.onCancel();
                setConfirmModal(null);
              }}>×</button>
            </div>
            <div className="modal-body" style={{ padding: "1.5rem", fontSize: "12.5px", color: "var(--text-primary)" }}>
              {confirmModal.message}
            </div>
            <div className="modal-footer">
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => {
                  if (confirmModal.onCancel) confirmModal.onCancel();
                  setConfirmModal(null);
                }}
              >
                Annuler
              </button>
              <button 
                type="button" 
                className="btn btn-danger" 
                style={{ backgroundColor: "var(--danger)" }}
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local Alert Modal Overlay */}
      {alertModal && (
        <div className="modal-overlay" style={{ zIndex: 2100 }}>
          <div className="modal-container" style={{ maxWidth: "400px" }}>
            <div className="modal-header">
              <h3>{alertModal.title}</h3>
              <button className="modal-close" onClick={() => setAlertModal(null)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: "1.5rem", fontSize: "12.5px", color: "var(--text-primary)" }}>
              {alertModal.message}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setAlertModal(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Hover Image Preview Overlay */}
      {hoveredImage && (
        <div 
          className="hover-thumb-card" 
          style={{ top: hoverPosition.y, left: hoverPosition.x }}
        >
          <img src={hoveredImage} alt="Preview" />
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div 
          className={`toast toast-${toast.type}`} 
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            backgroundColor: toast.type === "success" ? "var(--success)" : toast.type === "error" ? "var(--danger)" : "var(--accent)",
            color: "#fff",
            padding: "0.8rem 1.5rem",
            borderRadius: "8px",
            boxShadow: "var(--shadow-lg)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontFamily: "var(--font-title)",
            fontWeight: 500,
            animation: "slideUp 0.3s ease-out",
            border: "1px solid rgba(255,255,255,0.1)"
          }}
        >
          {toast.type === "success" ? "✔️" : toast.type === "error" ? "❌" : "ℹ️"} {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
