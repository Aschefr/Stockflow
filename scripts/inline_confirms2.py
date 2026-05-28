#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

APP_PATH = r"d:\Code Projects\Stockflow\src\App.tsx"

with open(APP_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# 1. State
OLD_STATE = """  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);"""

NEW_STATE = """  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [inlineConfirm, setInlineConfirm] = useState<{ id: string, action: () => void } | null>(null);"""

if OLD_STATE in content:
    content = content.replace(OLD_STATE, NEW_STATE, 1)
    changes += 1
    print("[OK] State inlineConfirm ajouté")
else:
    print("[WARN] State inlineConfirm déjà présent ou non trouvé")


# 2. Bouton Image (lignes ~3138)
OLD_IMG_BTN = """                    <button
                      className="btn-delete-media"
                      title="Supprimer cette image"
                      style={{ position: "absolute", top: "10px", right: "10px", backgroundColor: "rgba(239, 68, 68, 0.8)", border: "none", color: "#fff", borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontWeight: "bold", zIndex: 10 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmModal({
                          title: "Supprimer l'image",
                          message: "Êtes-vous sûr de vouloir supprimer définitivement cette image ?",
                          onConfirm: async () => {
                            try {
                              const imgPath = productImages[activeImageIndex];
                              await invoke("delete_media", {
                                networkPath: config.network_path,
                                sku: selectedProduct.sku,
                                mediaType: "image",
                                filePath: imgPath
                              });
                              const updatedImgs: string[] = await invoke("list_sku_images", { networkPath: config.network_path, sku: selectedProduct.sku });
                              setProductImages(updatedImgs);
                              setActiveImageIndex(0);
                              syncAndFetch(config);
                            } catch (err: any) {
                              setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                            }
                          }
                        });
                      }}
                    >
                      🗑️
                    </button>"""

NEW_IMG_BTN = """                    {inlineConfirm?.id === "image-delete" ? (
                      <div className="inline-confirm" style={{ position: "absolute", top: "10px", right: "10px", backgroundColor: "rgba(239, 68, 68, 0.9)", padding: "4px 6px", borderRadius: "4px", zIndex: 10, display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{ color: "white", fontSize: "11px", fontWeight: "bold" }}>Supprimer ?</span>
                        <button onClick={(e) => { e.stopPropagation(); inlineConfirm.action(); setInlineConfirm(null); }} style={{ background: "#fff", color: "var(--danger)", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontWeight: "bold", padding: "2px 6px" }}>Oui</button>
                        <button onClick={(e) => { e.stopPropagation(); setInlineConfirm(null); }} style={{ background: "rgba(0,0,0,0.3)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "11px", padding: "2px 6px" }}>Non</button>
                      </div>
                    ) : (
                      <button
                        className="btn-delete-media"
                        title="Supprimer cette image"
                        style={{ position: "absolute", top: "10px", right: "10px", backgroundColor: "rgba(239, 68, 68, 0.8)", border: "none", color: "#fff", borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontWeight: "bold", zIndex: 10 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setInlineConfirm({
                            id: "image-delete",
                            action: async () => {
                              try {
                                const imgPath = productImages[activeImageIndex];
                                await invoke("delete_media", {
                                  networkPath: config.network_path,
                                  sku: selectedProduct.sku,
                                  mediaType: "image",
                                  filePath: imgPath
                                });
                                const updatedImgs: string[] = await invoke("list_sku_images", { networkPath: config.network_path, sku: selectedProduct.sku });
                                setProductImages(updatedImgs);
                                setActiveImageIndex(0);
                                syncAndFetch(config);
                              } catch (err: any) {
                                setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                              }
                            }
                          });
                        }}
                      >
                        🗑️
                      </button>
                    )}"""

if OLD_IMG_BTN in content:
    content = content.replace(OLD_IMG_BTN, NEW_IMG_BTN, 1)
    changes += 1
    print("[OK] Bouton Image corrigé")
else:
    print("[WARN] Bouton Image non trouvé")


# 3. Bouton Suppression Produit global (~3454)
OLD_DEL_PROD = """                  <button 
                    type="button" 
                    className="btn btn-danger" 
                    style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "12px", backgroundColor: "var(--danger)" }}
                    onClick={() => {
                      setConfirmModal({
                        title: "Supprimer le produit",
                        message: `Êtes-vous sûr de vouloir supprimer définitivement le SKU ${selectedProduct.sku} ?`,
                        onConfirm: async () => {
                          try {
                            await invoke("delete_product", {
                              networkPath: config.network_path,
                              trigramme: config.trigramme,
                              sku: selectedProduct.sku
                            });
                            setSelectedProduct(null);
                            syncAndFetch(config);
                          } catch (err: any) {
                            setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                          }
                        }
                      });
                    }}
                  >
                    🗑️ Supprimer
                  </button>"""

NEW_DEL_PROD = """                  {inlineConfirm?.id === "product-delete" ? (
                    <div style={{ flex: 1, display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(239, 68, 68, 0.1)", borderRadius: "6px", padding: "0 0.5rem" }}>
                      <span style={{ color: "var(--danger)", fontSize: "12px", fontWeight: "bold" }}>Sûr ?</span>
                      <button type="button" className="btn" style={{ background: "var(--danger)", color: "#fff", padding: "0.3rem 0.6rem", fontSize: "12px" }} onClick={() => {
                        inlineConfirm.action();
                        setInlineConfirm(null);
                      }}>Oui</button>
                      <button type="button" className="btn" style={{ background: "var(--bg-lighter)", color: "var(--text-color)", padding: "0.3rem 0.6rem", fontSize: "12px" }} onClick={() => setInlineConfirm(null)}>Non</button>
                    </div>
                  ) : (
                    <button 
                      type="button" 
                      className="btn btn-danger" 
                      style={{ flex: 1, padding: "0.3rem 0.6rem", fontSize: "12px", backgroundColor: "var(--danger)" }}
                      onClick={() => {
                        setInlineConfirm({
                          id: "product-delete",
                          action: async () => {
                            try {
                              await invoke("delete_product", {
                                networkPath: config.network_path,
                                trigramme: config.trigramme,
                                sku: selectedProduct.sku
                              });
                              setSelectedProduct(null);
                              syncAndFetch(config);
                            } catch (err: any) {
                              setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                            }
                          }
                        });
                      }}
                    >
                      🗑️ Supprimer
                    </button>
                  )}"""

if OLD_DEL_PROD in content:
    content = content.replace(OLD_DEL_PROD, NEW_DEL_PROD, 1)
    changes += 1
    print("[OK] Bouton Suppression Produit corrigé")
else:
    print("[WARN] Bouton Produit non trouvé")

# 4. Bouton Suppression Notice (PDF) (~3608)
OLD_DEL_PDF = """                        <button
                          className="btn btn-danger"
                          title="Supprimer cette notice"
                          style={{ backgroundColor: "var(--danger)", color: "#fff", padding: "0 0.5rem", border: "none", borderRadius: "6px", cursor: "pointer" }}
                          onClick={() => {
                            setConfirmModal({
                              title: "Supprimer la notice",
                              message: `Êtes-vous sûr de vouloir supprimer définitivement la notice ${fileName} ?`,
                              onConfirm: async () => {
                                try {
                                  await invoke("delete_media", {
                                    networkPath: config.network_path,
                                    sku: selectedProduct.sku,
                                    mediaType: "pdf",
                                    filePath: pdf
                                  });
                                  const updatedPdfs: string[] = await invoke("list_sku_pdfs", { networkPath: config.network_path, sku: selectedProduct.sku });
                                  setProductPdfs(updatedPdfs);
                                  syncAndFetch(config);
                                } catch (err: any) {
                                  setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                                }
                              }
                            });
                          }}
                        >
                          🗑️
                        </button>"""

NEW_DEL_PDF = """                        {inlineConfirm?.id === `pdf-delete-${fileName}` ? (
                          <div style={{ display: "flex", gap: "4px", alignItems: "center", backgroundColor: "rgba(239, 68, 68, 0.9)", padding: "2px 4px", borderRadius: "4px", flexShrink: 0 }}>
                            <span style={{ color: "white", fontSize: "10px", fontWeight: "bold" }}>Sûr ?</span>
                            <button onClick={(e) => { e.stopPropagation(); inlineConfirm.action(); setInlineConfirm(null); }} style={{ background: "#fff", color: "var(--danger)", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontWeight: "bold", padding: "2px 6px" }}>Oui</button>
                            <button onClick={(e) => { e.stopPropagation(); setInlineConfirm(null); }} style={{ background: "rgba(0,0,0,0.3)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "10px", padding: "2px 6px" }}>Non</button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-danger"
                            title="Supprimer cette notice"
                            style={{ backgroundColor: "var(--danger)", color: "#fff", padding: "0 0.5rem", border: "none", borderRadius: "6px", cursor: "pointer", flexShrink: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInlineConfirm({
                                id: `pdf-delete-${fileName}`,
                                action: async () => {
                                  try {
                                    await invoke("delete_media", {
                                      networkPath: config.network_path,
                                      sku: selectedProduct.sku,
                                      mediaType: "pdf",
                                      filePath: pdf
                                    });
                                    const updatedPdfs: string[] = await invoke("list_sku_pdfs", { networkPath: config.network_path, sku: selectedProduct.sku });
                                    setProductPdfs(updatedPdfs);
                                    syncAndFetch(config);
                                  } catch (err: any) {
                                    setAlertModal({ title: "Erreur de suppression", message: err.toString() });
                                  }
                                }
                              });
                            }}
                          >
                            🗑️
                          </button>
                        )}"""

if OLD_DEL_PDF in content:
    content = content.replace(OLD_DEL_PDF, NEW_DEL_PDF, 1)
    changes += 1
    print("[OK] Bouton Suppression PDF corrigé")
else:
    print("[WARN] Bouton PDF non trouvé")

with open(APP_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print(f"Modifications effectuées : {changes}")
