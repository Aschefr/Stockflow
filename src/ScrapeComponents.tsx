/**
 * ScrapeProgressBadge - Badge discret de progression du scraping en arrière-plan.
 * 
 * Affiche un indicateur animé dans la fiche produit pendant que le scraping
 * est en cours, avec le pourcentage de progression et un bouton d'annulation.
 */
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ScrapeProgressBadgeProps {
  sku: string;
  onOpenAutoFill?: (sku: string) => void;
  onComplete?: (candidatesCount: number) => void;
  onError?: (error: string) => void;
}

interface ScrapeProgress {
  sku: string;
  progress: number;
  message: string;
}

export function ScrapeProgressBadge({ sku, onOpenAutoFill, onComplete, onError }: ScrapeProgressBadgeProps) {
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [candidatesCount, setCandidatesCount] = useState<number>(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    const handleHighlight = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.sku === sku) {
        setIsHighlighted(true);
        setTimeout(() => setIsHighlighted(false), 3000);
      }
    };
    window.addEventListener("highlight-scrape-task", handleHighlight);
    return () => window.removeEventListener("highlight-scrape-task", handleHighlight);
  }, [sku]);

  useEffect(() => {
    // Reset state for new SKU to prevent showing stale info from previous SKU
    setProgress(null);
    setMessage("");
    setStatus(null);
    setCandidatesCount(0);

    // Check initial status
    invoke<any>("get_scrape_status", { sku }).then(statusData => {
      if (statusData) {
        setProgress(statusData.progress);
        setMessage(statusData.message);
        setStatus(statusData.status);
      } else {
        setStatus(null);
      }
    }).catch(() => {
      setStatus(null);
    });

    // Listen for progress events
    const unlisten1 = listen<ScrapeProgress>("scrape-task-progress", (event) => {
      if (event.payload.sku === sku) {
        setProgress(event.payload.progress);
        setMessage(event.payload.message);
        setStatus("InProgress");
      }
    });

    const unlisten2 = listen<{ sku: string; candidates_count: number }>("scrape-task-complete", (event) => {
      if (event.payload.sku === sku) {
        setProgress(1.0);
        setStatus("Complete");
        setCandidatesCount(event.payload.candidates_count);
        setMessage(`${event.payload.candidates_count} candidats trouvés`);
        onComplete?.(event.payload.candidates_count);
      }
    });

    const unlisten3 = listen<{ sku: string; error: string }>("scrape-task-error", (event) => {
      if (event.payload.sku === sku) {
        setStatus("Failed");
        setMessage(event.payload.error);
        onError?.(event.payload.error);
      }
    });

    return () => {
      unlisten1.then(f => f());
      unlisten2.then(f => f());
      unlisten3.then(f => f());
    };
  }, [sku]);

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("cancel_background_scrape", { sku });
      setStatus("Cancelled");
      setMessage("Annulé");
    } catch (e) {
      console.error("Erreur annulation scrape:", e);
    }
  };

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("resume_background_scrape", { sku });
      setStatus("InProgress");
      setProgress(0.05);
      setMessage("Relance...");
    } catch (e) {
      console.error("Erreur reprise scrape:", e);
    }
  };



  // Nothing to show
  const progressPct = progress !== null ? Math.round(progress * 100) : null;
  const displayStatus = status;

  if (progressPct === null && !displayStatus) return null;

  const badgeClass = [
    "scrape-progress-badge",
    displayStatus === "InProgress" || displayStatus === "Pending"
      ? "scrape-progress-badge--inprogress"
      : displayStatus === "Complete"
      ? "scrape-progress-badge--complete"
      : displayStatus === "Failed" || displayStatus === "Cancelled"
      ? `scrape-progress-badge--${displayStatus?.toLowerCase()}`
      : "",
    isHighlighted ? "scrape-progress-badge--highlighted" : "",
  ].filter(Boolean).join(" ");

  const isActive = displayStatus === "InProgress" || displayStatus === "Pending";
  const isComplete = displayStatus === "Complete";
  const isFailed = displayStatus === "Failed" || displayStatus === "Cancelled";

  // Message court pour affichage dans le badge
  const shortMessage = message.length > 55 ? message.substring(0, 52) + "..." : message;

  return (
    <div
      className={badgeClass}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={isComplete ? () => onOpenAutoFill?.(sku) : undefined}
      style={{ cursor: isComplete ? "pointer" : "default" }}
      title={message}
    >
      {isActive && <span className="scrape-progress-badge__spinner" />}
      <span className="scrape-progress-badge__text">
        {isActive && progressPct !== null && (
          <span className="scrape-progress-badge__pct">{progressPct}% — </span>
        )}
        {shortMessage || (isComplete ? `✓ ${candidatesCount} candidats` : isFailed ? "✗ Erreur" : "En attente")}
      </span>
      {isHovered && isActive && (
        <button
          className="scrape-progress-badge__action"
          onClick={handleCancel}
          title="Annuler"
        >✕</button>
      )}
      {isHovered && isFailed && (
        <button
          className="scrape-progress-badge__action"
          onClick={handleResume}
          title="Relancer"
        >↻</button>
      )}
      {isComplete && isHovered && (
        <span className="scrape-progress-badge__open-hint">→ Ouvrir</span>
      )}
    </div>
  );
}

/**
 * AutoFillModal - Modal principal d'auto-remplissage.
 * 
 * Affiche toutes les données candidats scrapées pour un SKU, avec des dropdowns
 * de sélection par propriété. L'utilisateur valide sa sélection avant application.
 */

interface CandidateSource {
  url?: string;
  screenshot_path?: string;
  provider: string;
}

interface Candidate<T> {
  value: T;
  source: CandidateSource;
  confidence: number;
  selected: boolean;
}

interface PriceInfo {
  price: number;
  currency: string;
  tax_type: string;
  label: string;
  pack_size: number;
}

interface DimensionInfo {
  width?: string;
  height?: string;
  depth?: string;
}

interface ResourceCandidate {
  url: string;
  title: string;
  domain: string;
  source: CandidateSource;
  file_type: string;
}

interface ScrapeCandidates {
  sku: string;
  scraped_at: string;
  /** Timestamp Unix millisecondes pour le calcul de fraîcheur */
  scraped_at_ms?: number;
  status: string;
  progress: number;
  error_message?: string;
  sources_visited: Array<{
    url: string;
    provider: string;
    screenshot_path?: string;
    visited_at: string;
    success: boolean;
  }>;
  label_candidates: Candidate<string>[];
  brand_candidates: Candidate<string>[];
  mpn_candidates: Candidate<string>[];
  price_candidates: Candidate<PriceInfo>[];
  dimension_candidates: Candidate<DimensionInfo>[];
  weight_candidates: Candidate<string>[];
  pack_size_candidates: Candidate<number>[];
  pdf_candidates: ResourceCandidate[];
  image_candidates: ResourceCandidate[];
}

interface AutoFillModalProps {
  isOpen: boolean;
  onClose: () => void;
  sku: string;
  onApply: (selections: AutoFillSelections) => void;
  networkPath: string;
  /** Produit actuel pour afficher la comparaison avant/après dans la confirmation */
  currentProduct?: {
    label?: string;
    brand?: string;
    mpn?: string;
    price?: number | string;
    poids?: string;
    largeur?: string;
    hauteur?: string;
    profondeur?: string;
    pack_size?: number;
  };
}

export interface AutoFillSelections {
  label?: string;
  brand?: string;
  mpn?: string;
  price?: number;
  pack_size?: number;
  tax_type?: string;
  largeur?: string;
  hauteur?: string;
  profondeur?: string;
  poids?: string;
  source_url?: string;
  screenshot_path?: string;
  image_urls?: string[];
}

export function AutoFillModal({ isOpen, onClose, sku, onApply, networkPath: _networkPath, currentProduct }: AutoFillModalProps) {
  const [candidates, setCandidates] = useState<ScrapeCandidates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Nombre d'images valides (non-cassées) */
  const [validImageCount, setValidImageCount] = useState(0);

  // Selected indices
  const [selectedLabel, setSelectedLabel] = useState(0);
  const [selectedBrand, setSelectedBrand] = useState(0);
  const [selectedMpn, setSelectedMpn] = useState(0);
  const [selectedPrice, setSelectedPrice] = useState(0);
  const [selectedDimension, setSelectedDimension] = useState(0);
  const [selectedWeight, setSelectedWeight] = useState(0);
  const [selectedPackSize] = useState(0);
  const [activeTab, setActiveTab] = useState<"properties" | "resources" | "sources">("properties");

  // Skipped fields + image selection
  const [skippedFields, setSkippedFields] = useState<Set<string>>(new Set());
  const [selectedImageUrls, setSelectedImageUrls] = useState<Set<string>>(new Set());

  // Confirmation step
  const [confirmStep, setConfirmStep] = useState(false);
  const [pendingSelections, setPendingSelections] = useState<AutoFillSelections | null>(null);

  const toggleSkip = (field: string) => {
    setSkippedFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  useEffect(() => {
    if (isOpen && sku) {
      // Réinitialiser le compteur d'images valides à chaque ouverture
      setValidImageCount(0);
      loadCandidates();
    }
  }, [isOpen, sku]);

  const loadCandidates = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<ScrapeCandidates | null>("get_scrape_candidates", { sku });
      if (result) {
        setCandidates(result);
        // Initialiser le compteur à la totalité, les onError des images vont le décrémenter
        setValidImageCount(result.image_candidates.length);
        // Pré-sélectionner automatiquement le candidat marqué selected:true par le backend
        const labelIdx = result.label_candidates.findIndex(c => c.selected);
        if (labelIdx >= 0) setSelectedLabel(labelIdx);
        const brandIdx = result.brand_candidates.findIndex(c => c.selected);
        if (brandIdx >= 0) setSelectedBrand(brandIdx);
        const mpnIdx = result.mpn_candidates.findIndex(c => c.selected);
        if (mpnIdx >= 0) setSelectedMpn(mpnIdx);
        const priceIdx = result.price_candidates.findIndex(c => c.selected);
        if (priceIdx >= 0) setSelectedPrice(priceIdx);
        const dimIdx = result.dimension_candidates.findIndex(c => c.selected);
        if (dimIdx >= 0) setSelectedDimension(dimIdx);
        const weightIdx = result.weight_candidates.findIndex(c => c.selected);
        if (weightIdx >= 0) setSelectedWeight(weightIdx);
      } else {
        setError("Aucune donnée scrapée trouvée pour ce SKU. Lancez d'abord un scraping.");
      }
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setLoading(false);
    }
  };

  const computeSelections = (): AutoFillSelections => {
    if (!candidates) return {};
    const selections: AutoFillSelections = {};

    if (!skippedFields.has("label") && candidates.label_candidates.length > 0) {
      selections.label = candidates.label_candidates[selectedLabel]?.value;
    }
    if (!skippedFields.has("brand") && candidates.brand_candidates.length > 0) {
      selections.brand = candidates.brand_candidates[selectedBrand]?.value;
    }
    if (!skippedFields.has("mpn") && candidates.mpn_candidates.length > 0) {
      selections.mpn = candidates.mpn_candidates[selectedMpn]?.value;
    }
    if (!skippedFields.has("price") && candidates.price_candidates.length > 0) {
      const priceCandidate = candidates.price_candidates[selectedPrice];
      if (priceCandidate) {
        selections.price = priceCandidate.value.price;
        selections.pack_size = priceCandidate.value.pack_size;
        selections.tax_type = priceCandidate.value.tax_type;
      }
    }
    if (!skippedFields.has("dimensions") && candidates.dimension_candidates.length > 0) {
      const dim = candidates.dimension_candidates[selectedDimension]?.value;
      if (dim) {
        selections.largeur = dim.width || undefined;
        selections.hauteur = dim.height || undefined;
        selections.profondeur = dim.depth || undefined;
      }
    }
    if (!skippedFields.has("weight") && candidates.weight_candidates.length > 0) {
      selections.poids = candidates.weight_candidates[selectedWeight]?.value;
    }
    if (!skippedFields.has("pack_size") && candidates.pack_size_candidates.length > 0 && !selections.pack_size) {
      selections.pack_size = candidates.pack_size_candidates[selectedPackSize]?.value;
    }

    if (selectedImageUrls.size > 0) {
      selections.image_urls = Array.from(selectedImageUrls);
    }

    const bestSource = candidates.sources_visited.find(s => s.success);
    if (bestSource) {
      selections.source_url = bestSource.url;
      selections.screenshot_path = bestSource.screenshot_path || undefined;
    }

    return selections;
  };

  const handleApply = () => {
    const selections = computeSelections();
    if (Object.keys(selections).length === 0) return;
    setPendingSelections(selections);
    setConfirmStep(true);
  };

  const handleConfirmApply = () => {
    if (pendingSelections) {
      onApply(pendingSelections);
      onClose();
    }
  };

  const handleRescrape = async () => {
    try {
      await invoke("resume_background_scrape", { sku });
      setLoading(true);
      setError(null);
      // Écouter l'événement de fin
      const unlisten = await listen<{ sku: string; candidates_count: number }>("scrape-task-complete", (event) => {
        if (event.payload.sku === sku.toUpperCase()) {
          unlisten();
          loadCandidates();
        }
      });
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleStartScrapeAndClose = async () => {
    try {
      await invoke("resume_background_scrape", { sku });
      onClose();
      const event = new CustomEvent("highlight-scrape-task", { detail: { sku } });
      window.dispatchEvent(event);
    } catch (e: any) {
      console.error("Erreur lancement scrape depuis modal:", e);
    }
  };

  const formatNum = (v: any) => {
    if (v === null || v === undefined) return "";
    return v.toString().replace(/\./g, ",");
  };

  const skippedCount = skippedFields.size;
  const hasSkippedAll = candidates !== null && Object.keys(candidates).length > 0 &&
    ["label", "brand", "mpn", "price", "dimensions", "weight", "pack_size"].every(f => skippedFields.has(f)) &&
    selectedImageUrls.size === 0;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="autofill-modal" onClick={e => e.stopPropagation()}>
        <div className="autofill-modal__header">
          <h3>✨ Auto-remplissage — {sku}</h3>
          <div className="autofill-modal__header-actions">
            <button className="btn-icon" onClick={handleRescrape} title="Relancer le scraping">↻</button>
            <button className="btn-icon" onClick={onClose} title="Fermer">✕</button>
          </div>
        </div>

        {loading ? (
          <div className="autofill-modal__loading">
            <div className="scrape-progress-badge__spinner" />
            <p>Chargement des données scrapées...</p>
          </div>
        ) : error ? (
          <div className="autofill-modal__error">
            <p className="error-message">⚠️ {error}</p>
            <button className="btn-primary btn-premium-scrape" onClick={handleStartScrapeAndClose}>
              🚀 Lancer le scraping en tâche de fond
            </button>
          </div>
        ) : confirmStep && pendingSelections ? (
          <>
            <div className="autofill-modal__content" style={{ padding: "1.5rem" }}>
              <h4 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Récapitulatif des modifications</h4>
              <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>
                    <th style={{ textAlign: "left", padding: "0.2rem 0.5rem", width: "120px" }}>Champ</th>
                    <th style={{ textAlign: "left", padding: "0.2rem 0.5rem" }}>Valeur actuelle</th>
                    <th style={{ padding: "0.2rem 0.4rem" }}></th>
                    <th style={{ textAlign: "left", padding: "0.2rem 0.5rem" }}>Nouvelle valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSelections.label && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Désignation</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-tertiary)", fontStyle: "italic", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentProduct?.label || "—"}</td>
                      <td style={{ padding: "0.3rem 0.3rem", color: "var(--accent)" }}>→</td>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 500 }}>{pendingSelections.label}</td>
                    </tr>
                  )}
                  {pendingSelections.brand && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Marque</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>{currentProduct?.brand || "—"}</td>
                      <td style={{ padding: "0.3rem 0.3rem", color: "var(--accent)" }}>→</td>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 500 }}>{pendingSelections.brand}</td>
                    </tr>
                  )}
                  {pendingSelections.mpn && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Ref Fabricant</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>{currentProduct?.mpn || "—"}</td>
                      <td style={{ padding: "0.3rem 0.3rem", color: "var(--accent)" }}>→</td>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 500 }}>{pendingSelections.mpn}</td>
                    </tr>
                  )}
                  {pendingSelections.price !== undefined && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Prix</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>{currentProduct?.price ? `${String(currentProduct.price).replace('.', ',')} €` : "—"}</td>
                      <td style={{ padding: "0.3rem 0.3rem", color: "var(--accent)" }}>→</td>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 500 }}>{formatNum(pendingSelections.price)} € {pendingSelections.tax_type && pendingSelections.tax_type !== "unknown" ? pendingSelections.tax_type : ""}</td>
                    </tr>
                  )}
                  {pendingSelections.pack_size !== undefined && !pendingSelections.price && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Taille Lot</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>{currentProduct?.pack_size || "—"}</td>
                      <td style={{ padding: "0.3rem 0.3rem", color: "var(--accent)" }}>→</td>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 500 }}>{pendingSelections.pack_size}</td>
                    </tr>
                  )}
                  {pendingSelections.largeur && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Dimensions</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>
                        {currentProduct?.largeur ? `${currentProduct.largeur} × ${currentProduct.hauteur || "—"} × ${currentProduct.profondeur || "—"} mm` : "—"}
                      </td>
                      <td style={{ padding: "0.3rem 0.3rem", color: "var(--accent)" }}>→</td>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 500 }}>{pendingSelections.largeur} × {pendingSelections.hauteur || "—"} × {pendingSelections.profondeur || "—"} mm</td>
                    </tr>
                  )}
                  {pendingSelections.poids && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Poids</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>{currentProduct?.poids ? `${currentProduct.poids} g` : "—"}</td>
                      <td style={{ padding: "0.3rem 0.3rem", color: "var(--accent)" }}>→</td>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 500 }}>{pendingSelections.poids} g</td>
                    </tr>
                  )}
                  {pendingSelections.image_urls && pendingSelections.image_urls.length > 0 && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Images</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-tertiary)", fontStyle: "italic" }}>—</td>
                      <td style={{ padding: "0.3rem 0.3rem", color: "var(--accent)" }}>→</td>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 500 }}>{pendingSelections.image_urls.length} image(s) sélectionnée(s)</td>
                    </tr>
                  )}
                  {pendingSelections.source_url && (
                    <tr>
                      <td style={{ padding: "0.3rem 0.5rem", color: "var(--text-secondary)" }}>Source</td>
                      <td colSpan={3} style={{ padding: "0.3rem 0.5rem", fontSize: "11px" }}><a href={pendingSelections.source_url} target="_blank" rel="noopener noreferrer">{pendingSelections.source_url.length > 60 ? pendingSelections.source_url.substring(0, 60) + "..." : pendingSelections.source_url}</a></td>
                    </tr>
                  )}
                </tbody>
              </table>
              {skippedCount > 0 && (
                <p style={{ marginTop: "1rem", fontSize: "12px", color: "var(--text-tertiary)" }}>⚠️ {skippedCount} champ(s) ignoré(s) — ne seront pas modifiés</p>
              )}
            </div>
            <div className="autofill-modal__footer">
              <span className="autofill-modal__info" />
              <div className="autofill-modal__actions">
                <button className="btn-secondary" onClick={() => setConfirmStep(false)}>← Retour</button>
                <button className="btn-primary" onClick={handleConfirmApply}>
                  ✓ Confirmer l'application
                </button>
              </div>
            </div>
          </>
        ) : candidates ? (
          <>
            <div className="autofill-modal__tabs">
              <button
                className={`autofill-modal__tab ${activeTab === "properties" ? "active" : ""}`}
                onClick={() => setActiveTab("properties")}
              >
                📋 Propriétés ({
                  candidates.label_candidates.length +
                  candidates.brand_candidates.length +
                  candidates.price_candidates.length +
                  candidates.dimension_candidates.length +
                  candidates.weight_candidates.length
                })
              </button>
              <button
                className={`autofill-modal__tab ${activeTab === "resources" ? "active" : ""}`}
                onClick={() => setActiveTab("resources")}
              >
                📎 Ressources ({candidates.pdf_candidates.length + validImageCount})
              </button>
              <button
                className={`autofill-modal__tab ${activeTab === "sources" ? "active" : ""}`}
                onClick={() => setActiveTab("sources")}
              >
                🔗 Sources ({candidates.sources_visited.length})
              </button>
            </div>

            <div className="autofill-modal__content">
              {activeTab === "properties" && (
                <div className="autofill-modal__properties">
                  <CandidateRow
                    label="Désignation"
                    candidates={candidates.label_candidates.map(c => ({
                      display: c.value,
                      source: c.source,
                      confidence: c.confidence,
                    }))}
                    selectedIndex={selectedLabel}
                    onSelect={setSelectedLabel}
                    skipped={skippedFields.has("label")}
                    onToggleSkip={() => toggleSkip("label")}
                  />
                  <CandidateRow
                    label="Marque"
                    candidates={candidates.brand_candidates.map(c => ({
                      display: c.value,
                      source: c.source,
                      confidence: c.confidence,
                    }))}
                    selectedIndex={selectedBrand}
                    onSelect={setSelectedBrand}
                    skipped={skippedFields.has("brand")}
                    onToggleSkip={() => toggleSkip("brand")}
                  />
                  <CandidateRow
                    label="Ref Fabricant"
                    candidates={candidates.mpn_candidates.map(c => ({
                      display: c.value,
                      source: c.source,
                      confidence: c.confidence,
                    }))}
                    selectedIndex={selectedMpn}
                    onSelect={setSelectedMpn}
                    skipped={skippedFields.has("mpn")}
                    onToggleSkip={() => toggleSkip("mpn")}
                  />
                  <CandidateRow
                    label="Prix"
                    candidates={candidates.price_candidates.map(c => ({
                      display: `${formatNum(c.value.price)} € ${c.value.tax_type !== "unknown" ? c.value.tax_type : ""} (lot: ${c.value.pack_size})`,
                      source: c.source,
                      confidence: c.confidence,
                    }))}
                    selectedIndex={selectedPrice}
                    onSelect={setSelectedPrice}
                    skipped={skippedFields.has("price")}
                    onToggleSkip={() => toggleSkip("price")}
                  />
                  <CandidateRow
                    label="Dimensions"
                    candidates={candidates.dimension_candidates.map(c => ({
                      display: `${c.value.width || "—"} × ${c.value.height || "—"} × ${c.value.depth || "—"} mm`,
                      source: c.source,
                      confidence: c.confidence,
                    }))}
                    selectedIndex={selectedDimension}
                    onSelect={setSelectedDimension}
                    skipped={skippedFields.has("dimensions")}
                    onToggleSkip={() => toggleSkip("dimensions")}
                  />
                  <CandidateRow
                    label="Poids"
                    candidates={candidates.weight_candidates.map(c => ({
                      display: `${c.value} g`,
                      source: c.source,
                      confidence: c.confidence,
                    }))}
                    selectedIndex={selectedWeight}
                    onSelect={setSelectedWeight}
                    skipped={skippedFields.has("weight")}
                    onToggleSkip={() => toggleSkip("weight")}
                  />
                </div>
              )}

              {activeTab === "resources" && (
                <div className="autofill-modal__resources">
                  {candidates.pdf_candidates.length > 0 && (
                    <div className="autofill-modal__resource-group">
                      <h4>📄 PDF ({candidates.pdf_candidates.length})</h4>
                      {candidates.pdf_candidates.map((pdf, i) => (
                        <div key={i} className="autofill-modal__resource-item">
                          <span className="resource-title">{pdf.title || "PDF"}</span>
                          <span className="resource-domain">{pdf.domain}</span>
                          <a href={pdf.url} target="_blank" rel="noopener noreferrer" className="resource-link">
                            ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                  {candidates.image_candidates.length > 0 && (
                    <div className="autofill-modal__resource-group">
                      <h4>🖼️ Images
                        <span style={{ marginLeft: "0.5rem", fontSize: "12px", color: "var(--text-tertiary)" }}>
                          ({validImageCount} valide{validImageCount !== 1 ? "s" : ""} / {candidates.image_candidates.length} total)
                        </span>
                      </h4>
                      <div className="autofill-modal__image-grid">
                        {candidates.image_candidates.filter(img => img.url && img.url.trim()).slice(0, 12).map((img, i) => {
                          const isSelected = selectedImageUrls.has(img.url);
                          return (
                            <div
                              key={i}
                              className={`autofill-modal__image-thumb ${isSelected ? "selected" : ""}`}
                              onClick={() => {
                                setSelectedImageUrls(prev => {
                                  const next = new Set(prev);
                                  if (next.has(img.url)) next.delete(img.url);
                                  else next.add(img.url);
                                  return next;
                                });
                              }}
                              style={{ cursor: "pointer", border: isSelected ? "3px solid var(--accent)" : "3px solid transparent", position: "relative" }}
                            >
                              <img
                                src={img.url}
                                alt={img.title || `Image ${i + 1}`}
                                loading="lazy"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                  // Décrémenter le compteur d'images valides
                                  setValidImageCount(prev => Math.max(0, prev - 1));
                                }}
                              />
                              <span className="image-domain">{img.domain}</span>
                              <button
                                type="button"
                                className="image-preview-btn"
                                onClick={(e) => { e.stopPropagation(); window.open(img.url, '_blank', 'noopener'); }}
                                title="Ouvrir l'image"
                              >📷</button>
                              {isSelected && (
                                <span className="image-check" style={{ position: "absolute", top: "4px", right: "4px", backgroundColor: "var(--accent)", color: "#fff", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>✓</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {candidates.pdf_candidates.length === 0 && candidates.image_candidates.length === 0 && (
                    <p className="autofill-modal__empty">Aucune ressource trouvée.</p>
                  )}
                </div>
              )}

              {activeTab === "sources" && (
                <div className="autofill-modal__sources">
                  {candidates.sources_visited.map((src, i) => (
                    <div key={i} className={`autofill-modal__source-item ${src.success ? "success" : "failed"}`}>
                      <span className="source-icon">{src.success ? "✓" : "✕"}</span>
                      <span className="source-provider">{src.provider}</span>
                      <a href={src.url} target="_blank" rel="noopener noreferrer" className="source-url">
                        {src.url.length > 60 ? src.url.substring(0, 60) + "..." : src.url}
                      </a>
                      {src.screenshot_path && (
                        <span className="source-screenshot" title="Screenshot disponible">📸</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="autofill-modal__footer">
              <span className="autofill-modal__info">
                Scrapé le {new Date(candidates.scraped_at).toLocaleString("fr-FR")}
                {skippedCount > 0 && ` · ${skippedCount} ignoré${skippedCount > 1 ? "s" : ""}`}
                {/* Avertissement données périmées (> 7 jours) */}
                {candidates.scraped_at_ms && Date.now() - candidates.scraped_at_ms > 7 * 24 * 60 * 60 * 1000 && (
                  <span style={{ marginLeft: "0.5rem", color: "var(--color-warning, #f59e0b)", fontWeight: 500 }}
                    title="Les données ont plus de 7 jours — relancez un scraping pour les actualiser">
                    ⚠ Données anciennes
                  </span>
                )}
              </span>
              <div className="autofill-modal__actions">
                <button className="btn-secondary" onClick={onClose}>Annuler</button>
                <button className="btn-primary" onClick={handleApply} disabled={hasSkippedAll}>
                  ✓ Appliquer la sélection
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * CandidateRow — Ligne de sélection d'un candidat avec dropdown.
 */
interface CandidateDisplay {
  display: string;
  source: CandidateSource;
  confidence: number;
}

function CandidateRow({
  label,
  candidates,
  selectedIndex,
  onSelect,
  skipped,
  onToggleSkip,
}: {
  label: string;
  candidates: CandidateDisplay[];
  selectedIndex: number;
  onSelect: (idx: number) => void;
  skipped: boolean;
  onToggleSkip: () => void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="candidate-row candidate-row--empty">
        <span className="candidate-row__label">{label}</span>
        <span className="candidate-row__value candidate-row__value--empty">—</span>
      </div>
    );
  }

  return (
    <div className={`candidate-row ${skipped ? "candidate-row--skipped" : ""}`} style={{ opacity: skipped ? 0.45 : 1 }}>
      <span className="candidate-row__label">{label}</span>
      <div className="candidate-row__selector">
        {candidates.length === 1 ? (
          <div className="candidate-row__single">
            <span className="candidate-row__value">{candidates[0].display}</span>
            <ConfidenceBadge confidence={candidates[0].confidence} />
            <SourceBadge source={candidates[0].source} />
          </div>
        ) : (
          <select
            className="candidate-dropdown"
            value={selectedIndex}
            onChange={(e) => onSelect(parseInt(e.target.value, 10))}
            disabled={skipped}
          >
            {candidates.map((c, i) => (
              <option key={i} value={i}>
                {c.display} [{c.source.provider}]
              </option>
            ))}
          </select>
        )}
        {candidates.length > 1 && !skipped && (
          <div className="candidate-row__meta">
            <ConfidenceBadge confidence={candidates[selectedIndex]?.confidence || 0} />
            <SourceBadge source={candidates[selectedIndex]?.source} />
          </div>
        )}
      </div>
      <button
        className="btn-icon candidate-row__skip"
        onClick={onToggleSkip}
        title={skipped ? "Inclure ce champ" : "Ignorer ce champ"}
        style={{ marginLeft: "0.3rem", fontSize: "14px", opacity: skipped ? 1 : 0.5 }}
      >
        {skipped ? "✓" : "✕"}
      </button>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? "var(--color-success)" : pct >= 50 ? "var(--color-warning)" : "var(--color-error)";
  return (
    <span className="confidence-badge" style={{ color }} title={`Confiance: ${pct}%`}>
      {pct}%
    </span>
  );
}

function SourceBadge({ source }: { source?: CandidateSource }) {
  if (!source) return null;
  return (
    <span className="source-badge" title={source.url || source.provider}>
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-badge__link">
          {source.provider}
        </a>
      ) : (
        source.provider
      )}
      {source.screenshot_path && <span className="source-badge__screenshot">📸</span>}
    </span>
  );
}
