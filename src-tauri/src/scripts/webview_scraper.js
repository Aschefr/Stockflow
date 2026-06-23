(function() {
    if (window !== window.top) {
        return;
    }
    if (window.sfScraperStarted) {
        return;
    }
    window.sfScraperStarted = true;
    if (!window.sfStartTime) {
        window.sfStartTime = Date.now();
    }
    function isSafeToClick(el) {
        if (!el || typeof el.click !== 'function') {
            return false;
        }
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'A') {
            const href = el.getAttribute('href');
            if (typeof href === 'string' && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                return false;
            }
        }
        return true;
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

    function dismissCookieBanners() {
        try {
            function querySelectorAllShadow(selector, node = document) {
                let list = Array.from(node.querySelectorAll(selector));
                node.querySelectorAll('*').forEach(el => {
                    if (el.shadowRoot) {
                        list = list.concat(querySelectorAllShadow(selector, el.shadowRoot));
                    }
                });
                return list;
            }

            const selectors = [
                '#onetrust-accept-btn-handler',
                '#coiPage-acceptAll',
                '#consent_prompt_submit',
                'button[id*="accept" i]',
                'button[class*="accept" i]',
                'button[id*="consent" i]',
                'button[class*="consent" i]',
                '[id*="cookie" i] button',
                '[class*="cookie" i] button',
                'a[class*="cookie" i]',
                'a[id*="cookie" i]'
            ];
            selectors.forEach(sel => {
                try {
                    querySelectorAllShadow(sel).forEach(btn => {
                        if (isSafeToClick(btn)) {
                            console.log("[Scraper] Clicking cookie button via selector:", sel);
                            btn.click();
                        }
                    });
                } catch(_) {}
            });
            const buttonTextRegex = /accept(?:er)?(?:\s+tout)?|agree|allow\s+all|autoriser(?:\s+tout)?/i;
            querySelectorAllShadow('button, a, span, div').forEach(el => {
                if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.classList.contains('btn') || el.classList.contains('button')) {
                    if (buttonTextRegex.test(el.textContent.trim()) && isSafeToClick(el)) {
                        console.log("[Scraper] Clicking cookie button via text match:", el.textContent.trim());
                        el.click();
                    }
                }
            });

            // Clic sur les boutons de sélection de type de client (ex: Conrad)
            // IMPORTANT: Ne cliquer que les boutons dans des modales/banners, jamais les liens de navigation
            const clientTypeTexts = [
                'je suis un client professionnel',
                'je suis un client particulier',
                'client professionnel',
                'client particulier',
                'continuer en tant que professionnel',
                'continuer en tant que particulier'
            ];
            querySelectorAllShadow('button, [role="button"]').forEach(el => {
                const text = el.textContent.trim().toLowerCase();
                // Vérifier que le texte correspond exactement à une phrase connue
                if (clientTypeTexts.some(ct => text === ct)) {
                    // Vérifier que l'élément est dans un contexte de modale/overlay/banner
                    const parent = el.closest('[role="dialog"], [role="alertdialog"], [class*="modal" i], [class*="overlay" i], [class*="banner" i], [class*="popup" i], [class*="dialog" i], [id*="modal" i], [id*="overlay" i], [id*="banner" i], [id*="popup" i], [id*="dialog" i]');
                    if (parent) {
                        console.log("[Scraper] Clicking client type selector in modal:", text);
                        try {
                            el.click();
                        } catch (_) {}
                    }
                }
            });
        } catch(_) {}
    }

    function expandTabsSequentially() {
        try {
            // Défilement automatique pour déclencher le lazy load
            if (!window.sfHasScrolled) {
                window.scrollTo({ top: document.body.scrollHeight / 3, behavior: 'auto' });
                window.sfHasScrolled = true;
            }

            const keywords = [
                'caractéristiques', 'specification', 'specs', 'technical data', 
                'détails du produit', 'product details', 'fiche technique', 
                'attributes', 'spécifications', 'technical details',
                'documentation', 'téléchargement', 'download', 'datasheet',
                'conformité', 'compliance', 'legislation', 'législation', 'detail',
                'documents technique'
            ];

            const selectors = [
                '[role="tab"]',
                'button[aria-expanded="false"]',
                '.accordion-header',
                '.tab-title',
                '.specs-tab',
                '.pdp-tab',
                '#pdp-specs-tab',
                'a[href*="technical-datasheets" i]',
                'button[class*="spec" i]',
                'button[id*="spec" i]',
                '.technical-specifications',
                '#specifications',
                'button[id*="characteristics" i]',
                'button[class*="characteristics" i]'
            ];

            // Collecter tous les candidats potentiels de boutons/onglets
            const candidates = [];
            
            selectors.forEach(sel => {
                try {
                    document.querySelectorAll(sel).forEach(el => {
                        if (isSafeToClick(el) && !candidates.includes(el)) {
                            candidates.push(el);
                        }
                    });
                } catch(_) {}
            });

            document.querySelectorAll('button, a, span, div, h2, h3, li').forEach(el => {
                try {
                    const text = el.textContent.trim().toLowerCase();
                    const className = el.className || '';
                    const hasTabClass = typeof className === 'string' && (className.toLowerCase().includes('tab') || className.toLowerCase().includes('accordion'));
                    
                    if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'LI' || hasTabClass || el.getAttribute('role') === 'tab') {
                        if (keywords.some(k => text.includes(k)) && isSafeToClick(el) && !candidates.includes(el)) {
                            candidates.push(el);
                        }
                    }
                } catch(_) {}
            });

            const isActiveTab = (el) => {
                const ariaSelected = el.getAttribute('aria-selected') || (el.parentElement ? el.parentElement.getAttribute('aria-selected') : null);
                const ariaExpanded = el.getAttribute('aria-expanded') || (el.parentElement ? el.parentElement.getAttribute('aria-expanded') : null);
                if (ariaSelected === 'true' || ariaExpanded === 'true') return true;

                const checkClass = (str) => {
                    if (typeof str !== 'string') return false;
                    const lower = str.toLowerCase();
                    return /\b(active|selected|expanded|open|is-open)\b/i.test(lower) 
                        || lower.includes('-active') 
                        || lower.includes('-selected');
                };

                if (checkClass(el.className)) return true;
                if (el.parentElement && checkClass(el.parentElement.className)) return true;
                return false;
            };

            // Filtrer pour ne garder que ceux qui ne sont pas déjà actifs/ouverts
            const unclickedTabs = candidates.filter(el => {
                // Si on l'a déjà cliqué dans cette session de scraping, on l'ignore pour éviter de boucler à l'infini
                if (el.sfClicked) return false;
                if (isActiveTab(el)) return false;
                return true;
            });

            console.log("[Scraper] Found unclicked tabs count:", unclickedTabs.length);

            // On clique sur le premier onglet non encore cliqué
            if (unclickedTabs.length > 0) {
                const tabToClick = unclickedTabs[0];
                tabToClick.sfClicked = true;
                console.log("[Scraper] Clicking tab sequentially:", tabToClick.textContent.trim() || tabToClick.tagName);
                tabToClick.click();
                return true; // Indique qu'on a fait une action de clic et qu'on doit attendre
            }
        } catch(e) {
            console.error("[Scraper] Error in expandTabsSequentially:", e);
        }
        return false; // Rien n'a été cliqué
    }

    function extractSpecsInJS() {
        let width_val = null;
        let height_val = null;
        let depth_val = null;
        let weight_val = null;

        document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
            try {
                const json = JSON.parse(script.textContent || '{}');
                const blocks = Array.isArray(json) ? json : [json];
                for (const data of blocks) {
                    const items = data['@graph'] && Array.isArray(data['@graph']) ? data['@graph'] : [data];
                    for (const item of items) {
                        if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product'))) {
                            if (item.width && item.width.name) {
                                width_val = String(item.width.name).replace("mm", "").trim();
                            }
                            if (item.height && item.height.name) {
                                height_val = String(item.height.name).replace("mm", "").trim();
                            }
                            if (item.depth && item.depth.name) {
                                depth_val = String(item.depth.name).replace("mm", "").trim();
                            }
                            if (item.weight && item.weight.name) {
                                weight_val = String(item.weight.name).replace("g", "").replace("kg", "").trim();
                            }
                            if (item.additionalProperty && Array.isArray(item.additionalProperty)) {
                                item.additionalProperty.forEach(p => {
                                    if (p.name && p.value) {
                                        const name = p.name.toLowerCase();
                                        const val = String(p.value).replace("mm", "").replace("g", "").replace("kg", "").trim();
                                        if (name === "largeur" || name === "width") width_val = val;
                                        if (name === "hauteur" || name === "height") height_val = val;
                                        if (name === "profondeur" || name === "depth") depth_val = val;
                                        if (name === "poids" || name === "weight") weight_val = val;
                                    }
                                });
                            }
                        }
                    }
                }
            } catch(_) {}
        });

        const outerHtml = document.documentElement.outerHTML;
        const getAttributeVal = (html, attrName) => {
            const keyStr = `"attributeName":"${attrName}"`;
            const idx = html.indexOf(keyStr);
            if (idx === -1) return null;
            const after = html.substring(idx);
            const valIdx = after.indexOf('"value":"');
            if (valIdx === -1) return null;
            const afterVal = after.substring(valIdx + 9);
            const endValIdx = afterVal.indexOf('"');
            if (endValIdx === -1) return null;
            return afterVal.substring(0, endValIdx).trim();
        };

        if (!width_val) width_val = getAttributeVal(outerHtml, 'Largeur');
        if (!height_val) height_val = getAttributeVal(outerHtml, 'Hauteur');
        if (!depth_val) depth_val = getAttributeVal(outerHtml, 'Profondeur');
        if (!weight_val) weight_val = getAttributeVal(outerHtml, 'Poids');

        document.querySelectorAll('td, th, dt, dd, span, li').forEach(el => {
            try {
                const text = el.textContent.trim().toLowerCase();
                const checkSpec = (labelKey, valSetter) => {
                    if (text.startsWith(labelKey)) {
                        const nextChar = text.charAt(labelKey.length);
                        if (!nextChar || !/[a-zà-öø-ÿ0-9]/i.test(nextChar)) {
                            let valText = '';
                            if (el.nextElementSibling) {
                                valText = el.nextElementSibling.textContent.trim();
                            } else {
                                valText = el.textContent.substring(labelKey.length).replace(/^[:\s]+/, '').trim();
                            }
                            if (valText) {
                                const numMatch = valText.match(/[-+]?[0-9]*[.,]?[0-9]+/);
                                if (numMatch) {
                                    valSetter(numMatch[0]);
                                }
                            }
                        }
                    }
                };

                checkSpec('largeur', v => { if (!width_val) width_val = v; });
                checkSpec('width', v => { if (!width_val) width_val = v; });
                checkSpec('hauteur', v => { if (!height_val) height_val = v; });
                checkSpec('height', v => { if (!height_val) height_val = v; });
                checkSpec('profondeur', v => { if (!depth_val) depth_val = v; });
                checkSpec('depth', v => { if (!depth_val) depth_val = v; });
                checkSpec('poids', v => { if (!weight_val) weight_val = v; });
                checkSpec('weight', v => { if (!weight_val) weight_val = v; });
            } catch(_) {}
        });

        return {
            width: width_val,
            height: height_val,
            depth: depth_val,
            weight: weight_val
        };
    }

    function tryScrape() {
        try {
            console.log("[Scraper] tryScrape called. readyState: " + document.readyState + ", URL: " + window.location.href);
            if (!document.body || (document.readyState !== 'complete' && document.readyState !== 'interactive')) {
                console.log("[Scraper] DOM not ready yet.");
                return false;
            }

            dismissCookieBanners();
            
            const isRs = window.location.hostname.includes('rs-online') || window.location.hostname.includes('rsdelivers');
            const isSearchPage = isRs && !window.location.pathname.includes('/p/') && !window.location.pathname.includes('/product/');
            
            // Construire allTextNodes tôt pour pouvoir l'utiliser dans l'accumulation des dimensions
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

            // Accumulation des PDFs
            window.sfAccumulatedPdfs = window.sfAccumulatedPdfs || [];
            document.querySelectorAll('a').forEach(a => {
                const href = a.getAttribute('href');
                if (href && (href.toLowerCase().includes('.pdf') || href.toLowerCase().includes('filetype=pdf') || href.toLowerCase().includes('format=pdf'))) {
                    let absUrl = href;
                    try { absUrl = new URL(href, document.baseURI || window.location.href).toString(); } catch(_) {}
                    const title = a.textContent.trim() || 'Fiche Technique';
                    if (!window.sfAccumulatedPdfs.some(p => p.url === absUrl)) {
                        window.sfAccumulatedPdfs.push({ url: absUrl, title: title });
                    }
                }
            });

            // Accumulation des candidats de dimensions
            window.sfAccumulatedDimensions = window.sfAccumulatedDimensions || [];
            const dimRegex = /\b\d+(?:[.,]\d+)?\s*(?:x|×|\*)\s*\d+(?:[.,]\d+)?(?:\s*(?:x|×|\*)\s*\d+(?:[.,]\d+)?)?\s*(?:mm|cm|m|inch|pouces)?\b/gi;
            allTextNodes.forEach(nodeInfo => {
                const text = nodeInfo.text;
                let match;
                dimRegex.lastIndex = 0;
                while ((match = dimRegex.exec(text)) !== null) {
                    const candidate = match[0].trim();
                    if (candidate.toLowerCase().includes('x') || candidate.toLowerCase().includes('×') || candidate.toLowerCase().includes('*')) {
                        if (!window.sfAccumulatedDimensions.includes(candidate)) {
                            window.sfAccumulatedDimensions.push(candidate);
                        }
                    }
                }
            });

            if (!isSearchPage) {
                window.sfTabClickCount = window.sfTabClickCount || 0;
                if (window.sfTabClickCount < 5) {
                    const clicked = expandTabsSequentially();
                    if (clicked) {
                        window.sfTabClickCount++;
                        console.log("[Scraper] Tab cliqué, attente de chargement... Compteur :", window.sfTabClickCount);
                        return false; // Réessayer lors du prochain cycle de l'intervalle
                    }
                }
            }

            injectOverlay();

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

            // Helper function to robustly clean and parse price strings (supporting thousands separators and different decimal markers)
            const cleanAndParsePrice = (priceStr) => {
                let clean = priceStr.replace(/[\s ]/g, ''); // replace all space variations including U+202F
                if (/,(\d{2})$/.test(clean)) {
                    clean = clean.replace(/\./g, '');
                    clean = clean.replace(',', '.');
                } else if (/\.(\d{2})$/.test(clean)) {
                    clean = clean.replace(/,/g, '');
                }
                return parseFloat(clean);
            };

            // --- DEBUT EXTRACTION PRIX GLOBALE OPTIMISÉE ET CONTEXTUELLE ---
            const priceRegex = /(?:\b\d{1,3}(?:[\s .]\d{3})*(?:[.,]\d{2})\b|\b\d+[.,]\d{2}\b)/g;
            const foundHTs = [];
            const foundTTCs = [];
            const foundUnknowns = [];
            


            for (const nodeInfo of allTextNodes) {
                const text = nodeInfo.text;
                const parentText = nodeInfo.parent ? (nodeInfo.parent.innerText || '') : '';
                const cleanParentText = parentText.replace(/\s+/g, ' ');
                
                let match;
                priceRegex.lastIndex = 0;
                while ((match = priceRegex.exec(text)) !== null) {
                    const priceStr = match[0];
                    const val = cleanAndParsePrice(priceStr);
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
                                     priceHT = cleanAndParsePrice(htMatch[1]);
                                 }
                                 const ttcMatch = parentText.match(/([\d\s,.]+)\s*(?:€|EUR)?\s*TTC/i);
                                 if (ttcMatch) {
                                     priceTTC = cleanAndParsePrice(ttcMatch[1]);
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

            const specs = extractSpecsInJS();
            const res = {
                brand: brand.trim(),
                label: label.trim(),
                price: parseFloat(price.toFixed(2)),
                pack_size: pack_size,
                mpn: mpn.trim(),
                pdfs: window.sfAccumulatedPdfs || [],
                json_ld_blocks: jsonLdBlocks,
                cloudinary_urls: cloudinaryUrls,
                price_candidates: price_candidates,
                dimension_candidates: window.sfAccumulatedDimensions || [],
                width: specs.width,
                height: specs.height,
                depth: specs.depth,
                weight: specs.weight
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
                          if (overlay) overlay.remove();
                          const style = document.getElementById('sf-scrape-style');
                          if (style) style.remove();
                          
                          window.html2canvas(document.body, { 
                              logging: false, 
                              useCORS: true, 
                              allowTaint: true,
                              scale: 1,
                              backgroundColor: '#ffffff'
                          })
                          .then(canvas => {
                              try {
                                  sendResult(canvas.toDataURL('image/jpeg', 0.6));
                              } catch(err) {
                                  sendResult(null);
                              }
                          })
                           .catch((e) => {
                               console.error("[Scraper html2canvas] Canvas rendering failed:", e);
                               sendResult(null);
                           });
                      } catch(err) {
                          console.error("[Scraper html2canvas] Exception in executeHtml2Canvas:", err);
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
