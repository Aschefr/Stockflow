import { stripTrailingPunctuation } from "./webScraperService";

export interface SupplierScrapeResult {
  label: string;
  brand: string;
  mpn: string;
  vpcCode: string;
  vpcSite: string;
  price: number;
  category?: string;
  subCategory?: string;
  largeur?: string;
  hauteur?: string;
  profondeur?: string;
  poids?: string;
  notes?: string;
  image_urls: string[];
  pdf_urls: string[];
  source_url?: string;
  timestamp?: number;
}

/**
 * Génère le code exécutable du Bookmarklet (Favori Edge/Chrome 1-Clic).
 */
export function getBookmarkletHref(): string {
  const code = `(function(){
    try {
      var d = {
        label: "",
        brand: "",
        mpn: "",
        vpcCode: "",
        vpcSite: "",
        price: 0,
        category: "",
        subCategory: "",
        largeur: "",
        hauteur: "",
        profondeur: "",
        poids: "",
        notes: "",
        image_urls: [],
        pdf_urls: [],
        source_url: window.location.href,
        timestamp: Date.now()
      };

      var h = window.location.hostname.toLowerCase();
      if (h.includes("rs-online") || h.includes("rsdelivers")) d.vpcSite = "RS";
      else if (h.includes("farnell")) d.vpcSite = "Farnell";
      else if (h.includes("mouser")) d.vpcSite = "Mouser";
      else if (h.includes("conrad")) d.vpcSite = "Conrad";
      else if (h.includes("distrelec")) d.vpcSite = "Distrelec";

      // 1. JSON-LD
      document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){
        try {
          var j = JSON.parse(s.textContent || "{}");
          var list = Array.isArray(j) ? j : (j['@graph'] || [j]);
          for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].indexOf('Product') >= 0)) {
              if (item.name && !d.label) d.label = item.name;
              if (item.brand) d.brand = typeof item.brand === 'string' ? item.brand : (item.brand.name || "");
              if (item.mpn && !d.mpn) d.mpn = String(item.mpn);
              if (item.sku && !d.vpcCode) d.vpcCode = String(item.sku);
              if (item.image) {
                var imgs = Array.isArray(item.image) ? item.image : [item.image];
                for (var k = 0; k < imgs.length; k++) {
                  var u = typeof imgs[k] === 'string' ? imgs[k] : (imgs[k].url || "");
                  if (u && d.image_urls.indexOf(u) < 0) d.image_urls.push(u);
                }
              }
              if (item.offers) {
                var offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                var pr = offers.price || offers.lowPrice;
                if (pr && !d.price) d.price = parseFloat(String(pr).replace(',', '.'));
              }
            }
          }
        } catch(e){}
      });

      // 2. Fallbacks Titre, Marque, Prix
      if (!d.label) {
        var h1 = document.querySelector('h1');
        if (h1) d.label = h1.innerText.trim();
      }
      if (!d.price) {
        var priceEl = document.querySelector('[data-testid*="price"], .price, .current-price, .product-price');
        if (priceEl) {
          var m = priceEl.innerText.replace(',', '.').match(/\\d+(\\.\\d+)?/);
          if (m) d.price = parseFloat(m[0]);
        }
      }

      // 3. Fallbacks Images et PDFs
      document.querySelectorAll('a[href*=".pdf"], a[href*="datasheet"], a[href*="notice"]').forEach(function(a){
        var href = a.href;
        if (href && d.pdf_urls.indexOf(href) < 0) d.pdf_urls.push(href);
      });
      document.querySelectorAll('img').forEach(function(img){
        var src = img.currentSrc || img.src;
        if (src && (src.includes("/product/") || src.includes("/large/") || src.includes("images") || src.includes("rsdelivers"))) {
          if (d.image_urls.indexOf(src) < 0 && !src.includes("icon") && !src.includes("logo")) {
            d.image_urls.push(src);
          }
        }
      });

      var payload = JSON.stringify(d);
      localStorage.setItem('sf_scraped_product_handoff', payload);

      var copied = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = payload;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch(e){}

      if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload).catch(function(){});
      }

      var toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#10b981;color:#fff;padding:14px 22px;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,0.3);z-index:9999999;font-family:sans-serif;font-size:14px;font-weight:600;display:flex;align-items:center;gap:10px;';
      toast.innerHTML = '<span>📦 Fiche capturée ! Collez-la dans StockFlow.</span>';
      document.body.appendChild(toast);
      setTimeout(function(){ toast.remove(); }, 3500);

      alert("✅ Fiche fournisseur capturée avec succès !\n\nArticle : " + (d.mpn || d.vpcCode || d.label || "Fiche détectée") + "\n\n👉 Revenez dans StockFlow et cliquez sur :\n« 📋 Coller fiche fournisseur »");
    } catch(err) {
      alert("Erreur StockFlow Capture: " + err.message);
    }
  })();`;

  return `javascript:${encodeURI(code.replace(/\s+/g, " ").trim())}`;
}

/**
 * Analyse intelligemment un texte ou du HTML collé (Smart Clipboard Parser).
 */
export function parseSupplierData(input: string): SupplierScrapeResult {
  const clean = (input || "").trim();

  // 1. Si c'est du JSON directement issu du bookmarklet
  if (clean.startsWith("{") && clean.endsWith("}")) {
    try {
      const parsed = JSON.parse(clean);
      if (parsed.label || parsed.mpn || parsed.price || parsed.vpcCode) {
        return {
          label: parsed.label || "",
          brand: parsed.brand || "",
          mpn: parsed.mpn || "",
          vpcCode: parsed.vpcCode || "",
          vpcSite: parsed.vpcSite || "",
          price: Number(parsed.price || 0),
          category: parsed.category || "",
          subCategory: parsed.subCategory || "",
          largeur: parsed.largeur || "",
          hauteur: parsed.hauteur || "",
          profondeur: parsed.profondeur || "",
          poids: parsed.poids || "",
          notes: parsed.notes || "",
          image_urls: parsed.image_urls || [],
          pdf_urls: parsed.pdf_urls || [],
          source_url: parsed.source_url || "",
        };
      }
    } catch {}
  }

  const result: SupplierScrapeResult = {
    label: "",
    brand: "",
    mpn: "",
    vpcCode: "",
    vpcSite: "",
    price: 0,
    image_urls: [],
    pdf_urls: [],
  };

  // 2. Si le contenu ressemble à du HTML
  if (clean.includes("<") && clean.includes(">")) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(clean, "text/html");

      // Chercher JSON-LD
      const jsonLd = doc.querySelectorAll('script[type="application/ld+json"]');
      jsonLd.forEach((s) => {
        try {
          const j = JSON.parse(s.textContent || "{}");
          const list = Array.isArray(j) ? j : j["@graph"] || [j];
          for (const item of list) {
            if (item["@type"] === "Product") {
              if (item.name && !result.label) result.label = item.name;
              if (item.brand) result.brand = typeof item.brand === "string" ? item.brand : item.brand.name || "";
              if (item.mpn && !result.mpn) result.mpn = String(item.mpn);
              if (item.sku && !result.vpcCode) result.vpcCode = String(item.sku);
              if (item.offers) {
                const off = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                const p = off.price || off.lowPrice;
                if (p && !result.price) result.price = parseFloat(String(p).replace(",", "."));
              }
            }
          }
        } catch {}
      });

      if (!result.label) {
        const h1 = doc.querySelector("h1");
        if (h1) result.label = h1.textContent?.trim() || "";
      }
    } catch {}
  }

  // 3. Analyse textuelle heuristique (Regex) sur le texte brut (gère mono-ligne et multi-lignes)
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
    const combined = `${line} ${nextLine}`;

    // --- Détection Code VPC (RS / Farnell / Mouser) ---
    if (!result.vpcCode) {
      if (line.match(/(?:code\s*commande\s*rs|code\s*rs|rs\s*stock)/i)) {
        result.vpcSite = "RS";
        const m = combined.match(/(?:code\s*commande\s*rs|code\s*rs|rs\s*stock)?\s*[:=]?\s*([0-9]{3}-[0-9]{3,4}|[0-9]{6,8})/i);
        if (m) result.vpcCode = m[1].trim();

        // Sur RS, le titre de l'article se trouve très fréquemment juste avant le bloc "Code commande RS"
        if (!result.label && i > 0) {
          for (let prevIdx = i - 1; prevIdx >= Math.max(0, i - 5); prevIdx--) {
            const candidate = lines[prevIdx];
            if (
              candidate.length >= 8 &&
              !candidate.match(/^(passer|suivi|menu|accueil|panier|recherche|connexion|s'identifier|outils|voir)/i) &&
              !candidate.includes("http")
            ) {
              result.label = candidate;
              break;
            }
          }
        }
      } else if (line.match(/(?:code\s*farnell|réf(?:\.|érence)?\s*farnell)/i)) {
        result.vpcSite = "Farnell";
        const m = combined.match(/(?:code\s*farnell|réf(?:\.|érence)?\s*farnell)?\s*[:=]?\s*([0-9]{6,9})/i);
        if (m) result.vpcCode = m[1].trim();
      } else if (line.match(/(?:réf(?:\.|érence)?\s*mouser|mouser\s*part)/i)) {
        result.vpcSite = "Mouser";
        const m = combined.match(/(?:réf(?:\.|érence)?\s*mouser|mouser\s*part)?\s*[:=]?\s*([A-Za-z0-9\-_]+)/i);
        if (m) result.vpcCode = m[1].trim();
      }
    }

    // --- Détection Ref Fabricant / MPN ---
    if (!result.mpn) {
      if (line.match(/(?:r[eé]f(?:\.|[eé]rence)?\s*fabricant|r[eé]f\.?\s*mfr|mpn|part\s*number)/i)) {
        const afterColon = line.includes(":") ? line.split(":")[1].trim() : "";
        const candidateVal = afterColon || nextLine;
        const m = candidateVal.match(/([A-Za-z0-9._\-/]{3,})/);
        if (m && !m[1].match(/^(marque|voir|catégorie|prix)/i)) {
          result.mpn = m[1].trim();
        }
      }
    }

    // --- Détection Marque (en évitant la confusion avec "Référence fabricant") ---
    if (!result.brand) {
      const isBrandHeading = line.match(/(?:marque|brand|constructeur)/i) || (line.match(/fabricant/i) && !line.match(/r[eé]f/i));
      if (isBrandHeading) {
        const afterColon = line.includes(":") ? line.split(":")[1].trim() : "";
        let candidateVal = afterColon || nextLine;
        candidateVal = candidateVal.replace(/voir\s+la\s+cat[eé]gorie.*$/i, "").trim();
        if (candidateVal && !candidateVal.match(/^(r[eé]f|code|prix|produit)/i)) {
          result.brand = candidateVal;
        }
      }
    }

    // --- Détection Prix (ex: "149,00 €", "149.00 EUR", "Prix : 45,00 € HT") ---
    if (!result.price) {
      const priceMatch = line.match(/(?:prix|price|unitaire|total|sous-total)?\s*[:=]?\s*([0-9]+[.,][0-9]{2})\s*(?:€|eur)/i);
      if (priceMatch) {
        const p = parseFloat(priceMatch[1].replace(",", "."));
        if (p > 0) result.price = p;
      }
    }

    // --- Détection Dimensions (ex: "150 x 80 x 60 mm" ou "150x80x60") ---
    if (!result.largeur && !result.hauteur && !result.profondeur) {
      const dimMatch = combined.match(/([0-9]+[.,]?[0-9]*)\s*x\s*([0-9]+[.,]?[0-9]*)\s*x\s*([0-9]+[.,]?[0-9]*)\s*(?:mm|cm)?/i);
      if (dimMatch) {
        result.largeur = dimMatch[1];
        result.hauteur = dimMatch[2];
        result.profondeur = dimMatch[3];
      }
    }

    // --- Détection Poids (ex: "Poids : 250 g" ou "1.8 kg") ---
    if (!result.poids) {
      const weightMatch = combined.match(/(?:poids|weight)\s*[:=]?\s*([0-9]+[.,]?[0-9]*)\s*(g|kg)/i);
      if (weightMatch) {
        let val = parseFloat(weightMatch[1].replace(",", "."));
        if (weightMatch[2].toLowerCase() === "kg") val = val * 1000;
        result.poids = String(Math.round(val));
      }
    }

    // Détection de liens PDF
    if (line.includes(".pdf")) {
      const pdfMatch = line.match(/https?:\/\/[^\s"'<>]+\.pdf/i);
      if (pdfMatch && !result.pdf_urls.includes(pdfMatch[0])) {
        result.pdf_urls.push(pdfMatch[0]);
      }
    }

    // Détection de liens Images
    if (line.match(/\.(jpg|jpeg|png|webp)/i)) {
      const imgMatch = line.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)/i);
      if (imgMatch && !result.image_urls.includes(imgMatch[0])) {
        result.image_urls.push(imgMatch[0]);
      }
    }
  }

  // Si aucun titre n'a été trouvé, essayer de trouver la première ligne significative
  if (!result.label && lines.length > 0) {
    const firstLine = lines.find((l) =>
      l.length > 12 &&
      !l.match(/^(passer|suivi|menu|accueil|panier|recherche|connexion|s'identifier|solutions|tous|notre)/i) &&
      !l.includes("http") &&
      !l.includes(";")
    );
    if (firstLine) result.label = firstLine;
  }

  result.label = stripTrailingPunctuation(result.label);
  result.brand = stripTrailingPunctuation(result.brand);
  result.mpn = stripTrailingPunctuation(result.mpn);
  result.vpcCode = stripTrailingPunctuation(result.vpcCode);

  return result;
}

/**
 * Écoute la transmission de données depuis un autre onglet (favori bookmarklet via localStorage).
 */
export function listenForSupplierHandoff(callback: (data: SupplierScrapeResult) => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === "sf_scraped_product_handoff" && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        callback(data);
      } catch (err) {
        console.warn("[WebScraperAssistant] Erreur lecture handoff :", err);
      }
    }
  };

  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/**
 * Construit un objet ScrapeCandidates complet à partir d'un SupplierScrapeResult
 * pour permettre l'affichage et la sélection interactive dans AutoFillModal.
 */
export function buildCandidatesFromSupplierData(parsed: SupplierScrapeResult, sku: string): any {
  const provider = parsed.vpcSite || "Fiche fournisseur";
  const cleanLabel = stripTrailingPunctuation(parsed.label);
  const cleanBrand = stripTrailingPunctuation(parsed.brand);
  const cleanMpn = stripTrailingPunctuation(parsed.mpn);
  const labelCandidates = cleanLabel ? [{ value: cleanLabel, confidence: 1.0, source: { provider }, selected: true }] : [];
  const brandCandidates = cleanBrand ? [{ value: cleanBrand, confidence: 1.0, source: { provider }, selected: true }] : [];
  const mpnCandidates = cleanMpn ? [{ value: cleanMpn, confidence: 1.0, source: { provider }, selected: true }] : [];
  const priceCandidates = parsed.price > 0 ? [{ value: { price: parsed.price, currency: "EUR" }, confidence: 1.0, source: { provider }, selected: true }] : [];

  const dimCandidates = (parsed.largeur || parsed.hauteur || parsed.profondeur) ? [{
    value: {
      largeur: parsed.largeur ? parseFloat(parsed.largeur.replace(",", ".")) : undefined,
      hauteur: parsed.hauteur ? parseFloat(parsed.hauteur.replace(",", ".")) : undefined,
      profondeur: parsed.profondeur ? parseFloat(parsed.profondeur.replace(",", ".")) : undefined,
      unit: "mm"
    },
    confidence: 1.0,
    source: { provider },
    selected: true
  }] : [];

  const weightCandidates = parsed.poids ? [{ value: parsed.poids, confidence: 1.0, source: { provider }, selected: true }] : [];

  const imageCandidates = (parsed.image_urls || []).map(url => ({
    url,
    thumbnail_url: url,
    confidence: 1.0,
    source: { provider }
  }));

  const pdfCandidates = (parsed.pdf_urls || []).map(url => ({
    url,
    title: "Fiche technique / Notice",
    confidence: 1.0,
    source: { provider }
  }));

  return {
    sku: sku.toUpperCase(),
    scraped_at: new Date().toISOString(),
    scraped_at_ms: Date.now(),
    status: "Complete",
    progress: 1.0,
    sources_visited: [
      {
        url: parsed.source_url || "Fiche fournisseur importée",
        provider,
        visited_at: new Date().toISOString(),
        success: true,
      }
    ],
    label_candidates: labelCandidates,
    brand_candidates: brandCandidates,
    mpn_candidates: mpnCandidates,
    price_candidates: priceCandidates,
    dimension_candidates: dimCandidates,
    weight_candidates: weightCandidates,
    pack_size_candidates: [],
    image_candidates: imageCandidates,
    pdf_candidates: pdfCandidates,
  };
}

