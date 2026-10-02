import { Product } from "../types";
import { idbGet } from "./webDatabase";
import { getDirectoryHandle, writeEventToDirectory, writeAuditToDirectory, getSubdirectoryHandle } from "./webFileSystem";

let selectedCsvFile: File | null = null;
let selectedImagesDirHandle: FileSystemDirectoryHandle | null = null;
let selectedPdfDirHandle: FileSystemDirectoryHandle | null = null;

export async function selectCsvFileWeb(): Promise<string | null> {
  if (typeof (window as any).showOpenFilePicker === "function") {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: "Fichiers CSV (*.csv)",
            accept: {
              "text/csv": [".csv"],
              "application/vnd.ms-excel": [".csv"],
              "text/plain": [".csv", ".txt"],
            },
          },
        ],
        multiple: false,
      });
      if (handle) {
        const file = await handle.getFile();
        selectedCsvFile = file;
        return file.name;
      }
    } catch (err: any) {
      if (err.name === "AbortError") return null;
      console.warn("[WebCSV] showOpenFilePicker échoué, fallback sur input...", err);
    }
  }

  // Fallback: input file
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv,application/vnd.ms-excel";
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (file) {
        selectedCsvFile = file;
        resolve(file.name);
      } else {
        resolve(null);
      }
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      resolve(null);
    };

    input.click();
  });
}

export async function selectImageDirWeb(): Promise<string | null> {
  if (typeof (window as any).showDirectoryPicker === "function") {
    try {
      const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
        mode: "read",
      });
      selectedImagesDirHandle = handle;
      return handle.name;
    } catch (err: any) {
      if (err.name === "AbortError") return null;
      console.error("[WebCSV] Erreur sélection dossier images:", err);
    }
  }
  return null;
}

export async function selectPdfDirWeb(): Promise<string | null> {
  if (typeof (window as any).showDirectoryPicker === "function") {
    try {
      const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
        mode: "read",
      });
      selectedPdfDirHandle = handle;
      return handle.name;
    } catch (err: any) {
      if (err.name === "AbortError") return null;
      console.error("[WebCSV] Erreur sélection dossier PDF:", err);
    }
  }
  return null;
}

function sanitizeSku(sku: string): string {
  return sku
    .trim()
    .replace(/\s+/g, "")
    .replace(/[/\\:*?"<>|]/g, "-")
    .toUpperCase();
}

function sanitizeFolderName(name: string, fallback: string): string {
  const clean = name
    .trim()
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .toUpperCase();
  return clean || fallback;
}

async function readFileAsWindows1252(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    // Lecture avec l'encodage français Windows-1252 pour préserver accents et cédilles
    reader.readAsText(file, "windows-1252");
  });
}

export async function importCsvWeb(trigramme: string = "MIG"): Promise<{
  success: number;
  missing_files: number;
  errors: string[];
}> {
  if (!selectedCsvFile) {
    throw new Error("Veuillez d'abord sélectionner un fichier CSV en cliquant sur 'Parcourir'.");
  }

  const netHandle = await getDirectoryHandle();
  const textContent = await readFileAsWindows1252(selectedCsvFile);
  const lines = textContent.split(/\r?\n/);

  // Sauter les 8 premières lignes d'en-têtes Excel
  const dataLines = lines.slice(8);

  const report = {
    success: 0,
    missing_files: 0,
    errors: [] as string[],
  };

  // Préparer les sous-dossiers réseau si connectés
  const netImagesDir = netHandle ? await getSubdirectoryHandle(netHandle, "images", true) : null;
  const netDocsDir = netHandle ? await getSubdirectoryHandle(netHandle, "documents", true) : null;

  for (const line of dataLines) {
    if (!line.trim()) continue;

    const parts = line.split(";");
    if (parts.length < 3) continue;

    const qteStr = parts[0]?.trim() || "0";
    const refStr = parts[1]?.trim() || "";
    const descStr = parts[2]?.trim() || "";

    if (!refStr || !descStr) continue;

    const sku = sanitizeSku(refStr);
    const existing = await idbGet<Product>("products", sku);

    const famille = parts[3]?.trim() || "";
    const sousFamille = parts[4]?.trim() || "";
    const emplacement = parts[5]?.trim() || "";
    const marque = parts[7]?.trim() || "";

    const tension = parts[8]?.trim() || "";
    const notes = parts[9]?.trim() || "";
    const largeur = parts[10]?.trim() || "";
    const hauteur = parts[11]?.trim() || "";
    const profondeur = parts[12]?.trim() || "";
    const poids = parts[13]?.trim() || "";
    const codeRs = parts[14]?.trim() || "";

    const rawPrix = parts[15]?.trim() || "0";
    const prix = Number(rawPrix.replace(",", ".").replace(/[^\d.-]/g, "")) || 0;
    const qte = Number(qteStr.replace(",", ".")) || 0;

    const rawPdf = parts[23]?.trim() || "";
    const rawImg = parts[24]?.trim() || "";

    let imagePath = existing?.image_path || null;
    let pdfPath = existing?.pdf_path || null;

    // Copie de l'image
    if (rawImg && selectedImagesDirHandle && netImagesDir) {
      try {
        const cleanImgName = rawImg.replace(/^[/\\]+/, "").split(/[/\\]/).pop() || rawImg;
        let srcFileHandle: FileSystemFileHandle | null = null;
        try {
          srcFileHandle = await selectedImagesDirHandle.getFileHandle(cleanImgName);
        } catch {
          // Essayer recherche insensible à la casse
          for await (const [name, handle] of (selectedImagesDirHandle as any).entries()) {
            if (handle.kind === "file" && name.toLowerCase() === cleanImgName.toLowerCase()) {
              srcFileHandle = handle;
              break;
            }
          }
        }

        if (srcFileHandle) {
          const file = await srcFileHandle.getFile();
          const ext = file.name.split(".").pop() || "jpg";
          const destName = `${sku}_1.${ext}`.toUpperCase();
          const destHandle = await netImagesDir.getFileHandle(destName, { create: true });
          const writable = await (destHandle as any).createWritable();
          await writable.write(await file.arrayBuffer());
          await writable.close();
          imagePath = `images/${destName}`;
        } else if (!imagePath) {
          report.missing_files++;
        }
      } catch (err: any) {
        report.errors.push(`Échec copie image pour ${sku}: ${err.message}`);
      }
    }

    // Copie du PDF
    if (rawPdf && selectedPdfDirHandle && netDocsDir) {
      try {
        const cleanPdfName = rawPdf.replace(/^[/\\]+/, "").split(/[/\\]/).pop() || rawPdf;
        let srcFileHandle: FileSystemFileHandle | null = null;
        try {
          srcFileHandle = await selectedPdfDirHandle.getFileHandle(cleanPdfName);
        } catch {
          for await (const [name, handle] of (selectedPdfDirHandle as any).entries()) {
            if (handle.kind === "file" && name.toLowerCase() === cleanPdfName.toLowerCase()) {
              srcFileHandle = handle;
              break;
            }
          }
        }

        if (srcFileHandle) {
          const cleanBrand = sanitizeFolderName(marque, "INCONNUE");
          const cleanCat = sanitizeFolderName(famille, "SANS_FAMILLE");
          const cleanSubcat = sanitizeFolderName(sousFamille, "SANS_SOUS_FAMILLE");
          const cleanDesc = sanitizeFolderName(descStr, "");
          const skuFolder = cleanDesc ? `${sku} - ${cleanDesc}` : sku;

          const brandDir = await netDocsDir.getDirectoryHandle(cleanBrand, { create: true });
          const catDir = await brandDir.getDirectoryHandle(cleanCat, { create: true });
          const subcatDir = await catDir.getDirectoryHandle(cleanSubcat, { create: true });
          const skuDir = await subcatDir.getDirectoryHandle(skuFolder, { create: true });

          const file = await srcFileHandle.getFile();
          const destHandle = await skuDir.getFileHandle(file.name, { create: true });
          const writable = await (destHandle as any).createWritable();
          await writable.write(await file.arrayBuffer());
          await writable.close();

          pdfPath = `documents/${cleanBrand}/${cleanCat}/${cleanSubcat}/${skuFolder}/${file.name}`;
        } else if (!pdfPath) {
          report.missing_files++;
        }
      } catch (err: any) {
        report.errors.push(`Échec copie PDF pour ${sku}: ${err.message}`);
      }
    }

    // Déterminer s'il y a des modifications à apporter
    const detailsChanged =
      !existing ||
      existing.mpn !== refStr ||
      existing.label !== descStr ||
      existing.brand !== marque ||
      existing.category !== famille ||
      existing.sub_category !== sousFamille ||
      existing.location !== emplacement ||
      Math.abs(existing.price - prix) > 0.001 ||
      existing.image_path !== imagePath ||
      existing.pdf_path !== pdfPath;

    const stockDiff = existing ? qte - existing.current_stock : qte;

    if (existing && !detailsChanged && Math.abs(stockDiff) <= 0.001) {
      report.success++;
      continue;
    }

    const attributesJson: any = {
      tension,
      largeur,
      hauteur,
      profondeur,
      poids,
      notes,
    };
    if (codeRs) {
      attributesJson.vpc = { RS: codeRs };
    }

    const payload = {
      sku,
      mpn: refStr,
      label: descStr,
      brand: marque,
      category: famille,
      subCategory: sousFamille,
      location: emplacement,
      type: "QUANTITATIVE",
      minStock: 0,
      price: prix,
      initial_stock: existing ? existing.current_stock : qte,
      attributes: attributesJson,
      image_path: imagePath,
      pdf_path: pdfPath,
      packSize: 1,
    };

    const eventType = existing ? "PRODUCT_UPDATE" : "PRODUCT_CREATE";
    await writeEventToDirectory(netHandle, eventType, trigramme, payload);

    if (!existing) {
      await writeAuditToDirectory(netHandle, sku, trigramme, "CREATE", "Import initial CSV");
    } else {
      await writeAuditToDirectory(netHandle, sku, trigramme, "UPDATE", "Import CSV");
    }

    if (existing && Math.abs(stockDiff) > 0.001) {
      const stockType = stockDiff > 0 ? "STOCK_IN" : "STOCK_OUT";
      await writeEventToDirectory(netHandle, stockType, trigramme, {
        sku,
        qty: Math.abs(stockDiff),
        note: "Migration CSV",
      });
    }

    report.success++;
  }

  return report;
}
