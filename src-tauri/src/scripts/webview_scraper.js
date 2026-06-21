(function() {
    if (window !== window.top) {
        return;
    }
    if (!window.sfStartTime) {
        window.sfStartTime = Date.now();
    }
    function injectOverlay() {
        if (!document.body || document.getElementById('sf-scrape-overlay')) {
            return;
        }
        try {
            const style = document.createElement('style');
            style.id = 'sf-scrape-style';
            style.textContent = `
                body > :not(#sf-scrape-overlay) {
                    filter: blur(5px) !important;
                    pointer-events: none !important;
                }
                #sf-scrape-overlay {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    background: rgba(15, 23, 42, 0.9) !important;
                    backdrop-filter: blur(8px) !important;
                    z-index: 99999999 !important;
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                    justify-content: center !important;
                    color: #f8fafc !important;
                    font-family: system-ui, -apple-system, sans-serif !important;
                    pointer-events: auto !important;
                }
                .sf-loader {
                    border: 4px solid #334155 !important;
                    border-top: 4px solid #3b82f6 !important;
                    border-radius: 50% !important;
                    width: 40px !important;
                    height: 40px !important;
                    animation: sf-spin 1s linear infinite !important;
                    margin-bottom: 20px !important;
                }
                @keyframes sf-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);

            const overlay = document.createElement('div');
            overlay.id = 'sf-scrape-overlay';
            overlay.innerHTML = `
                <div class="sf-loader"></div>
                <h2 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 600; text-align: center; color: #3b82f6;">StockFlow Scraper</h2>
                <p style="margin: 0; font-size: 13px; color: #94a3b8; text-align: center; max-width: 80%; line-height: 1.5;">
                    Récupération automatique des informations produit en cours...<br>
                    Merci de ne pas interagir avec cette fenêtre. Elle se fermera automatiquement.
                </p>
            `;
            document.body.appendChild(overlay);
        } catch (_) {}
    }

    function tryScrape() {
        try {
            console.log("[Scraper] tryScrape called. readyState: " + document.readyState + ", URL: " + window.location.href);
            if (!document.body || (document.readyState !== 'complete' && document.readyState !== 'interactive')) {
                console.log("[Scraper] DOM not ready yet.");
                return false;
            }

            injectOverlay();

            const pdfs = [];
            document.querySelectorAll('a').forEach(a => {
                const href = a.getAttribute('href');
                if (href && (href.toLowerCase().includes('.pdf') || href.toLowerCase().includes('filetype=pdf') || href.toLowerCase().includes('format=pdf'))) {
                    let absUrl = href;
                    try { absUrl = new URL(href, document.baseURI || window.location.href).toString(); } catch(_) {}
                    const title = a.textContent.trim() || 'Fiche Technique';
                    pdfs.push({ url: absUrl, title: title });
                }
            });

            let brand = '';
            let label = '';
            let jsonLdPrice = 0.0;
            let mpn = '';

            document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
                try {
                    const json = JSON.parse(script.textContent || '{}');
                    const blocks = Array.isArray(json) ? json : [json];
                    for (const data of blocks) {
                        const items = data['@graph'] && Array.isArray(data['@graph']) ? data['@graph'] : [data];
                        for (const item of items) {
                            if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product'))) {
                                if (item.name) label = item.name;
                                if (item.brand) {
                                    brand = typeof item.brand === 'string' ? item.brand : (item.brand.name || '');
                                }
                                if (item.mpn) mpn = String(item.mpn);
                                if (item.offers) {
                                    const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                                    const pVal = offers.lowPrice || offers.price;
                                    if (pVal) jsonLdPrice = parseFloat(String(pVal).replace(',', '.'));
                                }
                            }
                        }
                    }
                } catch(_) {}
            });

            if (!label) {
                label = document.querySelector('h1')?.textContent?.trim() || '';
            }

            // Si c'est un site RS et qu'on est sur une page de recherche (pas encore redirigé vers le produit /p/ ou /product/)
            const isRs = window.location.hostname.includes('rs-online') || window.location.hostname.includes('rsdelivers');
            const isSearchPage = isRs && !window.location.pathname.includes('/p/') && !window.location.pathname.includes('/product/');
            
            console.log("[Scraper] isSearchPage: " + isSearchPage + ", time passed: " + (Date.now() - window.sfStartTime) + "ms");
            if (isSearchPage && (Date.now() - window.sfStartTime < 6000)) {
                console.log("[Scraper] Waiting for search redirect...");
                return false;
            }

            console.log("[Scraper] Label: " + label + ", Links count: " + document.querySelectorAll('a').length);
            if (!label && document.querySelectorAll('a').length < 10) {
                console.log("[Scraper] Waiting for label/links...");
                return false;
            }

            // Extrait la taille du lot (pack size) et le prix HT/TTC depuis le DOM
            let pack_size = 1;
            let price = 0.0;
            let priceHT = null;
            let priceTTC = null;

            // 1. Recherche via les conteneurs de Sous-total / Subtotal
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                if (el.children.length === 0) {
                    const text = el.textContent || '';
                    if (text.includes('Sous-total') || text.includes('Subtotal')) {
                        // Récupérer le pack size depuis le texte
                        // ex: "Sous-total (1 paquet de 10 unités)*"
                        const packMatch = text.match(/(?:paquet|lot|pack|box|boite|boîte) de\s*(\d+)/i);
                        if (packMatch) {
                            const val = parseInt(packMatch[1], 10);
                            if (val > 0) pack_size = val;
                        }

                        const parent = el.parentElement;
                        if (parent) {
                            const parentText = parent.textContent || '';
                            // ex: "60,07 € HT" ou "72,08 € TTC"
                            const htMatch = parentText.match(/([\d\s,.]+)\s*(?:€|EUR)?\s*HT/i);
                            if (htMatch) {
                                priceHT = parseFloat(htMatch[1].replace(/\s/g, '').replace(',', '.'));
                            }
                            const ttcMatch = parentText.match(/([\d\s,.]+)\s*(?:€|EUR)?\s*TTC/i);
                            if (ttcMatch) {
                                priceTTC = parseFloat(ttcMatch[1].replace(/\s/g, '').replace(',', '.'));
                            }
                        }
                    }
                }
            }

            // 2. Si non trouvé via Sous-total, analyser le texte global pour la taille du lot
            if (pack_size === 1) {
                const bodyText = document.body.innerText || '';
                const packPatterns = [
                    /(?:paquet|lot|pack|box|boite|boîte|sac|pochette) de\s*(\d+)\s*(?:unités|pièces|items|units|u)?/i,
                    /conditionnement\s*:\s*(\d+)/i,
                    /(\d+)\s*(?:unités|pièces|units|items)\s+par\s+(?:paquet|lot|pack|boite|boîte)/i
                ];
                for (const pattern of packPatterns) {
                    const m = bodyText.match(pattern);
                    if (m) {
                        const val = parseInt(m[1], 10);
                        if (val > 0) {
                            pack_size = val;
                            break;
                        }
                    }
                }
            }

            // 3. Détermination du prix final HT attendu par le backend
            if (priceHT !== null && !isNaN(priceHT)) {
                price = priceHT;
            } else if (priceTTC !== null && !isNaN(priceTTC)) {
                price = priceTTC / 1.20; // Conversion TTC vers HT (TVA 20%)
            } else if (jsonLdPrice > 0) {
                // Si on a récupéré le prix du JSON-LD (généralement le prix unitaire TTC sur RS)
                const isRs = window.location.hostname.includes('rs-online') || window.location.hostname.includes('rsdelivers');
                if (isRs) {
                    // RS affiche le prix unitaire TTC en JSON-LD, on le convertit en prix de lot HT :
                    price = (jsonLdPrice / 1.20) * pack_size;
                } else {
                    price = jsonLdPrice; // Autre site, on fait confiance au JSON-LD
                }
            }

            // Attente si aucun prix n'est trouvé pour l'instant (laisse du temps au JS client de s'exécuter)
            const priceFound = price > 0 || priceHT !== null || priceTTC !== null;
            console.log("[Scraper] PriceFound: " + priceFound + ", price: " + price + ", priceHT: " + priceHT + ", priceTTC: " + priceTTC + ", time passed: " + (Date.now() - window.sfStartTime) + "ms");
            if (!priceFound && (Date.now() - window.sfStartTime < 4000)) {
                console.log("[Scraper] Waiting for price to appear...");
                return false;
            }

            // Construction de la liste des candidats de prix pour confirmation utilisateur
            const price_candidates = [];
            if (priceHT !== null && !isNaN(priceHT)) {
                price_candidates.push({
                    price: priceHT,
                    pack_size: pack_size,
                    tax_type: "HT",
                    label: `Prix du lot (${pack_size} u.)`
                });
            }
            if (priceTTC !== null && !isNaN(priceTTC)) {
                price_candidates.push({
                    price: priceTTC,
                    pack_size: pack_size,
                    tax_type: "TTC",
                    label: `Prix du lot (${pack_size} u.)`
                });
            }
            if (jsonLdPrice > 0) {
                price_candidates.push({
                    price: jsonLdPrice,
                    pack_size: 1,
                    tax_type: "HT", // Généralement HT dans le LD-JSON
                    label: "Prix unitaire (JSON-LD)"
                });
                if (pack_size > 1) {
                    price_candidates.push({
                        price: parseFloat(jsonLdPrice.toFixed(4)),
                        pack_size: 1,
                        tax_type: "HT",
                        label: "Prix unitaire (calculé)"
                    });
                    price_candidates.push({
                        price: parseFloat((jsonLdPrice * pack_size).toFixed(2)),
                        pack_size: pack_size,
                        tax_type: "HT",
                        label: `Prix du lot (${pack_size} u.) (calculé)`
                    });
                }
            }

            const jsonLdBlocks = [];
            document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
                jsonLdBlocks.push(script.textContent);
            });
            
            const cloudinaryUrls = [];
            const htmlText = document.documentElement.outerHTML;
            const regex = /https:\/\/res\.cloudinary\.com\/rsc\/image\/upload\/[^"'\s<>}\\]+/g;
            const matches = htmlText.match(regex) || [];
            matches.forEach(m => cloudinaryUrls.push(m.replace('\\', '')));

            const res = {
                brand: brand.trim(),
                label: label.trim(),
                price: parseFloat(price.toFixed(2)),
                pack_size: pack_size,
                mpn: mpn.trim(),
                pdfs: pdfs,
                json_ld_blocks: jsonLdBlocks,
                cloudinary_urls: cloudinaryUrls,
                price_candidates: price_candidates
            };

            // Fonction pour charger html2canvas et générer la capture d'écran de la page
            const captureAndSend = () => {
                const sendResult = (screenshotData) => {
                    res.screenshot = screenshotData;
                    console.log("[Scraper] tryScrape SUCCESS! Setting hash: " + JSON.stringify(res));
                    window.location.href = 'https://scraped/#scraped:' + encodeURIComponent(JSON.stringify(res));
                };

                if (window.html2canvas) {
                    window.html2canvas(document.body, { logging: false, useCORS: true, allowTaint: true })
                        .then(canvas => sendResult(canvas.toDataURL('image/jpeg', 0.6)))
                        .catch(() => sendResult(null));
                } else {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                    script.onload = () => {
                        window.html2canvas(document.body, { logging: false, useCORS: true, allowTaint: true })
                            .then(canvas => sendResult(canvas.toDataURL('image/jpeg', 0.6)))
                            .catch(() => sendResult(null));
                    };
                    script.onerror = () => sendResult(null);
                    document.head.appendChild(script);
                }
            };

            captureAndSend();
            return true;
        } catch (e) {
            window.location.href = 'https://scraped/#scraped_err:' + encodeURIComponent('Erreur tryScrape: ' + e.toString() + ' | ' + e.stack);
            return true;
        }
    }

    try {
        if (!tryScrape()) {
            const interval = setInterval(() => {
                if (tryScrape()) clearInterval(interval);
            }, 500);
            setTimeout(() => {
                 clearInterval(interval);
                 window.location.href = 'https://scraped/#scraped_err:' + encodeURIComponent('Timeout côté JS');
            }, 25000);
        }
    } catch(e) {
        window.location.href = 'https://scraped/#scraped_err:' + encodeURIComponent(e.toString());
    }
})();
