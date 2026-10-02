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
 * Ouvre un fichier ou un lien URL.
 * En mode Desktop, utilise le plugin d'ouverture système.
 * En mode Web, ouvre l'URL directe ou résout le fichier local via Blob URL pour l'afficher dans un nouvel onglet.
 */
export async function openPath(path: string): Promise<void> {
  if (isTauri()) {
    return await tauriOpenPath(path);
  }
  if (!path) return;

  // 1. URLs directes (web, blob, data)
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:") || path.startsWith("data:")) {
    window.open(path, "_blank", "noopener,noreferrer");
    return;
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
