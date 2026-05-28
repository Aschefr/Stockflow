#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ajout de la saisie du stock initial dans Stockflow :
1. Ajouter initial_stock dans le state newProduct
2. Ajouter initial_stock dans la réinitialisation du form après création
3. Appeler add_movement après create_product si initial_stock > 0
4. Ajouter le champ UI dans la modal de création
5. Rendre la cellule current_stock cliquable (handleCellDoubleClick + handleCellSave)
"""
import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1, closefd=False)

APP_PATH = r"d:\Code Projects\Stockflow\src\App.tsx"

with open(APP_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Fichier lu : {len(content)} chars, {content.count(chr(10))+1} lignes")
changes = 0


# ─── 1. Ajouter initial_stock dans le state newProduct ───────────────────────
OLD_STATE = '''    poids: ""
  });
  const [duplicateWarning, setDuplicateWarning] = useState("");'''

NEW_STATE = '''    poids: "",
    initial_stock: "0"
  });
  const [duplicateWarning, setDuplicateWarning] = useState("");'''

if OLD_STATE in content:
    content = content.replace(OLD_STATE, NEW_STATE, 1)
    print("[OK] 1. initial_stock ajouté au state newProduct")
    changes += 1
else:
    print("[WARN] 1. State newProduct non trouvé (déjà modifié ?)")


# ─── 2. Ajouter initial_stock dans la réinitialisation du form ───────────────
OLD_RESET = '''        poids: ""
      });
      setShowAddModal(false);'''

NEW_RESET = '''        poids: "",
        initial_stock: "0"
      });
      setShowAddModal(false);'''

if OLD_RESET in content:
    content = content.replace(OLD_RESET, NEW_RESET, 1)
    print("[OK] 2. initial_stock ajouté dans le reset du form")
    changes += 1
else:
    print("[WARN] 2. Reset form non trouvé")


# ─── 3. Appeler add_movement après create_product si initial_stock > 0 ───────
OLD_CREATE_SUCCESS = '''      setCreateSuccess("Produit créé avec succès ! Événement généré.");'''

NEW_CREATE_SUCCESS = '''      // Si un stock initial est renseigné, créer un mouvement STOCK_IN
      const initialQty = Number(newProduct.initial_stock?.toString().replace(",", ".")) || 0;
      if (initialQty > 0) {
        try {
          await invoke("add_movement", {
            networkPath: config.network_path,
            trigramme: config.trigramme,
            eventType: "STOCK_IN",
            sku: newProduct.sku,
            qty: initialQty,
            note: "Stock initial à la création",
          });
        } catch (e) {
          console.warn("Stock initial non enregistré :", e);
        }
      }
      setCreateSuccess("Produit créé avec succès ! Événement généré.");'''

if OLD_CREATE_SUCCESS in content:
    content = content.replace(OLD_CREATE_SUCCESS, NEW_CREATE_SUCCESS, 1)
    print("[OK] 3. Appel add_movement pour stock initial après création")
    changes += 1
else:
    print("[WARN] 3. setCreateSuccess non trouvé")


# ─── 4. Rendre current_stock éditable dans handleCellDoubleClick ─────────────
OLD_CELL_DBL = '''    if (field === "price" || field === "min_stock" || field === "largeur" || field === "hauteur" || field === "profondeur" || field === "poids") {
      valStr = valStr.replace(/\\./g, ",");
    }'''

NEW_CELL_DBL = '''    if (field === "price" || field === "min_stock" || field === "largeur" || field === "hauteur" || field === "profondeur" || field === "poids" || field === "current_stock") {
      valStr = valStr.replace(/\\./g, ",");
    }'''

if OLD_CELL_DBL in content:
    content = content.replace(OLD_CELL_DBL, NEW_CELL_DBL, 1)
    print("[OK] 4. current_stock ajouté dans handleCellDoubleClick")
    changes += 1
else:
    print("[WARN] 4. handleCellDoubleClick non trouvé")


# ─── 5. Gérer current_stock dans handleCellSave ───────────────────────────────
OLD_CELL_SAVE = '''    } else if (editingCell.field === "largeur" || editingCell.field === "hauteur" || editingCell.field === "profondeur" || editingCell.field === "poids") {
      (attributesObj as any)[editingCell.field] = cleanVal;
      updatedProd.attributes = JSON.stringify(attributesObj);
    }

    try {
      await invoke("create_product", {'''

NEW_CELL_SAVE = '''    } else if (editingCell.field === "largeur" || editingCell.field === "hauteur" || editingCell.field === "profondeur" || editingCell.field === "poids") {
      (attributesObj as any)[editingCell.field] = cleanVal;
      updatedProd.attributes = JSON.stringify(attributesObj);
    } else if (editingCell.field === "current_stock") {
      // Saisie directe du stock : calcule la différence et crée un mouvement
      const targetQty = Number(cleanVal.replace(",", ".")) || 0;
      const currentQty = product.current_stock || 0;
      const diff = targetQty - currentQty;
      if (diff !== 0 && config) {
        try {
          await invoke("add_movement", {
            networkPath: config.network_path,
            trigramme: config.trigramme,
            eventType: diff > 0 ? "STOCK_IN" : "STOCK_OUT",
            sku: product.sku,
            qty: Math.abs(diff),
            note: diff > 0 ? "Ajustement stock (entrée)" : "Ajustement stock (sortie)",
          });
          setEditingCell(null);
          syncAndFetch(config);
        } catch (err) {
          console.error("Erreur mouvement stock :", err);
        }
      } else {
        setEditingCell(null);
      }
      return; // Court-circuit : pas de invoke create_product pour le stock
    }

    try {
      await invoke("create_product", {'''

if OLD_CELL_SAVE in content:
    content = content.replace(OLD_CELL_SAVE, NEW_CELL_SAVE, 1)
    print("[OK] 5. current_stock géré dans handleCellSave")
    changes += 1
else:
    print("[WARN] 5. handleCellSave insertion non trouvée")


# ─── 6. Rendre la cellule current_stock isEditable = true dans le tableau ────
OLD_CELL_RENDER = '''                              } else if (col.id === "current_stock") {
                                displayValue = (
                                  <span className={`stock-status-badge ${stockClass}`}>
                                    {prod.current_stock}
                                  </span>
                                );
                                rawValue = prod.current_stock;'''

NEW_CELL_RENDER = '''                              } else if (col.id === "current_stock") {
                                displayValue = (
                                  <span className={`stock-status-badge ${stockClass}`}>
                                    {prod.current_stock}
                                  </span>
                                );
                                rawValue = prod.current_stock;
                                isEditable = true; // Double-clic → saisie directe → mouvement STOCK_IN/OUT'''

if OLD_CELL_RENDER in content:
    content = content.replace(OLD_CELL_RENDER, NEW_CELL_RENDER, 1)
    print("[OK] 6. isEditable=true sur cellule current_stock")
    changes += 1
else:
    print("[WARN] 6. Rendu cellule current_stock non trouvé")


# ─── 7. Ajouter le champ "Stock initial" dans la modal de création ────────────
OLD_MIN_STOCK_FIELD = '''                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-min">Seuil Alerte Stock</label>
                      <input
                        id="modal-p-min"
                        type="text"
                        list="minstocks-datalist"
                        value={newProduct.min_stock}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, min_stock: cleanNumericInput(e.target.value) }))}
                      />
                    </div>
                  </div>'''

NEW_MIN_STOCK_FIELD = '''                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-min">Seuil Alerte Stock</label>
                      <input
                        id="modal-p-min"
                        type="text"
                        list="minstocks-datalist"
                        value={newProduct.min_stock}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, min_stock: cleanNumericInput(e.target.value) }))}
                      />
                    </div>
                  </div>

                  <div className="modal-field-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label htmlFor="modal-p-initial-stock" style={{ color: "var(--success)", fontWeight: 600 }}>
                        📦 Stock initial (à la création)
                      </label>
                      <input
                        id="modal-p-initial-stock"
                        type="text"
                        placeholder="0"
                        value={newProduct.initial_stock}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, initial_stock: cleanNumericInput(e.target.value) }))}
                        style={{ borderColor: Number(newProduct.initial_stock) > 0 ? "var(--success)" : undefined }}
                      />
                      {Number(newProduct.initial_stock) > 0 && (
                        <span style={{ fontSize: "11px", color: "var(--success)", marginTop: "2px", display: "block" }}>
                          Un mouvement d'entrée de {newProduct.initial_stock} unité(s) sera créé automatiquement.
                        </span>
                      )}
                    </div>
                  </div>'''

if OLD_MIN_STOCK_FIELD in content:
    content = content.replace(OLD_MIN_STOCK_FIELD, NEW_MIN_STOCK_FIELD, 1)
    print("[OK] 7. Champ Stock initial ajouté dans la modal de création")
    changes += 1
else:
    print("[WARN] 7. Champ min_stock dans modal non trouvé")


# ─── Écriture finale ──────────────────────────────────────────────────────────
with open(APP_PATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print(f"\n[OK] App.tsx écrit en UTF-8 sans BOM : {changes}/7 modifications appliquées")

# Vérif BOM
with open(APP_PATH, 'rb') as f:
    first3 = f.read(3)
if first3 == b'\xef\xbb\xbf':
    print("[ERREUR] BOM détecté !")
else:
    print(f"[OK] Pas de BOM. Premiers octets: {first3.hex()}")

print("=== TERMINÉ ===")
