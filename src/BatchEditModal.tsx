import React, { useState, useMemo } from "react";
import { invoke } from "./services/api";
import type { Product } from "./types";

interface AppConfig {
  network_path: string;
  trigramme: string;
}

interface BatchEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  filteredProducts: Product[];
  selectedSkus: string[];
  config: AppConfig | null;
  onComplete: () => Promise<void>;
  initialScope?: "selected" | "filtered" | "all";
}

type EditScope = "selected" | "filtered" | "all";
type EditField = "category" | "sub_category" | "brand" | "location" | "label" | "vpc_supplier" | "notes";
type EditMode = "replace_text" | "set_value";

interface PreviewItem {
  sku: string;
  label: string;
  oldValue: string;
  newValue: string;
  originalProduct: Product;
  updatedProduct: Product;
}

export const BatchEditModal: React.FC<BatchEditModalProps> = ({
  isOpen,
  onClose,
  products,
  filteredProducts,
  selectedSkus,
  config,
  onComplete,
  initialScope = "selected",
}) => {
  const [scope, setScope] = useState<EditScope>(() => {
    if (initialScope === "selected" && selectedSkus.length > 0) return "selected";
    if (initialScope === "filtered") return "filtered";
    return selectedSkus.length > 0 ? "selected" : "filtered";
  });

  const [field, setField] = useState<EditField>("category");
  const [mode, setMode] = useState<EditMode>("set_value");

  // Search & Replace parameters
  const [searchPattern, setSearchPattern] = useState("");
  const [replacePattern, setReplacePattern] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [exactMatch, setExactMatch] = useState(false);

  // Set Value parameters
  const [fixedValue, setFixedValue] = useState("");

  // Supplier rename parameters
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");

  // Execution state
  const [isApplying, setIsApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Datalists / Suggestions from existing database values
  const existingCategories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(),
    [products]
  );
  const existingSubCategories = useMemo(
    () => Array.from(new Set(products.map((p) => p.sub_category).filter(Boolean))).sort(),
    [products]
  );
  const existingBrands = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand).filter(Boolean))).sort(),
    [products]
  );
  const existingLocations = useMemo(
    () => Array.from(new Set(products.map((p) => p.location).filter(Boolean))).sort(),
    [products]
  );
  const existingSuppliers = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      try {
        const attrs = typeof p.attributes === "string" ? JSON.parse(p.attributes || "{}") : p.attributes;
        if (attrs?.vpc && typeof attrs.vpc === "object") {
          Object.keys(attrs.vpc).forEach((k) => set.add(k));
        }
      } catch {}
    });
    return Array.from(set).sort();
  }, [products]);

  // Determine targeted items based on selected scope
  const targetProducts = useMemo(() => {
    if (scope === "selected") {
      const set = new Set(selectedSkus);
      return products.filter((p) => set.has(p.sku));
    }
    if (scope === "filtered") {
      return filteredProducts;
    }
    return products;
  }, [scope, products, filteredProducts, selectedSkus]);

  // Compute live preview of modifications
  const previewItems = useMemo<PreviewItem[]>(() => {
    if (targetProducts.length === 0) return [];

    const results: PreviewItem[] = [];

    for (const prod of targetProducts) {
      let attrs: any = {};
      try {
        attrs = typeof prod.attributes === "string" ? JSON.parse(prod.attributes || "{}") : (prod.attributes || {});
      } catch {
        attrs = {};
      }

      let oldValue = "";
      let newValue = "";
      let updatedProd = { ...prod };

      if (field === "vpc_supplier") {
        if (!selectedSupplier) continue;
        const currentSuppliers = attrs.vpc && typeof attrs.vpc === "object" ? Object.keys(attrs.vpc) : [];
        if (!currentSuppliers.includes(selectedSupplier)) continue;

        oldValue = selectedSupplier;
        newValue = newSupplierName.trim();
        if (!newValue || oldValue === newValue) continue;

        const newVpc = { ...attrs.vpc };
        newVpc[newValue] = newVpc[selectedSupplier];
        delete newVpc[selectedSupplier];
        attrs.vpc = newVpc;
        updatedProd.attributes = JSON.stringify(attrs);
      } else {
        // Read current value according to target field
        if (field === "category") oldValue = prod.category || "";
        else if (field === "sub_category") oldValue = prod.sub_category || "";
        else if (field === "brand") oldValue = prod.brand || "";
        else if (field === "location") oldValue = prod.location || "";
        else if (field === "label") oldValue = prod.label || "";
        else if (field === "notes") oldValue = attrs.notes || "";

        // Compute new value
        if (mode === "set_value") {
          newValue = fixedValue.trim();
        } else if (mode === "replace_text") {
          if (!searchPattern) continue;
          if (exactMatch) {
            if (caseSensitive ? oldValue === searchPattern : oldValue.toLowerCase() === searchPattern.toLowerCase()) {
              newValue = replacePattern;
            } else {
              newValue = oldValue;
            }
          } else {
            const flags = caseSensitive ? "g" : "gi";
            const escaped = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(escaped, flags);
            newValue = oldValue.replace(regex, replacePattern);
          }
        }

        if (oldValue === newValue) continue;

        // Apply to updatedProd
        if (field === "category") updatedProd.category = newValue;
        else if (field === "sub_category") updatedProd.sub_category = newValue;
        else if (field === "brand") updatedProd.brand = newValue;
        else if (field === "location") updatedProd.location = newValue;
        else if (field === "label") updatedProd.label = newValue;
        else if (field === "notes") {
          attrs.notes = newValue;
          updatedProd.attributes = JSON.stringify(attrs);
        }
      }

      results.push({
        sku: prod.sku,
        label: prod.label,
        oldValue,
        newValue,
        originalProduct: prod,
        updatedProduct: updatedProd,
      });
    }

    return results;
  }, [
    targetProducts,
    field,
    mode,
    fixedValue,
    searchPattern,
    replacePattern,
    caseSensitive,
    exactMatch,
    selectedSupplier,
    newSupplierName,
  ]);

  if (!isOpen) return null;

  const handleApply = async () => {
    if (!config || previewItems.length === 0) return;
    const confirmText = `Confirmez-vous la modification de ${previewItems.length} référence(s) ? Cette action enregistrera les modifications et mettra à jour l'historique d'audit.`;
    if (!window.confirm(confirmText)) return;

    setIsApplying(true);
    setErrorMsg(null);
    setProgress({ done: 0, total: previewItems.length });

    try {
      let count = 0;
      for (const item of previewItems) {
        const p = item.updatedProduct;
        let attributesObj = {};
        try {
          attributesObj = typeof p.attributes === "string" ? JSON.parse(p.attributes || "{}") : p.attributes || {};
        } catch {
          attributesObj = {};
        }

        await invoke("create_product", {
          networkPath: config.network_path,
          trigramme: config.trigramme,
          sku: p.sku,
          mpn: p.mpn || p.sku,
          label: p.label,
          brand: p.brand,
          category: p.category,
          subCategory: p.sub_category,
          location: p.location,
          itemType: p.item_type,
          minStock: p.min_stock,
          price: p.price,
          imagePath: p.image_path,
          pdfPath: p.pdf_path,
          attributes: attributesObj,
          packSize: p.pack_size,
        });

        count++;
        setProgress({ done: count, total: previewItems.length });
      }

      await onComplete();
      onClose();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Erreur lors de l'application : ${err.message || String(err)}`);
    } finally {
      setIsApplying(false);
      setProgress(null);
    }
  };

  const getDatalistOptions = () => {
    if (field === "category") return existingCategories;
    if (field === "sub_category") return existingSubCategories;
    if (field === "brand") return existingBrands;
    if (field === "location") return existingLocations;
    return [];
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "80vw", maxWidth: "900px", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.25rem" }}>✏️</span>
            <h3 style={{ margin: 0 }}>Modification & Renommage en lot</h3>
          </div>
          <button className="modal-close" onClick={onClose} disabled={isApplying}>
            ×
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "1.25rem", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {errorMsg && (
            <div style={{ padding: "0.75rem", backgroundColor: "var(--danger-light)", color: "var(--danger)", borderRadius: "6px", fontSize: "13px" }}>
              {errorMsg}
            </div>
          )}

          {/* Section 1: Scope */}
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>
              1. Périmètre des articles à modifier
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className={`btn ${scope === "selected" ? "" : "btn-secondary"}`}
                style={{ fontSize: "12px", padding: "0.4rem 0.8rem", opacity: selectedSkus.length === 0 ? 0.5 : 1 }}
                onClick={() => setScope("selected")}
                disabled={selectedSkus.length === 0 || isApplying}
              >
                ☑️ Articles cochés ({selectedSkus.length})
              </button>
              <button
                type="button"
                className={`btn ${scope === "filtered" ? "" : "btn-secondary"}`}
                style={{ fontSize: "12px", padding: "0.4rem 0.8rem" }}
                onClick={() => setScope("filtered")}
                disabled={isApplying}
              >
                🔍 Articles filtrés ({filteredProducts.length})
              </button>
              <button
                type="button"
                className={`btn ${scope === "all" ? "" : "btn-secondary"}`}
                style={{ fontSize: "12px", padding: "0.4rem 0.8rem" }}
                onClick={() => setScope("all")}
                disabled={isApplying}
              >
                📦 Tout l'inventaire ({products.length})
              </button>
            </div>
          </div>

          {/* Section 2: Field & Mode */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>
                2. Champ à modifier
              </label>
              <select
                value={field}
                onChange={(e) => {
                  setField(e.target.value as EditField);
                  setFixedValue("");
                }}
                disabled={isApplying}
                style={{ width: "100%", padding: "0.5rem" }}
              >
                <option value="category">📁 Famille</option>
                <option value="sub_category">📂 Sous-famille</option>
                <option value="brand">🏷️ Marque</option>
                <option value="location">📍 Emplacement</option>
                <option value="label">📝 Désignation (Description)</option>
                <option value="vpc_supplier">🏢 Fournisseur VPC (RS, Farnell, Mouser...)</option>
                <option value="notes">📌 Notes / Remarques</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>
                3. Type d'opération
              </label>
              {field === "vpc_supplier" ? (
                <div style={{ padding: "0.5rem", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Renommage du nom du fournisseur dans les références VPC
                </div>
              ) : (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className={`btn ${mode === "set_value" ? "" : "btn-secondary"}`}
                    style={{ flex: 1, fontSize: "11px", padding: "0.45rem" }}
                    onClick={() => setMode("set_value")}
                    disabled={isApplying}
                  >
                    ✏️ Valeur fixe
                  </button>
                  <button
                    type="button"
                    className={`btn ${mode === "replace_text" ? "" : "btn-secondary"}`}
                    style={{ flex: 1, fontSize: "11px", padding: "0.45rem" }}
                    onClick={() => setMode("replace_text")}
                    disabled={isApplying}
                  >
                    🔍 Rechercher / Remplacer
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Operation Parameters */}
          <div style={{ padding: "1rem", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
            {field === "vpc_supplier" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", marginBottom: "0.3rem" }}>
                    Fournisseur existant à renommer :
                  </label>
                  <select
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    disabled={isApplying}
                    style={{ width: "100%", padding: "0.4rem" }}
                  >
                    <option value="">-- Choisir un fournisseur --</option>
                    {existingSuppliers.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", marginBottom: "0.3rem" }}>
                    Nouveau nom du fournisseur :
                  </label>
                  <input
                    type="text"
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="Ex: RS Components"
                    disabled={isApplying}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              </div>
            ) : mode === "set_value" ? (
              <div>
                <label style={{ display: "block", fontSize: "12px", marginBottom: "0.3rem" }}>
                  Nouvelle valeur à appliquer à tous les articles du périmètre :
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    list="batch-edit-suggestions"
                    value={fixedValue}
                    onChange={(e) => setFixedValue(e.target.value)}
                    placeholder={`Entrez ou sélectionnez une valeur pour ${field}...`}
                    disabled={isApplying}
                    style={{ flex: 1, padding: "0.4rem" }}
                  />
                  <datalist id="batch-edit-suggestions">
                    {getDatalistOptions().map((opt) => (
                      <option key={opt} value={opt} />
                    ))}
                  </datalist>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "0.6rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", marginBottom: "0.3rem" }}>
                      Terme / Texte à rechercher :
                    </label>
                    <input
                      type="text"
                      value={searchPattern}
                      onChange={(e) => setSearchPattern(e.target.value)}
                      placeholder="Ex: Vanne 2 voies..."
                      disabled={isApplying}
                      style={{ width: "100%", padding: "0.4rem" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", marginBottom: "0.3rem" }}>
                      Remplacer par :
                    </label>
                    <input
                      type="text"
                      value={replacePattern}
                      onChange={(e) => setReplacePattern(e.target.value)}
                      placeholder="Ex: Électrovanne 2/2..."
                      disabled={isApplying}
                      style={{ width: "100%", padding: "0.4rem" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "1.5rem", fontSize: "12px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={caseSensitive}
                      onChange={(e) => setCaseSensitive(e.target.checked)}
                      disabled={isApplying}
                    />
                    Respecter la casse (majuscule / minuscule)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={exactMatch}
                      onChange={(e) => setExactMatch(e.target.checked)}
                      disabled={isApplying}
                    />
                    Correspondance exacte du champ complet
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Live Preview Table */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "220px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <label style={{ fontWeight: 600, fontSize: "13px" }}>
                4. Aperçu des modifications ({previewItems.length} article(s) à modifier sur {targetProducts.length} analysé(s))
              </label>
              {previewItems.length > 0 && (
                <span className="badge" style={{ backgroundColor: "var(--accent-light)", color: "var(--accent)" }}>
                  {previewItems.length} impacté(s)
                </span>
              )}
            </div>

            <div
              style={{
                flex: 1,
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                overflowY: "auto",
                maxHeight: "240px",
                backgroundColor: "var(--bg-primary)",
              }}
            >
              {previewItems.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                  Aucune modification détectée avec les paramètres actuels.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead style={{ position: "sticky", top: 0, backgroundColor: "var(--bg-secondary)", zIndex: 2 }}>
                    <tr>
                      <th style={{ padding: "6px 8px", textAlign: "left", width: "120px" }}>SKU</th>
                      <th style={{ padding: "6px 8px", textAlign: "left" }}>Désignation</th>
                      <th style={{ padding: "6px 8px", textAlign: "left", width: "180px" }}>Valeur actuelle</th>
                      <th style={{ padding: "6px 4px", textAlign: "center", width: "24px" }}>➔</th>
                      <th style={{ padding: "6px 8px", textAlign: "left", width: "180px" }}>Nouvelle valeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewItems.slice(0, 100).map((item) => (
                      <tr key={item.sku} style={{ borderBottom: "1px solid var(--border-color)" }}>
                        <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                          {item.sku}
                        </td>
                        <td style={{ padding: "5px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px" }}>
                          {item.label}
                        </td>
                        <td style={{ padding: "5px 8px", color: "var(--danger)", textDecoration: "line-through" }}>
                          {item.oldValue || <span style={{ opacity: 0.5, fontStyle: "italic" }}>(vide)</span>}
                        </td>
                        <td style={{ padding: "5px 4px", textAlign: "center", color: "var(--accent)" }}>➔</td>
                        <td style={{ padding: "5px 8px", color: "var(--success)", fontWeight: 600 }}>
                          {item.newValue || <span style={{ opacity: 0.5, fontStyle: "italic" }}>(vide)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {previewItems.length > 100 && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                * Affichage des 100 premiers aperçus sur {previewItems.length} total.
              </span>
            )}
          </div>

          {/* Progress Indicator */}
          {progress && (
            <div style={{ marginTop: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "0.25rem" }}>
                <span>Application en cours...</span>
                <span>
                  {progress.done} / {progress.total} ({Math.round((progress.done / progress.total) * 100)}%)
                </span>
              </div>
              <div style={{ width: "100%", height: "8px", backgroundColor: "var(--bg-tertiary)", borderRadius: "4px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                    height: "100%",
                    backgroundColor: "var(--accent)",
                    transition: "width 0.15s ease",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isApplying}>
            Annuler
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleApply}
            disabled={previewItems.length === 0 || isApplying}
            style={{ minWidth: "180px" }}
          >
            {isApplying ? "Application..." : `Appliquer (${previewItems.length} modifs)`}
          </button>
        </div>
      </div>
    </div>
  );
};
