import { invoke as tauriInvoke, convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";
import { openPath as tauriOpenPath } from "@tauri-apps/plugin-opener";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { webBackendInstance } from "./webBackend";

import { getCachedMediaUrl, resolveMediaUrl, getDirectoryHandle } from "./webFileSystem";

/**
 * Détermine dynamiquement si l'application s'exécute dans l'environnement de bureau Tauri (Windows .exe)
 * ou dans un navigateur Web standard (Microsoft Edge, Google Chrome).
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
}

/**
 * Appelle une commande backend.
 * En mode Desktop (Tauri), délègue à l'IPC Rust natif.
 * En mode Pure Web, délègue au moteur IndexedDB + File System Access API.
 */
export async function invoke<T = any>(command: string, args?: Record<string, any>): Promise<T> {
  if (isTauri()) {
    return await tauriInvoke<T>(command, args);
  }
  return await webBackendInstance.handle(command, args);
}

/**
 * Convertit un chemin de fichier local/médias en URL exploitable par le navigateur.
 * En mode Desktop (Tauri), convertit vers asset:// ou http://asset.localhost/.
 * En mode Pure Web, résout vers une URL Blob locale ou URL directe.
 */
export function convertFileSrc(filePath: string, protocol = "asset"): string {
  if (!filePath) return "";
  if (isTauri()) {
    return tauriConvertFileSrc(filePath, protocol);
  }
  if (filePath.startsWith("blob:") || filePath.startsWith("http://") || filePath.startsWith("https://") || filePath.startsWith("data:")) {
    return filePath;
  }
  const cached = getCachedMediaUrl(filePath);
  if (cached) return cached;
  return "";
}

/**
 * Précharge une image dans le cache mémoire de décodage du navigateur (RAM/Bitmap).
 * Permet un affichage au survol à 0ms de latence sans scintillement.
 */
export async function preloadImage(src: string): Promise<void> {
  if (!src) return;
  try {
    const img = new Image();
    img.src = src;
    if ("decode" in img) {
      await img.decode().catch(() => {});
    }
  } catch {}
}

/**
 * Résout de façon universelle un chemin d'image/média en URL directement exploitable (blob ou asset).
 * Fonctionne de façon synchrone si déjà en cache, ou asynchrone si à charger depuis le disque/répertoire.
 */
export async function resolveMediaSrc(filePath: string | null | undefined, networkPath?: string): Promise<string> {
  if (!filePath || !filePath.trim()) return "";

  // 1. Déjà une URL directe (web, blob, data)
  if (filePath.startsWith("http://") || filePath.startsWith("https://") || filePath.startsWith("blob:") || filePath.startsWith("data:")) {
    return filePath;
  }

  // 2. Mode Desktop (Tauri)
  if (isTauri()) {
    const full = networkPath ? `${networkPath}/${filePath}`.replace(/\\/g, "/") : filePath;
    return convertFileSrc(full);
  }

  // 3. Mode Web pur : vérifier d'abord le cache synchrone
  const cached = getCachedMediaUrl(filePath) || (networkPath ? getCachedMediaUrl(`${networkPath}/${filePath}`) : null);
  if (cached) return cached;

  // 4. Si non présent en cache mémoire synchrone, résoudre via le backend (qui tente IndexedDB puis FileSystemAccess)
  try {
    const cleanPath = filePath.replace(/\\/g, "/");
    const resolved = await invoke<string>("resolve_media", { path: cleanPath });
    if (resolved && (resolved.startsWith("blob:") || resolved.startsWith("http"))) {
      return resolved;
    }
  } catch {}

  return "";
}

/**
 * Précharge par lots une liste de chemins de médias (ex: articles d'une nomenclature ou produits visibles)
 * pour qu'ils soient décodés en arrière-plan et instantanés à l'affichage et au survol.
 */
export async function preloadMediaBatch(
  items: Array<{ imagePath?: string | null; sku?: string }>,
  networkPath?: string,
  concurrency = 6
): Promise<void> {
  if (!items || items.length === 0) return;

  const validItems = items.filter(it => it && (it.imagePath || it.sku));
  if (validItems.length === 0) return;

  let index = 0;

  async function worker() {
    while (index < validItems.length) {
      const current = validItems[index++];
      if (!current) continue;
      try {
        let src = "";
        if (current.imagePath) {
          src = await resolveMediaSrc(current.imagePath, networkPath);
        } else if (current.sku) {
          try {
            const skuImgs: string[] = await invoke("list_sku_images", { networkPath, sku: current.sku });
            if (skuImgs && skuImgs.length > 0) {
              src = await resolveMediaSrc(skuImgs[0], networkPath);
            }
          } catch {}
        }
        if (src) {
          await preloadImage(src);
        }
      } catch {}
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, validItems.length) }, () => worker());
  await Promise.all(workers);
}

/**
 * Ouvre un fichier ou un lien URL.
 * En mode Desktop, utilise le plugin d'ouverture système.
 * En mode Web, ouvre l'URL directe ou résout le fichier local via Blob URL pour l'afficher dans un nouvel onglet.
 */
export async function openPath(path: string): Promise<void> {
  if (!path || !path.trim()) return;

  const trimmed = path.trim();

  // 1. URLs directes (web, blob, data)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("blob:") || trimmed.startsWith("data:")) {
    if (isTauri()) {
      return await tauriOpenPath(trimmed);
    }
    window.open(trimmed, "_blank", "noopener,noreferrer");
    return;
  }

  // Ignorer les chaînes de libellé ou textes descriptifs (ex: "Fiche fournisseur importée")
  if (!trimmed.includes(".") && !trimmed.includes("/") && !trimmed.includes("\\")) {
    console.warn("[StockFlow] Libellé non-fichier ignoré par openPath :", trimmed);
    return;
  }

  if (isTauri()) {
    return await tauriOpenPath(trimmed);
  }

  // 2. Fichiers locaux dans le dossier partagé (notices PDF, images, etc.)
  try {
    let cleanPath = path.replace(/\\/g, "/");
    // Retirer les préfixes de dossier réseau ou étiquettes visuelles
    const markers = ["documents/", "images/", "pdfs/", "logos/"];
    for (const marker of markers) {
      const idx = cleanPath.indexOf(marker);
      if (idx !== -1) {
        cleanPath = cleanPath.substring(idx);
        break;
      }
    }

    // A. Vérifier le cache d'URL Blob
    let mediaUrl = getCachedMediaUrl(cleanPath) || getCachedMediaUrl(path);

    // B. Si pas en cache, résoudre depuis le dossier File System Access connecté
    if (!mediaUrl) {
      const dirHandle = await getDirectoryHandle();
      if (dirHandle) {
        mediaUrl = await resolveMediaUrl(dirHandle, cleanPath);
      }
    }

    // C. Si une URL Blob a été créée, l'ouvrir dans un nouvel onglet
    if (mediaUrl) {
      window.open(mediaUrl, "_blank", "noopener,noreferrer");
      return;
    }

    // D. Si impossible de résoudre
    console.warn("[StockFlow] Fichier local introuvable ou non connecté :", path);
    alert(`Impossible d'ouvrir le fichier local :\n${path}\n\nVérifiez que le dossier partagé est bien connecté dans l'onglet Paramètres.`);
  } catch (err) {
    console.error("[StockFlow] Erreur lors de l'ouverture du fichier :", err);
    alert(`Erreur lors de l'ouverture du fichier :\n${err}`);
  }
}

type EventCallback<T> = (event: { payload: T }) => void;
const webListeners = new Map<string, Set<EventCallback<any>>>();

/**
 * Écoute les événements système.
 * En mode Desktop, utilise l'API d'événements Tauri.
 * En mode Web, utilise un bus d'événements mémoire local.
 */
export async function listen<T = any>(event: string, handler: EventCallback<T>): Promise<() => void> {
  if (isTauri()) {
    return await tauriListen<T>(event, handler);
  }
  if (!webListeners.has(event)) {
    webListeners.set(event, new Set());
  }
  webListeners.get(event)!.add(handler);
  return () => {
    webListeners.get(event)?.delete(handler);
  };
}

export function emitWebEvent<T = any>(event: string, payload: T): void {
  const handlers = webListeners.get(event);
  if (handlers) {
    handlers.forEach((h) => h({ payload }));
  }
}
