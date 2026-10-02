import React, { useState, useEffect, useRef } from "react";
import { invoke, convertFileSrc } from "./services/api";
import { type AutoFillSelections } from "./ScrapeComponents";
import { parseSupplierData, type SupplierScrapeResult, buildCandidatesFromSupplierData } from "./services/webScraperAssistant";
import { searchSearxngImages, searchSearxngPdfs } from "./services/webScraperService";
import {
  detectDocumentType,
  DOCUMENT_TYPE_OPTIONS,
  getDocumentTypeOption
} from "./utils/documentUtils";

export interface SelectedPdfItem {
  url: string;
  title: string;
  docType: string;
  docTypeLabel?: string;
  fileData?: number[];
  fileName?: string;
  isLocalFile?: boolean;
}

interface AppConfig {
  trigramme: string;
  network_path: string;
  vpc_sites: string[];
  image_rename_convention?: string;
  pdf_rename_convention?: string;
  enable_scrape_fallback?: boolean;
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
  image_path?: string | null;
  pdf_path?: string | null;
}

interface ProductFormProps {
  mode: "create" | "edit";
  initialTab?: "general" | "images" | "documents";
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
  onScrape: (isEdit: boolean, options?: { includeImages?: boolean; includeDocs?: boolean; allowFallback?: boolean }) => void;
  onOpenAutoFill: (sku: string, isEdit: boolean) => void;
  autoFillSource: string | null;
  autoFillFallbackInfo: string | null;
  autoFillChanges: AutoFillSelections | null;

  // Feedback states
  successMessage: string;
  errorMessage: string;
  duplicateWarning?: string;
  globalScrape?: { sku: string; progress: number; message: string; status: string } | null;
  onChangeSku?: (sku: string) => void;
}

export function ProductForm({
  mode,
  initialTab = "general",
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
  globalScrape,
  onChangeSku,
}: ProductFormProps) {
  const isEdit = mode === "edit";
  const [candidates, setCandidates] = useState<any>(null);
  const hasCandidates = Boolean(
    candidates && (
      (candidates.label_candidates && candidates.label_candidates.length > 0) ||
      (candidates.brand_candidates && candidates.brand_candidates.length > 0) ||
      (candidates.mpn_candidates && candidates.mpn_candidates.length > 0) ||
      (candidates.image_candidates && candidates.image_candidates.length > 0) ||
      (candidates.pdf_candidates && candidates.pdf_candidates.length > 0) ||
      (candidates.price_candidates && candidates.price_candidates.length > 0)
    )
  );
  const [activeTab, setActiveTab] = useState<"general" | "images" | "documents">(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [manualDocUrl, setManualDocUrl] = useState("");
  const [manualMediaFeedback, setManualMediaFeedback] = useState<string | null>(null);
  const [hasEditedImageQuery, setHasEditedImageQuery] = useState(false);
  const [hasEditedDocQuery, setHasEditedDocQuery] = useState(false);
  const [imageScrapeQuery, setImageScrapeQuery] = useState("");
  const [isScrapingImages, setIsScrapingImages] = useState(false);
  const [imageScrapeFeedback, setImageScrapeFeedback] = useState<string | null>(null);
  const [docScrapeQuery, setDocScrapeQuery] = useState("");
  const [isScrapingDocs, setIsScrapingDocs] = useState(false);
  const [docScrapeFeedback, setDocScrapeFeedback] = useState<string | null>(null);
  const [activeImages, setActiveImages] = useState<string[]>([]);
  const [activePdfs, setActivePdfs] = useState<string[]>([]);
  const [inlineConfirmMedia, setInlineConfirmMedia] = useState<{ type: "image" | "pdf"; path: string } | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteRawInput, setPasteRawInput] = useState("");
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);
  const [scrapeIncludeImages, setScrapeIncludeImages] = useState(false);
  const [scrapeIncludeDocs, setScrapeIncludeDocs] = useState(false);
  const [scrapeAllowFallback, setScrapeAllowFallback] = useState<boolean>(() => {
    return config?.enable_scrape_fallback !== false;
  });

  // Médias sélectionnés pour importation différée (sauvegardés lors de la validation finale du SKU)
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>(() => {
    try {
      const attrs = typeof productData.attributes === "string" ? JSON.parse(productData.attributes || "{}") : (productData.attributes || {});
      return attrs.scrape_image_urls || (productData.image_path && productData.image_path.startsWith("http") ? [productData.image_path] : []);
    } catch {
      return [];
    }
  });

  const localDocInputRef = useRef<HTMLInputElement>(null);

  const [selectedPdfList, setSelectedPdfList] = useState<SelectedPdfItem[]>(() => {
    try {
      const attrs = typeof productData.attributes === "string" ? JSON.parse(productData.attributes || "{}") : (productData.attributes || {});
      if (Array.isArray(attrs.scrape_pdf_meta) && attrs.scrape_pdf_meta.length > 0) {
        return attrs.scrape_pdf_meta.map((m: any) => {
          const detected = detectDocumentType(m.url, m.title);
          const typeVal = m.docType || detected.value;
          const typeOpt = getDocumentTypeOption(typeVal);
          return {
            url: m.url,
            title: m.title || m.url.split("/").pop()?.split("?")[0] || "Notice technique",
            docType: typeVal,
            docTypeLabel: typeOpt.label,
            fileName: m.fileName,
          };
        });
      }
      const urls: string[] = attrs.scrape_pdf_urls || (productData.pdf_path && productData.pdf_path.startsWith("http") ? [productData.pdf_path] : []);
      return urls.map(u => {
        const title = u.split("/").pop()?.split("?")[0] || "Notice technique";
        const detected = detectDocumentType(u, title);
        return {
          url: u,
          title,
          docType: detected.value,
          docTypeLabel: detected.label,
        };
      });
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (autoFillChanges?.image_urls && autoFillChanges.image_urls.length > 0) {
      setSelectedImageUrls(prev => Array.from(new Set([...prev, ...(autoFillChanges.image_urls || [])])));
    }
    if (autoFillChanges?.pdf_urls && autoFillChanges.pdf_urls.length > 0) {
      setSelectedPdfList(prev => {
        const existingUrls = new Set(prev.map(p => p.url));
        const newItems: SelectedPdfItem[] = (autoFillChanges.pdf_urls || [])
          .filter(u => !existingUrls.has(u))
          .map(u => {
            const meta = (autoFillChanges as any)?.pdf_meta?.find((m: any) => m.url === u);
            const cand = candidates?.pdf_candidates?.find((c: any) => c.url === u);
            const title = meta?.title || cand?.title || u.split("/").pop()?.split("?")[0] || "Notice technique";
            const detected = detectDocumentType(u, title, cand?.snippet || "");
            const docType = meta?.docType || cand?.doc_type || detected.value;
            const typeOpt = getDocumentTypeOption(docType);
            return {
              url: u,
              title,
              docType,
              docTypeLabel: typeOpt.label,
            };
          });
        return [...prev, ...newItems];
      });
    }
  }, [autoFillChanges]);

  // Synchronisation lors de l'édition d'un produit existant ou changement de données
  useEffect(() => {
    try {
      const attrs = typeof productData.attributes === "string" ? JSON.parse(productData.attributes || "{}") : (productData.attributes || {});
      const imgUrls: string[] = attrs.scrape_image_urls || (productData.image_path && productData.image_path.startsWith("http") ? [productData.image_path] : []);
      if (imgUrls.length > 0) {
        setSelectedImageUrls(prev => Array.from(new Set([...prev, ...imgUrls])));
      }
      if (Array.isArray(attrs.scrape_pdf_meta) && attrs.scrape_pdf_meta.length > 0) {
        setSelectedPdfList(prev => {
          const existingUrls = new Set(prev.map(p => p.url));
          const newItems: SelectedPdfItem[] = attrs.scrape_pdf_meta
            .filter((m: any) => !existingUrls.has(m.url))
            .map((m: any) => {
              const detected = detectDocumentType(m.url, m.title);
              const typeVal = m.docType || detected.value;
              const typeOpt = getDocumentTypeOption(typeVal);
              return {
                url: m.url,
                title: m.title || m.url.split("/").pop()?.split("?")[0] || "Notice technique",
                docType: typeVal,
                docTypeLabel: typeOpt.label,
                fileName: m.fileName,
              };
            });
          return [...prev, ...newItems];
        });
      } else {
        const pdfUrls: string[] = attrs.scrape_pdf_urls || (productData.pdf_path && productData.pdf_path.startsWith("http") ? [productData.pdf_path] : []);
        if (pdfUrls.length > 0) {
          setSelectedPdfList(prev => {
            const existingUrls = new Set(prev.map(p => p.url));
            const newItems: SelectedPdfItem[] = pdfUrls
              .filter(u => !existingUrls.has(u))
              .map(u => {
                const cand = candidates?.pdf_candidates?.find((c: any) => c.url === u);
                const title = cand?.title || u.split("/").pop()?.split("?")[0] || "Notice technique";
                const detected = detectDocumentType(u, title, cand?.snippet || "");
                const typeVal = cand?.doc_type || detected.value;
                const typeOpt = getDocumentTypeOption(typeVal);
                return {
                  url: u,
                  title,
                  docType: typeVal,
                  docTypeLabel: typeOpt.label,
                };
              });
            return [...prev, ...newItems];
          });
        }
      }
    } catch {}
  }, [productData.sku, productData.attributes]);

  const currentActiveSku = (productData.sku || autofillCodeInput || "").trim().toUpperCase();
  const isCurrentScraping = !!(
    globalScrape &&
    currentActiveSku &&
    globalScrape.sku.toUpperCase() === currentActiveSku
  );

  const applySupplierScrape = (scraped: SupplierScrapeResult) => {
    let newSku = productData.sku;
    if (!isEdit) {
      if (scraped.mpn) {
        if (!productData.sku || productData.sku.trim() === autofillCodeInput.trim() || autofillType !== "mpn") {
          newSku = scraped.mpn.trim().toUpperCase();
          if (onChangeSku) onChangeSku(newSku);
        }
      } else if (!productData.sku && autofillCodeInput.trim() && autofillType === "mpn") {
        newSku = autofillCodeInput.trim().toUpperCase();
        if (onChangeSku) onChangeSku(newSku);
      }
    }

    setProductData((prev: any) => {
      const updated = { ...prev };
      if (!isEdit && newSku) updated.sku = newSku;
      if (scraped.label) updated.label = scraped.label;
      if (scraped.brand) updated.brand = scraped.brand;
      if (scraped.mpn) updated.mpn = scraped.mpn;
      if (scraped.price > 0) updated.price = String(scraped.price).replace(".", ",");
      if (scraped.category) updated.category = scraped.category;
      if (scraped.subCategory) updated.sub_category = scraped.subCategory;
      if (scraped.largeur) updated.largeur = scraped.largeur;
      if (scraped.hauteur) updated.hauteur = scraped.hauteur;
      if (scraped.profondeur) updated.profondeur = scraped.profondeur;
      if (scraped.poids) updated.poids = scraped.poids;
      if (scraped.notes) {
        updated.notes = prev.notes ? `${prev.notes}\n${scraped.notes}` : scraped.notes;
      }
      return updated;
    });

    if (scraped.vpcSite) {
      setVpcSite(scraped.vpcSite);
    } else if (autofillType !== "mpn") {
      setVpcSite(autofillType);
    }

    if (scraped.vpcCode) {
      setVpcCode(scraped.vpcCode);
    } else if (autofillType !== "mpn" && autofillCodeInput.trim()) {
      setVpcCode(autofillCodeInput.trim());
    }

    if ((scraped.image_urls && scraped.image_urls.length > 0) || (scraped.pdf_urls && scraped.pdf_urls.length > 0)) {
      setCandidates((prev: any) => ({
        ...prev,
        scraped_at: new Date().toISOString(),
        source_url: scraped.source_url || prev?.source_url,
        image_candidates: [
          ...(prev?.image_candidates || []),
          ...(scraped.image_urls || []).map((url) => ({
            url,
            confidence: 1.0,
            source: { provider: scraped.vpcSite || "Fournisseur" },
          })),
        ],
        pdf_candidates: [
          ...(prev?.pdf_candidates || []),
          ...(scraped.pdf_urls || []).map((url) => ({
            url,
            title: "Fiche technique / Notice",
            confidence: 1.0,
            source: { provider: scraped.vpcSite || "Fournisseur" },
          })),
        ],
      }));
    }
  };

  const processParsedSupplierData = async (parsed: SupplierScrapeResult) => {
    // 1. Déterminer le SKU cible : la référence MPN trouvée prime sur le code fournisseur
    let targetSku = productData.sku;
    if (!isEdit) {
      if (parsed.mpn) {
        if (!productData.sku || productData.sku.trim() === autofillCodeInput.trim() || autofillType !== "mpn") {
          targetSku = parsed.mpn.trim().toUpperCase();
        }
      } else if (!targetSku && autofillCodeInput.trim() && autofillType === "mpn") {
        targetSku = autofillCodeInput.trim().toUpperCase();
      }
    }
    if (!targetSku) targetSku = (parsed.mpn || parsed.vpcCode || autofillCodeInput || "ARTICLE").toUpperCase();

    // 2. Pré-remplir les champs du formulaire
    applySupplierScrape(parsed);

    // 3. Générer les candidats structurés et les persister dans le cache
    const candidateObj = buildCandidatesFromSupplierData(parsed, targetSku);
    setCandidates(candidateObj);

    try {
      await invoke("save_scrape_candidates", { sku: targetSku, candidates: candidateObj });
      if (autofillCodeInput && autofillCodeInput.trim().toUpperCase() !== targetSku) {
        await invoke("save_scrape_candidates", { sku: autofillCodeInput.trim().toUpperCase(), candidates: candidateObj });
      }
    } catch (e) {
      console.warn("[ProductForm] Erreur persistance candidats :", e);
    }

    setPasteFeedback(`✅ Fiche fournisseur importée : ${parsed.label || parsed.mpn || "OK"}`);
    setTimeout(() => setPasteFeedback(null), 5000);

    // 4. Ouvrir immédiatement la modale visuelle de sélection des candidats (photos, pdfs, propriétés)
    if (onOpenAutoFill) {
      onOpenAutoFill(targetSku, isEdit);
    }
  };

  const handleSmartPasteSupplier = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().length > 5) {
          const parsed = parseSupplierData(text);
          if (parsed.label || parsed.mpn || parsed.vpcCode || parsed.price > 0) {
            await processParsedSupplierData(parsed);
            return;
          }
        }
      }
    } catch (e) {
      console.info("[ProductForm] Presse-papiers direct non accessible :", e);
    }
    setShowPasteModal(true);
  };

  const handleProcessManualPaste = async () => {
    if (!pasteRawInput.trim()) return;
    const parsed = parseSupplierData(pasteRawInput);
    setShowPasteModal(false);
    setPasteRawInput("");
    await processParsedSupplierData(parsed);
  };

  const suggestedImageQuery = [
    productData.brand,
    productData.mpn || productData.sku || autofillCodeInput,
    productData.label
  ].filter(Boolean).join(" ").trim() || (productData.sku || autofillCodeInput || "");

  const suggestedDocQuery = [
    productData.brand,
    productData.mpn || productData.sku || autofillCodeInput,
    "datasheet notice"
  ].filter(Boolean).join(" ").trim() || (productData.sku || autofillCodeInput || "");

  // Pré-remplit véritablement la valeur des champs de recherche tant que l'utilisateur ne les a pas modifiés manuellement
  useEffect(() => {
    if (!hasEditedImageQuery && suggestedImageQuery) {
      setImageScrapeQuery(suggestedImageQuery);
    }
  }, [suggestedImageQuery, hasEditedImageQuery]);

  useEffect(() => {
    if (!hasEditedDocQuery && suggestedDocQuery) {
      setDocScrapeQuery(suggestedDocQuery);
    }
  }, [suggestedDocQuery, hasEditedDocQuery]);

  const loadMedia = async () => {
    const sku = (productData.sku || autofillCodeInput || "").toUpperCase().trim();
    if (sku && config) {
      try {
        const imgs: string[] = await invoke("list_sku_images", {
          networkPath: config.network_path,
          sku: sku,
        });
        setActiveImages(imgs || []);
        const pdfs: string[] = await invoke("list_sku_pdfs", {
          networkPath: config.network_path,
          sku: sku,
        });
        setActivePdfs(pdfs || []);
      } catch (err) {
        console.error("Error loading media in form:", err);
      }
    }
  };

  useEffect(() => {
    const sku = (productData.sku || autofillCodeInput || "").toUpperCase().trim();
    if (sku) {
      invoke("get_scrape_candidates", { sku })
        .then((res: any) => {
          if (res) {
            setCandidates(res);
          }
        })
        .catch((err) => console.error("Error loading candidates:", err));
      loadMedia();
    }
  }, [isEdit, productData.sku, autofillCodeInput]);

  const mediaFeedbackTimerRef = useRef<any>(null);
  const showMediaFeedback = (msg: string) => {
    if (mediaFeedbackTimerRef.current) {
      clearTimeout(mediaFeedbackTimerRef.current);
    }
    setManualMediaFeedback(msg);
    mediaFeedbackTimerRef.current = setTimeout(() => {
      setManualMediaFeedback(null);
      mediaFeedbackTimerRef.current = null;
    }, 2800);
  };

  const handleLocalDocSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newItems: SelectedPdfItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buffer = await file.arrayBuffer();
        const u8 = new Uint8Array(buffer);
        const blobUrl = URL.createObjectURL(new Blob([u8], { type: "application/pdf" }));
        const detected = detectDocumentType("", file.name);
        newItems.push({
          url: blobUrl,
          title: file.name,
          docType: detected.value,
          docTypeLabel: detected.label,
          fileData: Array.from(u8),
          fileName: file.name,
          isLocalFile: true,
        });
      } catch (err) {
        console.error("Erreur lecture PDF local :", err);
      }
    }
    const updated = [...newItems, ...selectedPdfList];
    setSelectedPdfList(updated);
    syncMediaToProductData(selectedImageUrls, updated);
    showMediaFeedback(`✅ ${newItems.length} document(s) local(aux) sélectionné(s) pour l'enregistrement !`);
    if (localDocInputRef.current) localDocInputRef.current.value = "";
  };

  const syncMediaToProductData = (newImages: string[], newPdfs: SelectedPdfItem[]) => {
    setProductData((prev: any) => {
      let attrs: any = {};
      try {
        attrs = typeof prev.attributes === "string" ? JSON.parse(prev.attributes || "{}") : (prev.attributes || {});
      } catch {}
      attrs.scrape_image_urls = newImages;
      attrs.scrape_pdf_urls = newPdfs.map(p => p.url);
      attrs.scrape_pdf_meta = newPdfs.map(p => ({
        url: p.url,
        title: p.title,
        docType: p.docType,
        docTypeLabel: p.docTypeLabel,
        fileName: p.fileName,
      }));
      if (newPdfs.length > 0) {
        attrs.scrape_doc_url = newPdfs[0].url;
      }
      const pendingFiles = newPdfs
        .filter(p => p.fileData && p.fileName)
        .map(p => ({ fileName: p.fileName!, fileData: p.fileData!, docType: p.docType }));
      return {
        ...prev,
        pending_pdf_files: pendingFiles,
        image_path: prev.image_path || (newImages.length > 0 ? newImages[0] : null),
        pdf_path: prev.pdf_path || (newPdfs.length > 0 ? newPdfs[0].url : null),
        attributes: JSON.stringify(attrs),
      };
    });
  };

  const toggleSelectImage = (url: string) => {
    const isSelected = selectedImageUrls.includes(url);
    const updated = isSelected ? selectedImageUrls.filter(u => u !== url) : [...selectedImageUrls, url];
    setSelectedImageUrls(updated);
    syncMediaToProductData(updated, selectedPdfList);
    showMediaFeedback(isSelected ? "Image retirée de la sélection." : "✅ Image sélectionnée pour l'article !");
  };

  const toggleSelectPdf = (url: string, title?: string, candidateDocType?: string) => {
    const isSelected = selectedPdfList.some(p => p.url === url);
    if (isSelected) {
      const updated = selectedPdfList.filter(p => p.url !== url);
      setSelectedPdfList(updated);
      syncMediaToProductData(selectedImageUrls, updated);
      showMediaFeedback("Document retiré de la sélection.");
    } else {
      const cand = candidates?.pdf_candidates?.find((c: any) => c.url === url);
      const resolvedTitle = title || cand?.title || url.split("/").pop()?.split("?")[0] || "Notice technique";
      const detected = detectDocumentType(url, resolvedTitle, cand?.snippet || "");
      const finalDocType = candidateDocType || cand?.doc_type || detected.value;
      const typeOpt = getDocumentTypeOption(finalDocType);
      const updated: SelectedPdfItem[] = [
        ...selectedPdfList,
        {
          url,
          title: resolvedTitle,
          docType: finalDocType,
          docTypeLabel: typeOpt.label,
        }
      ];
      setSelectedPdfList(updated);
      syncMediaToProductData(selectedImageUrls, updated);
      showMediaFeedback(`✅ Document sélectionné (${typeOpt.label}) !`);
    }
  };

  const handleChangeDocType = (url: string, newDocType: string) => {
    const typeOpt = getDocumentTypeOption(newDocType);
    const updated = selectedPdfList.map(item => {
      if (item.url === url) {
        return {
          ...item,
          docType: newDocType,
          docTypeLabel: typeOpt.label,
        };
      }
      return item;
    });
    setSelectedPdfList(updated);
    syncMediaToProductData(selectedImageUrls, updated);
  };

  const handleScrapeImages = async (overrideQuery?: string | React.MouseEvent) => {
    const rawQ = typeof overrideQuery === "string" ? overrideQuery : imageScrapeQuery;
    const q = (rawQ.trim() || suggestedImageQuery).trim();
    if (!q) {
      setImageScrapeFeedback("⚠️ Indiquez au moins une référence ou marque.");
      setTimeout(() => setImageScrapeFeedback(null), 4000);
      return;
    }
    setIsScrapingImages(true);
    setImageScrapeFeedback("⏳ Recherche d'images sur SearXNG...");
    try {
      const results = await searchSearxngImages(q);
      if (results && results.length > 0) {
        setCandidates((prev: any) => {
          const existingUrls = new Set((prev?.image_candidates || []).map((c: any) => c.url));
          const newCandidates = results.filter((c: any) => !existingUrls.has(c.url));
          const updated = {
            ...prev,
            image_candidates: [...newCandidates, ...(prev?.image_candidates || [])],
          };
          const targetSku = (productData.sku || autofillCodeInput || "").toUpperCase().trim();
          if (targetSku) {
            invoke("save_scrape_candidates", { sku: targetSku, candidates: updated }).catch(() => {});
          }
          return updated;
        });
        setImageScrapeFeedback(`✅ ${results.length} image(s) trouvée(s) pour « ${q} »`);
      } else {
        setImageScrapeFeedback(`⚠️ Aucune image trouvée pour « ${q} ».`);
      }
    } catch (err: any) {
      console.error("Erreur scraping images :", err);
      setImageScrapeFeedback(`❌ Erreur : ${err.message || String(err)}`);
    } finally {
      setIsScrapingImages(false);
      setTimeout(() => setImageScrapeFeedback(null), 6000);
    }
  };

  const handleScrapeDocs = async (overrideQuery?: string | React.MouseEvent) => {
    const rawQ = typeof overrideQuery === "string" ? overrideQuery : docScrapeQuery;
    const q = (rawQ.trim() || suggestedDocQuery).trim();
    if (!q) {
      setDocScrapeFeedback("⚠️ Indiquez au moins une référence ou marque.");
      setTimeout(() => setDocScrapeFeedback(null), 4000);
      return;
    }
    setIsScrapingDocs(true);
    setDocScrapeFeedback("⏳ Recherche de documents PDF sur SearXNG...");
    try {
      const results = await searchSearxngPdfs(q);
      if (results && results.length > 0) {
        setCandidates((prev: any) => {
          const existingUrls = new Set((prev?.pdf_candidates || []).map((c: any) => c.url));
          const newCandidates = results.filter((c: any) => !existingUrls.has(c.url));
          const updated = {
            ...prev,
            pdf_candidates: [...newCandidates, ...(prev?.pdf_candidates || [])],
          };
          const targetSku = (productData.sku || autofillCodeInput || "").toUpperCase().trim();
          if (targetSku) {
            invoke("save_scrape_candidates", { sku: targetSku, candidates: updated }).catch(() => {});
          }
          return updated;
        });
        setDocScrapeFeedback(`✅ ${results.length} document(s) trouvé(s) pour « ${q} »`);
      } else {
        setDocScrapeFeedback(`⚠️ Aucun document PDF trouvé pour « ${q} ».`);
      }
    } catch (err: any) {
      console.error("Erreur scraping documents :", err);
      setDocScrapeFeedback(`❌ Erreur : ${err.message || String(err)}`);
    } finally {
      setIsScrapingDocs(false);
      setTimeout(() => setDocScrapeFeedback(null), 6000);
    }
  };

  const handleAddManualImage = () => {
    const url = manualImageUrl.trim();
    if (!url) return;
    if (!selectedImageUrls.includes(url)) {
      const updated = [url, ...selectedImageUrls];
      setSelectedImageUrls(updated);
      syncMediaToProductData(updated, selectedPdfList);
      showMediaFeedback("✅ Image ajoutée et sélectionnée pour l'article !");
    } else {
      showMediaFeedback("ℹ️ Cette image est déjà sélectionnée.");
    }
    setManualImageUrl("");
  };

  const handleAddManualDoc = () => {
    const url = manualDocUrl.trim();
    if (!url) return;
    if (!selectedPdfList.some(p => p.url === url)) {
      const title = url.split("/").pop()?.split("?")[0] || "Document PDF";
      const detected = detectDocumentType(url, title);
      const updated: SelectedPdfItem[] = [
        {
          url,
          title,
          docType: detected.value,
          docTypeLabel: detected.label,
        },
        ...selectedPdfList,
      ];
      setSelectedPdfList(updated);
      syncMediaToProductData(selectedImageUrls, updated);
      showMediaFeedback(`✅ Document ajouté (${detected.label}) et sélectionné !`);
    } else {
      showMediaFeedback("ℹ️ Ce document est déjà sélectionné.");
    }
    setManualDocUrl("");
  };

  const handleDeleteMedia = async (mediaType: "image" | "pdf", path: string) => {
    const targetSku = (productData.sku || autofillCodeInput || "").toUpperCase().trim();
    if (!config || !targetSku) return;
    try {
      await invoke("delete_media", {
        networkPath: config.network_path,
        trigramme: config.trigramme,
        sku: targetSku,
        mediaType,
        path
      });
      setInlineConfirmMedia(null);
      await loadMedia();
    } catch (err: any) {
      console.error("Error deleting media:", err);
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

  const renderImagesTab = () => {
    const sku = (productData.sku || autofillCodeInput || "").toUpperCase();
    const unimportedSelectedImages = selectedImageUrls.filter(u => !activeImages.some(ai => ai.includes(u)));
    const totalImages = activeImages.length + unimportedSelectedImages.length;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", paddingBottom: "1rem" }}>
        {/* 1. Scraper des images sur le Web */}
        <div className="modal-field-group" style={{ backgroundColor: "var(--bg-secondary)", padding: "0.75rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <div className="modal-field-group-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.3rem" }}>
              🌐 Rechercher / Scraper des images sur le Web
            </div>
            <span style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>via SearXNG</span>
          </div>
          <p style={{ fontSize: "11px", color: "var(--text-tertiary)", margin: "0 0 0.5rem 0" }}>
            Lancez une recherche automatique de photos produits avec les mots-clés de l'article :
          </p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="image-scrape-query"
              type="text"
              placeholder="Mots-clés de recherche (ex: Schneider LC1D09)..."
              value={imageScrapeQuery}
              onChange={(e) => {
                setHasEditedImageQuery(true);
                setImageScrapeQuery(e.target.value);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScrapeImages(); } }}
              style={{ flex: 1, padding: "0.45rem 0.6rem", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)" }}
            />
            {hasEditedImageQuery && (
              <button
                type="button"
                className="btn"
                title="Réinitialiser avec les informations de l'article"
                onClick={() => {
                  setHasEditedImageQuery(false);
                  setImageScrapeQuery(suggestedImageQuery);
                }}
                style={{ padding: "0.45rem 0.6rem", fontSize: "12px", minWidth: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ↺
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleScrapeImages()}
              disabled={isScrapingImages}
              style={{ minWidth: "140px", fontSize: "12px", padding: "0.45rem 0.8rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}
            >
              {isScrapingImages ? "⏳ Recherche..." : "🔍 Scraper images"}
            </button>
          </div>
          {imageScrapeFeedback && (
            <div style={{ fontSize: "11px", marginTop: "0.4rem", color: imageScrapeFeedback.startsWith("✅") ? "var(--success)" : imageScrapeFeedback.startsWith("⚠️") ? "var(--warning)" : "var(--accent)", fontWeight: 500 }}>
              {imageScrapeFeedback}
            </div>
          )}
        </div>

        {/* 2. Ajout manuel d'URL */}
        <div className="modal-field-group">
          <div className="modal-field-group-title">➕ Ou ajouter manuellement par URL</div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="manual-image-url"
              type="url"
              placeholder="URL directe de l'image (https://...)"
              value={manualImageUrl}
              onChange={(e) => setManualImageUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddManualImage(); } }}
              style={{ flex: 1, padding: "0.4rem 0.6rem", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)" }}
            />
            <button
              type="button"
              className="btn"
              onClick={handleAddManualImage}
              disabled={!manualImageUrl.trim()}
              style={{ minWidth: "100px", fontSize: "12px", padding: "0.4rem 0.8rem" }}
            >
              ➕ Ajouter
            </button>
          </div>
          {config?.image_rename_convention && (
            <div style={{ fontSize: "10px", color: "var(--text-tertiary)", marginTop: "0.25rem" }}>
              📌 Convention de nommage : <strong>{
                config.image_rename_convention
                  .replace(/{sku}/gi, sku || "SKU")
                  .replace(/{brand}/gi, productData.brand || "MARQUE")
                  .replace(/{mpn}/gi, productData.mpn || "MPN")
                  .replace(/{description}/gi, productData.label || "DESCRIPTION")
                  .replace(/{index}/gi, "1")
              }</strong>
            </div>
          )}
        </div>

        {/* 3. Images sélectionnées & importées */}
        <div className="modal-field-group">
          <div className="modal-field-group-title">
            📸 Images pour cet article ({totalImages})
          </div>
          {totalImages === 0 ? (
            <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontStyle: "italic" }}>
              Aucune image sélectionnée pour ce SKU. Cliquez sur une image candidate ci-dessous pour la sélectionner.
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {/* Images déjà présentes sur le disque */}
              {activeImages.map((path, idx) => {
                const fullUrl = convertFileSrc(`${config?.network_path}/${path}`.replace(/\\/g, "/"));
                const isDeleting = inlineConfirmMedia?.type === "image" && inlineConfirmMedia.path === path;
                return (
                  <div key={`disk-${idx}`} style={{ position: "relative", width: "96px", height: "96px", border: "1px solid var(--border-color)", borderRadius: "6px", overflow: "hidden", backgroundColor: "var(--bg-secondary)" }}>
                    <img src={fullUrl} alt="imported" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <span style={{ position: "absolute", top: "3px", left: "3px", backgroundColor: "rgba(16, 185, 129, 0.85)", color: "#fff", borderRadius: "3px", padding: "1px 4px", fontSize: "9px", fontWeight: "600" }}>
                      💾 Disque
                    </span>
                    <button
                      type="button"
                      onClick={() => window.open(fullUrl, "_blank")}
                      style={{ position: "absolute", bottom: "3px", right: "3px", backgroundColor: "rgba(15, 23, 42, 0.85)", color: "#fff", border: "1px solid rgba(255, 255, 255, 0.2)", borderRadius: "4px", padding: "2px 6px", cursor: "pointer", fontSize: "10px", fontWeight: "600" }}
                      title="Voir en grand"
                    >
                      👁️ Voir
                    </button>
                    {isDeleting ? (
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                        <button type="button" onClick={() => handleDeleteMedia("image", path)} style={{ backgroundColor: "var(--danger)", color: "#fff", border: "none", borderRadius: "3px", padding: "2px 4px", fontSize: "9px", cursor: "pointer", fontWeight: "bold" }}>Confirmer</button>
                        <button type="button" onClick={() => setInlineConfirmMedia(null)} style={{ backgroundColor: "#4b5563", color: "#fff", border: "none", borderRadius: "3px", padding: "2px 4px", fontSize: "9px", cursor: "pointer" }}>Annuler</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setInlineConfirmMedia({ type: "image", path })} style={{ position: "absolute", top: "3px", right: "3px", backgroundColor: "rgba(239, 68, 68, 0.85)", color: "#fff", border: "none", borderRadius: "50%", width: "18px", height: "18px", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center" }} title="Supprimer du disque">✕</button>
                    )}
                  </div>
                );
              })}

              {/* Images sélectionnées prêtes à être rattachées */}
              {unimportedSelectedImages.map((url, idx) => (
                <div key={`sel-${idx}`} style={{ position: "relative", width: "96px", height: "96px", border: "2px solid var(--accent, #6366f1)", borderRadius: "6px", overflow: "hidden", backgroundColor: "var(--bg-secondary)", boxShadow: "0 0 10px rgba(99, 102, 241, 0.25)" }}>
                  <img src={url} alt="selected" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <span style={{ position: "absolute", top: "3px", left: "3px", backgroundColor: "var(--accent, #6366f1)", color: "#fff", borderRadius: "3px", padding: "1px 4px", fontSize: "9px", fontWeight: "600" }}>
                    ✓ Prête
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleSelectImage(url)}
                    style={{ position: "absolute", top: "3px", right: "3px", backgroundColor: "rgba(239, 68, 68, 0.85)", color: "#fff", border: "none", borderRadius: "50%", width: "18px", height: "18px", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center" }}
                    title="Retirer de la sélection"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(url, "_blank")}
                    style={{ position: "absolute", bottom: "3px", right: "3px", backgroundColor: "rgba(15, 23, 42, 0.85)", color: "#fff", border: "1px solid rgba(255, 255, 255, 0.2)", borderRadius: "4px", padding: "2px 6px", cursor: "pointer", fontSize: "10px", fontWeight: "600" }}
                    title="Voir en grand"
                  >
                    👁️ Voir
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. Images candidates (scraping) */}
        <div className="modal-field-group">
          <div className="modal-field-group-title">
            🌐 Images candidates (scraping) {candidates?.image_candidates?.length ? `(${candidates.image_candidates.length})` : ""}
          </div>
          {candidates?.image_candidates && candidates.image_candidates.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {candidates.image_candidates.slice(0, 18).map((img: any, idx: number) => {
                const isSelected = selectedImageUrls.includes(img.url);
                return (
                  <div
                    key={idx}
                    onClick={() => toggleSelectImage(img.url)}
                    style={{
                      position: "relative",
                      width: "96px",
                      height: "96px",
                      border: isSelected ? "2px solid var(--accent, #6366f1)" : "1px solid var(--border-color)",
                      borderRadius: "6px",
                      overflow: "hidden",
                      backgroundColor: "var(--bg-secondary)",
                      cursor: "pointer",
                      boxShadow: isSelected ? "0 0 12px rgba(99, 102, 241, 0.35)" : "none",
                      transition: "all 0.15s ease",
                    }}
                    title={isSelected ? "Cliquer pour retirer cette image" : "Cliquer pour sélectionner cette image"}
                  >
                    <img
                      src={img.url}
                      alt="candidate"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => {
                        const el = e.currentTarget;
                        if (img.thumbnail_url && el.src !== img.thumbnail_url) el.src = img.thumbnail_url;
                      }}
                    />
                    {isSelected ? (
                      <span
                        style={{
                          position: "absolute",
                          top: "3px",
                          right: "3px",
                          backgroundColor: "var(--accent, #6366f1)",
                          color: "#fff",
                          borderRadius: "50%",
                          width: "18px",
                          height: "18px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          fontWeight: "bold",
                          boxShadow: "0 2px 4px rgba(0,0,0,0.5)",
                        }}
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        style={{
                          position: "absolute",
                          top: "3px",
                          right: "3px",
                          backgroundColor: "rgba(0,0,0,0.6)",
                          color: "#fff",
                          borderRadius: "50%",
                          width: "18px",
                          height: "18px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                        }}
                      >
                        +
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(img.url, "_blank");
                      }}
                      style={{
                        position: "absolute",
                        bottom: "3px",
                        right: "3px",
                        backgroundColor: "rgba(15, 23, 42, 0.85)",
                        color: "#fff",
                        border: "1px solid rgba(255, 255, 255, 0.2)",
                        borderRadius: "4px",
                        padding: "2px 6px",
                        cursor: "pointer",
                        fontSize: "10px",
                        fontWeight: "600",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                        display: "flex",
                        alignItems: "center",
                        gap: "2px",
                      }}
                      title="Ouvrir l'image en grand dans un nouvel onglet"
                    >
                      👁️ Voir
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontStyle: "italic" }}>
              💡 Cliquez sur le bouton « 🔍 Scraper images » ci-dessus pour lancer la recherche d'images en ligne.
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderDocumentsTab = () => {
    const sku = (productData.sku || autofillCodeInput || "").toUpperCase();
    const unimportedSelectedPdfs = selectedPdfList.filter(p => !activePdfs.some(ap => ap.includes(p.url)));
    const totalDocs = activePdfs.length + unimportedSelectedPdfs.length;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", paddingBottom: "1rem" }}>
        {/* 1. Scraper des documents / notices sur le Web */}
        <div className="modal-field-group" style={{ backgroundColor: "var(--bg-secondary)", padding: "0.75rem", borderRadius: "6px", border: "1px solid var(--border-color)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <div className="modal-field-group-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.3rem" }}>
              🌐 Rechercher / Scraper des notices & fiches techniques PDF
            </div>
            <span style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>via SearXNG</span>
          </div>
          <p style={{ fontSize: "11px", color: "var(--text-tertiary)", margin: "0 0 0.5rem 0" }}>
            Recherche ciblée de documentations, manuels ou fiches techniques PDF :
          </p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="doc-scrape-query"
              type="text"
              placeholder="Mots-clés de recherche (ex: Schneider LC1D09 notice)..."
              value={docScrapeQuery}
              onChange={(e) => {
                setHasEditedDocQuery(true);
                setDocScrapeQuery(e.target.value);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScrapeDocs(); } }}
              style={{ flex: 1, padding: "0.45rem 0.6rem", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)" }}
            />
            {hasEditedDocQuery && (
              <button
                type="button"
                className="btn"
                title="Réinitialiser avec les informations de l'article"
                onClick={() => {
                  setHasEditedDocQuery(false);
                  setDocScrapeQuery(suggestedDocQuery);
                }}
                style={{ padding: "0.45rem 0.6rem", fontSize: "12px", minWidth: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ↺
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleScrapeDocs()}
              disabled={isScrapingDocs}
              style={{ minWidth: "150px", fontSize: "12px", padding: "0.45rem 0.8rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}
            >
              {isScrapingDocs ? "⏳ Recherche..." : "🔍 Scraper notices"}
            </button>
          </div>
          {docScrapeFeedback && (
            <div style={{ fontSize: "11px", marginTop: "0.4rem", color: docScrapeFeedback.startsWith("✅") ? "var(--success)" : docScrapeFeedback.startsWith("⚠️") ? "var(--warning)" : "var(--accent)", fontWeight: 500 }}>
              {docScrapeFeedback}
            </div>
          )}
        </div>

        {/* 2. Ajout manuel document */}
        <div className="modal-field-group">
          <div className="modal-field-group-title">➕ Ajouter un document (URL ou fichier sur votre disque)</div>
          <input
            type="file"
            ref={localDocInputRef}
            accept=".pdf,application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={handleLocalDocSelected}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id="manual-doc-url"
              type="url"
              placeholder="URL directe du document PDF (https://...)"
              value={manualDocUrl}
              onChange={(e) => setManualDocUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddManualDoc(); } }}
              style={{ flex: 1, padding: "0.4rem 0.6rem", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)" }}
            />
            <button
              type="button"
              className="btn"
              onClick={handleAddManualDoc}
              disabled={!manualDocUrl.trim()}
              style={{ minWidth: "90px", fontSize: "12px", padding: "0.4rem 0.8rem" }}
            >
              ➕ Ajouter URL
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => localDocInputRef.current?.click()}
              style={{ minWidth: "140px", fontSize: "12px", padding: "0.4rem 0.8rem", display: "flex", alignItems: "center", gap: "5px" }}
              title="Sélectionner un ou plusieurs fichiers PDF sur votre ordinateur"
            >
              📁 Fichier local PDF
            </button>
          </div>
          {config?.pdf_rename_convention && (
            <div style={{ fontSize: "10px", color: "var(--text-tertiary)", marginTop: "0.25rem" }}>
              📌 Convention de nommage : <strong>{
                config.pdf_rename_convention
                  .replace(/{sku}/gi, sku || "SKU")
                  .replace(/{brand}/gi, productData.brand || "MARQUE")
                  .replace(/{mpn}/gi, productData.mpn || "MPN")
                  .replace(/{description}/gi, productData.label || "DESCRIPTION")
                  .replace(/{type}/gi, "datasheet")
              }</strong>
            </div>
          )}
        </div>

        {/* 3. Documents sélectionnés & importés */}
        <div className="modal-field-group">
          <div className="modal-field-group-title">
            📄 Documents pour cet article ({totalDocs})
          </div>
          {totalDocs === 0 ? (
            <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontStyle: "italic" }}>
              Aucun document sélectionné pour ce SKU. Cliquez sur un document candidat ci-dessous pour le sélectionner.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {/* Documents physiques sur disque */}
              {activePdfs.map((path, idx) => {
                const name = path.split('/').pop() || "";
                const blobUrl = convertFileSrc(path) || (path.startsWith("http") ? path : "");
                const isDeleting = inlineConfirmMedia?.type === "pdf" && inlineConfirmMedia.path === path;
                return (
                  <div key={`disk-${idx}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "var(--bg-secondary)", padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", gap: "8px" }}>
                    <span style={{ fontSize: "12px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", flex: 1, color: "var(--text-primary)" }} title={name}>
                      📄 {name}
                    </span>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", color: "var(--success)", backgroundColor: "rgba(16, 185, 129, 0.15)", padding: "2px 6px", borderRadius: "3px", fontWeight: "600" }}>
                        💾 Disque
                      </span>
                      {blobUrl && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => window.open(blobUrl, "_blank")}
                          style={{ fontSize: "11px", padding: "2px 8px", height: "24px", display: "flex", alignItems: "center", gap: "4px" }}
                          title="Voir le document dans un nouvel onglet"
                        >
                          👁️ Voir
                        </button>
                      )}
                      {isDeleting ? (
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <button type="button" onClick={() => handleDeleteMedia("pdf", path)} style={{ backgroundColor: "var(--danger)", color: "#fff", border: "none", borderRadius: "3px", padding: "2px 6px", fontSize: "10px", cursor: "pointer", fontWeight: "bold" }}>Confirmer</button>
                          <button type="button" onClick={() => setInlineConfirmMedia(null)} style={{ backgroundColor: "transparent", color: "var(--text-secondary)", border: "none", fontSize: "10px", cursor: "pointer" }}>Annuler</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setInlineConfirmMedia({ type: "pdf", path })} style={{ backgroundColor: "transparent", color: "var(--danger)", border: "none", cursor: "pointer", fontSize: "14px", padding: "0 4px" }} title="Supprimer du disque">✕</button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Documents candidats sélectionnés (prêts pour enregistrement JSON) */}
              {unimportedSelectedPdfs.map((pdfItem, idx) => {
                const curDocType = pdfItem.docType || "fiche_technique";
                return (
                  <div key={`sel-${idx}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(99, 102, 241, 0.08)", padding: "6px 10px", borderRadius: "6px", border: "1.5px solid var(--accent, #6366f1)", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: "12px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", flex: 1, color: "var(--text-primary)", fontWeight: "500" }} title={pdfItem.title || pdfItem.url}>
                        📄 {pdfItem.title || "Notice technique"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                      <select
                        value={curDocType}
                        onChange={(e) => handleChangeDocType(pdfItem.url, e.target.value)}
                        style={{
                          fontSize: "11px",
                          padding: "2px 6px",
                          height: "24px",
                          borderRadius: "4px",
                          backgroundColor: "var(--bg-secondary)",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border-color)",
                          cursor: "pointer",
                          fontWeight: "600",
                          outline: "none",
                        }}
                        title="Modifier le type de ce document (utilisé pour la balise {Type} du renommage)"
                      >
                        {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: "10px", color: "var(--accent)", backgroundColor: "rgba(99, 102, 241, 0.15)", padding: "2px 6px", borderRadius: "3px", fontWeight: "600" }}>
                        ✓ Prêt à enregistrer
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => window.open(pdfItem.url, "_blank")}
                        style={{ fontSize: "11px", padding: "2px 8px", height: "24px", display: "flex", alignItems: "center", gap: "4px" }}
                        title="Ouvrir et prévisualiser ce document"
                      >
                        👁️ Voir
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSelectPdf(pdfItem.url)}
                        style={{ backgroundColor: "transparent", color: "var(--text-tertiary)", border: "none", cursor: "pointer", fontSize: "13px", padding: "0 4px", fontWeight: "bold" }}
                        title="Retirer de la sélection"
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
                      >
                        ✕ Retirer
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4. Documents candidats (scraping) */}
        <div className="modal-field-group">
          <div className="modal-field-group-title">
            🌐 Documents candidats (scraping) {candidates?.pdf_candidates?.length ? `(${candidates.pdf_candidates.length})` : ""}
          </div>
          {candidates?.pdf_candidates && candidates.pdf_candidates.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {candidates.pdf_candidates.map((pdf: any, idx: number) => {
                const isSelected = selectedPdfList.some(p => p.url === pdf.url);
                const detected = detectDocumentType(pdf.url, pdf.title, pdf.snippet || "");
                const candDocType = pdf.doc_type || detected.value;
                const candDocTypeLabel = pdf.doc_type_label || detected.label;
                const typeOpt = getDocumentTypeOption(candDocType);
                return (
                  <div
                    key={idx}
                    onClick={() => toggleSelectPdf(pdf.url, pdf.title, candDocType)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      backgroundColor: isSelected ? "rgba(99, 102, 241, 0.14)" : "var(--bg-secondary)",
                      padding: "6px 10px",
                      borderRadius: "6px",
                      border: isSelected ? "1.5px solid var(--accent, #6366f1)" : "1px solid var(--border-color)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      boxShadow: isSelected ? "0 0 10px rgba(99, 102, 241, 0.2)" : "none",
                      gap: "8px",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "var(--border-hover, #64748b)";
                        e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.04)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "var(--border-color)";
                        e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "18px",
                          height: "18px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          backgroundColor: isSelected ? "var(--accent, #6366f1)" : "rgba(255, 255, 255, 0.08)",
                          color: isSelected ? "#fff" : "var(--text-tertiary)",
                          fontWeight: "bold",
                          transition: "all 0.15s ease",
                          flexShrink: 0,
                        }}
                      >
                        {isSelected ? "✓" : "+"}
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                          fontWeight: isSelected ? "600" : "400",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                        }}
                        title={pdf.title || pdf.url}
                      >
                        📄 {pdf.title || "Notice technique"}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          color: "#fff",
                          backgroundColor: typeOpt.badgeColor || "#3b82f6",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          fontWeight: "600",
                          flexShrink: 0,
                        }}
                        title={`Type détecté : ${candDocTypeLabel}`}
                      >
                        {candDocTypeLabel}
                      </span>
                      {pdf.source?.provider && (
                        <span style={{ fontSize: "10px", color: "var(--text-tertiary)", backgroundColor: "rgba(255, 255, 255, 0.05)", padding: "1px 5px", borderRadius: "3px", flexShrink: 0 }}>
                          {pdf.source.provider}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      {isSelected && (
                        <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: "600" }}>
                          ✓ Sélectionné
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(pdf.url, "_blank");
                        }}
                        style={{
                          fontSize: "11px",
                          padding: "3px 10px",
                          height: "26px",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          backgroundColor: "rgba(255, 255, 255, 0.06)",
                          border: "1px solid var(--border-color)",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          borderRadius: "4px",
                        }}
                        title="Consulter ce document PDF dans un nouvel onglet"
                      >
                        👁️ Voir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontStyle: "italic" }}>
              💡 Cliquez sur le bouton « 🔍 Scraper notices » ci-dessus pour rechercher des documents techniques en ligne.
            </p>
          )}
        </div>
      </div>
    );
  };

  function cleanNumericInput(value: string): string {
    let cleaned = value.replace(/\./g, ",");
    cleaned = cleaned.replace(/[^0-9,-]/g, "");
    return cleaned;
  }

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFormSubmit = async (e: React.FormEvent) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ position: "relative" }}>
        <div className="modal-header">
          <h3>{isEdit ? `Modifier le SKU : ${productData.sku}` : "Ajouter un nouveau SKU"}</h3>
          <button className="modal-close" onClick={onClose} disabled={isSubmitting}>×</button>
        </div>
        <form onSubmit={handleFormSubmit}>
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

            {/* Onglets du modal au sommet */}
            <div className="modal-tabs" style={{ display: "flex", gap: "0", borderBottom: "1px solid var(--border-color)", marginBottom: "1rem" }}>
              {(["general", "images", "documents"] as const).map((tab) => {
                const totalImages = activeImages.length + selectedImageUrls.filter(u => !activeImages.some(ai => ai.includes(u))).length;
                const totalDocs = activePdfs.length + selectedPdfList.filter(p => !activePdfs.some(ap => ap.includes(p.url))).length;
                const labels: Record<string, string> = {
                  general: "📝 Général",
                  images: `🖼️ Images${totalImages > 0 ? ` (${totalImages})` : candidates?.image_candidates?.length > 0 ? ` (${candidates.image_candidates.length})` : ""}`,
                  documents: `📄 Documents${totalDocs > 0 ? ` (${totalDocs})` : candidates?.pdf_candidates?.length > 0 ? ` (${candidates.pdf_candidates.length})` : ""}`,
                };
                return (
                  <button
                    key={tab}
                    type="button"
                    className={`modal-tab-btn ${activeTab === tab ? "active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: "0.5rem 1.1rem",
                      border: "none",
                      background: "none",
                      borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                      color: activeTab === tab ? "var(--text-primary)" : "var(--text-secondary)",
                      fontWeight: "600",
                      cursor: "pointer",
                      fontSize: "13px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>

            {activeTab === "general" ? (
              <>
                {/* Outil de recherche & Scraping dans l'affichage principal (Général) */}
                <div className="autofill-box" style={{ marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                    <div style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>🚀</span> Recherche & Scraping
                    </div>
                    <span style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>SearXNG & VPC</span>
                  </div>
                  <div className="autofill-box-row" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <select
                      id="modal-autofill-type"
                      value={autofillType}
                      onChange={(e) => setAutofillType(e.target.value)}
                      style={{ minWidth: "150px" }}
                    >
                      <option value="mpn">Réf. Fabricant (MPN)</option>
                      {config?.vpc_sites?.map((s) => (
                        <option key={s} value={s}>
                          Code {s}
                        </option>
                      ))}
                    </select>
                    <input
                      id="modal-autofill-code"
                      type="text"
                      placeholder={
                        autofillType === "mpn"
                          ? "Saisir la référence fabricant (MPN)..."
                          : `Code article / commande ${autofillType} (ex: 862-648)...`
                      }
                      value={autofillCodeInput}
                      onChange={(e) => {
                        setAutofillCodeInput(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onScrape(isEdit, {
                            includeImages: scrapeIncludeImages,
                            includeDocs: scrapeIncludeDocs,
                            allowFallback: scrapeAllowFallback
                          });
                        }
                      }}
                      style={{ flex: 1 }}
                    />
                    <button
                      id="modal-autofill-scrape-btn"
                      type="button"
                      className="btn btn-primary"
                      disabled={scrapeZoneLoading || (isCurrentScraping && globalScrape?.status === "InProgress")}
                      onClick={() => onScrape(isEdit, {
                        includeImages: scrapeIncludeImages,
                        includeDocs: scrapeIncludeDocs,
                        allowFallback: scrapeAllowFallback
                      })}
                      title={
                        scrapeIncludeImages && scrapeIncludeDocs
                          ? "Scraper les informations, les images et les documents PDF"
                          : scrapeIncludeImages
                          ? "Scraper les informations et les images"
                          : scrapeIncludeDocs
                          ? "Scraper les informations et les documents PDF"
                          : "Scraper les informations du produit (désignation, marque, MPN, prix, dimensions...)"
                      }
                      style={{ minWidth: "105px", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}
                    >
                      {isCurrentScraping && globalScrape?.status === "InProgress"
                        ? `⏳ ${Math.round((globalScrape?.progress || 0) * 100)}%`
                        : scrapeZoneLoading
                        ? "⏳ ..."
                        : "🚀 Scraper"}
                    </button>
                  </div>

                  {/* Options de scraping : Badges modernes interactifs */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap", padding: "0.2rem 0" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontWeight: "600", marginRight: "0.2rem" }}>Options :</span>
                    
                    <button
                      type="button"
                      id="scrape-opt-badge-images"
                      onClick={() => setScrapeIncludeImages(!scrapeIncludeImages)}
                      title={scrapeIncludeImages ? "Images incluses dans la recherche (cliquer pour désactiver)" : "Cliquer pour inclure la recherche automatique d'images"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 11px",
                        fontSize: "11px",
                        fontWeight: "600",
                        borderRadius: "20px",
                        cursor: "pointer",
                        border: scrapeIncludeImages
                          ? "1px solid var(--accent, #6366f1)"
                          : "1px solid var(--border-color)",
                        backgroundColor: scrapeIncludeImages
                          ? "rgba(99, 102, 241, 0.18)"
                          : "var(--bg-secondary)",
                        color: scrapeIncludeImages
                          ? "var(--accent, #818cf8)"
                          : "var(--text-secondary)",
                        boxShadow: scrapeIncludeImages
                          ? "0 0 10px rgba(99, 102, 241, 0.25)"
                          : "none",
                        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                        userSelect: "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!scrapeIncludeImages) {
                          e.currentTarget.style.borderColor = "var(--accent)";
                          e.currentTarget.style.color = "var(--text-primary)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!scrapeIncludeImages) {
                          e.currentTarget.style.borderColor = "var(--border-color)";
                          e.currentTarget.style.color = "var(--text-secondary)";
                        }
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          fontSize: "10px",
                          backgroundColor: scrapeIncludeImages
                            ? "var(--accent, #6366f1)"
                            : "rgba(255, 255, 255, 0.08)",
                          color: scrapeIncludeImages ? "#ffffff" : "var(--text-tertiary)",
                          transition: "all 0.2s ease",
                        }}
                      >
                        {scrapeIncludeImages ? "✓" : "+"}
                      </span>
                      <span>🖼️ Images</span>
                    </button>

                    <button
                      type="button"
                      id="scrape-opt-badge-docs"
                      onClick={() => setScrapeIncludeDocs(!scrapeIncludeDocs)}
                      title={scrapeIncludeDocs ? "Notices/PDF inclus dans la recherche (cliquer pour désactiver)" : "Cliquer pour inclure la recherche automatique de notices et fiches techniques PDF"}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 11px",
                        fontSize: "11px",
                        fontWeight: "600",
                        borderRadius: "20px",
                        cursor: "pointer",
                        border: scrapeIncludeDocs
                          ? "1px solid var(--accent, #6366f1)"
                          : "1px solid var(--border-color)",
                        backgroundColor: scrapeIncludeDocs
                          ? "rgba(99, 102, 241, 0.18)"
                          : "var(--bg-secondary)",
                        color: scrapeIncludeDocs
                          ? "var(--accent, #818cf8)"
                          : "var(--text-secondary)",
                        boxShadow: scrapeIncludeDocs
                          ? "0 0 10px rgba(99, 102, 241, 0.25)"
                          : "none",
                        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                        userSelect: "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!scrapeIncludeDocs) {
                          e.currentTarget.style.borderColor = "var(--accent)";
                          e.currentTarget.style.color = "var(--text-primary)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!scrapeIncludeDocs) {
                          e.currentTarget.style.borderColor = "var(--border-color)";
                          e.currentTarget.style.color = "var(--text-secondary)";
                        }
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          fontSize: "10px",
                          backgroundColor: scrapeIncludeDocs
                            ? "var(--accent, #6366f1)"
                            : "rgba(255, 255, 255, 0.08)",
                          color: scrapeIncludeDocs ? "#ffffff" : "var(--text-tertiary)",
                          transition: "all 0.2s ease",
                        }}
                      >
                        {scrapeIncludeDocs ? "✓" : "+"}
                      </span>
                      <span>📄 Notices & PDF</span>
                    </button>

                    <button
                      type="button"
                      id="scrape-opt-badge-fallback"
                      onClick={() => setScrapeAllowFallback(!scrapeAllowFallback)}
                      title={
                        scrapeAllowFallback
                          ? "Fallback Web actif : si le site ciblé ne renvoie rien, la recherche s'élargit à tout le Web (cliquer pour restreindre au domaine strict)"
                          : "Mode domaine strict actif : seules les données du domaine configuré sont acceptées (cliquer pour activer le fallback)"
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 11px",
                        fontSize: "11px",
                        fontWeight: "600",
                        borderRadius: "20px",
                        cursor: "pointer",
                        border: scrapeAllowFallback
                          ? "1px solid var(--accent, #6366f1)"
                          : "1px solid var(--border-color)",
                        backgroundColor: scrapeAllowFallback
                          ? "rgba(99, 102, 241, 0.18)"
                          : "var(--bg-secondary)",
                        color: scrapeAllowFallback
                          ? "var(--accent, #818cf8)"
                          : "var(--text-secondary)",
                        boxShadow: scrapeAllowFallback
                          ? "0 0 10px rgba(99, 102, 241, 0.25)"
                          : "none",
                        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                        userSelect: "none",
                      }}
                    >
                      <span style={{ fontSize: "12px" }}>{scrapeAllowFallback ? "🌐" : "🔒"}</span>
                      <span>{scrapeAllowFallback ? "Fallback Web (ON)" : "Domaine strict (OFF)"}</span>
                    </button>
                  </div>

                  {/* Boutons d'action auxiliaires : Revoir variantes et Coller fiche fournisseur */}
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    {hasCandidates && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{
                          flex: 1,
                          fontSize: "12px",
                          height: "30px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          backgroundColor: autoFillChanges ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.22)",
                          border: "1px solid rgba(99, 102, 241, 0.35)",
                          color: "var(--primary-color)",
                          fontWeight: "500",
                          cursor: "pointer",
                        }}
                        onClick={() => onOpenAutoFill(productData.sku || autofillCodeInput, isEdit)}
                        title={
                          autoFillChanges
                            ? "Rouvrir les propositions pour choisir un autre titre, d'autres photos ou documents"
                            : "Pré-remplir le formulaire avec les informations trouvées"
                        }
                      >
                        {autoFillChanges ? "🎯 Revoir les variantes" : "✨ Appliquer les candidats"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        flex: 1,
                        fontSize: "12px",
                        height: "30px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        backgroundColor: "rgba(16, 185, 129, 0.15)",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                        color: "var(--success)",
                        fontWeight: "600",
                      }}
                      onClick={handleSmartPasteSupplier}
                      title="Coller automatiquement la fiche fournisseur (depuis presse-papiers ou saisie manuelle)"
                    >
                      📋 Coller fiche fournisseur
                    </button>
                  </div>

                  {/* Retour d'avancement du scraping en direct dans la modale */}
                  {isCurrentScraping && globalScrape && (
                    <div style={{ marginTop: "0.5rem" }}>
                      {globalScrape.status === "InProgress" && (
                        <div
                          style={{
                            padding: "0.5rem 0.75rem",
                            borderRadius: "6px",
                            backgroundColor: "rgba(59, 130, 246, 0.12)",
                            border: "1px solid rgba(59, 130, 246, 0.35)",
                            color: "var(--accent, #3b82f6)",
                            fontSize: "12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                              <span className="scrape-spin-micro" style={{ width: "10px", height: "10px", border: "2px solid transparent", borderTopColor: "currentColor", borderRadius: "50%", animation: "scrape-spin 0.8s linear infinite", display: "inline-block" }} />
                              Scraping en cours pour <strong>{globalScrape.sku}</strong>...
                            </span>
                            <span style={{ fontWeight: "700" }}>{Math.round(globalScrape.progress * 100)}%</span>
                          </div>
                          <div
                            style={{
                              width: "100%",
                              height: "4px",
                              backgroundColor: "rgba(59, 130, 246, 0.2)",
                              borderRadius: "2px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max(5, Math.round(globalScrape.progress * 100))}%`,
                                height: "100%",
                                backgroundColor: "#3b82f6",
                                transition: "width 0.3s ease",
                              }}
                            />
                          </div>
                          <span style={{ fontSize: "11px", opacity: 0.85 }}>{globalScrape.message}</span>
                        </div>
                      )}

                      {globalScrape.status === "Complete" && (
                        <div
                          style={{
                            padding: "0.5rem 0.75rem",
                            borderRadius: "6px",
                            backgroundColor: "rgba(16, 185, 129, 0.12)",
                            border: "1px solid rgba(16, 185, 129, 0.35)",
                            color: "var(--success, #10b981)",
                            fontSize: "12px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "8px",
                          }}
                        >
                          <span>🎉 Scraping terminé pour <strong>{globalScrape.sku}</strong> !</span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{
                              fontSize: "11px",
                              padding: "3px 10px",
                              backgroundColor: "rgba(16, 185, 129, 0.2)",
                              border: "1px solid rgba(16, 185, 129, 0.5)",
                              color: "var(--success, #10b981)",
                              fontWeight: 600,
                              cursor: "pointer",
                              borderRadius: "4px",
                            }}
                            onClick={() => onOpenAutoFill(currentActiveSku, isEdit)}
                          >
                            ✨ Ouvrir les candidats
                          </button>
                        </div>
                      )}

                      {globalScrape.status === "Failed" && (
                        <div
                          style={{
                            padding: "0.5rem 0.75rem",
                            borderRadius: "6px",
                            backgroundColor: "rgba(239, 68, 68, 0.12)",
                            border: "1px solid rgba(239, 68, 68, 0.35)",
                            color: "var(--danger, #ef4444)",
                            fontSize: "12px",
                          }}
                        >
                          ⚠️ Échec du scraping : {globalScrape.message}
                        </div>
                      )}
                    </div>
                  )}

                  {pasteFeedback && (
                    <div
                      style={{
                        marginTop: "0.4rem",
                        padding: "0.4rem 0.6rem",
                        fontSize: "11px",
                        backgroundColor: "rgba(16, 185, 129, 0.15)",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                        borderRadius: "4px",
                        color: "var(--success)",
                        fontWeight: "500",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{pasteFeedback}</span>
                      <button
                        type="button"
                        onClick={() => setPasteFeedback(null)}
                        style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "14px", lineHeight: "1" }}
                      >
                        ×
                      </button>
                    </div>
                  )}
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <div className="autofill-changes-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>✅ Données pré-remplies par le scraping</span>
                  </div>
                  {hasCandidates && (
                    <button
                      type="button"
                      onClick={() => onOpenAutoFill(productData.sku || autofillCodeInput, isEdit)}
                      style={{
                        background: "rgba(99, 102, 241, 0.18)",
                        border: "1px solid rgba(99, 102, 241, 0.4)",
                        color: "var(--accent, #818cf8)",
                        borderRadius: "5px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        cursor: "pointer",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                      title="Modifier vos sélections de titre, marque, photos ou documents"
                    >
                      🎯 Revoir les variantes
                    </button>
                  )}
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
                  {autoFillChanges.pdf_urls && autoFillChanges.pdf_urls.length > 0 && (
                    <span>📄 {autoFillChanges.pdf_urls.length} notice(s)</span>
                  )}
                </div>
                <div className="autofill-changes-help">
                  💡 Les champs ci-dessous ont été renseignés automatiquement. Vous pouvez les ajuster librement, puis cliquer sur {isEdit ? '"Enregistrer"' : '"Créer"'} pour finaliser.
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
        ) : activeTab === "images" ? (
          renderImagesTab()
        ) : (
          renderDocumentsTab()
        )}
      </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
              Annuler
            </button>
            <button type="submit" className="btn" disabled={isSubmitting}>
              {isSubmitting ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ width: "13px", height: "13px", border: "2px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
                  {isEdit ? "Enregistrement..." : "Création..."}
                </span>
              ) : (
                isEdit ? "Enregistrer" : "Créer"
              )}
            </button>
          </div>
        </form>

        {/* Notification flottante sans décalage de mise en page (zéro saut sous la souris) */}
        {manualMediaFeedback && (
          <div
            style={{
              position: "absolute",
              bottom: "72px",
              right: "24px",
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              color: "#f8fafc",
              border: "1px solid rgba(16, 185, 129, 0.5)",
              borderLeft: "4px solid var(--success, #10b981)",
              padding: "0.6rem 1.1rem",
              borderRadius: "8px",
              boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.4)",
              fontSize: "12px",
              fontWeight: 600,
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              pointerEvents: "none",
              backdropFilter: "blur(4px)",
              animation: "slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {manualMediaFeedback}
          </div>
        )}
      </div>

      {/* Modale de saisie / collage manuel fiche fournisseur */}
      {showPasteModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(3px)",
          }}
          onClick={() => setShowPasteModal(false)}
        >
          <div
            style={{
              backgroundColor: "var(--background-card, #1e293b)",
              border: "1px solid var(--border-color, #334155)",
              borderRadius: "12px",
              padding: "1.5rem",
              width: "90%",
              maxWidth: "540px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h3 style={{ margin: 0, fontSize: "16px", color: "var(--text-primary)" }}>
                📋 Coller la fiche fournisseur
              </h3>
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "20px", cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "0.75rem", lineHeight: "1.4" }}>
              Sélectionnez et copiez (<strong>Ctrl+C</strong>) le texte ou le tableau depuis la page du fournisseur (RS, Farnell, Mouser...) ou utilisez le favori StockFlow, puis collez-le ci-dessous (<strong>Ctrl+V</strong>) :
            </p>

            <textarea
              autoFocus
              value={pasteRawInput}
              onChange={(e) => setPasteRawInput(e.target.value)}
              placeholder="Collez ici le texte copié depuis la page fournisseur ou le code JSON du favori..."
              rows={8}
              style={{
                width: "100%",
                padding: "0.75rem",
                fontSize: "12px",
                fontFamily: "monospace",
                backgroundColor: "var(--bg-secondary, #0f172a)",
                border: "1px solid var(--border-color, #334155)",
                borderRadius: "6px",
                color: "var(--text-primary, #f8fafc)",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowPasteModal(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleProcessManualPaste}
                disabled={!pasteRawInput.trim()}
                style={{ backgroundColor: "var(--accent, #6366f1)" }}
              >
                ✨ Analyser et Remplir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
