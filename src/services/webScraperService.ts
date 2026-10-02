import { idbGet, idbPut, idbGetAll } from "./webDatabase";
import { emitWebEvent } from "./api";
import { detectDocumentType } from "../utils/documentUtils";

export interface CandidateSource {
  url?: string;
  screenshot_path?: string;
  provider: string;
}

export interface Candidate<T> {
  value: T;
  source: CandidateSource;
  confidence: number;
  selected: boolean;
}

export interface PriceInfo {
  price: number;
  currency: string;
  tax_type: string;
  label: string;
  pack_size: number;
}

export interface DimensionInfo {
  width?: string;
  height?: string;
  depth?: string;
}

export interface ResourceCandidate {
  url: string;
  thumbnail_url?: string;
  title: string;
  domain: string;
  source: CandidateSource;
  file_type: string;
  confidence?: number;
  doc_type?: string;
  doc_type_label?: string;
}

export interface ScrapeCandidates {
  sku: string;
  scraped_at: string;
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

const DEFAULT_SEARXNG_URL = "https://search.amify-studio.fr";

export interface BrandDefinition {
  canonical: string;
  aliases: string[];
  domains: string[];
}

export const BRAND_DEFINITIONS: BrandDefinition[] = [
  { canonical: "Siemens", aliases: ["Siemens", "Siemens Industry", "SIMATIC", "SITOP", "SIRIUS", "Sinamics", "LOGO!", "Sentron", "Simocode", "Desigo"], domains: ["siemens.com", "siemens.fr", "siemens.de", "sieportal.siemens.com", "industry.siemens.com", "mall.industry.siemens.com", "support.industry.siemens.com"] },
  { canonical: "Schneider Electric", aliases: ["Schneider Electric", "Schneider", "Telemecanique", "Merlin Gerin", "Modicon", "Square D", "Altivar", "Tesys", "Harmony", "Acti9", "Canalis", "Clipsal"], domains: ["se.com", "schneider-electric.com", "schneider-electric.fr", "telemecanique.com"] },
  { canonical: "ABB", aliases: ["ABB", "Asea Brown Boveri", "Entrelec", "Baldor", "Jokab Safety"], domains: ["abb.com", "abb.fr"] },
  { canonical: "Phoenix Contact", aliases: ["Phoenix Contact", "Phoenix"], domains: ["phoenixcontact.com", "phoenixcontact.fr", "phoenixcontact.de"] },
  { canonical: "Wago", aliases: ["WAGO", "Wago", "WAGO Kontakttechnik"], domains: ["wago.com", "wago.fr"] },
  { canonical: "Legrand", aliases: ["Legrand", "Bticino", "Netatmo", "Cablofil"], domains: ["legrand.fr", "legrand.com"] },
  { canonical: "Finder", aliases: ["Finder", "Finder Relais"], domains: ["findernet.com", "finder-relais.net"] },
  { canonical: "Eaton", aliases: ["Eaton", "Moeller", "Cutler-Hammer", "Cooper"], domains: ["eaton.com", "eaton.fr"] },
  { canonical: "Murrelektronik", aliases: ["Murrelektronik", "Murr"], domains: ["murrelektronik.com", "murrelektronik.fr"] },
  { canonical: "SMC", aliases: ["SMC", "SMC Corporation", "SMC Pneumatics"], domains: ["smc.eu", "smc.fr", "smcworld.com"] },
  { canonical: "Festo", aliases: ["Festo"], domains: ["festo.com", "festo.fr"] },
  { canonical: "Weidmüller", aliases: ["Weidmüller", "Weidmuller", "Klippon"], domains: ["weidmueller.com", "weidmueller.fr"] },
  { canonical: "Rittal", aliases: ["Rittal"], domains: ["rittal.com", "rittal.fr"] },
  { canonical: "Harting", aliases: ["Harting", "Han-Modular"], domains: ["harting.com"] },
  { canonical: "SICK", aliases: ["SICK", "Sick Sensor"], domains: ["sick.com"] },
  { canonical: "IFM", aliases: ["IFM", "ifm electronic", "IFM Electronic"], domains: ["ifm.com"] },
  { canonical: "Omron", aliases: ["Omron", "Omron Industrial Automation"], domains: ["omron.com", "ia.omron.com"] },
  { canonical: "Pilz", aliases: ["Pilz", "PNOZ"], domains: ["pilz.com"] },
  { canonical: "Turck", aliases: ["Turck", "Turck Banner", "Banner Engineering"], domains: ["turck.com", "bannerengineering.com"] },
  { canonical: "Allen-Bradley", aliases: ["Allen-Bradley", "Allen Bradley", "Rockwell Automation", "Rockwell", "Guardmaster"], domains: ["rockwellautomation.com", "allen-bradley.com"] },
  { canonical: "Mean Well", aliases: ["Mean Well", "Meanwell"], domains: ["meanwell.com", "meanwell.eu"] },
  { canonical: "Danfoss", aliases: ["Danfoss", "VLT"], domains: ["danfoss.com"] },
  { canonical: "Mitsubishi Electric", aliases: ["Mitsubishi Electric", "Mitsubishi", "MELSEC"], domains: ["mitsubishielectric.com"] },
  { canonical: "Crouzet", aliases: ["Crouzet", "Millenium"], domains: ["crouzet.com", "crouzet.fr"] },
  { canonical: "Carlo Gavazzi", aliases: ["Carlo Gavazzi", "Gavazzi"], domains: ["gavazziautomation.com"] },
  { canonical: "Socomec", aliases: ["Socomec", "Diris"], domains: ["socomec.fr", "socomec.com"] },
  { canonical: "Hager", aliases: ["Hager"], domains: ["hager.fr", "hager.com"] },
  { canonical: "Chint", aliases: ["Chint", "Chint Electric"], domains: ["chint.com"] },
  { canonical: "Lovato", aliases: ["Lovato", "Lovato Electric"], domains: ["lovatoelectric.com"] },
  { canonical: "Pflitsch", aliases: ["Pflitsch"], domains: ["pflitsch.de"] },
  { canonical: "Lapp", aliases: ["Lapp", "Lapp Kabel", "Lapp Group", "Ölflex", "Olflex", "Unitronic"], domains: ["lappkabel.de", "lapp.com"] },
  { canonical: "Helukabel", aliases: ["Helukabel"], domains: ["helukabel.com", "helukabel.fr"] },
  { canonical: "Milwaukee", aliases: ["Milwaukee", "Milwaukee Tool"], domains: ["milwaukeetool.eu", "milwaukeetool.com"] },
  { canonical: "Bosch", aliases: ["Bosch", "Bosch Rexroth", "Rexroth", "Bosch Professional"], domains: ["bosch-professional.com", "boschrexroth.com", "bosch.fr"] },
  { canonical: "DeWalt", aliases: ["DeWalt", "Dewalt"], domains: ["dewalt.fr", "dewalt.com"] },
  { canonical: "Makita", aliases: ["Makita"], domains: ["makita.fr", "makita.com"] },
  { canonical: "Metabo", aliases: ["Metabo"], domains: ["metabo.com"] },
  { canonical: "Festool", aliases: ["Festool"], domains: ["festool.fr", "festool.com"] },
  { canonical: "Fluke", aliases: ["Fluke", "Fluke Networks"], domains: ["fluke.com", "fluke.fr"] },
  { canonical: "Knipex", aliases: ["Knipex"], domains: ["knipex.com"] },
  { canonical: "Wera", aliases: ["Wera", "Kraftform"], domains: ["wera.de"] },
  { canonical: "Facom", aliases: ["Facom"], domains: ["facom.com", "facom.fr"] },
  { canonical: "Stanley", aliases: ["Stanley"], domains: ["stanleyoutillage.fr", "stanleyworks.com"] },
  { canonical: "3M", aliases: ["3M", "Scotch"], domains: ["3mfrance.fr", "3m.com"] },
  { canonical: "HellermannTyton", aliases: ["HellermannTyton", "Hellermann"], domains: ["hellermanntyton.fr", "hellermanntyton.com"] },
  { canonical: "Molex", aliases: ["Molex"], domains: ["molex.com"] },
  { canonical: "TE Connectivity", aliases: ["TE Connectivity", "Tyco Electronics", "AMP"], domains: ["te.com"] },
  { canonical: "JST", aliases: ["JST"], domains: ["jst.com"] },
  { canonical: "Hirose", aliases: ["Hirose", "HRS"], domains: ["hirose.com"] },
  { canonical: "Amphenol", aliases: ["Amphenol"], domains: ["amphenol.com"] },
  { canonical: "RS PRO", aliases: ["RS PRO", "RS Pro"], domains: [] },
  { canonical: "Würth", aliases: ["Würth", "Wurth", "Würth Elektronik", "Wurth Elektronik"], domains: ["wuerth.fr", "we-online.com"] }
];

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Détecte et classe intelligemment les marques à partir des résultats de recherche.
 * Attribue des scores pondérés selon la présence sur un domaine officiel (+40),
 * dans les titres des premiers résultats (+22, +16, +12, +7), et dans les extraits.
 */
export function scoreAndRankBrands(
  results: any[],
  existingBrand?: string
): Candidate<string>[] {
  if (existingBrand && existingBrand.trim()) {
    return [{
      value: existingBrand.trim(),
      source: { provider: "Existant" },
      confidence: 0.99,
      selected: true
    }];
  }

  const brandScores = new Map<string, { score: number; sources: string[]; evidence: string[] }>();

  results.forEach((r, rank) => {
    const rawUrl = r.url || "";
    const rawTitle = r.title || "";
    const rawSnippet = r.content || "";
    let hostname = "";
    try {
      hostname = new URL(rawUrl).hostname.toLowerCase();
    } catch {}

    for (const b of BRAND_DEFINITIONS) {
      let bScore = 0;
      const evidence: string[] = [];

      // 1. Site officiel de la marque (+40 points - signal absolu)
      const domainMatch = b.domains.some(d => hostname === d || hostname.endsWith("." + d));
      if (domainMatch) {
        bScore += 40;
        evidence.push(`Site officiel (${hostname})`);
      }

      // 2. Présence dans le titre avec pondération par rang
      for (const alias of b.aliases) {
        const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
        if (regex.test(rawTitle)) {
          const rankWeight = rank === 0 ? 22 : rank === 1 ? 16 : rank === 2 ? 12 : 7;
          bScore += rankWeight;
          evidence.push(`Titre #${rank + 1} (${alias})`);
          break;
        }
      }

      // 3. Présence dans l'extrait
      for (const alias of b.aliases) {
        const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
        if (regex.test(rawSnippet)) {
          const rankWeight = rank === 0 ? 5 : rank <= 2 ? 3 : 1.5;
          bScore += rankWeight;
          evidence.push(`Extrait #${rank + 1}`);
          break;
        }
      }

      if (bScore > 0) {
        const current = brandScores.get(b.canonical) || { score: 0, sources: [], evidence: [] };
        current.score += bScore;
        if (rawUrl && !current.sources.includes(rawUrl)) current.sources.push(rawUrl);
        current.evidence.push(...evidence);
        brandScores.set(b.canonical, current);
      }
    }
  });

  if (brandScores.size === 0) return [];

  const sorted = Array.from(brandScores.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.score - a.score);

  const topScore = sorted[0].score;

  return sorted.slice(0, 4).map((item, idx) => {
    let confidence = 0.50;
    if (idx === 0) {
      if (item.score >= 35) confidence = 0.98;
      else if (item.score >= 20) confidence = 0.93;
      else if (item.score >= 10) confidence = 0.85;
      else confidence = 0.75;
    } else {
      const ratio = item.score / (topScore || 1);
      confidence = Math.max(0.40, Math.min(0.85, Math.round(ratio * 0.85 * 100) / 100));
    }

    return {
      value: item.name,
      source: {
        provider: item.evidence[0] ? `SearXNG (${item.evidence[0]})` : "SearXNG",
        url: item.sources[0]
      },
      confidence,
      selected: idx === 0
    };
  });
}

/**
 * Nettoie le titre brut d'un résultat de recherche pour obtenir une désignation claire
 */
/**
 * Supprime la ponctuation traînante indésirable (. , ; : - etc.) à la fin des champs scrapés
 */
export function stripTrailingPunctuation(str: string): string {
  if (!str) return "";
  return str.trim().replace(/[.,;:·•\-–—|/]+$/, "").trim();
}

/**
 * Récupère la configuration persistée depuis le localStorage
 */
export function getAppConfigFromStorage(): any {
  try {
    const raw = localStorage.getItem("stockflow_config");
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

/**
 * Détermine le domaine configuré par l'utilisateur pour un fournisseur donné (ex: RS -> fr.rs-online.com)
 */
export function getConfiguredVpcDomain(site: string): string {
  try {
    const cfg = getAppConfigFromStorage();
    if (cfg?.vpc_urls) {
      const targetSite = (site || "").trim().toLowerCase();
      const directKey = Object.keys(cfg.vpc_urls).find(k => k.toLowerCase() === targetSite);
      if (directKey && cfg.vpc_urls[directKey]?.trim()) {
        return cfg.vpc_urls[directKey].trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      }
      const partialKey = Object.keys(cfg.vpc_urls).find(k => targetSite.includes(k.toLowerCase()) || k.toLowerCase().includes(targetSite));
      if (partialKey && cfg.vpc_urls[partialKey]?.trim()) {
        return cfg.vpc_urls[partialKey].trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      }
    }
  } catch {}
  const s = (site || "").toLowerCase();
  if (s.includes("rs")) return "fr.rs-online.com";
  if (s.includes("farnell")) return "fr.farnell.com";
  if (s.includes("mouser")) return "www.mouser.fr";
  if (s.includes("conrad")) return "www.conrad.fr";
  return "";
}

/**
 * Normalise l'URL d'un fournisseur vers le domaine configuré (ex: remplace de.rs-online.com par fr.rs-online.com)
 */
export function normalizeSupplierUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("rs-online.com") || host.includes("rsdelivers.com")) {
      const targetDomain = getConfiguredVpcDomain("RS") || "fr.rs-online.com";
      if (targetDomain && host !== targetDomain) {
        u.hostname = targetDomain;
        return u.toString();
      }
    }
    if (host.includes("farnell.com")) {
      const targetDomain = getConfiguredVpcDomain("Farnell") || "fr.farnell.com";
      if (targetDomain && host !== targetDomain) {
        u.hostname = targetDomain;
        return u.toString();
      }
    }
    if (host.includes("mouser.")) {
      const targetDomain = getConfiguredVpcDomain("Mouser") || "www.mouser.fr";
      if (targetDomain && host !== targetDomain) {
        u.hostname = targetDomain;
        return u.toString();
      }
    }
    if (host.includes("conrad.")) {
      const targetDomain = getConfiguredVpcDomain("Conrad") || "www.conrad.fr";
      if (targetDomain && host !== targetDomain) {
        u.hostname = targetDomain;
        return u.toString();
      }
    }
  } catch {}
  return url;
}

export function cleanProductTitle(rawTitle: string, sku: string): string {
  if (!rawTitle) return "";
  let t = rawTitle;

  // 1. Enlever la référence produit / SKU au début ("6GK75436WX000XE0 | ", "6GK7543-6WX00-0XE0 - ")
  if (sku) {
    const skuEscaped = escapeRegex(sku);
    t = t.replace(new RegExp(`^\\s*${skuEscaped}\\s*[-|:]\\s*`, "i"), "");
    const cleanSku = sku.replace(/[^A-Za-z0-9]/g, "");
    if (cleanSku.length >= 4) {
      t = t.replace(new RegExp(`^\\s*[A-Za-z0-9\\-_]{${Math.max(4, cleanSku.length - 2)},${cleanSku.length + 5}}\\s*\\|\\s*`, "i"), "");
    }
  }

  // 2. Enlever les préfixes de plateformes ("Product Details - Industry Mall - ", "Détails du produit - ")
  t = t.replace(/^Product Details\s*[-|]\s*Industry Mall\s*[-|]\s*/i, "");
  t = t.replace(/^Détails du produit\s*[-|]\s*/i, "");

  // 3. Enlever les suffixes de distributeurs et catalogues
  t = t.replace(/\s*[-|]\s*(RS|RS Components|RS Online|Farnell|Farnell FR|Mouser|Conrad|Amazon|eBay|Distrelec|TME|Rexel|Sonepar|SiePortal|Industry Mall|Siemens SiePortal).*$/i, "");
  t = t.replace(/\s*[-|]\s*Documentation\s*technique.*$/i, "");
  t = t.replace(/\s*[-|]\s*Notice.*$/i, "");

  // 4. Enlever les suffixes de domaine
  t = t.replace(/\s*sur\s+fr\.rs-online\.com.*$/i, "");
  t = t.replace(/\s*sur\s+[a-z0-9.-]+\.[a-z]{2,}.*$/i, "");

  // 5. Nettoyer toute ponctuation finale (points, tirets, barres...)
  return stripTrailingPunctuation(t.trim());
}

export function getSearxngUrl(): string {
  try {
    const raw = localStorage.getItem("stockflow_config");
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg.searxng_url && typeof cfg.searxng_url === "string" && cfg.searxng_url.trim()) {
        return cfg.searxng_url.trim().replace(/\/+$/, "");
      }
    }
  } catch {}
  return DEFAULT_SEARXNG_URL;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Recherche des images candidates sur SearXNG
 */
export async function searchSearxngImages(
  query: string,
  searxngBaseUrl: string = getSearxngUrl()
): Promise<ResourceCandidate[]> {
  const url = `${searxngBaseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=images&language=fr-FR`;
  
  const resp = await fetch(url, {
    headers: {
      "Accept": "application/json",
    }
  });

  if (resp.status === 429) {
    throw new Error("RATE_LIMIT_EXCEEDED: Limite temporaire de requêtes atteinte sur votre instance SearXNG (Cloudflare). Veuillez patienter quelques instants.");
  }

  if (!resp.ok) {
    throw new Error(`Erreur HTTP SearXNG (${resp.status}): ${resp.statusText}`);
  }

  const data = await resp.json();
  const results: any[] = data.results || [];

  return results.slice(0, 30).map((r: any) => {
    let domain = "web";
    try {
      if (r.url) domain = new URL(r.url).hostname;
    } catch {}

    const imgUrl = r.img_src || r.thumbnail_src || r.url || "";
    const thumbUrl = r.thumbnail_src || r.img_src || imgUrl;
    const ext = imgUrl.split("?")[0].split(".").pop()?.slice(0, 4) || "jpg";

    return {
      url: imgUrl,
      thumbnail_url: thumbUrl,
      title: r.title || "Image produit",
      domain,
      source: { provider: "SearXNG", url: r.url },
      file_type: ext,
      confidence: r.img_src ? 0.90 : 0.75,
    };
  });
}

/**
 * Recherche des notices et fiches techniques PDF sur SearXNG
 */
export async function searchSearxngPdfs(
  query: string,
  searxngBaseUrl: string = getSearxngUrl()
): Promise<ResourceCandidate[]> {
  const pdfQuery = `${query} (manuel OR notice OR guide OR datasheet) filetype:pdf`;
  const url = `${searxngBaseUrl}/search?q=${encodeURIComponent(pdfQuery)}&format=json&categories=general&language=fr-FR`;

  const resp = await fetch(url, {
    headers: {
      "Accept": "application/json",
    }
  });

  if (resp.status === 429) {
    throw new Error("RATE_LIMIT_EXCEEDED: Limite de requêtes temporaire atteinte sur votre instance SearXNG (Cloudflare).");
  }

  if (!resp.ok) {
    throw new Error(`Erreur HTTP SearXNG (${resp.status})`);
  }

  const data = await resp.json();
  const results: any[] = data.results || [];

  const pdfs = results.filter((r: any) => {
    const u = (r.url || "").toLowerCase();
    const t = (r.title || "").toLowerCase();
    return u.includes(".pdf") || t.includes("pdf") || t.includes("datasheet") || t.includes("notice");
  });

  return pdfs.slice(0, 15).map((r: any) => {
    let domain = "web";
    try {
      if (r.url) domain = new URL(r.url).hostname;
    } catch {}

    const typeInfo = detectDocumentType(r.url, r.title, r.content);

    return {
      url: r.url,
      title: r.title || typeInfo.label,
      domain,
      source: { provider: "SearXNG", url: r.url },
      file_type: "pdf",
      confidence: 0.92,
      doc_type: typeInfo.value,
      doc_type_label: typeInfo.label,
    };
  });
}

/**
 * Recherche d'informations générales pour l'auto-remplissage des champs (désignation, marque...)
 */
export async function searchSearxngGeneral(
  query: string,
  searxngBaseUrl: string = getSearxngUrl()
): Promise<any[]> {
  const url = `${searxngBaseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=fr-FR`;
  try {
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.results || [];
  } catch (e) {
    console.warn("[WebScraper] Erreur recherche générale :", e);
    return [];
  }
}

export interface WebScrapeOptions {
  includeImages?: boolean;
  includeDocs?: boolean;
  allowFallback?: boolean;
}

/**
 * Lance le scraping complet ou sélectif pour un SKU en mode Web pur
 */
export async function runWebScrape(
  sku: string,
  hintProduct?: any,
  options?: WebScrapeOptions
): Promise<ScrapeCandidates> {
  const upperSku = sku.toUpperCase().trim();
  const searxngUrl = getSearxngUrl();
  const includeImages = options?.includeImages === true;
  const includeDocs = options?.includeDocs === true;

  const cfg = getAppConfigFromStorage();
  const allowFallback = options?.allowFallback !== undefined
    ? options.allowFallback
    : (cfg?.enable_scrape_fallback !== false);

  const rsDomain = getConfiguredVpcDomain("RS") || "fr.rs-online.com";
  const farnellDomain = getConfiguredVpcDomain("Farnell") || "fr.farnell.com";
  const mouserDomain = getConfiguredVpcDomain("Mouser") || "www.mouser.fr";
  const conradDomain = getConfiguredVpcDomain("Conrad") || "www.conrad.fr";

  const vpcSite = (hintProduct?.vpcSite || "").trim();
  const vpcCode = (hintProduct?.vpcCode || "").trim();
  const inputCode = vpcCode || upperSku;

  // L'utilisateur a-t-il explicitement sélectionné un fournisseur VPC (Code RS, Code Farnell, etc.) ?
  const isExplicitVpc = !!vpcSite;
  const isRs = isExplicitVpc && (vpcSite.toUpperCase() === "RS" || vpcSite.toLowerCase().includes("rs"));
  const isFarnell = isExplicitVpc && vpcSite.toLowerCase().includes("farnell");
  const isMouser = isExplicitVpc && vpcSite.toLowerCase().includes("mouser");
  const isConrad = isExplicitVpc && vpcSite.toLowerCase().includes("conrad");

  let targetDomain = "";
  if (isExplicitVpc) {
    if (isRs) targetDomain = rsDomain;
    else if (isFarnell) targetDomain = farnellDomain;
    else if (isMouser) targetDomain = mouserDomain;
    else if (isConrad) targetDomain = conradDomain;
    else targetDomain = getConfiguredVpcDomain(vpcSite);
  }

  let brand = (hintProduct?.brand || "").trim();
  let mpn = (hintProduct?.mpn || "").trim();
  let label = (hintProduct?.label || "").trim();

  // ÉTAPE 1 : RECHERCHE D'IDENTIFICATION SUR SEARXNG
  emitWebEvent("scrape-task-progress", {
    sku: upperSku,
    progress: 0.15,
    message: isExplicitVpc && isRs
      ? `Recherche ciblée sur ${rsDomain}...`
      : isExplicitVpc && targetDomain
      ? `Recherche ciblée sur ${targetDomain}...`
      : `Recherche d'identification générale pour ${upperSku}...`
  });

  let generalResults: any[] = [];
  let detectedSourceUrl: string | undefined = undefined;

  try {
    if (isExplicitVpc && isRs) {
      // 1. Essai ciblé sur le catalogue RS configuré (ex: fr.rs-online.com)
      generalResults = await searchSearxngGeneral(`${inputCode} site:${rsDomain}`, searxngUrl);

      // 2. Si 0 résultat, essayer avec le code préfixé par 0 sur le même domaine
      if (generalResults.length === 0) {
        const cleanDigits = inputCode.replace(/\D/g, "");
        const zeroPrefixed = cleanDigits.length === 6 ? "0" + cleanDigits : cleanDigits;
        if (zeroPrefixed !== inputCode) {
          generalResults = await searchSearxngGeneral(`${zeroPrefixed} site:${rsDomain}`, searxngUrl);
        }
      }

      // 3. Fallbacks régionaux et génériques (UNIQUEMENT si allowFallback est actif)
      if (allowFallback && generalResults.length === 0) {
        generalResults = await searchSearxngGeneral(`${inputCode} site:rs-online.com`, searxngUrl);
        if (generalResults.length === 0) {
          generalResults = await searchSearxngGeneral(`${inputCode} RS Components`, searxngUrl);
        }
        if (generalResults.length === 0) {
          generalResults = await searchSearxngGeneral(`${inputCode} RS`, searxngUrl);
        }
      }
    } else if (isExplicitVpc && isFarnell) {
      generalResults = await searchSearxngGeneral(`${inputCode} site:${farnellDomain}`, searxngUrl);
      if (allowFallback && generalResults.length === 0) {
        generalResults = await searchSearxngGeneral(`${inputCode} site:farnell.com`, searxngUrl);
      }
    } else if (isExplicitVpc && isMouser) {
      generalResults = await searchSearxngGeneral(`${inputCode} site:${mouserDomain}`, searxngUrl);
    } else if (isExplicitVpc && isConrad) {
      generalResults = await searchSearxngGeneral(`${inputCode} site:${conradDomain}`, searxngUrl);
    } else if (isExplicitVpc && targetDomain) {
      generalResults = await searchSearxngGeneral(`${inputCode} site:${targetDomain}`, searxngUrl);
    } else {
      // Recherche généraliste (MPN / Réf Fabricant ou aucun VPC spécifié) : sur tout le Web
      const q = [brand, mpn || upperSku, label].filter(Boolean).join(" ").trim() || upperSku;
      generalResults = await searchSearxngGeneral(q, searxngUrl);
    }

    // Si la recherche ciblée VPC n'a rien donné, fallback large sur le Web (UNIQUEMENT si allowFallback est actif)
    if (isExplicitVpc && allowFallback && generalResults.length === 0) {
      const fallbackQuery = [brand, mpn || upperSku, label].filter(Boolean).join(" ").trim() || upperSku;
      generalResults = await searchSearxngGeneral(fallbackQuery, searxngUrl);
    }
  } catch (err: any) {
    console.warn("[WebScraper] Erreur recherche générale :", err);
  }

  // Extraire les informations du produit depuis les résultats SearXNG
  const labelCandidates: Candidate<string>[] = [];
  const brandCandidates: Candidate<string>[] = [];
  const mpnCandidates: Candidate<string>[] = [];
  const priceCandidates: Candidate<PriceInfo>[] = [];
  const dimensionCandidates: Candidate<DimensionInfo>[] = [];
  const weightCandidates: Candidate<string>[] = [];
  const packSizeCandidates: Candidate<number>[] = [];
  let detectedCategory = "";

  // 1. Détection intelligente de la marque par score multi-critères (domaines officiels, titres, snippets)
  const detectedBrands = scoreAndRankBrands(generalResults, brand);
  brandCandidates.push(...detectedBrands.map(b => ({ ...b, value: stripTrailingPunctuation(b.value) })));
  if (!brand && brandCandidates.length > 0) {
    brand = brandCandidates[0].value;
  }

  // 2. Extraire la désignation, MPN et prix depuis chaque résultat SearXNG
  for (let rank = 0; rank < generalResults.length; rank++) {
    const r = generalResults[rank];
    const rawTitle = (r.title || "").trim();
    const rawSnippet = (r.content || "").trim();
    const rawUrl = r.url || "";
    const url = normalizeSupplierUrl(rawUrl);

    // En mode strict (fallback désactivé), ignorer les résultats ne correspondant pas au domaine ciblé
    if (!allowFallback && targetDomain) {
      try {
        const h = new URL(rawUrl).hostname.toLowerCase();
        if (!h.includes(targetDomain) && !targetDomain.includes(h)) {
          continue;
        }
      } catch {
        continue;
      }
    }

    if (!detectedSourceUrl && (url.includes("rs-online") || url.includes("rsdelivers") || url.includes("farnell") || url.includes("mouser") || url.includes("siemens") || url.includes("schneider"))) {
      detectedSourceUrl = url;
    }

    // Spécifique RS : parser le snippet standard "En commandant <Titre> <MPN> ou tout autre <Catégorie> sur fr.rs-online.com"
    if (url.includes("rs-online.com") || url.includes("rsdelivers.com")) {
      const rsSnippetMatch = rawSnippet.match(/En commandant\s+(.+?)\s+([A-Za-z0-9\-_]{4,35})\s+ou tout autre\s+(.+?)\s+sur/i);
      if (rsSnippetMatch) {
        const snippetLabel = cleanProductTitle(rsSnippetMatch[1].trim(), upperSku);
        const snippetMpn = stripTrailingPunctuation(rsSnippetMatch[2].trim());
        const snippetCat = stripTrailingPunctuation(rsSnippetMatch[3].trim());
        if (snippetLabel && snippetLabel.length > 5 && !labelCandidates.some(c => c.value.toLowerCase() === snippetLabel.toLowerCase())) {
          labelCandidates.unshift({
            value: snippetLabel,
            source: { provider: "RS Online (via SearXNG)", url },
            confidence: 0.98,
            selected: true,
          });
        }
        if (snippetMpn && !mpnCandidates.some(c => c.value.toUpperCase() === snippetMpn.toUpperCase())) {
          mpnCandidates.unshift({
            value: snippetMpn,
            source: { provider: "RS Online (via SearXNG)", url },
            confidence: 0.96,
            selected: mpnCandidates.length === 0,
          });
        }
        if (snippetCat && !detectedCategory) {
          detectedCategory = snippetCat;
        }
      }
    }

    // Nettoyer le titre pour fabriquer un candidat de désignation propre (sans le SKU ni suffixes boutique)
    const cleanedTitle = cleanProductTitle(rawTitle, upperSku);
    if (cleanedTitle && cleanedTitle.length > 6 && !labelCandidates.some(c => c.value.toLowerCase() === cleanedTitle.toLowerCase())) {
      let isOfficialDomain = false;
      try {
        const h = new URL(url).hostname.toLowerCase();
        isOfficialDomain = BRAND_DEFINITIONS.some(b => b.domains.some(d => h === d || h.endsWith("." + d)));
      } catch {}

      labelCandidates.push({
        value: cleanedTitle,
        source: {
          provider: isOfficialDomain ? "Site officiel (via SearXNG)" : url.includes("rs-online.com") ? "RS Online" : "SearXNG",
          url
        },
        confidence: isOfficialDomain ? 0.96 : url.includes("rs-online.com") ? 0.92 : rank === 0 ? 0.88 : 0.80,
        selected: labelCandidates.length === 0,
      });
    }

    // Détection de prix dans snippet ou titre
    const priceMatches = (rawTitle + " " + rawSnippet).matchAll(/(?:(\d{1,5}[\.,]\d{2})\s*€|€\s*(\d{1,5}[\.,]\d{2}))/g);
    for (const match of priceMatches) {
      const rawPrice = match[1] || match[2];
      if (rawPrice) {
        const priceNum = parseFloat(rawPrice.replace(",", "."));
        if (priceNum > 0.50 && priceNum < 100000 && !priceCandidates.some(c => Math.abs(c.value.price - priceNum) < 0.05)) {
          const isHt = url.includes("rs-online") || url.includes("farnell") || url.includes("mouser") || url.includes("sonepar") || rawSnippet.toLowerCase().includes("ht");
          priceCandidates.push({
            value: {
              price: priceNum,
              currency: "EUR",
              tax_type: isHt ? "HT" : "TTC",
              label: "Prix détecté",
              pack_size: 1
            },
            source: { provider: url.includes("rs-online") ? "RS Online (SearXNG)" : "SearXNG", url },
            confidence: url.includes("rs-online") ? 0.92 : 0.80,
            selected: priceCandidates.length === 0
          });
        }
      }
    }

    // Détection des dimensions physiques (ex: 15 x 73 x 58 mm)
    const dimMatch = (rawTitle + " " + rawSnippet).match(/(\d+[\.,]?\d*)\s*(?:x|×)\s*(\d+[\.,]?\d*)\s*(?:x|×)\s*(\d+[\.,]?\d*)\s*(mm|cm|m)/i);
    if (dimMatch && dimensionCandidates.length === 0) {
      dimensionCandidates.push({
        value: {
          width: dimMatch[1].replace(",", "."),
          height: dimMatch[2].replace(",", "."),
          depth: dimMatch[3].replace(",", "."),
        },
        source: { provider: "SearXNG", url },
        confidence: 0.85,
        selected: true
      });
    }

    // Détection du poids (ex: Poids net : 0,15 kg ou 150 g)
    const weightMatch = (rawTitle + " " + rawSnippet).match(/(?:Poids|Weight|Poids net)\s*[:=]?\s*(\d+[\.,]?\d*)\s*(g|kg)/i);
    if (weightMatch && weightCandidates.length === 0) {
      let val = parseFloat(weightMatch[1].replace(",", "."));
      if (weightMatch[2].toLowerCase() === "kg") val = Math.round(val * 1000);
      weightCandidates.push({
        value: `${val}`,
        source: { provider: "SearXNG", url },
        confidence: 0.85,
        selected: true
      });
    }

    // Détection de la taille du lot
    const packMatch = (rawTitle + " " + rawSnippet).match(/(?:lot de|paquet de|boîte de|cond\.\s*:?)\s*(\d+)/i);
    if (packMatch && packSizeCandidates.length === 0) {
      const size = parseInt(packMatch[1], 10);
      if (size > 1 && size <= 1000) {
        packSizeCandidates.push({
          value: size,
          source: { provider: "SearXNG", url },
          confidence: 0.80,
          selected: true
        });
      }
    }
  }

  // 3. Chercher des références formatées officielles dans les résultats
  // (ex: si le SKU saisi est "6GK75436WX000XE0", retrouver "6GK7543-6WX00-0XE0")
  const cleanSkuAlnum = upperSku.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (cleanSkuAlnum.length >= 4) {
    for (const r of generalResults) {
      const textToSearch = `${r.title || ""} ${r.content || ""}`;
      const tokens = textToSearch.split(/[\s,;:()[\]|]+/);
      for (const tok of tokens) {
        const cleanTok = tok.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        if (cleanTok === cleanSkuAlnum && tok.toUpperCase() !== upperSku && (tok.includes("-") || tok.includes(".") || tok.includes("/"))) {
          const sanitizedTok = stripTrailingPunctuation(tok);
          if (sanitizedTok && !mpnCandidates.some(c => c.value === sanitizedTok)) {
            mpnCandidates.unshift({
              value: sanitizedTok,
              source: { provider: "Référence fabricant formatée", url: normalizeSupplierUrl(r.url) },
              confidence: 0.98,
              selected: true,
            });
            break;
          }
        }
      }
    }
  }

  // 4. S'assurer que le SKU / MPN existant est disponible sans ponctuation finale
  if (mpn) {
    const cleanMpn = stripTrailingPunctuation(mpn);
    if (cleanMpn && !mpnCandidates.some(c => c.value === cleanMpn)) {
      mpnCandidates.push({
        value: cleanMpn,
        source: { provider: "Existant" },
        confidence: 0.95,
        selected: mpnCandidates.length === 0,
      });
    }
  }
  const cleanUpperSku = stripTrailingPunctuation(upperSku);
  if (!mpnCandidates.some(c => c.value === cleanUpperSku)) {
    mpnCandidates.push({
      value: cleanUpperSku,
      source: { provider: "SKU" },
      confidence: 0.90,
      selected: mpnCandidates.length === 0,
    });
  }

  const topLabel = labelCandidates[0]?.value || "";
  const topBrand = brandCandidates[0]?.value || brand || "";
  const topMpn = mpnCandidates[0]?.value || mpn || "";

  // Récupérer les candidats existants en base pour ne pas écraser les images/docs précédemment trouvés si on ne les rescrape pas
  let existingCandidates: ScrapeCandidates | null = null;
  try {
    const raw = await idbGet<any>("config", `candidates_${upperSku}`);
    if (raw) existingCandidates = raw.value || raw;
  } catch {}

  // ÉTAPE 2 : RECHERCHE D'IMAGES ENRICHIES (OPTIONNELLE)
  let imageCandidates: ResourceCandidate[] = existingCandidates?.image_candidates || [];
  if (includeImages) {
    emitWebEvent("scrape-task-progress", {
      sku: upperSku,
      progress: 0.50,
      message: topLabel ? `Recherche d'images pour ${topLabel.slice(0, 35)}...` : "Recherche d'images sur SearXNG..."
    });
    await delay(500);

    let imageQuery = "";
    if (topBrand && topMpn && topMpn !== upperSku) {
      imageQuery = `${topBrand} ${topMpn}`;
    } else if (topLabel) {
      imageQuery = topLabel.split(/\s+/).slice(0, 6).join(" ");
    } else if (isExplicitVpc && targetDomain) {
      imageQuery = `${inputCode} site:${targetDomain}`;
    } else {
      imageQuery = upperSku;
    }

    try {
      const searchedImages = await searchSearxngImages(imageQuery, searxngUrl);
      if (searchedImages.length < 3 && topLabel && imageQuery !== topLabel.slice(0, 30)) {
        const extraImgs = await searchSearxngImages(topLabel.split(/\s+/).slice(0, 6).join(" "), searxngUrl);
        searchedImages.push(...extraImgs.filter(ei => !searchedImages.some(i => i.url === ei.url)));
      }

      // Fusionner avec les images existantes sans doublons
      const existingUrls = new Set(imageCandidates.map(c => c.url));
      const freshCandidates = searchedImages.filter(c => !existingUrls.has(c.url));
      imageCandidates = [...freshCandidates, ...imageCandidates];

      // Secours : si la recherche textuelle n'a donné aucun label mais que des images pertinentes ont été trouvées
      if (labelCandidates.length === 0 && imageCandidates.length > 0) {
        for (const img of imageCandidates.slice(0, 4)) {
          if (img.title && img.title.length > 8 && !img.title.toLowerCase().includes("image")) {
            let cleanImgTitle = stripTrailingPunctuation(img.title.replace(/\s*[-|]\s*(RS|RS Components|Amazon|eBay).*$/i, "").trim());
            if (!labelCandidates.some(c => c.value.toLowerCase() === cleanImgTitle.toLowerCase())) {
              labelCandidates.push({
                value: cleanImgTitle,
                source: { provider: "Titre image SearXNG", url: img.source.url },
                confidence: 0.85,
                selected: labelCandidates.length === 0,
              });
            }
            if (brandCandidates.length === 0) {
              const imgBrands = scoreAndRankBrands([{ title: cleanImgTitle, url: img.source.url }]);
              if (imgBrands.length > 0) {
                brandCandidates.push(...imgBrands);
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.warn("[WebScraper] Erreur images :", err);
    }
  }

  // ÉTAPE 3 : RECHERCHE DE NOTICES ET FICHES TECHNIQUES PDF (OPTIONNELLE)
  let pdfCandidates: ResourceCandidate[] = existingCandidates?.pdf_candidates || [];
  if (includeDocs) {
    emitWebEvent("scrape-task-progress", {
      sku: upperSku,
      progress: 0.80,
      message: "Recherche de documentations techniques et notices..."
    });
    await delay(500);

    let pdfQuery = "";
    if (topBrand && topMpn && topMpn !== upperSku) {
      pdfQuery = `${topBrand} ${topMpn}`;
    } else if (topLabel) {
      pdfQuery = topLabel.split(/\s+/).slice(0, 5).join(" ");
    } else {
      pdfQuery = upperSku;
    }

    try {
      const searchedPdfs = await searchSearxngPdfs(pdfQuery, searxngUrl);
      const existingUrls = new Set(pdfCandidates.map(c => c.url));
      const freshPdfs = searchedPdfs.filter(c => !existingUrls.has(c.url));
      pdfCandidates = [...freshPdfs, ...pdfCandidates];
    } catch (err: any) {
      console.warn("[WebScraper] Erreur PDF :", err);
    }
  }

  const result: ScrapeCandidates = {
    sku: upperSku,
    scraped_at: new Date().toISOString(),
    scraped_at_ms: Date.now(),
    status: "Complete",
    progress: 1.0,
    sources_visited: [
      {
        url: detectedSourceUrl || `${searxngUrl}/search?q=${encodeURIComponent(inputCode)}`,
        provider: (isExplicitVpc && isRs)
          ? "RS Online (via SearXNG)"
          : (isExplicitVpc && targetDomain)
          ? `${targetDomain} (via SearXNG)`
          : "SearXNG (Auto-hébergé)",
        visited_at: new Date().toISOString(),
        success: labelCandidates.length > 0 || imageCandidates.length > 0,
      }
    ],
    label_candidates: labelCandidates,
    brand_candidates: brandCandidates,
    mpn_candidates: mpnCandidates,
    price_candidates: priceCandidates,
    dimension_candidates: dimensionCandidates,
    weight_candidates: weightCandidates,
    pack_size_candidates: packSizeCandidates,
    image_candidates: imageCandidates,
    pdf_candidates: pdfCandidates,
  };

  // Stocker dans le store config d'IndexedDB pour persistance
  await idbPut("config", {
    key: `candidates_${upperSku}`,
    value: result,
  });

  // Clé normalisée (sans tirets, espaces, points) pour réconciliation automatique
  const normSku = upperSku.replace(/[^A-Z0-9]/g, "");
  if (normSku && normSku !== upperSku) {
    await idbPut("config", {
      key: `candidates_${normSku}`,
      value: result,
    });
  }

  // Si un MPN formaté distinct a été extrait, enregistrer également sous ce MPN
  if (topMpn && topMpn.toUpperCase().trim() !== upperSku) {
    const cleanMpn = topMpn.toUpperCase().trim();
    await idbPut("config", {
      key: `candidates_${cleanMpn}`,
      value: result,
    });
    const normMpn = cleanMpn.replace(/[^A-Z0-9]/g, "");
    if (normMpn && normMpn !== cleanMpn && normMpn !== normSku) {
      await idbPut("config", {
        key: `candidates_${normMpn}`,
        value: result,
      });
    }
  }

  const totalCandidatesFound =
    (labelCandidates.length > 0 ? 1 : 0) +
    (brandCandidates.length > 0 ? 1 : 0) +
    (mpnCandidates.length > 0 ? 1 : 0) +
    (priceCandidates.length > 0 ? 1 : 0) +
    (dimensionCandidates.length > 0 ? 1 : 0) +
    (weightCandidates.length > 0 ? 1 : 0) +
    (packSizeCandidates.length > 0 ? 1 : 0) +
    imageCandidates.length +
    pdfCandidates.length;

  emitWebEvent("scrape-task-complete", {
    sku: upperSku,
    candidates_count: totalCandidatesFound,
  });

  return result;
}

/**
 * Récupère les candidats mis en cache dans IndexedDB pour un SKU.
 * Tolérant aux variations de formatage (avec ou sans tirets, majuscules/minuscules, etc.).
 */
export async function getStoredScrapeCandidates(sku: string): Promise<ScrapeCandidates | null> {
  const upperSku = (sku || "").toUpperCase().trim();
  if (!upperSku) return null;

  // 1. Recherche par clé exacte
  const record = await idbGet<any>("config", `candidates_${upperSku}`);
  if (record?.value) return record.value;

  // 2. Recherche par clé normalisée (sans tirets, espaces, etc.)
  const normSku = upperSku.replace(/[^A-Z0-9]/g, "");
  if (normSku && normSku !== upperSku) {
    const normRecord = await idbGet<any>("config", `candidates_${normSku}`);
    if (normRecord?.value) return normRecord.value;
  }

  // 3. Recherche de secours : balayer l'ensemble des clés candidates_* dans config
  try {
    const all = await idbGetAll<{ key: string; value: any }>("config");
    for (const item of all) {
      if (item.key && item.key.startsWith("candidates_")) {
        const itemKey = item.key.replace("candidates_", "").toUpperCase().trim();
        const itemNorm = itemKey.replace(/[^A-Z0-9]/g, "");
        if (itemNorm === normSku || itemKey === upperSku) {
          return item.value;
        }
      }
    }
  } catch (e) {
    console.warn("Fallback candidate lookup failed:", e);
  }

  return null;
}

