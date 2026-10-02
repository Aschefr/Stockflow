import { StockflowEvent, AuditLogItem, Product } from "../types";
import { idbGet, idbPut, idbGetAll, idbDelete } from "./webDatabase";
import { applySingleEventWeb, applySingleAuditWeb } from "./webEventProcessor";

export function sanitizeFolderName(name?: string, fallback = "INCONNU"): string {
  const clean = (name || "")
    .trim()
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/[. ]+$/, "");
  return clean || fallback;
}

let activeDirectoryHandle: FileSystemDirectoryHandle | null = null;
const mediaUrlCache = new Map<string, string>();
let mediaCacheInitialized = false;

/**
 * Restaure le cache persistant des images et notices depuis IndexedDB (media_cache)
 * dans le cache mémoire de l'application dès le démarrage pour un chargement instantané.
 */
export async function initMediaCacheFromIndexedDb(): Promise<void> {
  if (mediaCacheInitialized) return;
  mediaCacheInitialized = true;
  try {
    const entries = await idbGetAll<{ path: string; name?: string; blob: Blob; size?: number; updatedAt?: number }>("media_cache");
    if (entries && entries.length > 0) {
      // LRU Clean-up : Si plus de 500 médias en cache, conserver les 500 plus récents
      if (entries.length > 500) {
        entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const toRemove = entries.slice(500);
        for (const item of toRemove) {
          idbDelete("media_cache", item.path).catch(() => {});
        }
        entries.length = 500;
      }

      for (const entry of entries) {
        if (entry.blob && entry.path) {
          try {
            const objUrl = URL.createObjectURL(entry.blob);
            const normalized = entry.path.replace(/\\/g, "/");
            const fileName = entry.name || normalized.split("/").pop() || "";

            mediaUrlCache.set(normalized, objUrl);
            mediaUrlCache.set(entry.path, objUrl);
            if (fileName) {
              mediaUrlCache.set(fileName, objUrl);
              mediaUrlCache.set(`images/${fileName}`, objUrl);
              mediaUrlCache.set(fileName.toLowerCase(), objUrl);
            }
          } catch (e) {}
        }
      }
      console.log(`[WebFS] Cache persistant restauré : ${entries.length} médias chargés en mémoire navigateur.`);
    }
  } catch (err) {
    console.warn("[WebFS] Erreur chargement media_cache IDB:", err);
  }
}

export async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  initMediaCacheFromIndexedDb().catch(() => {});
  if (activeDirectoryHandle) return activeDirectoryHandle;

  try {
    const record = await idbGet<{ key: string; handle: FileSystemDirectoryHandle }>("config", "network_dir_handle");
    if (record && record.handle) {
      // 1. Tester readwrite
      try {
        const queryRes = await (record.handle as any).queryPermission({ mode: "readwrite" });
        if (queryRes === "granted") {
          activeDirectoryHandle = record.handle;
          return activeDirectoryHandle;
        }
      } catch {}

      // 2. Tester mode lecture seule (souvent persisté sans confirmation par Chrome/Edge)
      try {
        const queryRes = await (record.handle as any).queryPermission({ mode: "read" });
        if (queryRes === "granted") {
          activeDirectoryHandle = record.handle;
          return activeDirectoryHandle;
        }
      } catch {}
    }
  } catch (e) {
    console.warn("[WebFS] Impossible de restaurer le handle de dossier :", e);
  }
  return null;
}

export async function reconnectDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const record = await idbGet<{ key: string; handle: FileSystemDirectoryHandle }>("config", "network_dir_handle");
    if (record && record.handle) {
      const perm = await (record.handle as any).requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        activeDirectoryHandle = record.handle;
        return activeDirectoryHandle;
      }
    }
  } catch (e) {
    console.warn("[WebFS] Erreur lors de la réactivation de la permission dossier :", e);
  }
  return null;
}

export async function requestDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof (window as any).showDirectoryPicker !== "function") {
    throw new Error("L'API File System Access n'est pas disponible sur ce navigateur. Veuillez utiliser Microsoft Edge ou Chrome.");
  }

  try {
    const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
      mode: "readwrite",
    });

    activeDirectoryHandle = handle;
    await idbPut("config", { key: "network_dir_handle", handle });
    await idbPut("config", { key: "network_path", value: handle.name });

    return handle;
  } catch (err: any) {
    if (err.name === "AbortError") return null;
    throw err;
  }
}

export async function getSubdirectoryHandle(
  parent: FileSystemDirectoryHandle,
  name: string,
  create = false
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create });
  } catch {
    return null;
  }
}

// ==================== SYNCHRONISATION DES ÉVÉNEMENTS ====================

export async function syncEventsFromDirectory(dirHandle: FileSystemDirectoryHandle): Promise<number> {
  const eventsDir = await getSubdirectoryHandle(dirHandle, "events", true);
  if (!eventsDir) return 0;

  const entries: { name: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of (eventsDir as any).entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".json")) {
      entries.push({ name, handle: handle as FileSystemFileHandle });
    }
  }

  // Trier chronologiquement par nom de fichier
  entries.sort((a, b) => a.name.localeCompare(b.name));

  let appliedCount = 0;
  for (const entry of entries) {
    const alreadyApplied = await idbGet("applied_events", entry.name);
    if (!alreadyApplied) {
      try {
        const file = await entry.handle.getFile();
        const content = await file.text();
        const event: StockflowEvent = JSON.parse(content);

        await applySingleEventWeb(event);
        await idbPut("applied_events", {
          filename: entry.name,
          processed_at: new Date().toISOString(),
        });
        appliedCount++;
      } catch (err) {
        console.error(`[WebFS] Erreur lecture événement ${entry.name}:`, err);
      }
    }
  }

  // Synchroniser également les audits si le dossier existe
  await syncAuditsFromDirectory(dirHandle);

  return appliedCount;
}

export async function syncAuditsFromDirectory(dirHandle: FileSystemDirectoryHandle): Promise<number> {
  const auditDir = await getSubdirectoryHandle(dirHandle, "audit", false);
  if (!auditDir) return 0;

  const entries: { name: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of (auditDir as any).entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".json")) {
      entries.push({ name, handle: handle as FileSystemFileHandle });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  let count = 0;
  for (const entry of entries) {
    const alreadyApplied = await idbGet("applied_audits", entry.name);
    if (!alreadyApplied) {
      try {
        const file = await entry.handle.getFile();
        const content = await file.text();
        const audit: AuditLogItem = JSON.parse(content);

        await applySingleAuditWeb(audit);
        await idbPut("applied_audits", {
          filename: entry.name,
          processed_at: new Date().toISOString(),
        });
        count++;
      } catch (e) {
        console.error(`[WebFS] Erreur lecture audit ${entry.name}:`, e);
      }
    }
  }
  return count;
}

// ==================== ÉCRITURE D'ÉVÉNEMENT ====================

function formatCompactIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

export async function writeEventToDirectory(
  dirHandle: FileSystemDirectoryHandle | null,
  eventType: string,
  trigramme: string,
  payload: any
): Promise<void> {
  const eventId = crypto.randomUUID();
  const now = new Date();
  const event: StockflowEvent = {
    event_id: eventId,
    event_type: eventType,
    timestamp: now.toISOString(),
    trigramme: (trigramme || "WEB").toUpperCase(),
    payload,
  };

  const sku = (payload.sku || payload.bom_id || "GLOBAL").toUpperCase();
  const filename = `${formatCompactIso(now)}_${event.trigramme}_${eventType}_${sku}_${eventId.slice(0, 4)}.json`;

  if (dirHandle) {
    try {
      const eventsDir = await getSubdirectoryHandle(dirHandle, "events", true);
      if (eventsDir) {
        const fileHandle = await eventsDir.getFileHandle(filename, { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(JSON.stringify(event, null, 2));
        await writable.close();
      }
    } catch (err) {
      console.error("[WebFS] Erreur lors de l'écriture du fichier d'événement :", err);
    }
  }

  // Appliquer localement immédiatement
  await applySingleEventWeb(event);
  await idbPut("applied_events", {
    filename,
    processed_at: now.toISOString(),
  });
}

export async function writeAuditToDirectory(
  dirHandle: FileSystemDirectoryHandle | null,
  sku: string,
  trigramme: string,
  action: string,
  field: string | null = null,
  oldValue: string | null = null,
  newValue: string | null = null,
  sourceUrl: string | null = null
): Promise<void> {
  const auditId = crypto.randomUUID();
  const now = new Date();
  const audit: AuditLogItem = {
    audit_id: auditId,
    sku: sku.toUpperCase(),
    timestamp: now.toISOString(),
    trigramme: (trigramme || "WEB").toUpperCase(),
    action,
    field,
    old_value: oldValue,
    new_value: newValue,
    source_url: sourceUrl,
  };

  const filename = `${formatCompactIso(now)}_${audit.trigramme}_${action}_AUDIT_${sku.toUpperCase()}_${auditId.slice(0, 4)}.json`;

  if (dirHandle) {
    try {
      const auditDir = await getSubdirectoryHandle(dirHandle, "audit", true);
      if (auditDir) {
        const fileHandle = await auditDir.getFileHandle(filename, { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(JSON.stringify(audit, null, 2));
        await writable.close();
      }
    } catch (e) {
      console.error("[WebFS] Erreur écriture audit :", e);
    }
  }

  await applySingleAuditWeb(audit);
  await idbPut("applied_audits", {
    filename,
    processed_at: now.toISOString(),
  });
}

// ==================== GESTION DES MÉDIAS (IMAGES & PDF) ====================

export async function listSkuImagesFromDirectory(
  dirHandle: FileSystemDirectoryHandle | null,
  sku: string
): Promise<string[]> {
  if (!dirHandle) return [];
  const imagesDir = await getSubdirectoryHandle(dirHandle, "images", false);
  if (!imagesDir) return [];

  const skuUpper = sku.toUpperCase();
  const results: string[] = [];

  for await (const [name, handle] of (imagesDir as any).entries()) {
    if (handle.kind === "file") {
      const upper = name.toUpperCase();
      if (upper.startsWith("THUMB_")) continue;
      if (upper.startsWith(`${skuUpper}_`) || upper.startsWith(`${skuUpper}.`)) {
        const relativePath = `images/${name}`;
        results.push(relativePath);

        // Mettre en cache l'ObjectURL pour l'affichage immédiat
        if (!mediaUrlCache.has(relativePath)) {
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            const objUrl = URL.createObjectURL(file);
            mediaUrlCache.set(relativePath, objUrl);
            mediaUrlCache.set(name, objUrl);
            mediaUrlCache.set(`images/${name}`, objUrl);
            mediaUrlCache.set(name.toLowerCase(), objUrl);

            // Persistance dans IndexedDB 'media_cache' pour rechargements ultérieurs instantanés
            if (file.size < 15 * 1024 * 1024) {
              idbPut("media_cache", {
                path: relativePath,
                name: name,
                blob: file,
                size: file.size,
                updatedAt: Date.now()
              }).catch(() => {});
            }
          } catch (e) {
            console.warn(`[WebFS] Impossible de créer l'URL pour ${name}:`, e);
          }
        }
      }
    }
  }

  results.sort();
  return results;
}

export async function listSkuPdfsFromDirectory(
  dirHandle: FileSystemDirectoryHandle | null,
  sku: string,
  pdfPath?: string | null
): Promise<string[]> {
  if (!dirHandle) return [];
  const skuUpper = sku.toUpperCase();
  const results: string[] = [];

  // Récupérer le produit en base locale si pdfPath n'est pas passé
  if (!pdfPath && sku) {
    try {
      const prod = await idbGet<any>("products", skuUpper);
      if (prod?.pdf_path) {
        pdfPath = prod.pdf_path;
      }
    } catch {}
  }

  // 1. Si un pdf_path spécifique est défini sur le produit (ex: documents/Merlin Gerin/Distribution/Disjoncteurs/24060)
  if (pdfPath) {
    let cleanPath = pdfPath.replace(/\\/g, "/");
    const mIdx = cleanPath.indexOf("documents/");
    if (mIdx !== -1) cleanPath = cleanPath.substring(mIdx);
    const pIdx = cleanPath.indexOf("pdfs/");
    if (pIdx !== -1) cleanPath = cleanPath.substring(pIdx);

    const parts = cleanPath.split("/").filter(Boolean);
    let targetDir: FileSystemDirectoryHandle | null = dirHandle;

    for (let i = 0; i < parts.length; i++) {
      if (!targetDir) break;
      try {
        targetDir = await targetDir.getDirectoryHandle(parts[i], { create: false });
      } catch {
        targetDir = null;
      }
    }

    if (targetDir) {
      // C'était un dossier ! Scanner tous les fichiers .pdf qu'il contient
      for await (const [name, handle] of (targetDir as any).entries()) {
        if (handle.kind === "file" && name.toLowerCase().endsWith(".pdf")) {
          const rel = `${cleanPath}/${name}`;
          if (!results.includes(rel)) {
            results.push(rel);
            try {
              const file = await (handle as FileSystemFileHandle).getFile();
              const blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
              const objUrl = URL.createObjectURL(blob);
              mediaUrlCache.set(rel, objUrl);
              mediaUrlCache.set(name, objUrl);
              mediaUrlCache.set(name.toLowerCase(), objUrl);
            } catch {}
          }
        }
      }
    } else {
      // Peut-être que le dernier élément était directement un fichier .pdf
      try {
        let parentDir: FileSystemDirectoryHandle | null = dirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!parentDir) break;
          parentDir = await parentDir.getDirectoryHandle(parts[i], { create: false });
        }
        if (parentDir) {
          const fileName = parts[parts.length - 1];
          const fileHandle = await parentDir.getFileHandle(fileName, { create: false });
          if (fileHandle && !results.includes(cleanPath)) {
            results.push(cleanPath);
            try {
              const file = await fileHandle.getFile();
              const blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
              const objUrl = URL.createObjectURL(blob);
              mediaUrlCache.set(cleanPath, objUrl);
              mediaUrlCache.set(fileName, objUrl);
            } catch {}
          }
        }
      } catch {}
    }
  }

  // 2. Chercher dans documents/ ou pdfs/ par convention SKU
  const docDir = (await getSubdirectoryHandle(dirHandle, "documents", false)) ||
                 (await getSubdirectoryHandle(dirHandle, "pdfs", false));

  if (docDir) {
    // 2.a Chercher dans la structure hiérarchique documents/{Brand}/{Category}/{SubCategory}/{SKU} - {Description}/
    let prod: Product | null | undefined;
    try {
      prod = await idbGet<Product>("products", skuUpper);
    } catch {}

    if (prod && prod.brand && prod.category && prod.sub_category) {
      const cleanBrand = sanitizeFolderName(prod.brand, "INCONNU");
      const cleanCat = sanitizeFolderName(prod.category, "INCONNU");
      const cleanSubcat = sanitizeFolderName(prod.sub_category, "INCONNU");

      const brandDir = await getSubdirectoryHandle(docDir, cleanBrand, false);
      if (brandDir) {
        const catDir = await getSubdirectoryHandle(brandDir, cleanCat, false);
        if (catDir) {
          const subcatDir = await getSubdirectoryHandle(catDir, cleanSubcat, false);
          if (subcatDir) {
            for await (const [folderName, handle] of (subcatDir as any).entries()) {
              if (handle.kind === "directory") {
                const up = folderName.toUpperCase();
                if (up === skuUpper || up.startsWith(`${skuUpper} - `) || up.startsWith(`${skuUpper}_`)) {
                  for await (const [fileName, fileHandle] of (handle as any).entries()) {
                    if (fileHandle.kind === "file" && fileName.toLowerCase().endsWith(".pdf")) {
                      const relativePath = `documents/${cleanBrand}/${cleanCat}/${cleanSubcat}/${folderName}/${fileName}`;
                      if (!results.includes(relativePath)) {
                        results.push(relativePath);
                        if (!mediaUrlCache.has(relativePath)) {
                          try {
                            const file = await (fileHandle as FileSystemFileHandle).getFile();
                            const blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
                            const objUrl = URL.createObjectURL(blob);
                            mediaUrlCache.set(relativePath, objUrl);
                            mediaUrlCache.set(fileName, objUrl);
                          } catch {}
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2.b Sous-dossier par SKU direct (ex: documents/24060/)
    const skuSubDir = await getSubdirectoryHandle(docDir, skuUpper, false);
    if (skuSubDir) {
      for await (const [name, handle] of (skuSubDir as any).entries()) {
        if (handle.kind === "file" && name.toLowerCase().endsWith(".pdf")) {
          const relativePath = `documents/${skuUpper}/${name}`;
          if (!results.includes(relativePath)) {
            results.push(relativePath);
            if (!mediaUrlCache.has(relativePath)) {
              try {
                const file = await (handle as FileSystemFileHandle).getFile();
                const blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
                const objUrl = URL.createObjectURL(blob);
                mediaUrlCache.set(relativePath, objUrl);
                mediaUrlCache.set(name, objUrl);
              } catch {}
            }
          }
        }
      }
    }

    // 2.c Fichiers à la racine du dossier docs (ex: documents/24060_*.pdf)
    for await (const [name, handle] of (docDir as any).entries()) {
      if (handle.kind === "file" && name.toLowerCase().endsWith(".pdf")) {
        const upper = name.toUpperCase();
        if (upper.startsWith(`${skuUpper}_`) || upper.startsWith(`${skuUpper}.`)) {
          const relativePath = `documents/${name}`;
          if (!results.includes(relativePath)) {
            results.push(relativePath);
            if (!mediaUrlCache.has(relativePath)) {
              try {
                const file = await (handle as FileSystemFileHandle).getFile();
                const blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
                const objUrl = URL.createObjectURL(blob);
                mediaUrlCache.set(relativePath, objUrl);
                mediaUrlCache.set(name, objUrl);
              } catch {}
            }
          }
        }
      }
    }
  }

  results.sort();
  return results;
}

export async function resolveMediaUrl(
  dirHandle: FileSystemDirectoryHandle | null,
  relativePath: string
): Promise<string> {
  if (!relativePath) return "";
  if (relativePath.startsWith("http://") || relativePath.startsWith("https://") || relativePath.startsWith("data:") || relativePath.startsWith("blob:")) {
    return relativePath;
  }

  const cached = getCachedMediaUrl(relativePath);
  if (cached) return cached;

  let cleanRel = relativePath.replace(/\\/g, "/");
  // Si le chemin commence par un préfixe de dossier réseau, extraire à partir de images/ ou documents/
  const markers = ["images/", "documents/", "logos/"];
  for (const marker of markers) {
    const idx = cleanRel.indexOf(marker);
    if (idx !== -1) {
      cleanRel = cleanRel.substring(idx);
      break;
    }
  }

  const cachedClean = getCachedMediaUrl(cleanRel);
  if (cachedClean) return cachedClean;

  // Tenter de restaurer depuis le cache persistant IndexedDB (fonctionne même sans reconnecter le dossier)
  try {
    const entry = await idbGet<{ path: string; name?: string; blob: Blob }>("media_cache", cleanRel);
    if (entry && entry.blob) {
      const objUrl = URL.createObjectURL(entry.blob);
      mediaUrlCache.set(cleanRel, objUrl);
      mediaUrlCache.set(relativePath, objUrl);
      const fn = entry.name || cleanRel.split("/").pop();
      if (fn) {
        mediaUrlCache.set(fn, objUrl);
        mediaUrlCache.set(`images/${fn}`, objUrl);
        mediaUrlCache.set(fn.toLowerCase(), objUrl);
      }
      return objUrl;
    }
  } catch {}

  if (!dirHandle) return "";

  try {
    const parts = cleanRel.split("/").filter(Boolean);
    let currentDir = dirHandle;
    const isImageExt = Boolean(cleanRel.match(/\.(jpg|jpeg|png|webp|svg|gif|bmp)$/i));
    const isDocExt = Boolean(cleanRel.match(/\.(pdf|doc|docx)$/i));

    // Si le chemin ne contenait pas de dossier (ex: "00020-0081_1.jpg")
    if (parts.length === 1 && isImageExt) {
      cleanRel = `images/${parts[0]}`;
      parts.unshift("images");
    } else if (parts.length === 1 && isDocExt) {
      cleanRel = `documents/${parts[0]}`;
      parts.unshift("documents");
    }

    for (let i = 0; i < parts.length - 1; i++) {
      try {
        currentDir = await currentDir.getDirectoryHandle(parts[i]);
      } catch {
        break;
      }
    }

    const fileName = parts[parts.length - 1];
    let fileHandle: FileSystemFileHandle | null = null;

    try {
      fileHandle = await currentDir.getFileHandle(fileName);
    } catch {
      // 1. Tenter si fileName est en fait un sous-dossier contenant des PDF (ex: documents/Merlin Gerin/.../24060)
      try {
        const subDir = await currentDir.getDirectoryHandle(fileName, { create: false });
        if (subDir) {
          for await (const [n, h] of (subDir as any).entries()) {
            if (h.kind === "file" && n.toLowerCase().endsWith(".pdf")) {
              fileHandle = h as FileSystemFileHandle;
              break;
            }
          }
        }
      } catch {}

      // 2. Tenter dans le dossier images/ si c'est une image
      if (isImageExt) {
        try {
          const imgDir = await dirHandle.getDirectoryHandle("images", { create: false });
          try {
            fileHandle = await imgDir.getFileHandle(fileName);
          } catch {
            // Recherche insensible à la casse
            const upper = fileName.toUpperCase();
            for await (const [n, h] of (imgDir as any).entries()) {
              if (h.kind === "file" && n.toUpperCase() === upper) {
                fileHandle = h as FileSystemFileHandle;
                break;
              }
            }
          }
        } catch {}
      }
      // 3. Tenter dans documents/ si c'est un document ou sans extension
      if (!fileHandle && (isDocExt || !fileName.includes("."))) {
        for (const docFolder of ["documents", "pdfs"]) {
          try {
            const dDir = await dirHandle.getDirectoryHandle(docFolder, { create: false });
            try {
              fileHandle = await dDir.getFileHandle(fileName);
              break;
            } catch {
              const upper = fileName.toUpperCase();
              for await (const [n, h] of (dDir as any).entries()) {
                if (n.toUpperCase() === upper && h.kind === "file") {
                  fileHandle = h as FileSystemFileHandle;
                  break;
                }
              }
              if (fileHandle) break;
            }
          } catch {}
        }
      }
    }

    if (!fileHandle) return "";

    const file = await fileHandle.getFile();
    let blob: Blob = file;
    if (fileHandle.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      blob = new Blob([await file.arrayBuffer()], { type: "application/pdf" });
    }
    const url = URL.createObjectURL(blob);
    mediaUrlCache.set(cleanRel, url);
    mediaUrlCache.set(relativePath, url);
    mediaUrlCache.set(fileName, url);
    mediaUrlCache.set(fileHandle.name, url);
    mediaUrlCache.set(`images/${fileName}`, url);

    // Persistance dans IndexedDB 'media_cache' pour rechargements instantanés
    if (blob.size < 15 * 1024 * 1024) {
      idbPut("media_cache", {
        path: cleanRel,
        name: fileHandle.name,
        blob: blob,
        size: blob.size,
        updatedAt: Date.now()
      }).catch((err) => console.warn("[WebFS] Erreur mise en cache IDB:", err));
    }

    return url;
  } catch (e) {
    return "";
  }
}

export function getCachedMediaUrl(filePath: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/");
  if (mediaUrlCache.has(normalized)) return mediaUrlCache.get(normalized)!;

  const markers = ["images/", "documents/", "logos/"];
  for (const marker of markers) {
    const idx = normalized.indexOf(marker);
    if (idx !== -1) {
      const sub = normalized.substring(idx);
      if (mediaUrlCache.has(sub)) return mediaUrlCache.get(sub)!;
    }
  }

  if (mediaUrlCache.has(`images/${normalized}`)) {
    return mediaUrlCache.get(`images/${normalized}`)!;
  }

  const fileName = normalized.split("/").pop();
  if (fileName) {
    if (mediaUrlCache.has(fileName)) return mediaUrlCache.get(fileName)!;
    if (mediaUrlCache.has(`images/${fileName}`)) return mediaUrlCache.get(`images/${fileName}`)!;
  }

  return null;
}

export function setCachedMediaUrl(relativePath: string, url: string): void {
  if (!relativePath) return;
  const normalized = relativePath.replace(/\\/g, "/");
  mediaUrlCache.set(normalized, url);
  const fileName = normalized.split("/").pop();
  if (fileName) {
    mediaUrlCache.set(fileName, url);
  }
}

