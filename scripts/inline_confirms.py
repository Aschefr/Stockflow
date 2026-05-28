#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

APP_PATH = r"d:\Code Projects\Stockflow\src\App.tsx"

with open(APP_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# 1. Ajouter le state inlineConfirm
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

# 2. Bouton Image
OLD_IMG_BTN = """                  <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", maxHeight: "100%" }}>
                    <img 
                      src={`${config.network_path.replace(/\\\\/g, "/")}/images/${selectedProduct.image_path}`} 
                      alt={selectedProduct.label} 
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "8px" }}
                    />
                    <button
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
                              await invoke("delete_media", {
                                networkPath: config.network_path,
                                sku: selectedProduct.sku,
                                mediaType: "image",
                                fileName: selectedProduct.image_path
                              });
                              setEditSuccess("Image supprimée.");
                              syncAndFetch(config);
                              await refreshSelectedProduct(selectedProduct.sku);
                            } catch (err: any) {
                              setEditError(err.toString());
                            }
                          }
                        });
                      }}
                    >
                      🗑️
                    </button>
                  </div>"""

NEW_IMG_BTN = """                  <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", maxHeight: "100%" }}>
                    <img 
                      src={`${config.network_path.replace(/\\\\/g, "/")}/images/${selectedProduct.image_path}`} 
                      alt={selectedProduct.label} 
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "8px" }}
                    />
                    {inlineConfirm?.id === "image-delete" ? (
                      <div className="inline-confirm" style={{ position: "absolute", top: "10px", right: "10px", backgroundColor: "rgba(239, 68, 68, 0.9)", padding: "4px 6px", borderRadius: "4px", zIndex: 10, display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{ color: "white", fontSize: "11px", fontWeight: "bold" }}>Supprimer ?</span>
                        <button onClick={(e) => {
                          e.stopPropagation();
                          inlineConfirm.action();
                          setInlineConfirm(null);
                        }} style={{ background: "#fff", color: "var(--danger)", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontWeight: "bold", padding: "2px 6px" }}>Oui</button>
                        <button onClick={(e) => {
                          e.stopPropagation();
                          setInlineConfirm(null);
                        }} style={{ background: "rgba(0,0,0,0.3)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "11px", padding: "2px 6px" }}>Non</button>
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
                                await invoke("delete_media", {
                                  networkPath: config.network_path,
                                  sku: selectedProduct.sku,
                                  mediaType: "image",
                                  fileName: selectedProduct.image_path
                                });
                                setEditSuccess("Image supprimée.");
                                syncAndFetch(config);
                                await refreshSelectedProduct(selectedProduct.sku);
                              } catch (err: any) {
                                setEditError(err.toString());
                              }
                            }
                          });
                        }}
                      >
                        🗑️
                      </button>
                    )}
                  </div>"""

if OLD_IMG_BTN in content:
    content = content.replace(OLD_IMG_BTN, NEW_IMG_BTN, 1)
    changes += 1
    print("[OK] Bouton Image corrigé")

# 3. Bouton Suppression Produit global
OLD_DEL_PROD = """                  <button 
                    type="button" 
                    className="btn btn-danger" 
                    style={{ flex: 1, backgroundColor: "var(--danger)", color: "#fff" }}
                    onClick={() => {
                      setConfirmModal({
                        title: "Supprimer le produit",
                        message: `Êtes-vous sûr de vouloir supprimer définitivement le SKU ${selectedProduct.sku} ?`,
                        onConfirm: async () => {
                          try {
                            await invoke("delete_product", {
                              networkPath: config.network_path,
                              sku: selectedProduct.sku,
                            });
                            setSelectedProduct(null);
                            setShowEditModal(false);
                            syncAndFetch(config);
                          } catch (err: any) {
                            setEditError(err.toString());
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
                      <button type="button" className="btn" style={{ background: "var(--danger)", color: "#fff", padding: "0.4rem 0.8rem", fontSize: "12px" }} onClick={() => {
                        inlineConfirm.action();
                        setInlineConfirm(null);
                      }}>Oui</button>
                      <button type="button" className="btn" style={{ background: "var(--bg-lighter)", color: "var(--text-color)", padding: "0.4rem 0.8rem", fontSize: "12px" }} onClick={() => setInlineConfirm(null)}>Non</button>
                    </div>
                  ) : (
                    <button 
                      type="button" 
                      className="btn btn-danger" 
                      style={{ flex: 1, backgroundColor: "var(--danger)", color: "#fff" }}
                      onClick={() => {
                        setInlineConfirm({
                          id: "product-delete",
                          action: async () => {
                            try {
                              await invoke("delete_product", {
                                networkPath: config.network_path,
                                sku: selectedProduct.sku,
                              });
                              setSelectedProduct(null);
                              setShowEditModal(false);
                              syncAndFetch(config);
                            } catch (err: any) {
                              setEditError(err.toString());
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

# 4. Bouton Suppression Notice (PDF)
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
                                    fileName: fileName
                                  });
                                  setEditSuccess(`Notice ${fileName} supprimée.`);
                                  syncAndFetch(config);
                                  await refreshSelectedProduct(selectedProduct.sku);
                                } catch (err: any) {
                                  setEditError(err.toString());
                                }
                              }
                            });
                          }}
                        >
                          🗑️
                        </button>"""

NEW_DEL_PDF = """                        {inlineConfirm?.id === `pdf-delete-${fileName}` ? (
                          <div style={{ display: "flex", gap: "4px", alignItems: "center", backgroundColor: "rgba(239, 68, 68, 0.9)", padding: "2px 4px", borderRadius: "4px" }}>
                            <span style={{ color: "white", fontSize: "10px", fontWeight: "bold" }}>Supprimer?</span>
                            <button onClick={() => { inlineConfirm.action(); setInlineConfirm(null); }} style={{ background: "#fff", color: "var(--danger)", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontWeight: "bold", padding: "2px 4px" }}>Oui</button>
                            <button onClick={() => setInlineConfirm(null)} style={{ background: "rgba(0,0,0,0.3)", color: "white", border: "none", borderRadius: "3px", cursor: "pointer", fontSize: "10px", padding: "2px 4px" }}>Non</button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-danger"
                            title="Supprimer cette notice"
                            style={{ backgroundColor: "var(--danger)", color: "#fff", padding: "0 0.5rem", border: "none", borderRadius: "6px", cursor: "pointer" }}
                            onClick={() => {
                              setInlineConfirm({
                                id: `pdf-delete-${fileName}`,
                                action: async () => {
                                  try {
                                    await invoke("delete_media", {
                                      networkPath: config.network_path,
                                      sku: selectedProduct.sku,
                                      mediaType: "pdf",
                                      fileName: fileName
                                    });
                                    setEditSuccess(`Notice ${fileName} supprimée.`);
                                    syncAndFetch(config);
                                    await refreshSelectedProduct(selectedProduct.sku);
                                  } catch (err: any) {
                                    setEditError(err.toString());
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

# Important : On gère la fermeture de l'inline confirm si on clique ailleurs dans le modal
# On ajoute un onClick sur la div principale (celle de class modal-content) mais ce n'est pas strict.
# C'est optionnel, mais mieux. On l'ignorera pour l'instant pour la simplicité, car l'utilisateur peut juste cliquer "Non".

with open(APP_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print(f"Modifications effectuées : {changes}")
