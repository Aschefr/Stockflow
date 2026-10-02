import React, { useState, useEffect, useMemo } from "react";
import { ScrapeProgressBadge } from "./ScrapeComponents";
import { invoke, isTauri, resolveMediaSrc, preloadImage } from "./services/api";
import { getProductVpcUrl } from "./utils/vpcUtils";

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

interface AppConfig {
  trigramme: string;
  network_path: string;
  vpc_sites: string[];
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

interface ProductDetailPanelProps {
  selectedProduct: Product;
  config: AppConfig | null;
  productImages: string[];
  productPdfs: string[];
  productScreenshotPath: string | null;
  productHistory: ProductHistoryItem[];
  productAuditLog: AuditLogItem[];
  
  // Movement State & triggers
  movementQty: string;
  setMovementQty: (v: string) => void;
  movementNote: string;
  setMovementNote: (v: string) => void;
  movementSuccess: string;
  movementError: string;
  onStockMovement: (type: "STOCK_IN" | "STOCK_OUT") => void;

  // Audit triggers
  onRevertAudit: (item: AuditLogItem) => void;

  // Actions
  onClose: () => void;
  openAutoFillModal: (sku: string, isEdit: boolean) => void;
  onOpenEdit: (tab?: "general" | "images" | "documents") => void;
  onDeleteProduct: () => void;
  onDeleteMedia: (mediaType: "image" | "pdf", filePath: string) => Promise<void>;
  onRenameMedia: (mediaType: "pdf", oldPath: string, newName: string) => Promise<void>;
  onOpenPath: (path: string) => Promise<void>;
  onEnsureDirectory: (path: string) => Promise<void>;
  convertFileSrc: (path: string) => string;

  // Drag & drop props passed down
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

export function ProductDetailPanel({
  selectedProduct,
  config,
  productImages,
  productPdfs,
  productScreenshotPath,
  productHistory,
  productAuditLog,
  movementQty,
  setMovementQty,
  movementNote,
  setMovementNote,
  movementSuccess,
  movementError,
  onStockMovement,
  onRevertAudit,
  onClose,
  openAutoFillModal,
  onOpenEdit,
  onDeleteProduct,
  onDeleteMedia,
  onRenameMedia,
  onOpenPath,
  onEnsureDirectory,
  convertFileSrc,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
}: ProductDetailPanelProps) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [editingPdfPath, setEditingPdfPath] = useState<string | null>(null);
  const [newPdfName, setNewPdfName] = useState("");
  const [inlineConfirm, setInlineConfirm] = useState<{ id: string; action: () => void } | null>(null);

  // Vérifier si des candidats existent pour ce SKU (pour afficher/masquer le bouton)
  const [hasCandidates, setHasCandidates] = useState(false);
  useEffect(() => {
    let isMounted = true;
    setHasCandidates(false);
    if (selectedProduct?.sku) {
      invoke("get_scrape_candidates", { sku: selectedProduct.sku.toUpperCase() })
        .then((res: any) => {
          if (isMounted && res && (res.image_candidates?.length > 0 || res.pdf_candidates?.length > 0 || res.properties)) {
            setHasCandidates(true);
          }
        })
        .catch(() => {});
    }
    return () => { isMounted = false; };
  }, [selectedProduct?.sku]);

  // Fallback interne pour charger les images du SKU si la prop productImages est vide
  const [internalImages, setInternalImages] = useState<string[]>([]);
  useEffect(() => {
    let isMounted = true;
    if (selectedProduct?.sku && productImages.length === 0) {
      invoke<string[]>("list_sku_images", { sku: selectedProduct.sku, networkPath: config?.network_path })
        .then((imgs) => {
          if (isMounted && imgs && imgs.length > 0) {
            setInternalImages(imgs);
          }
        })
        .catch(() => {});
    } else {
      setInternalImages([]);
    }
    return () => { isMounted = false; };
  }, [selectedProduct?.sku, productImages.length, config?.network_path]);

  // Rassembler toutes les images disponibles : dossier réseau, image_path du produit, ou scraping
  const allImages = useMemo(() => {
    const list = [...productImages];
    for (const img of internalImages) {
      if (img && !list.includes(img)) list.push(img);
    }
    if (selectedProduct?.image_path && !list.includes(selectedProduct.image_path)) {
      list.push(selectedProduct.image_path);
    }
    if (selectedProduct?.attributes) {
      try {
        const attrs = typeof selectedProduct.attributes === "string" ? JSON.parse(selectedProduct.attributes) : selectedProduct.attributes;
        if (attrs?.scrape_image_urls && Array.isArray(attrs.scrape_image_urls)) {
          for (const u of attrs.scrape_image_urls) {
            if (u && !list.includes(u)) list.push(u);
          }
        } else if (attrs?.scrape_image_url && !list.includes(attrs.scrape_image_url)) {
          list.push(attrs.scrape_image_url);
        }
      } catch {}
    }
    return list;
  }, [productImages, internalImages, selectedProduct]);

  // Rassembler tous les documents PDF disponibles : dossier réseau/disque local, pdf_path du produit, ou URLs enregistrées/scrapées
  const allPdfs = useMemo(() => {
    const list: Array<{ path: string; isRemote: boolean; title?: string }> = [];
    const seen = new Set<string>();

    for (const pdf of productPdfs) {
      if (pdf && !seen.has(pdf)) {
        seen.add(pdf);
        list.push({
          path: pdf,
          isRemote: pdf.startsWith("http://") || pdf.startsWith("https://")
        });
      }
    }
    if (selectedProduct?.pdf_path && !seen.has(selectedProduct.pdf_path)) {
      const normalizedPdfPath = selectedProduct.pdf_path.replace(/\\/g, "/");
      const alreadyCovered = productPdfs.some(p => {
        const normP = p.replace(/\\/g, "/");
        return normP.startsWith(normalizedPdfPath) || normalizedPdfPath.startsWith(normP);
      });
      if (!alreadyCovered) {
        seen.add(selectedProduct.pdf_path);
        list.push({
          path: selectedProduct.pdf_path,
          isRemote: selectedProduct.pdf_path.startsWith("http://") || selectedProduct.pdf_path.startsWith("https://")
        });
      }
    }
    if (selectedProduct?.attributes) {
      try {
        const attrs = typeof selectedProduct.attributes === "string" ? JSON.parse(selectedProduct.attributes) : selectedProduct.attributes;
        if (attrs?.scrape_pdf_urls && Array.isArray(attrs.scrape_pdf_urls)) {
          for (const u of attrs.scrape_pdf_urls) {
            if (u && typeof u === "string" && !seen.has(u)) {
              seen.add(u);
              list.push({ path: u, isRemote: true });
            }
          }
        }
        if (attrs?.scrape_doc_url && typeof attrs.scrape_doc_url === "string" && !seen.has(attrs.scrape_doc_url)) {
          seen.add(attrs.scrape_doc_url);
          list.push({ path: attrs.scrape_doc_url, isRemote: true });
        }
      } catch {}
    }
    return list;
  }, [productPdfs, selectedProduct]);

  const currentImg = allImages[activeImageIndex] || "";
  const [resolvedSrc, setResolvedSrc] = useState<string>("");

  useEffect(() => {
    let isMounted = true;
    if (!currentImg) {
      setResolvedSrc("");
      return;
    }
    resolveMediaSrc(currentImg, config?.network_path)
      .then((url) => {
        if (isMounted) {
          setResolvedSrc(url);
          if (url) preloadImage(url);
        }
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, [currentImg, config?.network_path]);

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

  function cleanNumericInput(value: string): string {
    let cleaned = value.replace(/\./g, ",");
    cleaned = cleaned.replace(/[^0-9,-]/g, "");
    return cleaned;
  }

  const vpcCodeFull = getVpcCode(selectedProduct);
  let vpcUrl = getProductVpcUrl(selectedProduct);
  if (vpcUrl && !vpcUrl.startsWith("http://") && !vpcUrl.startsWith("https://")) {
    vpcUrl = "";
  }
  let vpcSiteName = "VPC";
  let vpcCodeVal = "";

  if (vpcCodeFull) {
    const idx = vpcCodeFull.indexOf(":");
    vpcSiteName = idx !== -1 ? vpcCodeFull.substring(0, idx).trim() : "VPC";
    vpcCodeVal = idx !== -1 ? vpcCodeFull.substring(idx + 1).trim() : vpcCodeFull;

    if (!vpcUrl) {
      vpcUrl = `https://www.google.com/search?q=${encodeURIComponent(vpcCodeFull)}`;
      if (vpcSiteName.toLowerCase() === "rs" || vpcSiteName.toLowerCase().includes("rs component") || vpcSiteName.toLowerCase().includes("rs online")) {
        vpcUrl = `https://fr.rs-online.com/web/c/?searchTerm=${encodeURIComponent(vpcCodeVal)}`;
      } else if (vpcSiteName.toLowerCase().includes("farnell")) {
        vpcUrl = `https://fr.farnell.com/w/c/?st=${encodeURIComponent(vpcCodeVal)}`;
      } else if (vpcSiteName.toLowerCase().includes("mouser")) {
        vpcUrl = `https://www.mouser.fr/Search/Refine?Keyword=${encodeURIComponent(vpcCodeVal)}`;
      }
    }
  }

  const width = getAttribute(selectedProduct, "largeur");
  const height = getAttribute(selectedProduct, "hauteur");
  const depth = getAttribute(selectedProduct, "profondeur");
  const weight = getAttribute(selectedProduct, "poids");
  const tension = getAttribute(selectedProduct, "tension");
  const notes = getAttribute(selectedProduct, "notes");

  const sanitizeHttpUrl = (u: any): string => {
    if (typeof u !== "string") return "";
    const t = u.trim();
    return (t.startsWith("http://") || t.startsWith("https://")) ? t : "";
  };

  const priceUrl = sanitizeHttpUrl(getAttribute(selectedProduct, "scrape_price_url")) || (vpcUrl ? vpcUrl : "");
  const imageUrl = sanitizeHttpUrl(getAttribute(selectedProduct, "scrape_image_url"));
  const docUrl = sanitizeHttpUrl(getAttribute(selectedProduct, "scrape_doc_url"));

  return (
    <aside
      className={`details-panel ${isDragging ? "dragging" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="panel-header">
        <span className="panel-title">Fiche : {selectedProduct.sku}</span>
        <button className="panel-close" onClick={onClose}>×</button>
      </div>

      <div className="panel-content">
        <ScrapeProgressBadge
          sku={selectedProduct.sku}
          onOpenAutoFill={(sku) => openAutoFillModal(sku, true)}
        />

        {/* Image Container / Carousel */}
        <div className="image-preview-container">
          {allImages.length > 0 ? (
            <div className="carousel" style={{ position: "relative", width: "100%", height: "100%" }}>
              <img
                src={resolvedSrc || (allImages[activeImageIndex]?.startsWith("http") || allImages[activeImageIndex]?.startsWith("blob:") ? allImages[activeImageIndex] : (convertFileSrc(allImages[activeImageIndex]) || (config?.network_path ? convertFileSrc(`${config.network_path}/${allImages[activeImageIndex]}`.replace(/\\/g, "/")) : "")))}
                alt={selectedProduct.label}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
              {inlineConfirm?.id === "image-delete" ? (
                <div
                  className="inline-confirm"
                  style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    backgroundColor: "rgba(239, 68, 68, 0.9)",
                    padding: "4px 6px",
                    borderRadius: "4px",
                    zIndex: 10,
                    display: "flex",
                    gap: "6px",
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: "white", fontSize: "11px", fontWeight: "bold" }}>Supprimer ?</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      inlineConfirm.action();
                      setInlineConfirm(null);
                    }}
                    style={{
                      background: "#fff",
                      color: "var(--danger)",
                      border: "none",
                      borderRadius: "3px",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: "bold",
                      padding: "2px 6px",
                    }}
                  >
                    Oui
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setInlineConfirm(null);
                    }}
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      color: "white",
                      border: "none",
                      borderRadius: "3px",
                      cursor: "pointer",
                      fontSize: "11px",
                      padding: "2px 6px",
                    }}
                  >
                    Non
                  </button>
                </div>
              ) : (
                <button
                  className="btn-delete-media"
                  title="Supprimer cette image"
                  style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    backgroundColor: "rgba(239, 68, 68, 0.8)",
                    border: "none",
                    color: "#fff",
                    borderRadius: "4px",
                    padding: "4px 8px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    zIndex: 10,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setInlineConfirm({
                      id: "image-delete",
                      action: async () => {
                        const imgPath = allImages[activeImageIndex];
                        await onDeleteMedia("image", imgPath);
                        setActiveImageIndex(0);
                      },
                    });
                  }}
                >
                  🗑️
                </button>
              )}
              {allImages.length > 1 && (
                <div
                  className="carousel-controls"
                  style={{
                    position: "absolute",
                    bottom: "10px",
                    left: 0,
                    right: 0,
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "0 10px",
                    alignItems: "center",
                  }}
                >
                  <button
                    className="carousel-btn"
                    style={{
                      backgroundColor: "rgba(0,0,0,0.6)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "50%",
                      width: "24px",
                      height: "24px",
                      cursor: "pointer",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveImageIndex((prev) => (prev === 0 ? allImages.length - 1 : prev - 1));
                    }}
                  >
                    ◀
                  </button>
                  <span
                    className="carousel-indicator"
                    style={{
                      backgroundColor: "rgba(0,0,0,0.6)",
                      padding: "2px 6px",
                      borderRadius: "10px",
                      fontSize: "11px",
                      color: "#fff",
                    }}
                  >
                    {activeImageIndex + 1} / {allImages.length}
                  </span>
                  <button
                    className="carousel-btn"
                    style={{
                      backgroundColor: "rgba(0,0,0,0.6)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "50%",
                      width: "24px",
                      height: "24px",
                      cursor: "pointer",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveImageIndex((prev) => (prev === allImages.length - 1 ? 0 : prev + 1));
                    }}
                  >
                    ▶
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-muted)",
                fontSize: "12px",
                border: "2px dashed var(--border-color)",
                borderRadius: "8px",
                padding: "0.8rem",
              }}
            >
              <span>Pas d'image disponible</span>
              <span style={{ fontSize: "10px", marginTop: "4px" }}>Déposez des images ou PDFs ici</span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  fontSize: "10.5px",
                  padding: "0.25rem 0.6rem",
                  marginTop: "8px",
                  color: "var(--accent)",
                  borderColor: "var(--accent)",
                }}
                onClick={() => onOpenEdit("images")}
              >
                ➕ Ajouter ou scraper une image
              </button>
            </div>
          )}
        </div>

        {/* General Metadata */}
        <div>
          <h4 style={{ fontFamily: "var(--font-title)", marginBottom: "0.5rem" }}>{selectedProduct.label}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "12px" }}>
            <div>
              Marque: <strong>{selectedProduct.brand || "Inconnue"}</strong>
            </div>
            <div>
              MPN: <strong>{selectedProduct.mpn}</strong>
            </div>
            <div>
              SKU (Interne): <strong>{selectedProduct.sku}</strong>
            </div>
            <div>
              Type d'article:{" "}
              <strong>{selectedProduct.item_type === "consumable" ? "Consommable" : "Standard"}</strong>
            </div>
            <div>
              Famille: <strong>{selectedProduct.category || "-"}</strong>
            </div>
            <div>
              Sous-Famille: <strong>{selectedProduct.sub_category || "-"}</strong>
            </div>
            <div>
              Emplacement: <strong>{selectedProduct.location || "Non assigné"}</strong>
            </div>
            <div>
              Stock Actuel: <strong>{selectedProduct.current_stock} u</strong>
            </div>
            <div>
              Seuil Alerte: <strong>{selectedProduct.min_stock} u</strong>
            </div>

            {vpcCodeFull && (
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
                    gap: "0.2rem",
                  }}
                  onClick={() => onOpenPath(vpcUrl)}
                >
                  🌐 {vpcSiteName} ({vpcCodeVal})
                </button>
              </div>
            )}

            {(width || height || depth || weight || tension) && (
              <div
                style={{
                  gridColumn: "span 2",
                  borderTop: "1px solid var(--border-color)",
                  paddingTop: "0.4rem",
                  marginTop: "0.4rem",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.3rem",
                }}
              >
                {width && (
                  <div>
                    Largeur: <strong>{width} mm</strong>
                  </div>
                )}
                {height && (
                  <div>
                    Hauteur: <strong>{height} mm</strong>
                  </div>
                )}
                {depth && (
                  <div>
                    Profondeur: <strong>{depth} mm</strong>
                  </div>
                )}
                {weight && (
                  <div>
                    Poids: <strong>{weight} g</strong>
                  </div>
                )}
                {tension && (
                  <div style={{ gridColumn: "span 2" }}>
                    Tension: <strong>{tension}</strong>
                  </div>
                )}
              </div>
            )}

            {notes && (
              <div
                style={{
                  gridColumn: "span 2",
                  borderTop: "1px solid var(--border-color)",
                  paddingTop: "0.4rem",
                  marginTop: "0.4rem",
                }}
              >
                <div style={{ fontWeight: "600", marginBottom: "0.3rem", fontSize: "11px", color: "var(--text-secondary)" }}>
                  📝 Notes / Remarques :
                </div>
                <div style={{ fontSize: "12px", whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{notes}</div>
              </div>
            )}

            <div>
              {selectedProduct.pack_size > 1 ? "Prix du lot: " : "Prix unitaire: "}
              <strong>{selectedProduct.price.toFixed(2)} €</strong>
            </div>
            {selectedProduct.pack_size > 1 && (
              <>
                <div>
                  Taille du lot: <strong>{selectedProduct.pack_size} u</strong>
                </div>
                <div>
                  Prix unitaire: <strong>{(selectedProduct.price / selectedProduct.pack_size).toFixed(4)} €</strong>
                </div>
              </>
            )}
            <div>
              Valeur totale stock:{" "}
              <strong>
                {((selectedProduct.current_stock / (selectedProduct.pack_size || 1)) * selectedProduct.price).toFixed(
                  2
                )}{" "}
                €
              </strong>
            </div>

            {(priceUrl || imageUrl || docUrl) && (
              <div
                style={{
                  gridColumn: "span 2",
                  borderTop: "1px solid var(--border-color)",
                  paddingTop: "0.4rem",
                  marginTop: "0.4rem",
                }}
              >
                <div style={{ fontWeight: "600", marginBottom: "0.3rem", fontSize: "11px", color: "var(--text-secondary)" }}>
                  Sources de scraping :
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "11px" }}>
                  {priceUrl && (
                    <div>
                      💸 Prix :{" "}
                      <button
                        type="button"
                        className="btn-link"
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent)",
                          textDecoration: "underline",
                          cursor: "pointer",
                          padding: 0,
                          font: "inherit",
                        }}
                        onClick={() => onOpenPath(priceUrl)}
                      >
                        Lien source
                      </button>
                      {productScreenshotPath && (
                        <>
                          {" | "}
                          <button
                            type="button"
                            className="btn-link"
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--success)",
                              textDecoration: "underline",
                              cursor: "pointer",
                              padding: 0,
                              font: "inherit",
                            }}
                            onClick={() =>
                              onOpenPath(isTauri() ? `${config?.network_path}/${productScreenshotPath}`.replace(/\//g, "\\") : (productScreenshotPath || ""))
                            }
                            title="Consulter la capture d'écran de la page source"
                          >
                            📸 Capture
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {imageUrl && (
                    <div>
                      🖼️ Image :{" "}
                      <button
                        type="button"
                        className="btn-link"
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent)",
                          textDecoration: "underline",
                          cursor: "pointer",
                          padding: 0,
                          font: "inherit",
                        }}
                        onClick={() => onOpenPath(imageUrl)}
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
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--accent)",
                          textDecoration: "underline",
                          cursor: "pointer",
                          padding: 0,
                          font: "inherit",
                        }}
                        onClick={() => onOpenPath(docUrl)}
                      >
                        Lien source
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {hasCandidates && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            className="btn btn-premium-scrape"
            style={{
              flex: 1,
              padding: "0.4rem 0.8rem",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
            onClick={() => openAutoFillModal(selectedProduct.sku, true)}
            title="Consulter ou appliquer les propositions trouvées par le scraping pour cet article"
          >
            🎯 Revoir les variantes du scraping
          </button>
        </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem", marginBottom: "0.8rem" }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "12px" }}
            onClick={() => onOpenEdit("general")}
          >
            ✏️ Modifier
          </button>

          {inlineConfirm?.id === "product-delete" ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                borderRadius: "6px",
                padding: "0 0.5rem",
              }}
            >
              <span style={{ color: "var(--danger)", fontSize: "12px", fontWeight: "bold" }}>Sûr ?</span>
              <button
                type="button"
                className="btn"
                style={{ background: "var(--danger)", color: "#fff", padding: "0.3rem 0.6rem", fontSize: "12px" }}
                onClick={() => {
                  inlineConfirm.action();
                  setInlineConfirm(null);
                }}
              >
                Oui
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: "var(--bg-lighter)", color: "var(--text-color)", padding: "0.3rem 0.6rem", fontSize: "12px" }}
                onClick={() => setInlineConfirm(null)}
              >
                Non
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger"
              style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "12px", backgroundColor: "var(--danger)" }}
              onClick={() => {
                setInlineConfirm({
                  id: "product-delete",
                  action: onDeleteProduct,
                });
              }}
            >
              🗑️ Supprimer
            </button>
          )}
        </div>

        {/* PDF Document action */}
        <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
            <h4 style={{ fontFamily: "var(--font-title)", fontSize: "12px", margin: 0 }}>Documents PDF</h4>
            <div style={{ display: "flex", gap: "4px" }}>
              {allPdfs.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "0.25rem 0.5rem", fontSize: "10px" }}
                  title="Ouvrir le premier document PDF"
                  onClick={async () => {
                    const firstPdf = allPdfs[0];
                    if (firstPdf) {
                      try {
                        const path = isTauri()
                          ? (firstPdf.path.startsWith("http") ? firstPdf.path : `${config?.network_path}/${firstPdf.path}`.replace(/\//g, "\\"))
                          : firstPdf.path;
                        await onOpenPath(path);
                      } catch (err) {
                        console.warn("Impossible d'ouvrir le document :", err);
                      }
                    }
                  }}
                >
                  📄 Ouvrir ({allPdfs.length})
                </button>
              )}
              {isTauri() && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: "0.25rem 0.5rem", fontSize: "10px" }}
                  title="Ouvrir le dossier dans l'explorateur Windows"
                  onClick={async () => {
                    const sanitize = (name: string): string => {
                      return (name || "").trim().replace(/[\\/:*?"<>|]/g, "-") || "INCONNU";
                    };
                    const sku = sanitize(selectedProduct.sku).replace(/\s+/g, "").toUpperCase();
                    const path = `${config?.network_path}/documents/${sku}`.replace(/\//g, "\\");
                    try {
                      await onEnsureDirectory(path);
                      await onOpenPath(path);
                    } catch (err: any) {
                      console.error(err);
                    }
                  }}
                >
                  📂 Dossier
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "0.25rem 0.5rem", fontSize: "10px" }}
                title="Gérer ou ajouter des documents"
                onClick={() => onOpenEdit("documents")}
              >
                ➕ Gérer
              </button>
            </div>
          </div>
          {allPdfs.length > 0 ? (
            allPdfs.map((pdfItem, idx) => {
              const pdf = pdfItem.path;
              const isRemote = pdfItem.isRemote;
              const rawName = pdf.split("/").pop() || "Notice PDF";
              const fileName = decodeURIComponent(rawName.split("?")[0]);
              const isEditing = editingPdfPath === pdf;

              if (isRemote) {
                return (
                  <div key={idx} style={{ display: "flex", gap: "0.3rem" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        flex: 1,
                        padding: "0.4rem 0.6rem",
                        fontSize: "11px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textAlign: "left",
                        color: "var(--accent)",
                      }}
                      title={pdf}
                      onClick={() => onOpenPath(pdf)}
                    >
                      🌐 {fileName}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      title="Ouvrir dans un nouvel onglet"
                      style={{ padding: "0.4rem 0.5rem", fontSize: "11px", display: "inline-flex", alignItems: "center" }}
                      onClick={() => onOpenPath(pdf)}
                    >
                      🔗
                    </button>
                  </div>
                );
              }

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
                          await onRenameMedia("pdf", pdf, newPdfName);
                          setEditingPdfPath(null);
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
                        style={{
                          flex: 1,
                          padding: "0.4rem 0.6rem",
                          fontSize: "11px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textAlign: "left",
                        }}
                        onClick={() => onOpenPath(isTauri() ? (pdf.startsWith("http") ? pdf : `${config?.network_path}/${pdf}`.replace(/\//g, "\\")) : pdf)}
                      >
                        📄 {fileName}
                      </button>
                      <button
                        className="btn btn-secondary"
                        title="Renommer"
                        style={{ padding: "0.4rem 0.5rem", fontSize: "11px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        onClick={() => {
                          setEditingPdfPath(pdf);
                          setNewPdfName(fileName.replace(/\.pdf$/i, ""));
                        }}
                      >
                        ✏️
                      </button>
                    </>
                  )}
                  {inlineConfirm?.id === `pdf-delete-${fileName}` ? (
                    <div
                      style={{
                        display: "flex",
                        gap: "4px",
                        alignItems: "center",
                        backgroundColor: "rgba(239, 68, 68, 0.9)",
                        padding: "2px 4px",
                        borderRadius: "4px",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ color: "white", fontSize: "10px", fontWeight: "bold" }}>Sûr ?</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          inlineConfirm.action();
                          setInlineConfirm(null);
                        }}
                        style={{
                          background: "#fff",
                          color: "var(--danger)",
                          border: "none",
                          borderRadius: "3px",
                          cursor: "pointer",
                          fontSize: "10px",
                          fontWeight: "bold",
                          padding: "2px 6px",
                        }}
                      >
                        Oui
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setInlineConfirm(null);
                        }}
                        style={{
                          background: "rgba(0,0,0,0.3)",
                          color: "white",
                          border: "none",
                          borderRadius: "3px",
                          cursor: "pointer",
                          fontSize: "10px",
                          padding: "2px 6px",
                        }}
                      >
                        Non
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-danger"
                      title="Supprimer cette notice"
                      style={{
                        backgroundColor: "var(--danger)",
                        color: "#fff",
                        padding: "0 0.5rem",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setInlineConfirm({
                          id: `pdf-delete-${fileName}`,
                          action: () => onDeleteMedia("pdf", pdf),
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
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                textAlign: "center",
                padding: "0.6rem 0.5rem",
                border: "1px dashed var(--border-color)",
                borderRadius: "6px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>Aucune fiche technique PDF associée.</span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  fontSize: "10.5px",
                  padding: "0.25rem 0.6rem",
                  color: "var(--accent)",
                  borderColor: "var(--accent)",
                }}
                onClick={() => onOpenEdit("documents")}
              >
                ➕ Ajouter ou scraper une notice
              </button>
            </div>
          )}
        </div>

        {/* Movement controls */}
        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
          <h4 style={{ fontFamily: "var(--font-title)", marginBottom: "0.8rem" }}>Effectuer un mouvement</h4>
          {movementSuccess && (
            <div
              className="wizard-error"
              style={{
                color: "var(--success)",
                backgroundColor: "var(--success-light)",
                borderColor: "rgba(16,185,129,0.2)",
              }}
            >
              {movementSuccess}
            </div>
          )}
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
              onClick={() => onStockMovement("STOCK_IN")}
            >
              📥 Entrée Stock
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 1, backgroundColor: "var(--danger)" }}
              onClick={() => onStockMovement("STOCK_OUT")}
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
            {(() => {
              const displayAudits = productAuditLog.filter(
                item => !(item.action === "UPDATE" && ["Images", "Documents", "URL document", "URL image", "URL source prix", "Notice principale", "Image principale"].includes(item.field || ""))
              );
              if (displayAudits.length === 0) {
                return (
                  <div style={{ padding: "0.8rem", color: "var(--text-muted)", fontSize: "11px" }}>
                    Aucune modification enregistrée.
                  </div>
                );
              }
              return displayAudits.map((item) => {
                const date = new Date(item.timestamp);
                const dateStr = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
                const timeStr = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

                let badge = "🔵";
                let content: React.ReactNode = "";

                if (item.action === "CREATE") {
                  badge = "🟢";
                  content = <span>Création de la référence{item.field ? ` (${item.field})` : ""}</span>;
                } else if (item.action === "DELETE") {
                  badge = "🔴";
                  content = <span>Référence supprimée</span>;
                } else if (item.action === "UPLOAD_MEDIA") {
                  badge = "📥";
                  const rawPath = item.new_value || item.old_value || "";
                  const fileName = rawPath.split(/[/\\]/).pop();
                  const mediaLabel = item.field === "image" ? "image" : item.field === "screenshot" ? "capture d'écran" : "notice PDF";
                  content = (
                    <span>
                      Ajout {mediaLabel} : <strong>{fileName || "fichier"}</strong>
                      {rawPath && (
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => onOpenPath(rawPath)}
                          style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: "0 0.3rem", font: "inherit", fontSize: "10px" }}
                          title="Ouvrir le fichier"
                        >
                          👁️ voir
                        </button>
                      )}
                    </span>
                  );
                } else if (item.action === "DELETE_MEDIA") {
                  badge = "🗑️";
                  const fileName = (item.old_value || item.new_value || "").split(/[/\\]/).pop();
                  const mediaLabel = item.field === "image" ? "l'image" : "la notice PDF";
                  content = <span>Suppression de {mediaLabel} <strong>{fileName || ""}</strong></span>;
                } else if (item.action === "RENAME_MEDIA") {
                  badge = "✏️";
                  const oldName = (item.old_value || "").split(/[/\\]/).pop();
                  const newName = (item.new_value || "").split(/[/\\]/).pop();
                  content = (
                    <span>
                      Renommage média : <span className="audit-old-value">{oldName}</span> → <span className="audit-new-value">{newName}</span>
                    </span>
                  );
                } else if (item.action === "SCRAPE_PDF") {
                  badge = "📄";
                  const docLabel = item.field || "Notice technique";
                  const fileName = (item.new_value || "").split(/[/\\]/).pop();
                  content = (
                    <span>
                      Notice téléchargée ({docLabel}) : <strong>{fileName || item.new_value || "PDF"}</strong>
                      {item.source_url && (item.source_url.startsWith("http://") || item.source_url.startsWith("https://")) && (
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => onOpenPath(item.source_url!)}
                          title={item.source_url}
                          style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: "0 0.3rem", font: "inherit", fontSize: "10px" }}
                        >
                          🔗 source
                        </button>
                      )}
                    </span>
                  );
                } else if (item.action === "SCRAPE_IMAGE") {
                  badge = "🖼️";
                  const fileName = (item.new_value || "").split(/[/\\]/).pop();
                  content = (
                    <span>
                      Image téléchargée : <strong>{fileName || "Image"}</strong>
                      {item.source_url && (item.source_url.startsWith("http://") || item.source_url.startsWith("https://")) && (
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => onOpenPath(item.source_url!)}
                          title={item.source_url}
                          style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: "0 0.3rem", font: "inherit", fontSize: "10px" }}
                        >
                          🔗 source
                        </button>
                      )}
                    </span>
                  );
                } else if (item.action === "SCRAPE_PRICE") {
                  badge = "🟠";
                  content = (
                    <span>
                      Mise à jour Prix (Scraping) :{" "}
                      <strong>
                        {item.old_value ? parseFloat(item.old_value).toFixed(2) : "—"} € →{" "}
                        {item.new_value ? parseFloat(item.new_value).toFixed(2) : "—"} €
                      </strong>
                      {item.source_url && (item.source_url.startsWith("http://") || item.source_url.startsWith("https://")) && (
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => onOpenPath(item.source_url!)}
                          title={item.source_url}
                          style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: "0 0.3rem", font: "inherit", fontSize: "10px" }}
                        >
                          🔗 source
                        </button>
                      )}
                    </span>
                  );
                } else if (item.action === "UPDATE") {
                  badge = "🔵";
                  content = (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                      <span>
                        <strong>{item.field}</strong> : <span className="audit-old-value">{item.old_value || "—"}</span> → <span className="audit-new-value">{item.new_value || "—"}</span>
                        {item.source_url && (item.source_url.startsWith("http://") || item.source_url.startsWith("https://")) && (
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => onOpenPath(item.source_url!)}
                            title={item.source_url}
                            style={{ background: "none", border: "none", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", padding: "0 0.3rem", font: "inherit" }}
                          >
                            🔗 source
                          </button>
                        )}
                      </span>
                      {inlineConfirm?.id === `revert-audit-${item.audit_id}` ? (
                        <div
                          style={{
                            display: "inline-flex",
                            gap: "4px",
                            alignItems: "center",
                            backgroundColor: "rgba(59, 130, 246, 0.15)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            marginLeft: "0.5rem",
                            flexShrink: 0,
                          }}
                        >
                          <span style={{ fontSize: "10px", color: "var(--text-secondary)", fontWeight: "600" }}>Restaurer ?</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              inlineConfirm.action();
                              setInlineConfirm(null);
                            }}
                            style={{
                              background: "var(--accent)",
                              color: "#fff",
                              border: "none",
                              borderRadius: "3px",
                              cursor: "pointer",
                              fontSize: "9px",
                              padding: "1px 5px",
                              fontWeight: "bold",
                            }}
                          >
                            Oui
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInlineConfirm(null);
                            }}
                            style={{
                              background: "var(--bg-lighter)",
                              color: "var(--text-primary)",
                              border: "none",
                              borderRadius: "3px",
                              cursor: "pointer",
                              fontSize: "9px",
                              padding: "1px 5px",
                            }}
                          >
                            Non
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-link"
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--accent)",
                            textDecoration: "underline",
                            cursor: "pointer",
                            padding: 0,
                            fontSize: "10px",
                            font: "inherit",
                            marginLeft: "0.5rem",
                            whiteSpace: "nowrap",
                          }}
                          onClick={() =>
                            setInlineConfirm({
                              id: `revert-audit-${item.audit_id}`,
                              action: () => onRevertAudit(item),
                            })
                          }
                        >
                          ↩️ Restaurer
                        </button>
                      )}
                    </div>
                  );
                } else {
                  badge = "ℹ️";
                  content = (
                    <span>
                      {item.field ? <strong>{item.field} : </strong> : null}
                      {item.new_value || item.old_value || item.action}
                    </span>
                  );
                }

                return (
                  <div key={item.audit_id} className="history-item">
                    <div className="history-meta">
                      <span>{dateStr} {timeStr}</span>
                      <span>Par : {item.trigramme}</span>
                    </div>
                    <div style={{ display: "flex", gap: "0.3rem", fontSize: "11px", alignItems: "center" }}>
                      <span>{badge}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>{content}</div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </aside>
  );
}
