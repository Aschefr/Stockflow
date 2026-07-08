import React, { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { type AutoFillSelections } from "./ScrapeComponents";

interface AppConfig {
  trigramme: string;
  network_path: string;
  vpc_sites: string[];
}

interface ProductFormData {
  sku: string;
  mpn: string;
  label: string;
  brand: string;
  category: string;
  sub_category: string;
  location: string;
  min_stock: string | number;
  price: string | number;
  pack_size: string | number;
  attributes: string;
  largeur: string;
  hauteur: string;
  profondeur: string;
  poids: string;
  notes: string;
  initial_stock?: string;
}

interface ProductFormProps {
  mode: "create" | "edit";
  productData: ProductFormData;
  setProductData: React.Dispatch<React.SetStateAction<any>>;
  vpcSite: string;
  vpcCode: string;
  setVpcSite: (v: string) => void;
  setVpcCode: (v: string) => void;
  config: AppConfig | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;

  // Scraping props
  autofillType: string;
  setAutofillType: (v: string) => void;
  autofillCodeInput: string;
  setAutofillCodeInput: (v: string) => void;
  scrapeZoneLoading: boolean;
  onScrape: (isEdit: boolean) => void;
  onOpenAutoFill: (sku: string, isEdit: boolean) => void;
  autoFillSource: string | null;
  autoFillFallbackInfo: string | null;
  autoFillChanges: AutoFillSelections | null;

  // Feedback states
  successMessage: string;
  errorMessage: string;
  duplicateWarning?: string;
  onChangeSku?: (sku: string) => void;
}

export function ProductForm({
  mode,
  productData,
  setProductData,
  vpcSite,
  vpcCode,
  setVpcSite,
  setVpcCode,
  config,
  onSubmit,
  onClose,
  autofillType,
  setAutofillType,
  autofillCodeInput,
  setAutofillCodeInput,
  scrapeZoneLoading,
  onScrape,
  onOpenAutoFill,
  autoFillSource,
  autoFillFallbackInfo,
  autoFillChanges,
  successMessage,
  errorMessage,
  duplicateWarning,
  onChangeSku,
}: ProductFormProps) {
  const isEdit = mode === "edit";
  const [candidates, setCandidates] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"general" | "media">("general");
  const [activeImages, setActiveImages] = useState<string[]>([]);
  const [activePdfs, setActivePdfs] = useState<string[]>([]);
  const [importingMedia, setImportingMedia] = useState(false);
  const [inlineConfirmMedia, setInlineConfirmMedia] = useState<{ type: "image" | "pdf"; path: string } | null>(null);

  const loadMedia = async () => {
    if (isEdit && productData.sku && config) {
      try {
        const imgs: string[] = await invoke("list_sku_images", {
          networkPath: config.network_path,
          sku: productData.sku.toUpperCase(),
        });
        setActiveImages(imgs);
        const pdfs: string[] = await invoke("list_sku_pdfs", {
          networkPath: config.network_path,
          sku: productData.sku.toUpperCase(),
        });
        setActivePdfs(pdfs);
      } catch (err) {
        console.error("Error loading media in form:", err);
      }
    }
  };

  useEffect(() => {
    if (isEdit && productData.sku) {
      invoke("get_scrape_candidates", { sku: productData.sku.toUpperCase() })
        .then((res: any) => {
          if (res) {
            setCandidates(res);
          }
        })
        .catch((err) => console.error("Error loading candidates:", err));
      loadMedia();
    }
  }, [isEdit, productData.sku]);

  const handleImportImage = async (url: string) => {
    if (!config || !productData.sku) return;
    try {
      setImportingMedia(true);
      await invoke("save_selected_images", {
        sku: productData.sku.toUpperCase(),
        urls: [url],
        networkPath: config.network_path,
      });
      await loadMedia();
    } catch (err: any) {
      console.error("Error importing image:", err);
      alert("Erreur d'importation : " + err.toString());
    } finally {
      setImportingMedia(false);
    }
  };

  const handleImportPdf = async (url: string) => {
    if (!config || !productData.sku) return;
    try {
      setImportingMedia(true);
      await invoke("save_selected_pdf", {
        sku: productData.sku.toUpperCase(),
        url: url,
        networkPath: config.network_path,
        trigramme: config.trigramme,
        docType: "datasheet"
      });
      await loadMedia();
    } catch (err: any) {
      console.error("Error importing PDF:", err);
      alert("Erreur d'importation : " + err.toString());
    } finally {
      setImportingMedia(false);
    }
  };

  const handleDeleteMedia = async (mediaType: "image" | "pdf", path: string) => {
    if (!config || !productData.sku) return;
    try {
      setImportingMedia(true);
      await invoke("delete_media", {
        networkPath: config.network_path,
        trigramme: config.trigramme,
        sku: productData.sku.toUpperCase(),
        mediaType,
        path
      });
      setInlineConfirmMedia(null);
      await loadMedia();
    } catch (err: any) {
      console.error("Error deleting media:", err);
    } finally {
      setImportingMedia(false);
    }
  };

  function renderFieldCandidates(
    fieldName: string,
    candidatesList: any[] | undefined,
    onSelectCandidate: (val: any) => void
  ) {
    if (!isEdit || !candidatesList || candidatesList.length === 0) return null;
    return (
      <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" }}>
        <span style={{ fontSize: "10px", color: "var(--text-tertiary)", fontWeight: "600", marginRight: "0.2rem" }}>Scrapé :</span>
        {candidatesList.slice(0, 3).map((c, idx) => {
          let displayVal = "";
          if (fieldName === "price") {
            displayVal = c.value?.price !== undefined ? `${c.value.price} €` : "";
          } else if (fieldName === "dimensions") {
            const w = c.value?.width || "";
            const h = c.value?.height || "";
            const d = c.value?.depth || "";
            displayVal = w || h || d ? `${w || "?"}x${h || "?"}x${d || "?"}` : "";
          } else {
            displayVal = String(c.value || c.display || "");
          }
          
          let isCurrent = false;
          const currentValStr = String(productData[fieldName as keyof ProductFormData] || "").trim().toLowerCase();
          const candidateValStr = String(c.value || c.display || "").trim().toLowerCase();
          
          if (fieldName === "price") {
            const currentPriceNum = parseFloat(String(productData.price).replace(",", "."));
            const candPrice = c.value?.price;
            isCurrent = candPrice !== undefined && Math.abs(currentPriceNum - candPrice) < 0.01;
          } else if (fieldName === "dimensions") {
            const currentL = String(productData.largeur || "").trim().replace(",", ".");
            const currentH = String(productData.hauteur || "").trim().replace(",", ".");
            const currentP = String(productData.profondeur || "").trim().replace(",", ".");
            const candL = String(c.value?.width || "").trim().replace(",", ".");
            const candH = String(c.value?.height || "").trim().replace(",", ".");
            const candP = String(c.value?.depth || "").trim().replace(",", ".");
            isCurrent = currentL === candL && currentH === candH && currentP === candP && currentL !== "";
          } else {
            isCurrent = currentValStr === candidateValStr && currentValStr !== "";
          }

          if (isCurrent) {
            return (
              <span
                key={idx}
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  backgroundColor: "rgba(16, 185, 129, 0.15)",
                  color: "var(--success)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  borderRadius: "4px",
                  fontWeight: "500",
                }}
              >
                ✓ {displayVal}
              </span>
            );
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectCandidate(c)}
              title={c.confidence !== undefined && c.source?.provider ? `Confiance: ${Math.round(c.confidence * 100)}% (${c.source.provider})` : ""}
              style={{
                fontSize: "10px",
                padding: "2px 6px",
                backgroundColor: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "500",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.backgroundColor = "rgba(99, 102, 241, 0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-color)";
                e.currentTarget.style.color = "var(--text-secondary)";
                e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
              }}
            >
              ✨ {displayVal}
            </button>
          );
        })}
      </div>
    );
  }

  const renderMediaTab = () => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingBottom: "1rem" }}>
        {importingMedia && (
          <div style={{ padding: "0.5rem", backgroundColor: "rgba(99, 102, 241, 0.1)", borderRadius: "4px", color: "var(--accent)", fontSize: "12px", textAlign: "center", fontWeight: "600" }}>
            ⏳ Synchronisation des médias en cours...
          </div>
        )}
        
        {/* IMAGES */}
        <div className="modal-field-group">
          <div className="modal-field-group-title">📸 Images du Produit</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {/* Active images */}
            <div style={{ borderRight: "1px solid var(--border-color)", paddingRight: "1rem" }}>
              <h4 style={{ fontSize: "12px", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>Images Importées ({activeImages.length})</h4>
              {activeImages.length === 0 ? (
                <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontStyle: "italic" }}>Aucune image importée.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {activeImages.map((path, idx) => {
                    const fullUrl = convertFileSrc(`${config?.network_path}/${path}`.replace(/\\/g, "/"));
                    const isDeleting = inlineConfirmMedia?.type === "image" && inlineConfirmMedia.path === path;
                    return (
                      <div key={idx} style={{ position: "relative", width: "80px", height: "80px", border: "1px solid var(--border-color)", borderRadius: "4px", overflow: "hidden" }}>
                        <img src={fullUrl} alt="imported" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        {isDeleting ? (
                          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteMedia("image", path)}
                              style={{ backgroundColor: "var(--danger)", color: "#fff", border: "none", borderRadius: "3px", padding: "2px 4px", fontSize: "9px", cursor: "pointer", fontWeight: "bold" }}
                            >Confirmer</button>
                            <button
                              type="button"
                              onClick={() => setInlineConfirmMedia(null)}
                              style={{ backgroundColor: "#4b5563", color: "#fff", border: "none", borderRadius: "3px", padding: "2px 4px", fontSize: "9px", cursor: "pointer" }}
                            >Annuler</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setInlineConfirmMedia({ type: "image", path })}
                            style={{ position: "absolute", top: "2px", right: "2px", backgroundColor: "rgba(239, 68, 68, 0.8)", color: "#fff", border: "none", borderRadius: "50%", width: "16px", height: "16px", cursor: "pointer", fontSize: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}
                            title="Supprimer"
                          >✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Candidate images */}
            <div>
              <h4 style={{ fontSize: "12px", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>Images candidates disponibles</h4>
              {(!candidates || !candidates.image_candidates || candidates.image_candidates.length === 0) ? (
                <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontStyle: "italic" }}>Aucune image candidate trouvée.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {candidates.image_candidates.slice(0, 8).map((img: any, idx: number) => {
                    const isImported = activeImages.some(ai => ai.toLowerCase().includes(img.url.split('/').pop()?.split('?')[0]?.toLowerCase() || "___"));
                    
                    return (
                      <div key={idx} style={{ position: "relative", width: "80px", height: "80px", border: "1px solid var(--border-color)", borderRadius: "4px", overflow: "hidden", opacity: isImported ? 0.6 : 1 }}>
                        <img
                          src={img.url}
                          alt="candidate"
                          style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "pointer" }}
                          onClick={() => openPath(img.url).catch(err => console.error("Error opening URL:", err))}
                          title="Clic pour ouvrir"
                        />
                        {!isImported ? (
                          <button
                            type="button"
                            onClick={() => handleImportImage(img.url)}
                            style={{ position: "absolute", bottom: "2px", right: "2px", backgroundColor: "var(--accent)", color: "#fff", border: "none", borderRadius: "3px", padding: "2px 4px", cursor: "pointer", fontSize: "8px", fontWeight: "bold" }}
                            title="Importer"
                          >➕ Importer</button>
                        ) : (
                          <span style={{ position: "absolute", top: "2px", right: "2px", backgroundColor: "var(--success)", color: "#fff", borderRadius: "50%", width: "14px", height: "14px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px" }}>✓</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* DOCUMENTS PDF */}
        <div className="modal-field-group">
          <div className="modal-field-group-title">📄 Documents PDF / Notices</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {/* Active PDFs */}
            <div style={{ borderRight: "1px solid var(--border-color)", paddingRight: "1rem" }}>
              <h4 style={{ fontSize: "12px", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>Notices Importées ({activePdfs.length})</h4>
              {activePdfs.length === 0 ? (
                <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontStyle: "italic" }}>Aucune notice importée.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  {activePdfs.map((path, idx) => {
                    const isDeleting = inlineConfirmMedia?.type === "pdf" && inlineConfirmMedia.path === path;
                    const name = path.split('/').pop() || "";
                    return (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "var(--bg-secondary)", padding: "4px 8px", borderRadius: "4px", border: "1px solid var(--border-color)" }}>
                        <span style={{ fontSize: "11px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", flex: 1 }} title={name}>{name}</span>
                        {isDeleting ? (
                          <div style={{ display: "flex", gap: "0.3rem" }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteMedia("pdf", path)}
                              style={{ backgroundColor: "var(--danger)", color: "#fff", border: "none", borderRadius: "3px", padding: "2px 4px", fontSize: "9px", cursor: "pointer", fontWeight: "bold" }}
                            >Confirmer</button>
                            <button
                              type="button"
                              onClick={() => setInlineConfirmMedia(null)}
                              style={{ backgroundColor: "transparent", color: "var(--text-secondary)", border: "none", fontSize: "9px", cursor: "pointer" }}
                            >Annuler</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setInlineConfirmMedia({ type: "pdf", path })}
                            style={{ backgroundColor: "transparent", color: "var(--danger)", border: "none", cursor: "pointer", fontSize: "12px", padding: "0 4px" }}
                            title="Supprimer"
                          >✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Candidate PDFs */}
            <div>
              <h4 style={{ fontSize: "12px", marginBottom: "0.5rem", color: "var(--text-secondary)" }}>Notices candidates disponibles</h4>
              {(!candidates || !candidates.pdf_candidates || candidates.pdf_candidates.length === 0) ? (
                <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontStyle: "italic" }}>Aucune notice candidate trouvée.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  {candidates.pdf_candidates.slice(0, 5).map((pdf: any, idx: number) => {
                    const isImported = activePdfs.some(ap => ap.toLowerCase().includes(pdf.url.split('/').pop()?.split('?')[0]?.toLowerCase() || "___"));
                    
                    return (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "var(--bg-secondary)", padding: "4px 8px", borderRadius: "4px", border: "1px solid var(--border-color)", opacity: isImported ? 0.6 : 1 }}>
                        <a href={pdf.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "11px", textDecoration: "none", color: "var(--primary-color)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", flex: 1 }} title={pdf.title || pdf.url}>
                          📄 {pdf.title || "Fiche Technique"}
                        </a>
                        {!isImported ? (
                          <button
                            type="button"
                            onClick={() => handleImportPdf(pdf.url)}
                            style={{ backgroundColor: "var(--accent)", color: "#fff", border: "none", borderRadius: "3px", padding: "2px 6px", cursor: "pointer", fontSize: "9px", fontWeight: "600" }}
                          >➕ Importer</button>
                        ) : (
                          <span style={{ fontSize: "10px", color: "var(--success)", fontWeight: "600" }}>✓ Importé</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  function cleanNumericInput(value: string): string {
    let cleaned = value.replace(/\./g, ",");
    cleaned = cleaned.replace(/[^0-9,-]/g, "");
    return cleaned;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <h3>{isEdit ? `Modifier le SKU : ${productData.sku}` : "Ajouter un nouveau SKU"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal-body">
            {successMessage && (
              <div
                className="wizard-error"
                style={{
                  color: "var(--success)",
                  backgroundColor: "var(--success-light)",
                  borderColor: "rgba(16,185,129,0.2)",
                }}
              >
                {successMessage}
              </div>
            )}
            {errorMessage && <div className="wizard-error">{errorMessage}</div>}
            {duplicateWarning && (
              <div
                className="wizard-error"
                style={{
                  color: "var(--warning)",
                  backgroundColor: "var(--warning-light)",
                  borderColor: "rgba(245,158,11,0.2)",
                }}
              >
                {duplicateWarning}
              </div>
            )}

            {isEdit && (
              <div className="modal-tabs" style={{ display: "flex", gap: "1rem", borderBottom: "1px solid var(--border-color)", marginBottom: "1rem" }}>
                <button
                  type="button"
                  className={`modal-tab-btn ${activeTab === "general" ? "active" : ""}`}
                  onClick={() => setActiveTab("general")}
                  style={{
                    padding: "0.5rem 1rem",
                    border: "none",
                    background: "none",
                    borderBottom: activeTab === "general" ? "2px solid var(--accent)" : "2px solid transparent",
                    color: activeTab === "general" ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >
                  📝 Général
                </button>
                <button
                  type="button"
                  className={`modal-tab-btn ${activeTab === "media" ? "active" : ""}`}
                  onClick={() => setActiveTab("media")}
                  style={{
                    padding: "0.5rem 1rem",
                    border: "none",
                    background: "none",
                    borderBottom: activeTab === "media" ? "2px solid var(--accent)" : "2px solid transparent",
                    color: activeTab === "media" ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >
                  🖼️ Médias & Documents
                </button>
              </div>
            )}

            {(!isEdit || activeTab === "general") ? (
              <>
                {/* Auto-remplissage rapide */}
                <div className="autofill-box">
              <div style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-secondary)" }}>
                🚀 Auto-remplissage rapide
              </div>
              <div className="autofill-box-row">
                <select
                  id="modal-autofill-type"
                  value={autofillType}
                  onChange={(e) => setAutofillType(e.target.value)}
                >
                  <option value="mpn">Référence fabricant (MPN)</option>
                  {config?.vpc_sites?.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  id="modal-autofill-code"
                  type="text"
                  placeholder="Saisir la référence / le code..."
                  value={autofillCodeInput}
                  onChange={(e) => setAutofillCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onScrape(isEdit);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={scrapeZoneLoading}
                  onClick={() => onScrape(isEdit)}
                >
                  {scrapeZoneLoading ? "⏳ ..." : "🔍 Scraper"}
                </button>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    flex: 1,
                    fontSize: "12px",
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    backgroundColor: "rgba(99, 102, 241, 0.15)",
                    border: "1px solid rgba(99, 102, 241, 0.3)",
                    color: "var(--primary-color)",
                  }}
                  onClick={() => onOpenAutoFill(productData.sku, isEdit)}
                >
                  ✨ Auto-remplissage (Candidats)
                </button>
              </div>
            </div>

            {autoFillSource && (
              <div className="autofill-source-info">
                🌐 Source détectée :{" "}
                <a href={autoFillSource} target="_blank" rel="noopener noreferrer">
                  {autoFillSource}
                </a>
              </div>
            )}
            {autoFillFallbackInfo && (
              <div className="autofill-fallback-message">
                ⚠️ {autoFillFallbackInfo}
              </div>
            )}

            {autoFillChanges && (
              <div className="autofill-changes-box">
                <div className="autofill-changes-title">
                  📋 Modifications à appliquer
                </div>
                <div className="autofill-changes-list">
                  {autoFillChanges.label && (
                    <span>
                      🏷️ Désignation → <strong>{autoFillChanges.label}</strong>
                    </span>
                  )}
                  {autoFillChanges.brand && (
                    <span>
                      🏭 Marque → <strong>{autoFillChanges.brand}</strong>
                    </span>
                  )}
                  {autoFillChanges.mpn && (
                    <span>
                      🔢 MPN → <strong>{autoFillChanges.mpn}</strong>
                    </span>
                  )}
                  {autoFillChanges.price !== undefined && (
                    <span>
                      💰 Prix → <strong>{autoFillChanges.price} €</strong>
                    </span>
                  )}
                  {autoFillChanges.largeur && (
                    <span>
                      📐 Dims →{" "}
                      <strong>
                        {autoFillChanges.largeur}×{autoFillChanges.hauteur || "—"}×
                        {autoFillChanges.profondeur || "—"}
                      </strong>
                    </span>
                  )}
                  {autoFillChanges.poids && (
                    <span>
                      ⚖️ Poids → <strong>{autoFillChanges.poids} g</strong>
                    </span>
                  )}
                  {autoFillChanges.image_urls && autoFillChanges.image_urls.length > 0 && (
                    <span>🖼️ {autoFillChanges.image_urls.length} image(s)</span>
                  )}
                </div>
                <div className="autofill-changes-help">
                  Vérifie les champs ci-dessous puis clique sur {isEdit ? '"Enregistrer"' : '"Créer"'} pour enregistrer.
                </div>
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
                    disabled={isEdit}
                    list="skus-datalist"
                    value={productData.sku}
                    onChange={(e) => {
                      if (!isEdit) {
                        const skuVal = e.target.value;
                        if (onChangeSku) {
                          onChangeSku(skuVal);
                        } else {
                          setProductData((prev: any) => ({ ...prev, sku: skuVal }));
                        }
                      }
                    }}
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
                        value={productData.mpn}
                        onChange={(e) => setProductData((prev: any) => ({ ...prev, mpn: e.target.value }))}
                        placeholder="Identique SKU si vide"
                      />
                      {renderFieldCandidates("mpn", candidates?.mpn_candidates, (c) => setProductData((prev: any) => ({ ...prev, mpn: c.value })))}
                    </div>
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
                        value={productData.label}
                        onChange={(e) => setProductData((prev: any) => ({ ...prev, label: e.target.value }))}
                        placeholder="ex: Siemens S7-1500 PS 60W"
                      />
                      {renderFieldCandidates("label", candidates?.label_candidates, (c) => setProductData((prev: any) => ({ ...prev, label: c.value })))}
                    </div>
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
                        value={productData.brand}
                        onChange={(e) => setProductData((prev: any) => ({ ...prev, brand: e.target.value }))}
                        placeholder="ex: Siemens"
                      />
                      {renderFieldCandidates("brand", candidates?.brand_candidates, (c) => setProductData((prev: any) => ({ ...prev, brand: c.value })))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Fournisseur VPC */}
            <div className="modal-field-group">
              <div
                className="modal-field-group-title"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span>2. Fournisseur VPC</span>
              </div>
              <div className="modal-field-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="modal-p-vpc-site">Fournisseur VPC</label>
                  <select id="modal-p-vpc-site" value={vpcSite} onChange={(e) => setVpcSite(e.target.value)}>
                    <option value="">Sélectionner</option>
                    {config?.vpc_sites?.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="modal-p-vpc-code">Code VPC (Catalogue)</label>
                  <input
                    id="modal-p-vpc-code"
                    type="text"
                    placeholder="ex: RS-123-456"
                    value={vpcCode}
                    onChange={(e) => setVpcCode(e.target.value)}
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
                    value={productData.category}
                    onChange={(e) => setProductData((prev: any) => ({ ...prev, category: e.target.value }))}
                    placeholder="ex: Automatisme"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="modal-p-subcat">Sous-Famille (Sans auto-remplissage)</label>
                  <input
                    id="modal-p-subcat"
                    type="text"
                    list={isEdit ? "edit-subcategories-datalist" : "add-subcategories-datalist"}
                    value={productData.sub_category}
                    onChange={(e) => setProductData((prev: any) => ({ ...prev, sub_category: e.target.value }))}
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
                    value={productData.location}
                    onChange={(e) => setProductData((prev: any) => ({ ...prev, location: e.target.value }))}
                    placeholder="ex: MAG-A1-E2-B3"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="modal-p-min">Seuil Alerte Stock</label>
                  <input
                    id="modal-p-min"
                    type="text"
                    list="minstocks-datalist"
                    value={productData.min_stock}
                    onChange={(e) =>
                      setProductData((prev: any) => ({ ...prev, min_stock: cleanNumericInput(e.target.value) }))
                    }
                  />
                </div>
              </div>

              {!isEdit && (
                <div className="modal-field-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label htmlFor="modal-p-initial-stock" style={{ color: "var(--success)", fontWeight: 600 }}>
                      📦 Stock initial (à la création)
                    </label>
                    <input
                      id="modal-p-initial-stock"
                      type="text"
                      placeholder="0"
                      value={productData.initial_stock || ""}
                      onChange={(e) =>
                        setProductData((prev: any) => ({ ...prev, initial_stock: cleanNumericInput(e.target.value) }))
                      }
                      style={{
                        borderColor: Number(productData.initial_stock) > 0 ? "var(--success)" : undefined,
                      }}
                    />
                    {Number(productData.initial_stock) > 0 && (
                      <span style={{ fontSize: "11px", color: "var(--success)", marginTop: "2px", display: "block" }}>
                        Un mouvement d'entrée de {productData.initial_stock} unité(s) sera créé automatiquement.
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="modal-field-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <div className="field-with-autofill">
                    <div style={{ flex: 1 }}>
                      <label htmlFor="modal-p-price">Prix d'Achat (€)</label>
                      <input
                        id="modal-p-price"
                        type="text"
                        list="prices-datalist"
                        value={productData.price}
                        onChange={(e) =>
                          setProductData((prev: any) => ({ ...prev, price: cleanNumericInput(e.target.value) }))
                        }
                      />
                      {renderFieldCandidates("price", candidates?.price_candidates, (c) => setProductData((prev: any) => ({ ...prev, price: (c.value?.price || 0).toString().replace(".", ",") })))}
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ flex: 2 }}>
                  <div className="field-with-autofill">
                    <div style={{ flex: 1 }}>
                      <label htmlFor="modal-p-pack">Taille du Lot (pack)</label>
                      <input
                        id="modal-p-pack"
                        type="text"
                        value={productData.pack_size}
                        onChange={(e) =>
                          setProductData((prev: any) => ({ ...prev, pack_size: cleanNumericInput(e.target.value) }))
                        }
                      />
                      {renderFieldCandidates("pack_size", candidates?.pack_size_candidates, (c) => setProductData((prev: any) => ({ ...prev, pack_size: c.value.toString().replace(".", ",") })))}
                    </div>
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
                        value={productData.largeur}
                        onChange={(e) =>
                          setProductData((prev: any) => ({ ...prev, largeur: cleanNumericInput(e.target.value) }))
                        }
                      />
                    </div>
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
                        value={productData.hauteur}
                        onChange={(e) =>
                          setProductData((prev: any) => ({ ...prev, hauteur: cleanNumericInput(e.target.value) }))
                        }
                      />
                    </div>
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
                        value={productData.profondeur}
                        onChange={(e) =>
                          setProductData((prev: any) => ({ ...prev, profondeur: cleanNumericInput(e.target.value) }))
                        }
                      />
                    </div>
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
                        value={productData.poids}
                        onChange={(e) =>
                          setProductData((prev: any) => ({ ...prev, poids: cleanNumericInput(e.target.value) }))
                        }
                      />
                      {renderFieldCandidates("poids", candidates?.weight_candidates, (c) => setProductData((prev: any) => ({ ...prev, poids: c.value.toString().replace(".", ",") })))}
                    </div>
                  </div>
                </div>
              </div>
              {renderFieldCandidates("dimensions", candidates?.dimension_candidates, (c) => {
                const val = c.value || {};
                setProductData((prev: any) => ({
                  ...prev,
                  largeur: (val.width || "").toString().replace(".", ","),
                  hauteur: (val.height || "").toString().replace(".", ","),
                  profondeur: (val.depth || "").toString().replace(".", ","),
                }));
              })}
            </div>

            {/* 6. Notes / Remarques */}
            <div className="modal-field-group">
              <div className="modal-field-group-title">6. Notes / Remarques</div>
              <div className="modal-field-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label htmlFor="modal-p-notes">Notes / Remarques</label>
                  <textarea
                    id="modal-p-notes"
                    placeholder="Notes de maintenance, observations, etc."
                    value={productData.notes}
                    onChange={(e) => setProductData((prev: any) => ({ ...prev, notes: e.target.value }))}
                    style={{
                      width: "100%",
                      height: "80px",
                      padding: "0.5rem",
                      borderRadius: "4px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-primary)",
                      color: "var(--text-primary)",
                      resize: "vertical",
                      fontSize: "12px",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          renderMediaTab()
        )}
      </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn">
              {isEdit ? "Enregistrer" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
