import { getConfiguredVpcDomain } from "../services/webScraperService";

/**
 * Résout de façon robuste et universelle l'URL vers la page de l'article sur le site VPC.
 * 
 * Priorités de résolution :
 * 1. Attribut direct scrape_price_url ou source_url ou vpc_url
 * 2. Attributs structurés vpc (ex: { "RS": "519-724" }) ou codeRS
 *    -> Génère l'URL directe de recherche / article selon le domaine configuré (ex: fr.rs-online.com)
 */
export function getProductVpcUrl(prod: any): string {
  if (!prod) return "";

  try {
    const attrs = typeof prod.attributes === "string" 
      ? JSON.parse(prod.attributes || "{}") 
      : (prod.attributes || {});

    // 1. URL de scraping ou source explicite
    if (attrs?.scrape_price_url && typeof attrs.scrape_price_url === "string" && attrs.scrape_price_url.trim()) {
      return attrs.scrape_price_url.trim();
    }
    if (attrs?.source_url && typeof attrs.source_url === "string" && attrs.source_url.trim()) {
      return attrs.source_url.trim();
    }
    if (attrs?.vpc_url && typeof attrs.vpc_url === "string" && attrs.vpc_url.trim()) {
      return attrs.vpc_url.trim();
    }
    if (attrs?.url && typeof attrs.url === "string" && attrs.url.trim().startsWith("http")) {
      return attrs.url.trim();
    }

    // 2. Détection du code VPC et fournisseur
    let vpcCodeFull = "";
    if (attrs?.vpc && typeof attrs.vpc === "object") {
      const keys = Object.keys(attrs.vpc);
      if (keys.length > 0) {
        const site = keys[0];
        const val = attrs.vpc[site];
        if (val && String(val).trim()) {
          vpcCodeFull = `${site}: ${val}`;
        }
      }
    }
    if (!vpcCodeFull && attrs?.codeRS && String(attrs.codeRS).trim()) {
      vpcCodeFull = `RS: ${attrs.codeRS}`;
    }

    // Si aucun code VPC dans les attributs, regarder si prod.vpc_code ou équivalent existe
    if (!vpcCodeFull && prod.vpc_code && typeof prod.vpc_code === "string" && prod.vpc_code.trim()) {
      vpcCodeFull = prod.vpc_code.trim();
    }

    // 3. Construction dynamique de l'URL du fournisseur
    if (vpcCodeFull) {
      const idx = vpcCodeFull.indexOf(":");
      const vpcSiteName = idx !== -1 ? vpcCodeFull.substring(0, idx).trim() : "VPC";
      const vpcCodeVal = idx !== -1 ? vpcCodeFull.substring(idx + 1).trim() : vpcCodeFull;

      if (!vpcCodeVal) return "";

      const siteLower = vpcSiteName.toLowerCase();
      const configuredDomain = getConfiguredVpcDomain(vpcSiteName);

      // RS Components / RS France
      if (siteLower === "rs" || siteLower.includes("rs component") || siteLower.includes("rs online") || (configuredDomain && configuredDomain.includes("rs"))) {
        const domain = configuredDomain || "fr.rs-online.com";
        const cleanVal = vpcCodeVal.replace(/[-\s]/g, "").trim();
        return `https://${domain}/web/c/?searchTerm=${encodeURIComponent(cleanVal || vpcCodeVal)}`;
      }

      // Farnell
      if (siteLower.includes("farnell") || (configuredDomain && configuredDomain.includes("farnell"))) {
        const domain = configuredDomain || "fr.farnell.com";
        return `https://${domain}/w/c/?st=${encodeURIComponent(vpcCodeVal)}`;
      }

      // Mouser
      if (siteLower.includes("mouser") || (configuredDomain && configuredDomain.includes("mouser"))) {
        const domain = configuredDomain || "www.mouser.fr";
        return `https://${domain}/Search/Refine?Keyword=${encodeURIComponent(vpcCodeVal)}`;
      }

      // Conrad
      if (siteLower.includes("conrad") || (configuredDomain && configuredDomain.includes("conrad"))) {
        const domain = configuredDomain || "www.conrad.fr";
        return `https://${domain}/fr/search.html?search=${encodeURIComponent(vpcCodeVal)}`;
      }

      // Autre ou recherche générale
      return `https://www.google.com/search?q=${encodeURIComponent(`${vpcSiteName} ${vpcCodeVal}`)}`;
    }
  } catch (e) {}

  return "";
}
