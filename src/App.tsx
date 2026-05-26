import { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import logoImg from "./assets/logo.png";
import "./App.css";

interface AppConfig {
  trigramme: string;
  network_path: string;
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
}

interface ColumnConfig {
  id: string;
  label: string;
  width: number;
  visible: boolean;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "image", label: "Image", width: 80, visible: true },
  { id: "sku", label: "SKU (Interne)", width: 140, visible: true },
  { id: "mpn", label: "Ref Fabricant", width: 140, visible: true },
  { id: "brand", label: "Marque", width: 120, visible: true },
  { id: "label", label: "Désignation", width: 250, visible: true },
  { id: "location", label: "Emplacement", width: 110, visible: true },
  { id: "current_stock", label: "Stock Actuel", width: 100, visible: true },
  { id: "min_stock", label: "Seuil Alerte", width: 100, visible: true },
  { id: "price", label: "Prix Unit.", width: 100, visible: true },
  { id: "total_value", label: "Valeur Total", width: 110, visible: true },
];


interface ProductHistoryItem {
  timestamp: string;
  trigramme: string;
  event_type: string;
  qty: number;
  note: string;
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
}

function App() {
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

  useEffect(() => {
    localStorage.setItem("sf_inventory_columns", JSON.stringify(columns));
  }, [columns]);

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

  // Theme & Configuration States
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [trigrammeInput, setTrigrammeInput] = useState("");
  const [networkPathInput, setNetworkPathInput] = useState("");
  const [configError, setConfigError] = useState("");
  const [isEditingConfig, setIsEditingConfig] = useState(false);

  // Navigation & View States
  const [activeTab, setActiveTab] = useState<"dashboard" | "inventory" | "add_product" | "migration">("dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productHistory, setProductHistory] = useState<ProductHistoryItem[]>([]);
  
  // Dashboard statistics
  const [stats, setStats] = useState<DashboardStats>({
    total_references: 0,
    total_value: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
    recent_movements: []
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
    min_stock: 0,
    price: 0,
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
    min_stock: 0,
    price: 0,
    item_type: "QUANTITATIVE",
    image_path: null as string | null,
    pdf_path: null as string | null,
    attributes: "{}",
  });
  const [editSuccess, setEditSuccess] = useState("");
  const [editError, setEditError] = useState("");

  // Inventory movement dialog/state inside detail panel
  const [movementQty, setMovementQty] = useState(1);
  const [movementNote, setMovementNote] = useState("");
  const [movementError, setMovementError] = useState("");
  const [movementSuccess, setMovementSuccess] = useState("");

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ sku: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

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

  // Maintenance states
  const [maintenanceStatus, setMaintenanceStatus] = useState("");
  const [maintenanceError, setMaintenanceError] = useState("");
  const [isMaintenanceRunning, setIsMaintenanceRunning] = useState(false);

  // 1. Initial configuration load
  useEffect(() => {
    async function loadConfig() {
      try {
        const loaded: AppConfig | null = await invoke("get_config");
        if (loaded) {
          setConfig(loaded);
          setTrigrammeInput(loaded.trigramme);
          setNetworkPathInput(loaded.network_path);
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
      if (selectedProduct) {
        const updated = loadedProducts.find(p => p.sku === selectedProduct.sku);
        if (updated) {
          setSelectedProduct(updated);
          // Mettre à jour les médias
          const imgs: string[] = await invoke("list_sku_images", { networkPath: appConfig.network_path, sku: updated.sku });
          setProductImages(imgs);
          const pdfs: string[] = await invoke("list_sku_pdfs", { networkPath: appConfig.network_path, sku: updated.sku });
          setProductPdfs(pdfs);
        }
      }
    } catch (err) {
      console.error("Failed to fetch products/stats", err);
    }
  }

  // Handle configuration setup wizard submission
  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setConfigError("");
    try {
      await invoke("save_config", {
        trigramme: trigrammeInput,
        networkPath: networkPathInput,
      });
      const newConfig = { trigramme: trigrammeInput.toUpperCase(), network_path: networkPathInput };
      setConfig(newConfig);
      setIsEditingConfig(false);
      syncAndFetch(newConfig);
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
        minStock: Number(newProduct.min_stock) || 0,
        price: Number(newProduct.price) || 0,
        imagePath: null,
        pdfPath: null,
        attributes: {}
      });

      setCreateSuccess("Produit créé avec succès ! Événement généré.");
      setNewProduct({
        sku: "",
        mpn: "",
        label: "",
        brand: "",
        category: "",
        sub_category: "",
        location: "",
        min_stock: 0,
        price: 0,
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
        minStock: Number(editProduct.min_stock) || 0,
        price: Number(editProduct.price) || 0,
        imagePath: editProduct.image_path,
        pdfPath: editProduct.pdf_path,
        attributes: JSON.parse(editProduct.attributes || "{}")
      });

      setEditSuccess("Produit mis à jour avec succès !");
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
        min_stock: Number(editProduct.min_stock) || 0,
        price: Number(editProduct.price) || 0,
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
    setEditValue(value.toString());
  }

  async function handleCellSave(product: Product) {
    if (!config || !editingCell) return;
    
    // Construct the modification based on the field edited
    const updatedProd = { ...product };
    if (editingCell.field === "location") updatedProd.location = editValue;
    if (editingCell.field === "price") updatedProd.price = Number(editValue) || 0;
    if (editingCell.field === "label") updatedProd.label = editValue;

    try {
      await invoke("create_product", {
        networkPath: config.network_path,
        trigramme: config.trigramme,
        sku: updatedProd.sku,
        mpn: updatedProd.mpn,
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
        attributes: JSON.parse(updatedProd.attributes || "{}")
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
        qty: Number(movementQty),
        note: movementNote || (type === "STOCK_IN" ? "Entrée manuelle" : "Sortie manuelle"),
      });

      setMovementSuccess("Mouvement enregistré !");
      setMovementQty(1);
      setMovementNote("");
      syncAndFetch(config);
      // Reload history
      const history: ProductHistoryItem[] = await invoke("get_product_history", { sku: selectedProduct.sku });
      setProductHistory(history);
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
    if (!window.confirm("Êtes-vous sûr de vouloir compacter le dossier d'événements ? Cela va supprimer l'historique brut des fichiers JSON intermédiaires et générer des états de création et stock consolidés propres pour chaque produit actif.")) return;
    
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

  async function handleMediaCleanup() {
    if (!config) return;
    if (!window.confirm("Êtes-vous sûr de vouloir nettoyer le stockage des fichiers médias ? Toutes les images et tous les dossiers PDF qui ne correspondent à aucune référence de produit active dans la base de données seront définitivement supprimés.")) return;
    
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

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <img src={logoImg} alt="StockFlow" className="header-logo-img" />
          <span className="header-logo">StockFlow</span>
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
            className={`nav-item ${activeTab === "migration" ? "active" : ""}`}
            onClick={() => setActiveTab("migration")}
          >
            ⚙️ Importation Excel/CSV
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

              <div style={{ padding: "0 1.5rem 1.5rem" }}>
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
            </div>
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
                    setNewProduct({
                      sku: "",
                      mpn: "",
                      label: "",
                      brand: "",
                      category: "",
                      sub_category: "",
                      location: "",
                      min_stock: 0,
                      price: 0,
                    });
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

              <div className="table-container">
                <table 
                  className="spreadsheet"
                  style={{ 
                    tableLayout: "fixed", 
                    width: columns.filter(c => c.visible).reduce((sum, c) => sum + c.width, 0)
                  }}
                >
                  <thead>
                    <tr>
                      {columns.map(col => col.visible && (
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
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td 
                          colSpan={columns.filter(c => c.visible).length} 
                          style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}
                        >
                          Aucun produit correspondant.
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map((prod) => {
                        let stockClass = "stock-ok";
                        if (prod.current_stock === 0) stockClass = "stock-empty";
                        else if (prod.min_stock > 0 && prod.current_stock <= prod.min_stock) stockClass = "stock-low";

                        return (
                          <tr 
                            key={prod.sku}
                            className={selectedProduct?.sku === prod.sku ? "selected" : ""}
                            onClick={() => handleSelectProduct(prod)}
                          >
                            {columns.find(c => c.id === "image")?.visible && (
                              <td 
                                style={{ 
                                  textAlign: "center",
                                  width: columns.find(c => c.id === "image")?.width,
                                  minWidth: columns.find(c => c.id === "image")?.width,
                                  maxWidth: columns.find(c => c.id === "image")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                                onMouseMove={(e) => handleImageHover(e, prod.image_path)}
                                onMouseLeave={() => setHoveredImage(null)}
                              >
                                {prod.image_path ? "🖼️ Preview" : "N/A"}
                              </td>
                            )}
                            {columns.find(c => c.id === "sku")?.visible && (
                              <td
                                style={{ 
                                  width: columns.find(c => c.id === "sku")?.width,
                                  minWidth: columns.find(c => c.id === "sku")?.width,
                                  maxWidth: columns.find(c => c.id === "sku")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                <strong>{prod.sku}</strong>
                              </td>
                            )}
                            {columns.find(c => c.id === "mpn")?.visible && (
                              <td
                                style={{ 
                                  width: columns.find(c => c.id === "mpn")?.width,
                                  minWidth: columns.find(c => c.id === "mpn")?.width,
                                  maxWidth: columns.find(c => c.id === "mpn")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                {prod.mpn}
                              </td>
                            )}
                            {columns.find(c => c.id === "brand")?.visible && (
                              <td
                                style={{ 
                                  width: columns.find(c => c.id === "brand")?.width,
                                  minWidth: columns.find(c => c.id === "brand")?.width,
                                  maxWidth: columns.find(c => c.id === "brand")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                {prod.brand}
                              </td>
                            )}
                            {columns.find(c => c.id === "label")?.visible && (
                              <td 
                                onDoubleClick={() => handleCellDoubleClick(prod.sku, "label", prod.label)}
                                style={{ 
                                  cursor: "edit",
                                  width: columns.find(c => c.id === "label")?.width,
                                  minWidth: columns.find(c => c.id === "label")?.width,
                                  maxWidth: columns.find(c => c.id === "label")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                {editingCell?.sku === prod.sku && editingCell.field === "label" ? (
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={() => handleCellSave(prod)}
                                    onKeyDown={(e) => e.key === "Enter" && handleCellSave(prod)}
                                  />
                                ) : (
                                  prod.label
                                )}
                              </td>
                            )}
                            {columns.find(c => c.id === "location")?.visible && (
                              <td 
                                onDoubleClick={() => handleCellDoubleClick(prod.sku, "location", prod.location)}
                                style={{ 
                                  cursor: "edit",
                                  width: columns.find(c => c.id === "location")?.width,
                                  minWidth: columns.find(c => c.id === "location")?.width,
                                  maxWidth: columns.find(c => c.id === "location")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                {editingCell?.sku === prod.sku && editingCell.field === "location" ? (
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={() => handleCellSave(prod)}
                                    onKeyDown={(e) => e.key === "Enter" && handleCellSave(prod)}
                                  />
                                ) : (
                                  prod.location || "-"
                                )}
                              </td>
                            )}
                            {columns.find(c => c.id === "current_stock")?.visible && (
                              <td
                                style={{ 
                                  width: columns.find(c => c.id === "current_stock")?.width,
                                  minWidth: columns.find(c => c.id === "current_stock")?.width,
                                  maxWidth: columns.find(c => c.id === "current_stock")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                <span className={`stock-status-badge ${stockClass}`}>
                                  {prod.current_stock}
                                </span>
                              </td>
                            )}
                            {columns.find(c => c.id === "min_stock")?.visible && (
                              <td
                                style={{ 
                                  width: columns.find(c => c.id === "min_stock")?.width,
                                  minWidth: columns.find(c => c.id === "min_stock")?.width,
                                  maxWidth: columns.find(c => c.id === "min_stock")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                {prod.min_stock}
                              </td>
                            )}
                            {columns.find(c => c.id === "price")?.visible && (
                              <td 
                                onDoubleClick={() => handleCellDoubleClick(prod.sku, "price", prod.price)}
                                style={{ 
                                  cursor: "edit",
                                  width: columns.find(c => c.id === "price")?.width,
                                  minWidth: columns.find(c => c.id === "price")?.width,
                                  maxWidth: columns.find(c => c.id === "price")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                {editingCell?.sku === prod.sku && editingCell.field === "price" ? (
                                  <input
                                    type="number"
                                    autoFocus
                                    step="0.01"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={() => handleCellSave(prod)}
                                    onKeyDown={(e) => e.key === "Enter" && handleCellSave(prod)}
                                  />
                                ) : (
                                  `${prod.price.toFixed(2)} €`
                                )}
                              </td>
                            )}
                            {columns.find(c => c.id === "total_value")?.visible && (
                              <td
                                style={{ 
                                  width: columns.find(c => c.id === "total_value")?.width,
                                  minWidth: columns.find(c => c.id === "total_value")?.width,
                                  maxWidth: columns.find(c => c.id === "total_value")?.width,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap"
                                }}
                              >
                                {(prod.price * prod.current_stock).toFixed(2)} €
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
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
                  <div>Famille: <strong>{selectedProduct.category || "-"}</strong></div>
                  <div>Sous-Famille: <strong>{selectedProduct.sub_category || "-"}</strong></div>
                  <div>Emplacement: <strong>{selectedProduct.location || "Non assigné"}</strong></div>
                  <div>Prix unitaire: <strong>{selectedProduct.price.toFixed(2)} €</strong></div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem", marginBottom: "0.8rem" }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "12px" }}
                    onClick={() => {
                      setEditSuccess("");
                      setEditError("");
                      setEditProduct({
                        sku: selectedProduct.sku,
                        mpn: selectedProduct.mpn,
                        label: selectedProduct.label,
                        brand: selectedProduct.brand,
                        category: selectedProduct.category,
                        sub_category: selectedProduct.sub_category,
                        location: selectedProduct.location,
                        min_stock: selectedProduct.min_stock,
                        price: selectedProduct.price,
                        item_type: selectedProduct.item_type,
                        image_path: selectedProduct.image_path || null,
                        pdf_path: selectedProduct.pdf_path || null,
                        attributes: selectedProduct.attributes || "{}",
                      });
                      setShowEditModal(true);
                    }}
                  >
                    ✏️ Modifier
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-danger" 
                    style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "12px", backgroundColor: "var(--danger)" }}
                    onClick={async () => {
                      if (confirm(`Êtes-vous sûr de vouloir supprimer définitivement le SKU ${selectedProduct.sku} ?`)) {
                        try {
                          await invoke("delete_product", {
                            networkPath: config.network_path,
                            trigramme: config.trigramme,
                            sku: selectedProduct.sku
                          });
                          setSelectedProduct(null);
                          syncAndFetch(config);
                        } catch (err: any) {
                          alert(`Erreur de suppression : ${err.toString()}`);
                        }
                      }
                    }}
                  >
                    🗑️ Supprimer
                  </button>
                </div>
              </div>

              {/* PDF Document action */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {productPdfs.length > 0 ? (
                  productPdfs.map((pdf, idx) => {
                    const fileName = pdf.split("/").pop() || "Manuel PDF";
                    return (
                      <button 
                        key={idx}
                        className="btn btn-secondary"
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
                    type="number"
                    min={1}
                    value={movementQty}
                    onChange={(e) => setMovementQty(Number(e.target.value) || 1)}
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
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateProduct}>
              <div className="modal-body">
                {createSuccess && <div className="wizard-error" style={{ color: "var(--success)", backgroundColor: "var(--success-light)", borderColor: "rgba(16,185,129,0.2)" }}>{createSuccess}</div>}
                {createError && <div className="wizard-error">{createError}</div>}
                {duplicateWarning && <div className="wizard-error" style={{ color: "var(--warning)", backgroundColor: "var(--warning-light)", borderColor: "rgba(245,158,11,0.2)" }}>{duplicateWarning}</div>}

                <div className="form-group" style={{ marginBottom: "1rem" }}>
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
                <div className="form-group" style={{ marginBottom: "1rem" }}>
                  <label htmlFor="modal-p-mpn">Référence Fabricant (MPN)</label>
                  <input
                    id="modal-p-mpn"
                    type="text"
                    list="mpns-datalist"
                    value={newProduct.mpn}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, mpn: e.target.value }))}
                    placeholder="Saisie libre (laissé vide = identique SKU)"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "1rem" }}>
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
                <div className="form-group" style={{ marginBottom: "1rem" }}>
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
                <div className="row" style={{ gap: "1rem", marginBottom: "1rem", justifyContent: "stretch" }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="modal-p-cat">Famille</label>
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
                    <label htmlFor="modal-p-subcat">Sous-Famille</label>
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
                <div className="form-group" style={{ marginBottom: "1rem" }}>
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
                <div className="row" style={{ gap: "1rem", justifyContent: "stretch" }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="modal-p-min">Seuil d'Alerte Stock</label>
                    <input
                      id="modal-p-min"
                      type="number"
                      min={0}
                      list="minstocks-datalist"
                      value={newProduct.min_stock}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, min_stock: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="modal-p-price">Prix d'Achat (€)</label>
                    <input
                      id="modal-p-price"
                      type="number"
                      step="0.01"
                      min={0}
                      list="prices-datalist"
                      value={newProduct.price}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, price: Number(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Annuler</button>
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
              <button className="modal-close" onClick={() => setShowEditModal(false)}>×</button>
            </div>
            <form onSubmit={handleEditProduct}>
              <div className="modal-body">
                {editSuccess && <div className="wizard-error" style={{ color: "var(--success)", backgroundColor: "var(--success-light)", borderColor: "rgba(16,185,129,0.2)" }}>{editSuccess}</div>}
                {editError && <div className="wizard-error">{editError}</div>}

                <div className="form-group" style={{ marginBottom: "1rem" }}>
                  <label htmlFor="edit-p-mpn">Référence Fabricant (MPN)</label>
                  <input
                    id="edit-p-mpn"
                    type="text"
                    list="mpns-datalist"
                    value={editProduct.mpn}
                    onChange={(e) => setEditProduct(prev => ({ ...prev, mpn: e.target.value }))}
                    placeholder="Saisie libre (laissé vide = identique SKU)"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "1rem" }}>
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
                <div className="form-group" style={{ marginBottom: "1rem" }}>
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
                <div className="row" style={{ gap: "1rem", marginBottom: "1rem", justifyContent: "stretch" }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="edit-p-cat">Famille</label>
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
                    <label htmlFor="edit-p-subcat">Sous-Famille</label>
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
                <div className="form-group" style={{ marginBottom: "1rem" }}>
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
                <div className="row" style={{ gap: "1rem", justifyContent: "stretch" }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="edit-p-min">Seuil d'Alerte Stock</label>
                    <input
                      id="edit-p-min"
                      type="number"
                      min={0}
                      list="minstocks-datalist"
                      value={editProduct.min_stock}
                      onChange={(e) => setEditProduct(prev => ({ ...prev, min_stock: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="edit-p-price">Prix d'Achat (€)</label>
                    <input
                      id="edit-p-price"
                      type="number"
                      step="0.01"
                      min={0}
                      list="prices-datalist"
                      value={editProduct.price}
                      onChange={(e) => setEditProduct(prev => ({ ...prev, price: Number(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Annuler</button>
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

      {/* Hover Image Preview Overlay */}
      {hoveredImage && (
        <div 
          className="hover-thumb-card" 
          style={{ top: hoverPosition.y, left: hoverPosition.x }}
        >
          <img src={hoveredImage} alt="Preview" />
        </div>
      )}
    </div>
  );
}

export default App;
