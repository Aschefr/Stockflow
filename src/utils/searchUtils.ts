/**
 * Utilitaires de recherche intelligente et tolérante pour StockFlow.
 * 
 * Fonctionnalités :
 * - Recherche multi-termes (ET logique) : "Alim 24v" trouve "Alimentation - 230V - 24V"
 * - Insensibilité à la casse et aux accents (diacritiques) : "boîtier" <=> "boitier", "câble" <=> "cable"
 * - Tolérance sur les séparateurs et espaces unités : "24v" <=> "24 V", "230v" <=> "230 V", "1.5mm" <=> "1,5 mm"
 * - Tolérance aux sous-chaînes et préfixes : "alim" trouve "alimentation", "disj" trouve "disjoncteur"
 * - Recherche transversale sur tous les champs pertinents : désignation, SKU, MPN, marque, famille, sous-famille, emplacement, attributs
 * - Tolérance aux fautes de frappe (Levenshtein) sur les mots alphabétiques longs (ex: "scheinder" trouve "schneider")
 * - Système de score de pertinence pour trier les meilleurs résultats en premier
 */

export interface SearchableProduct {
  sku?: string;
  label?: string;
  brand?: string;
  mpn?: string;
  category?: string;
  sub_category?: string;
  subCategory?: string;
  location?: string;
  attributes?: string | Record<string, any> | null;
  [key: string]: any;
}

/**
 * Normalise une chaîne : minuscules et suppression des accents (diacritiques)
 */
export function normalizeSearchText(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Rapproche les unités et valeurs numériques (ex: "24 V" -> "24v", "1,5 mm" -> "1.5mm")
 */
export function collapseUnits(str: string): string {
  if (!str) return "";
  return str
    .replace(/(\d+)[,.](\d+)/g, "$1.$2")
    .replace(/(\d+(?:\.\d+)?)\s*([a-zA-Z%µ²°]+)/g, "$1$2");
}

/**
 * Distance de Levenshtein avec seuil d'abandon rapide pour les performances
 */
export function levenshtein(a: string, b: string, maxDist = 2): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const la = a.length;
  const lb = b.length;
  const dp: number[] = Array.from({ length: lb + 1 }, (_, i) => i);

  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    let minRow = dp[0];
    for (let j = 1; j <= lb; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
      if (dp[j] < minRow) minRow = dp[j];
    }
    if (minRow > maxDist) return maxDist + 1;
  }
  return dp[lb];
}

interface TokenMetadata {
  token: string;
  colToken: string;
  isNumberOrUnit: boolean;
  maxDist: number;
  len: number;
}

interface ProductFieldsCache {
  sku: string;
  mpn: string;
  label: string;
  brand: string;
  fullText: string;
  colFullText: string;
  allWords: string[];
}

function extractProductFields(product: SearchableProduct): ProductFieldsCache {
  const sku = normalizeSearchText(product.sku || "");
  const mpn = normalizeSearchText(product.mpn || "");
  const label = normalizeSearchText(product.label || "");
  const brand = normalizeSearchText(product.brand || "");
  const category = normalizeSearchText(product.category || "");
  const subCategory = normalizeSearchText(product.sub_category || product.subCategory || "");
  const location = normalizeSearchText(product.location || "");
  const attributes = normalizeSearchText(
    typeof product.attributes === "string"
      ? product.attributes
      : product.attributes
      ? JSON.stringify(product.attributes)
      : ""
  );

  const fullText = [sku, label, brand, mpn, category, subCategory, location, attributes]
    .filter(Boolean)
    .join(" ");
  const colFullText = collapseUnits(fullText);

  const words = fullText.split(/[\s,\-_/;:|()\[\]]+/);
  const colWords = colFullText.split(/[\s,\-_/;:|()\[\]]+/);
  const allWords = Array.from(new Set([...words, ...colWords])).filter(Boolean);

  return { sku, mpn, label, brand, fullText, colFullText, allWords };
}

/**
 * Crée un comparateur optimisé pour une requête donnée.
 * Pré-calcule les tokens et regex une seule fois pour tout le catalogue.
 */
export function createProductSearchMatcher<T extends SearchableProduct>(query: string) {
  const trimmed = (query || "").trim();
  if (!trimmed) {
    return {
      matches: () => true,
      score: () => 0,
      filterAndSort: (list: T[]) => list,
    };
  }

  const rawNormQuery = normalizeSearchText(trimmed);
  const colQuery = collapseUnits(rawNormQuery);
  const rawTokens = rawNormQuery.split(/[\s,\-_/]+/).filter(Boolean);

  if (rawTokens.length === 0) {
    return {
      matches: () => true,
      score: () => 0,
      filterAndSort: (list: T[]) => list,
    };
  }

  const tokenData: TokenMetadata[] = rawTokens.map(token => ({
    token,
    colToken: collapseUnits(token),
    isNumberOrUnit: /^\d+[a-zA-Z%µ²°]*$/.test(token) || /^\d+$/.test(token),
    maxDist: token.length >= 7 ? 2 : 1,
    len: token.length,
  }));

  function matches(product: T): boolean {
    const { fullText, colFullText, allWords } = extractProductFields(product);

    // Correspondance exacte globale
    if (fullText.includes(rawNormQuery) || colFullText.includes(colQuery)) {
      return true;
    }

    // Tous les tokens doivent être validés (ET logique)
    return tokenData.every(({ token, colToken, isNumberOrUnit, maxDist, len }) => {
      // 1. Sous-chaîne directe dans le texte combiné ou la version compactée
      if (fullText.includes(token) || colFullText.includes(colToken)) return true;
      if (allWords.some(w => w.includes(token) || w.includes(colToken))) return true;

      // 2. Tolérance aux fautes de frappe (sur les mots de 4+ lettres non purement numériques)
      if (!isNumberOrUnit && len >= 4) {
        return allWords.some(w => {
          if (/^\d/.test(w)) return false;
          return levenshtein(token, w, maxDist) <= maxDist;
        });
      }

      return false;
    });
  }

  function score(product: T): number {
    const { sku, mpn, label, brand, colFullText, allWords } = extractProductFields(product);
    let pts = 0;

    // Correspondance exacte avec la requête complète
    if (label.includes(rawNormQuery)) pts += 100;
    else if (colFullText.includes(colQuery)) pts += 80;

    // Correspondance sur référence exacte
    if (sku === rawNormQuery || mpn === rawNormQuery) pts += 90;
    else if (sku.includes(rawNormQuery) || mpn.includes(rawNormQuery)) pts += 50;

    // Points par token
    for (const { token, colToken } of tokenData) {
      if (label.startsWith(token) || label.startsWith(colToken)) pts += 35;
      else if (label.includes(token) || label.includes(colToken)) pts += 20;

      if (brand.includes(token)) pts += 15;
      if (sku.includes(token) || mpn.includes(token)) pts += 20;

      // Mot entier
      if (allWords.includes(token) || allWords.includes(colToken)) pts += 10;
    }

    return pts;
  }

  function filterAndSort(list: T[]): T[] {
    const matched = list.filter(matches);
    if (matched.length <= 1) return matched;

    return matched
      .map(item => ({ item, _score: score(item) }))
      .sort((a, b) => b._score - a._score)
      .map(({ item }) => item);
  }

  return { matches, score, filterAndSort };
}
