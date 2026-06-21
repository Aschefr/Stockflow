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

            // Analyse du texte complet pour extraire la taille du lot
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

            // --- DEBUT EXTRACTION PRIX GLOBALE OPTIMISÉE ET CONTEXTUELLE ---
            const priceRegex = /\b\d+(?:[\s,.]\d{2})\b/g;
            const foundHTs = [];
            const foundTTCs = [];
            const foundUnknowns = [];
            
            const allTextNodes = [];
            const walkDOM = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.nodeValue.trim();
                    if (text && /\d/.test(text)) {
                        allTextNodes.push({ text, parent: node.parentElement });
                    }
                } else {
                    for (let child = node.firstChild; child; child = child.nextSibling) {
                        if (child.nodeName !== 'SCRIPT' && child.nodeName !== 'STYLE' && child.id !== 'sf-scrape-overlay') {
                            walkDOM(child);
                        }
                    }
                }
            };
            
            if (document.body) {
                walkDOM(document.body);
            }

            for (const nodeInfo of allTextNodes) {
                const text = nodeInfo.text;
                const parentText = nodeInfo.parent ? (nodeInfo.parent.innerText || '') : '';
                const cleanParentText = parentText.replace(/\s+/g, ' ');
                
                let match;
                priceRegex.lastIndex = 0;
                while ((match = priceRegex.exec(text)) !== null) {
                    const priceStr = match[0];
                    const val = parseFloat(priceStr.replace(/\s/g, '').replace(',', '.'));
                    if (val > 0) {
                        const valIndex = cleanParentText.indexOf(priceStr);
                        if (valIndex !== -1) {
                            const start = Math.max(0, valIndex - 60);
                            const end = Math.min(cleanParentText.length, valIndex + priceStr.length + 60);
                            const context = cleanParentText.substring(start, end).toLowerCase();
                            
                            // Détection explicite de TTC d'abord pour éviter les faux-positifs HT
                            if (context.includes('ttc') || context.includes('incl') || context.includes('toutes taxes') || context.includes('tva comprise') || context.includes('tva incluse')) {
                                if (!foundTTCs.includes(val)) foundTTCs.push(val);
                            } else if (context.includes('ht') || context.includes('excl') || context.includes('hors taxe') || context.includes('net')) {
                                if (!foundHTs.includes(val)) foundHTs.push(val);
                            } else {
                                if (!foundUnknowns.includes(val)) foundUnknowns.push(val);
                            }
                        }
                    }
                }
            }

            // S'assurer qu'un prix trouvé dans une catégorie n'est pas pollué par l'autre
            // On ne met dans Unknown que les prix qui n'ont été classés ni HT ni TTC
            const finalUnknowns = foundUnknowns.filter(v => !foundHTs.includes(v) && !foundTTCs.includes(v));

            if (foundHTs.length > 0) priceHT = foundHTs[0];
            if (foundTTCs.length > 0) priceTTC = foundTTCs[0];
            const priceUnknown = finalUnknowns.length > 0 ? finalUnknowns[0] : null;
            // --- FIN EXTRACTION PRIX GLOBALE OPTIMISÉE ---

            // 1. Fallback par conteneur de Sous-total / Subtotal si toujours null
            if (priceHT === null && priceTTC === null) {
                const allElements = document.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.children.length === 0) {
                        const text = el.textContent || '';
                        if (text.includes('Sous-total') || text.includes('Subtotal')) {
                            const packMatch = text.match(/(?:paquet|lot|pack|box|boite|boîte) de\s*(\d+)/i);
                            if (packMatch) {
                                const val = parseInt(packMatch[1], 10);
                                if (val > 0) pack_size = val;
                            }

                            const parent = el.parentElement;
                            if (parent) {
                                const parentText = parent.textContent || '';
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
            }

            // 2. Détermination du prix final HT
            if (priceHT !== null && !isNaN(priceHT)) {
                price = priceHT;
            } else if (priceTTC !== null && !isNaN(priceTTC)) {
                price = priceTTC / 1.20; 
            } else if (priceUnknown !== null && !isNaN(priceUnknown)) {
                price = priceUnknown; // Par défaut, on le prend comme brut
            } else if (jsonLdPrice > 0) {
                const isRs = window.location.hostname.includes('rs-online') || window.location.hostname.includes('rsdelivers');
                if (isRs) {
                    price = jsonLdPrice * pack_size;
                } else {
                    price = jsonLdPrice;
                }
            }

            // Attente si aucun prix n'est trouvé pour l'instant (laisse du temps au JS client de s'exécuter)
            const priceFound = price > 0 || priceHT !== null || priceTTC !== null || priceUnknown !== null;
            console.log("[Scraper] PriceFound: " + priceFound + ", price: " + price + ", priceHT: " + priceHT + ", priceTTC: " + priceTTC + ", priceUnknown: " + priceUnknown + ", time passed: " + (Date.now() - window.sfStartTime) + "ms");
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
                    label: pack_size > 1 ? `Prix du lot (${pack_size} u.) - HT` : "Prix unitaire - HT"
                });
            }
            if (priceTTC !== null && !isNaN(priceTTC)) {
                price_candidates.push({
                    price: priceTTC,
                    pack_size: pack_size,
                    tax_type: "TTC",
                    label: pack_size > 1 ? `Prix du lot (${pack_size} u.) - TTC` : "Prix unitaire - TTC"
                });
            }
            if (priceUnknown !== null && !isNaN(priceUnknown)) {
                price_candidates.push({
                    price: priceUnknown,
                    pack_size: pack_size,
                    tax_type: "INCONNU",
                    label: pack_size > 1 ? `Prix du lot (${pack_size} u.) - INCONNU` : "Prix unitaire - INCONNU"
                });
            }
            if (jsonLdPrice > 0) {
                // RS JSON-LD price is unit price (excluding VAT)
                price_candidates.push({
                    price: jsonLdPrice,
                    pack_size: 1,
                    tax_type: "HT",
                    label: "Prix unitaire (JSON-LD) - HT"
                });
                if (pack_size > 1) {
                    price_candidates.push({
                        price: parseFloat((jsonLdPrice * pack_size).toFixed(2)),
                        pack_size: pack_size,
                        tax_type: "HT",
                        label: `Prix du lot (${pack_size} u.) (calculé JSON-LD) - HT`
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

                 const executeHtml2Canvas = () => {
                     try {
                         const overlay = document.getElementById('sf-scrape-overlay');
                         if (overlay) overlay.style.display = 'none'; // Temporarily hide the loader overlay for capture
                         
                         window.html2canvas(document.body, { 
                             logging: false, 
                             useCORS: true, 
                             allowTaint: true,
                             scale: 1,
                             backgroundColor: '#ffffff'
                         })
                         .then(canvas => {
                             if (overlay) overlay.style.display = 'flex'; // Restore overlay
                             try {
                                 sendResult(canvas.toDataURL('image/jpeg', 0.6));
                             } catch(err) {
                                 sendResult(null);
                             }
                         })
                         .catch(() => {
                             if (overlay) overlay.style.display = 'flex'; // Restore overlay
                             sendResult(null);
                         });
                     } catch(err) {
                         sendResult(null);
                     }
                 };

                 if (window.html2canvas) {
                     executeHtml2Canvas();
                 } else {
                     const script = document.createElement('script');
                     script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                     script.onload = () => {
                         setTimeout(executeHtml2Canvas, 500);
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
