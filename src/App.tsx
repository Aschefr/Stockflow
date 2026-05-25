import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  // Theme & Configuration States
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [trigrammeInput, setTrigrammeInput] = useState("");
  const [networkPathInput, setNetworkPathInput] = useState("");
  const [configError, setConfigError] = useState("");

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

  // Inventory movement dialog/state inside detail panel
  const [movementQty, setMovementQty] = useState(1);
  const [movementNote, setMovementNote] = useState("");
  const [movementError, setMovementError] = useState("");
  const [movementSuccess, setMovementSuccess] = useState("");

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ sku: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // CSV Migration State
  const [csvFilePath, setCsvFilePath] = useState("");
  const [mediaDirPath, setMediaDirPath] = useState("");
  const [migrationStatus, setMigrationStatus] = useState("");
  const [migrationError, setMigrationError] = useState("");

  // Network sync status
  const [isOnline, setIsOnline] = useState(true);

  // Hover image preview state
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });

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
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function pickMediaDir() {
    try {
      const path: string | null = await invoke("select_network_directory");
      if (path) {
        setMediaDirPath(path);
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
    try {
      const history: ProductHistoryItem[] = await invoke("get_product_history", { sku: prod.sku });
      setProductHistory(history);
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
      syncAndFetch(config);
    } catch (err: any) {
      setCreateError(err.toString());
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

    try {
      const count: number = await invoke("import_csv", {
        csvPath: csvFilePath,
        networkPath: config.network_path,
        trigramme: config.trigramme,
        mediaDir: mediaDirPath || null
      });
      setMigrationStatus(`Migration terminée ! ${count} références importées.`);
      syncAndFetch(config);
    } catch (err: any) {
      setMigrationStatus("");
      setMigrationError(err.toString());
    }
  }

  // Hover Thumbnail handler
  function handleImageHover(e: React.MouseEvent, imageRelativePath: string | null | undefined) {
    if (!imageRelativePath || !config) return;
    
    // Resolve absolute path through standard Windows file path format on network share
    const absolutePath = `file:///${config.network_path.replace(/\\/g, "/")}/${imageRelativePath}`;
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
    return matchQuery && matchCategory;
  });

  // Unique Categories for filters
  const categories = ["all", ...Array.from(new Set(products.map(p => p.category).filter(Boolean)))];

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

  // Setup Wizard if Config is missing
  if (!config) {
    return (
      <div className="wizard-overlay">
        <form onSubmit={handleSetup} className="wizard-card">
          <div className="wizard-logo">StockFlow</div>
          <div className="wizard-subtitle">Configuration du poste de travail</div>
          
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
            Valider et Créer l'environnement
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <span className="header-logo">📈 StockFlow</span>
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
          
          <div className="user-info">
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
            className={`nav-item ${activeTab === "add_product" ? "active" : ""}`}
            onClick={() => setActiveTab("add_product")}
          >
            ➕ Ajouter un Produit
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
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    style={{ width: "auto" }}
                  >
                    {categories.map((c, i) => (
                      <option key={i} value={c}>{c === "all" ? "Toutes" : c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="table-container">
                <table className="spreadsheet">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>SKU (Interne)</th>
                      <th>Ref Fabricant</th>
                      <th>Marque</th>
                      <th>Désignation</th>
                      <th>Emplacement</th>
                      <th>Stock Actuel</th>
                      <th>Seuil Alerte</th>
                      <th>Prix Unit.</th>
                      <th>Valeur Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
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
                            <td 
                              style={{ textAlign: "center" }}
                              onMouseMove={(e) => handleImageHover(e, prod.image_path)}
                              onMouseLeave={() => setHoveredImage(null)}
                            >
                              {prod.image_path ? "🖼️ Preview" : "N/A"}
                            </td>
                            <td><strong>{prod.sku}</strong></td>
                            <td>{prod.mpn}</td>
                            <td>{prod.brand}</td>
                            <td 
                              onDoubleClick={() => handleCellDoubleClick(prod.sku, "label", prod.label)}
                              style={{ cursor: "edit" }}
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
                            <td 
                              onDoubleClick={() => handleCellDoubleClick(prod.sku, "location", prod.location)}
                              style={{ cursor: "edit" }}
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
                            <td>
                              <span className={`stock-status-badge ${stockClass}`}>
                                {prod.current_stock}
                              </span>
                            </td>
                            <td>{prod.min_stock}</td>
                            <td 
                              onDoubleClick={() => handleCellDoubleClick(prod.sku, "price", prod.price)}
                              style={{ cursor: "edit" }}
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
                            <td>{(prod.price * prod.current_stock).toFixed(2)} €</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* TAB 3: CREATE PRODUCT */}
          {activeTab === "add_product" && (
            <div style={{ padding: "2rem", overflowY: "auto", maxWidth: "600px", margin: "0 auto", width: "100%" }}>
              <h2 style={{ fontFamily: "var(--font-title)", marginBottom: "1.5rem" }}>Ajouter une nouvelle référence</h2>
              
              {createSuccess && <div className="wizard-error" style={{ color: "var(--success)", backgroundColor: "var(--success-light)", borderColor: "rgba(16,185,129,0.2)" }}>{createSuccess}</div>}
              {createError && <div className="wizard-error">{createError}</div>}
              {duplicateWarning && <div className="wizard-error" style={{ color: "var(--warning)", backgroundColor: "var(--warning-light)", borderColor: "rgba(245,158,11,0.2)" }}>{duplicateWarning}</div>}

              <form onSubmit={handleCreateProduct} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="form-group">
                  <label htmlFor="p-sku">SKU (Référence Interne) *</label>
                  <input
                    id="p-sku"
                    type="text"
                    required
                    value={newProduct.sku}
                    onChange={(e) => handleSkuChange(e.target.value)}
                    placeholder="ex: 6ES75070RA000AB0"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="p-mpn">Référence Fabricant (MPN)</label>
                  <input
                    id="p-mpn"
                    type="text"
                    value={newProduct.mpn}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, mpn: e.target.value }))}
                    placeholder="Saisie libre (laissé vide = identique SKU)"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="p-label">Désignation Produit *</label>
                  <input
                    id="p-label"
                    type="text"
                    required
                    value={newProduct.label}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, label: e.target.value }))}
                    placeholder="ex: Siemens S7-1500 PS 60W"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="p-brand">Marque</label>
                  <input
                    id="p-brand"
                    type="text"
                    value={newProduct.brand}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, brand: e.target.value }))}
                    placeholder="ex: Siemens"
                  />
                </div>
                <div className="row" style={{ gap: "1rem", justifyContent: "stretch" }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="p-cat">Famille</label>
                    <input
                      id="p-cat"
                      type="text"
                      value={newProduct.category}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, category: e.target.value }))}
                      placeholder="ex: Automatisme"
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="p-subcat">Sous-Famille</label>
                    <input
                      id="p-subcat"
                      type="text"
                      value={newProduct.sub_category}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, sub_category: e.target.value }))}
                      placeholder="ex: Alimentation"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="p-loc">Emplacement Physique</label>
                  <input
                    id="p-loc"
                    type="text"
                    value={newProduct.location}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="ex: MAG-A1-E2-B3"
                  />
                </div>
                <div className="row" style={{ gap: "1rem", justifyContent: "stretch" }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="p-min">Seuil d'Alerte Stock</label>
                    <input
                      id="p-min"
                      type="number"
                      min={0}
                      value={newProduct.min_stock}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, min_stock: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="p-price">Prix d'Achat (€)</label>
                    <input
                      id="p-price"
                      type="number"
                      step="0.01"
                      min={0}
                      value={newProduct.price}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, price: Number(e.target.value) || 0 }))}
                    />
                  </div>
                </div>

                <button type="submit" className="btn" style={{ marginTop: "1rem" }}>
                  Créer le Produit (Générer l'événement)
                </button>
              </form>
            </div>
          )}

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
                      onChange={(e) => setCsvFilePath(e.target.value)}
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
                  <label htmlFor="media-path">Dossier source des documents & images (Optionnel)</label>
                  <div className="input-with-button">
                    <input
                      id="media-path"
                      type="text"
                      disabled={migrationStatus.includes("en cours")}
                      value={mediaDirPath}
                      onChange={(e) => setMediaDirPath(e.target.value)}
                      placeholder="Chemin du dossier contenant les dossiers 'Images' et 'PDF'"
                    />
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      disabled={migrationStatus.includes("en cours")}
                      onClick={pickMediaDir}
                    >
                      Parcourir
                    </button>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Si spécifié, l'application copiera automatiquement les images et documentations PDF dans le partage réseau en les liant aux fiches produits correspondantes.
                  </span>
                </div>

                <button 
                  type="submit" 
                  className="btn" 
                  disabled={migrationStatus.includes("en cours")}
                  style={{ marginTop: "1rem" }}
                >
                  {migrationStatus.includes("en cours") ? "Migration en cours..." : "Lancer la Migration"}
                </button>
              </form>
            </div>
          )}

        </main>

        {/* Right Details Panel */}
        {activeTab === "inventory" && selectedProduct && (
          <aside className="details-panel">
            <div className="panel-header">
              <span className="panel-title">Fiche : {selectedProduct.sku}</span>
              <button className="panel-close" onClick={() => setSelectedProduct(null)}>×</button>
            </div>
            
            <div className="panel-content">
              {/* Image Container */}
              <div className="image-preview-container">
                {selectedProduct.image_path ? (
                  <img 
                    src={`file:///${config.network_path.replace(/\\/g, "/")}/${selectedProduct.image_path}`} 
                    alt={selectedProduct.label} 
                  />
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>Pas d'image disponible</span>
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
              </div>

              {/* PDF Document action */}
              {selectedProduct.pdf_path ? (
                <a 
                  href={`file:///${config.network_path.replace(/\\/g, "/")}/${selectedProduct.pdf_path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{ textDecoration: "none", textAlign: "center", display: "block" }}
                >
                  📄 Fiche Technique PDF
                </a>
              ) : (
                <div style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" }}>
                  Aucune fiche technique PDF associée.
                </div>
              )}

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
