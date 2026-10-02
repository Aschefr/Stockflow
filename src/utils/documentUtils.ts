/**
 * Document type detection and options for Stockflow documents
 */

export interface DocumentTypeOption {
  value: string;
  label: string;
  badgeColor?: string;
}

export const DOCUMENT_TYPE_OPTIONS: DocumentTypeOption[] = [
  { value: "fiche_technique", label: "Fiche technique", badgeColor: "#3b82f6" },
  { value: "manuel", label: "Manuel", badgeColor: "#10b981" },
  { value: "guide_rapide", label: "Guide rapide", badgeColor: "#f59e0b" },
  { value: "installation", label: "Installation", badgeColor: "#8b5cf6" },
  { value: "information_produit", label: "Information Produit", badgeColor: "#06b6d4" },
  { value: "schema", label: "Schéma / Plan", badgeColor: "#ec4899" },
  { value: "certificat", label: "Certificat", badgeColor: "#14b8a6" },
  { value: "catalogue", label: "Catalogue", badgeColor: "#64748b" },
  { value: "autre", label: "Autre", badgeColor: "#94a3b8" },
];

/**
 * Analyse intelligente des termes dans l'URL, le titre et le texte pour détecter le type de document
 */
export function detectDocumentType(url: string = "", title: string = "", snippet: string = ""): DocumentTypeOption {
  let decodedUrl = url;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {}

  const combined = `${decodedUrl} ${title} ${snippet}`.toLowerCase();

  // 1. Guide rapide / Mise en service
  if (
    combined.includes("guide rapide") ||
    combined.includes("quick start") ||
    combined.includes("quickstart") ||
    combined.includes("quick guide") ||
    combined.includes("quick-guide") ||
    combined.includes("guide_rapide") ||
    combined.includes("mise en service rapide") ||
    combined.includes("demarrage rapide") ||
    combined.includes("démarrage rapide") ||
    combined.includes("qsg") ||
    combined.includes("brief instructions") ||
    combined.includes("kurzanleitung")
  ) {
    return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "guide_rapide")!;
  }

  // 2. Installation / Montage / Câblage
  if (
    combined.includes("installation") ||
    combined.includes("montage") ||
    combined.includes("assembly") ||
    combined.includes("mounting") ||
    combined.includes("câblage") ||
    combined.includes("cablage") ||
    combined.includes("wiring") ||
    combined.includes("raccordement") ||
    combined.includes("notice d'installation") ||
    combined.includes("instructions d'installation") ||
    combined.includes("einbauanweisung") ||
    combined.includes("install")
  ) {
    return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "installation")!;
  }

  // 3. Information Produit / Aperçu / Flyer / Plaquette
  if (
    combined.includes("information produit") ||
    combined.includes("informations produit") ||
    combined.includes("product information") ||
    combined.includes("product-information") ||
    combined.includes("product_info") ||
    combined.includes("flyer") ||
    combined.includes("plaquette") ||
    combined.includes("présentation") ||
    combined.includes("presentation") ||
    combined.includes("aperçu") ||
    combined.includes("apercu") ||
    combined.includes("overview") ||
    combined.includes("produktinformation")
  ) {
    return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "information_produit")!;
  }

  // 4. Schéma / Plan / Dimension
  if (
    combined.includes("schéma") ||
    combined.includes("schema") ||
    combined.includes("wiring diagram") ||
    combined.includes("circuit diagram") ||
    combined.includes("diagram") ||
    combined.includes("plan") ||
    combined.includes("encombrement") ||
    combined.includes("dimension") ||
    combined.includes("cad") ||
    combined.includes("dwg") ||
    combined.includes("dxf") ||
    combined.includes("masszeichnung") ||
    combined.includes("plan de pose")
  ) {
    return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "schema")!;
  }

  // 5. Certificat / Conformité / Homologation
  if (
    combined.includes("certificat") ||
    combined.includes("certificate") ||
    combined.includes("declaration") ||
    combined.includes("déclaration") ||
    combined.includes("conformit") ||
    combined.includes("homologation") ||
    combined.includes("rohs") ||
    combined.includes("reach") ||
    combined.includes("atex") ||
    combined.includes("ce_declaration") ||
    combined.includes("attestation") ||
    combined.includes("konformitaet")
  ) {
    return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "certificat")!;
  }

  // 6. Catalogue / Brochure / Guide de choix
  if (
    combined.includes("catalogue") ||
    combined.includes("catalog") ||
    combined.includes("brochure") ||
    combined.includes("prospectus") ||
    combined.includes("guide de choix") ||
    combined.includes("guide_de_choix") ||
    combined.includes("selection guide")
  ) {
    return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "catalogue")!;
  }

  // 7. Manuel / Notice / Mode d'emploi
  if (
    combined.includes("manuel") ||
    combined.includes("manual") ||
    combined.includes("user guide") ||
    combined.includes("guide utilisateur") ||
    combined.includes("mode d'emploi") ||
    combined.includes("notice d'utilisation") ||
    combined.includes("operating instructions") ||
    combined.includes("instruction manual") ||
    combined.includes("handbook") ||
    combined.includes("handbuch") ||
    combined.includes("betriebsanleitung")
  ) {
    return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "manuel")!;
  }

  // 8. Fiche technique / Datasheet / Caractéristiques
  if (
    combined.includes("fiche technique") ||
    combined.includes("fiche-technique") ||
    combined.includes("fiche_technique") ||
    combined.includes("ft_") ||
    combined.includes("datasheet") ||
    combined.includes("data sheet") ||
    combined.includes("data-sheet") ||
    combined.includes("caractéristique") ||
    combined.includes("caracteristique") ||
    combined.includes("spec sheet") ||
    combined.includes("specification") ||
    combined.includes("spécification") ||
    combined.includes("technical data") ||
    combined.includes("datenblatt")
  ) {
    return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "fiche_technique")!;
  }

  // Repli par défaut
  return DOCUMENT_TYPE_OPTIONS.find(o => o.value === "fiche_technique")!;
}

export function getDocumentTypeOption(value?: string): DocumentTypeOption {
  if (!value) return DOCUMENT_TYPE_OPTIONS[0];
  return DOCUMENT_TYPE_OPTIONS.find(o => o.value === value) || DOCUMENT_TYPE_OPTIONS[0];
}
