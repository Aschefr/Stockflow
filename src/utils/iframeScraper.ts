export interface ScrapedIframeData {
  brand: string;
  label: string;
  price: number;
  mpn: string;
  pdfs: { url: string; title: string; domain: string }[];
}

/**
 * Charge une URL dans un iframe invisible, extrait ses données (Désignation, Marque, Prix, PDFs) et nettoie le DOM.
 */
export function scrapeUrlWithIframe(url: string, timeoutMs = 15000): Promise<ScrapedIframeData> {
  return new Promise((resolve, reject) => {
    console.log(`[IframeScraper] Initialisation du chargement de l'URL : ${url}`);
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = url;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout lors du chargement de la page de scraping"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }

    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) {
          throw new Error("Impossible d'accéder au document de l'iframe");
        }

        console.log(`[IframeScraper] Page chargée. Extraction des données...`);

        let brand = "";
        let label = "";
        let price = 0;
        let mpn = "";
        const pdfs: { url: string; title: string; domain: string }[] = [];

        // 1. Extraction via JSON-LD
        const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
        jsonLdScripts.forEach((script) => {
          try {
            const textContent = script.textContent || "";
            if (!textContent.trim()) return;

            const json = JSON.parse(textContent);
            const blocks = Array.isArray(json) ? json : [json];

            for (const data of blocks) {
              // Gérer @graph
              const items = data["@graph"] && Array.isArray(data["@graph"]) ? data["@graph"] : [data];

              for (const item of items) {
                if (item["@type"] === "Product" || (Array.isArray(item["@type"]) && item["@type"].includes("Product"))) {
                  if (item.name && !label) label = item.name;
                  if (item.brand) {
                    const bVal = typeof item.brand === "string" ? item.brand : (item.brand.name || "");
                    if (bVal && !brand) brand = bVal;
                  }
                  if (item.mpn && !mpn) mpn = String(item.mpn);
                  if (item.offers) {
                    const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                    const priceVal = offers.lowPrice || offers.price;
                    if (priceVal && !price) {
                      price = parseFloat(String(priceVal).replace(",", "."));
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn("[IframeScraper] Erreur lors de l'analyse d'un bloc JSON-LD :", e);
          }
        });

        // 2. Fallbacks de Sélecteurs pour RS Components, Farnell, Mouser si JSON-LD est incomplet
        if (!label) {
          const h1 = doc.querySelector("h1");
          if (h1) label = h1.textContent?.trim() || "";
        }

        // 3. Extraction des PDF candidats
        const links = doc.querySelectorAll("a");
        links.forEach((a) => {
          try {
            const href = a.getAttribute("href") || "";
            const text = a.textContent?.trim() || "";
            
            if (!href) return;

            const hrefLower = href.toLowerCase();
            if (hrefLower.includes(".pdf") || hrefLower.includes("filetype=pdf") || hrefLower.includes("format=pdf")) {
              // Convertir l'URL relative en absolue
              let absoluteUrl = href;
              try {
                absoluteUrl = new URL(href, doc.baseURI || url).toString();
              } catch (_) {}

              const parsedUrl = new URL(absoluteUrl);
              const domain = parsedUrl.hostname;

              // Éliminer les doublons
              if (!pdfs.some((p) => p.url === absoluteUrl)) {
                pdfs.push({
                  url: absoluteUrl,
                  title: text || "Fiche Technique",
                  domain
                });
              }
            }
          } catch (_) {}
        });

        const result: ScrapedIframeData = {
          brand: brand.trim(),
          label: label.trim(),
          price: price || 0,
          mpn: mpn.trim(),
          pdfs
        };

        console.log("[IframeScraper] Extraction terminée :", result);
        cleanup();
        resolve(result);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    document.body.appendChild(iframe);
  });
}
