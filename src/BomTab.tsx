import { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface BomItem {
  sku: string;
  qty: number;
  note?: string;
}

function SortableItem(props: any) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({id: props.id});

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {props.children(listeners, isDragging)}
    </div>
  );
}

export interface Bom {
  id: string;
  name: string;
  status: string; // "DRAFT", "RESERVED", "COMPLETED"
  created_at: string;
  updated_at: string;
  items: BomItem[];
  equipment_note?: string;
}

const ALL_AVAILABLE_COLUMNS: Record<string, string> = {
  checkbox: "[ ] Case à cocher",
  sku: "SKU Interne",
  mpn: "MPN (Ref Fabricant)",
  label: "Désignation",
  brand: "Marque",
  category: "Famille",
  sub_category: "Sous-famille",
  location: "Emplacement",
  price: "Prix",
  current_stock: "Stock Actuel",
  min_stock: "Stock Min",
  pack_size: "Taille Paquet",
  note: "Note article",
  qty: "Qté Nette",
  roundedQty: "Qté à Commander (Arrondie)",
  vpcCode: "Code VPC",
  vpcName: "Fournisseur VPC"
};

const COLUMN_HEADERS: Record<string, string> = {
  checkbox: "[ ]",
  sku: "SKU",
  mpn: "MPN",
  label: "Désignation",
  brand: "Marque",
  category: "Famille",
  sub_category: "Sous-famille",
  location: "Emplacement",
  price: "Prix",
  current_stock: "Stock Actuel",
  min_stock: "Stock Min",
  pack_size: "Pack Size",
  note: "Note",
  qty: "Qté",
  roundedQty: "Qté Arrondie",
  vpcCode: "Code VPC",
  vpcName: "Fournisseur VPC"
};

export default function BomTab({ 
  networkPath, 
  trigramme, 
  products, 
  renderProductTable,
  selectedSkus,
  setSelectedSkus,
  onEditingChange
}: any) {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [editingBom, setEditingBom] = useState<Bom | null>(null);
  useEffect(() => { onEditingChange?.(editingBom !== null); }, [editingBom]);

  const [excelColumns, setExcelColumns] = useState(() => {
    const saved = localStorage.getItem("sf_bom_excel_columns");
    if (saved) {
      try { return JSON.parse(saved); } catch(e) {}
    }
    return [
      { id: "vpcCode", label: "Code VPC", enabled: true },
      { id: "mpn", label: "MPN", enabled: true },
      { id: "label", label: "Désignation", enabled: true },
      { id: "category", label: "Famille", enabled: true },
      { id: "sub_category", label: "Sous-famille", enabled: true },
      { id: "note", label: "Note article", enabled: true },
      { id: "qty", label: "Qté Nette", enabled: true },
      { id: "roundedQty", label: "Qté à Commander (Arrondie)", enabled: true }
    ];
  });

  const [pdfColumns, setPdfColumns] = useState(() => {
    const saved = localStorage.getItem("sf_bom_pdf_columns");
    if (saved) {
      try { return JSON.parse(saved); } catch(e) {}
    }
    return [
      { id: "checkbox", label: "[ ]", enabled: true },
      { id: "sku", label: "SKU", enabled: true },
      { id: "label", label: "Désignation", enabled: true },
      { id: "location", label: "Emplacement", enabled: true },
      { id: "note", label: "Note", enabled: true },
      { id: "qty", label: "Qté", enabled: true }
    ];
  });

  const [pdfMargin, setPdfMargin] = useState(() => {
    return localStorage.getItem("sf_bom_pdf_margin") || "default";
  });

  const [logoPath, setLogoPath] = useState(() => {
    return localStorage.getItem("sf_bom_logo_path") || "";
  });

  const [pdfSortBy, setPdfSortBy] = useState(() => {
    return localStorage.getItem("sf_bom_pdf_sort_by") || "location";
  });

  const [pdfLineBreakBy, setPdfLineBreakBy] = useState(() => {
    return localStorage.getItem("sf_bom_pdf_line_break_by") || "none";
  });

  const [tableColumns, setTableColumns] = useState(() => {
    const saved = localStorage.getItem("sf_bom_table_columns");
    if (saved) {
      try { return JSON.parse(saved); } catch(e) {}
    }
    return [
      { id: "sku", label: "SKU", enabled: true, width: 120 },
      { id: "label", label: "Désignation", enabled: true, width: 300 },
      { id: "location", label: "Emplacement", enabled: true, width: 130 },
      { id: "note", label: "Note article", enabled: true, width: 200 },
      { id: "qty", label: "Qté Requise", enabled: true, width: 90 },
      { id: "current_stock", label: "Stock Actuel", enabled: true, width: 100 },
      { id: "pack_size", label: "Pack Size", enabled: true, width: 100 }
    ];
  });

  const [tableSortBy, setTableSortBy] = useState(() => {
    return localStorage.getItem("sf_bom_table_sort_by") || "location";
  });

  const [tableLineBreakBy, setTableLineBreakBy] = useState(() => {
    return localStorage.getItem("sf_bom_table_line_break_by") || "none";
  });

  const [isTableConfigOpen, setIsTableConfigOpen] = useState(false);

  const [isExcelPreviewOpen, setIsExcelPreviewOpen] = useState(false);
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor));
  const [pickerSearchQuery, setPickerSearchQuery] = useState("");
  const [pickerCategoryFilter, setPickerCategoryFilter] = useState("all");
  const [pickerSubCategoryFilter, setPickerSubCategoryFilter] = useState("all");
  const [pickerQuantities, setPickerQuantities] = useState<Record<string, number>>({});
  const [pickerNotes, setPickerNotes] = useState<Record<string, string>>({});
  const [replacingSku, setReplacingSku] = useState<string | null>(null);

  const handleReplaceClick = (item: BomItem) => {
    const p = products.find((prod: any) => prod.sku === item.sku);
    if (p) {
      setPickerCategoryFilter(p.category || "all");
      setPickerSubCategoryFilter(p.sub_category || "all");
    }
    setReplacingSku(item.sku);
    setIsPickerOpen(true);
  };

  const calculateProjectTotal = (bom: Bom) => {
    return bom.items.reduce((sum, item) => {
      const p = products.find((prod: any) => prod.sku === item.sku);
      const price = p?.price !== undefined ? p.price : 0;
      return sum + (price * item.qty);
    }, 0);
  };

  useEffect(() => {
    fetchBoms();
  }, []);

  const fetchBoms = async () => {
    try {
      const res: Bom[] = await invoke("get_boms");
      setBoms(res);
    } catch (e) {
      console.error("Error fetching boms", e);
    }
  };

  const handleCreateNew = () => {
    setEditingBom({
      id: crypto.randomUUID(),
      name: "Nouvelle Nomenclature",
      status: "DRAFT",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: [],
    });
  };

  const handleDuplicate = (bom: Bom) => {
    setEditingBom({
      id: crypto.randomUUID(),
      name: `Copie de ${bom.name}`,
      status: "DRAFT",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: [...bom.items],
    });
  };

  const handleSaveDraft = async () => {
    if (!editingBom) return;
    try {
      await invoke("save_bom", {
        networkPath,
        trigramme,
        bomId: editingBom.id,
        name: editingBom.name,
        status: editingBom.status,
        equipmentNote: editingBom.equipment_note || "",
        items: editingBom.items
      });
      setEditingBom(null);
      setTimeout(fetchBoms, 1500); // wait for event processing
    } catch (e) {
      alert("Erreur lors de l'enregistrement : " + e);
    }
  };

  const handleReserve = async () => {
    if (!editingBom) return;
    try {
      for (const item of editingBom.items) {
        await invoke("add_movement", {
          networkPath,
          trigramme,
          eventType: "STOCK_RESERVE",
          sku: item.sku,
          qty: item.qty,
          note: `Réservation projet: ${editingBom.name}`
        });
      }
      
      const updatedBom = { ...editingBom, status: "RESERVED", updated_at: new Date().toISOString() };
      await invoke("save_bom", {
        networkPath,
        trigramme,
        bomId: updatedBom.id,
        name: updatedBom.name,
        status: updatedBom.status,
        equipmentNote: updatedBom.equipment_note || "",
        items: updatedBom.items
      });
      
      setEditingBom(null);
      setTimeout(fetchBoms, 1500);
    } catch (e) {
      alert("Erreur: " + e);
    }
  };

  const handleWithdraw = async () => {
    if (!editingBom) return;
    try {
      for (const item of editingBom.items) {
        // Lever la réservation
        if (editingBom.status === "RESERVED") {
          await invoke("add_movement", {
            networkPath,
            trigramme,
            eventType: "STOCK_UNRESERVE",
            sku: item.sku,
            qty: item.qty,
            note: `Clôture projet: ${editingBom.name}`
          });
        }
        // Sortie de stock réelle
        await invoke("add_movement", {
          networkPath,
          trigramme,
          eventType: "STOCK_OUT",
          sku: item.sku,
          qty: item.qty,
          note: `Sortie projet: ${editingBom.name}`
        });
      }

      const updatedBom = { ...editingBom, status: "COMPLETED", updated_at: new Date().toISOString() };
      await invoke("save_bom", {
        networkPath,
        trigramme,
        bomId: updatedBom.id,
        name: updatedBom.name,
        status: updatedBom.status,
        equipmentNote: updatedBom.equipment_note || "",
        items: updatedBom.items
      });
      
      setEditingBom(null);
      setTimeout(fetchBoms, 1500);
    } catch (e) {
      alert("Erreur: " + e);
    }
  };

  const loadImage = (path: string): Promise<HTMLImageElement | null> => {
    return new Promise((resolve) => {
      if (!path) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = convertFileSrc(path);
    });
  };

  const getColumnValue = (item: BomItem, p: any, colId: string): any => {
    let vpcCode = "";
    let vpcName = "";
    try {
      const attrs = typeof p?.attributes === "string" ? JSON.parse(p.attributes) : p?.attributes;
      if (attrs?.vpc) {
        vpcCode = Object.values(attrs.vpc)[0] as string;
        vpcName = Object.keys(attrs.vpc)[0] as string;
      }
    } catch (e) {}
    const packSize = p?.pack_size || 1;
    const qteArrondie = Math.ceil(item.qty / packSize) * packSize;

    switch (colId) {
      case "checkbox": return "";
      case "sku": return item.sku;
      case "mpn": return p?.mpn || "";
      case "label": return p?.label || "Inconnu";
      case "brand": return p?.brand || "";
      case "category": return p?.category || "";
      case "sub_category": return p?.sub_category || "";
      case "location": return p?.location || "-";
      case "price": return p?.price !== undefined ? p.price : 0;
      case "current_stock": return p?.current_stock !== undefined ? p.current_stock : 0;
      case "min_stock": return p?.min_stock !== undefined ? p.min_stock : 0;
      case "pack_size": return packSize;
      case "note": return item.note || "-";
      case "qty": return item.qty;
      case "roundedQty": return qteArrondie;
      case "vpcCode": return vpcCode;
      case "vpcName": return vpcName;
      default: return "";
    }
  };

  const handleGeneratePdf = async () => {
    if (!editingBom) return;
    try {
      const doc = new jsPDF();
      
      const isMinimal = pdfMargin === "minimal";
      const startX = isMinimal ? 10 : 14;
      let startY = isMinimal ? 10 : 20;
      
      let logoImg = null;
      if (logoPath) {
        logoImg = await loadImage(logoPath);
      }
      
      if (logoImg) {
        const aspect = logoImg.width / logoImg.height;
        const logoHeight = isMinimal ? 12 : 16;
        const logoWidth = logoHeight * aspect;
        doc.addImage(logoImg, "PNG", startX, startY, logoWidth, logoHeight);
        startY += logoHeight + 5;
      }
      
      doc.setFontSize(16);
      doc.text(`Fiche Projet: ${editingBom.name}`, startX, startY);
      startY += 8;
      
      doc.setFontSize(11);
      doc.text(`Statut: ${editingBom.status}`, startX, startY);
      startY += 8;
      
      if (editingBom.equipment_note) {
        doc.setFontSize(11);
        doc.text(`Note / Equipement: ${editingBom.equipment_note}`, startX, startY);
        startY += 8;
      }
      
      const activeCols = pdfColumns.filter((c: any) => c.enabled);
      const headRow = activeCols.map((c: any) => c.label);
      
      // Sort items
      const sortedItems = [...editingBom.items].sort((a, b) => {
        const pA = products.find((prod: any) => prod.sku === a.sku);
        const pB = products.find((prod: any) => prod.sku === b.sku);
        
        let valA = "";
        let valB = "";
        
        if (pdfSortBy === "category") {
          valA = pA?.category || "";
          valB = pB?.category || "";
        } else if (pdfSortBy === "sub_category") {
          valA = pA?.sub_category || "";
          valB = pB?.sub_category || "";
        } else if (pdfSortBy === "location") {
          valA = pA?.location || "";
          valB = pB?.location || "";
        } else if (pdfSortBy === "sku") {
          valA = a.sku || "";
          valB = b.sku || "";
        } else if (pdfSortBy === "label") {
          valA = pA?.label || "";
          valB = pB?.label || "";
        } else {
          return 0;
        }
        
        const comp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        if (comp !== 0) return comp;
        return a.sku.localeCompare(b.sku);
      });

      const tableData: string[][] = [];
      let prevGroupVal = "";

      sortedItems.forEach((item, index) => {
        const p = products.find((prod: any) => prod.sku === item.sku);
        
        let currentGroupVal = "";
        if (pdfLineBreakBy === "category") {
          currentGroupVal = p?.category || "";
        } else if (pdfLineBreakBy === "sub_category") {
          currentGroupVal = p?.sub_category || "";
        } else if (pdfLineBreakBy === "location") {
          currentGroupVal = p?.location || "";
        }
        
        if (pdfLineBreakBy !== "none" && index > 0 && currentGroupVal !== prevGroupVal) {
          tableData.push(activeCols.map(() => ""));
        }
        
        const rowData = activeCols.map((col: any) => {
          const val = getColumnValue(item, p, col.id);
          return val === null || val === undefined ? "" : val.toString();
        });
        tableData.push(rowData);
        
        prevGroupVal = currentGroupVal;
      });

      autoTable(doc, {
        startY: startY + 4,
        margin: { top: isMinimal ? 10 : 15, left: startX, right: startX, bottom: isMinimal ? 10 : 15 },
        head: [headRow],
        body: tableData,
      });
      
      const pdfOutput = doc.output("arraybuffer");
      const bytes = new Uint8Array(pdfOutput);
      
      await invoke("save_file_dialog", {
        filename: `${editingBom.name}_Fiche.pdf`,
        contents: Array.from(bytes),
        filterName: "Fichier PDF (*.pdf)",
        filterExt: "pdf"
      });
    } catch (e) {
      alert("Erreur lors de la génération du PDF : " + e);
    }
  };

  const handleGenerateExcel = async () => {
    if (!editingBom) return;
    try {
      const activeCols = excelColumns.filter((c: any) => c.enabled);
      
      const data = editingBom.items.map(item => {
        const p = products.find((prod: any) => prod.sku === item.sku);
        const row: Record<string, any> = {};
        for (const col of activeCols) {
          row[col.label] = getColumnValue(item, p, col.id);
        }
        return row;
      });

      const worksheet = XLSX.utils.json_to_sheet(data);

      // Adjust column widths automatically based on longest content
      const colWidths = activeCols.map((col: any) => {
        const headerLen = col.label.length;
        const maxValLen = data.reduce((max, row) => {
          const val = row[col.label];
          const len = val !== null && val !== undefined ? val.toString().length : 0;
          return Math.max(max, len);
        }, headerLen);
        return { wch: Math.max(maxValLen + 3, 10) };
      });
      worksheet["!cols"] = colWidths;

      // Set view to show gridlines (lignes et colonnes délimitées par des lignes)
      worksheet["!views"] = [{ showGridLines: true }];

      // Apply thin borders to all cells and bold styling to header row
      const borderStyle = {
        top: { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left: { style: "thin", color: { rgb: "000000" } },
        right: { style: "thin", color: { rgb: "000000" } }
      };

      for (const key in worksheet) {
        if (!key.startsWith("!")) {
          const cell = worksheet[key];
          if (cell && typeof cell === "object") {
            cell.s = {
              border: borderStyle
            };
            const rowNumber = parseInt(key.replace(/[A-Z]/g, ""), 10);
            if (rowNumber === 1) {
              cell.s.font = { bold: true };
            }
          }
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Commande");
      
      const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const bytes = new Uint8Array(excelBuffer);

      await invoke("save_file_dialog", {
        filename: `${editingBom.name}_Commande.xlsx`,
        contents: Array.from(bytes),
        filterName: "Fichier Excel (*.xlsx)",
        filterExt: "xlsx"
      });
    } catch (e) {
      alert("Erreur lors de la génération du fichier Excel : " + e);
    }
  };

  const handleDragEndExcel = (event: any) => {
    const {active, over} = event;
    if (active.id !== over?.id && over) {
      setExcelColumns((items: any[]) => {
        const oldIndex = items.findIndex((i: any) => i.id === active.id);
        const newIndex = items.findIndex((i: any) => i.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem("sf_bom_excel_columns", JSON.stringify(newItems));
        return newItems;
      });
    }
  };

  const handleDragEndPdf = (event: any) => {
    const {active, over} = event;
    if (active.id !== over?.id && over) {
      setPdfColumns((items: any[]) => {
        const oldIndex = items.findIndex((i: any) => i.id === active.id);
        const newIndex = items.findIndex((i: any) => i.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem("sf_bom_pdf_columns", JSON.stringify(newItems));
        return newItems;
      });
    }
  };

  const moveExcelColumn = (index: number, direction: 'up' | 'down') => {
    const newCols = [...excelColumns];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < newCols.length) {
      const temp = newCols[index];
      newCols[index] = newCols[targetIndex];
      newCols[targetIndex] = temp;
      setExcelColumns(newCols);
      localStorage.setItem("sf_bom_excel_columns", JSON.stringify(newCols));
    }
  };

  const toggleExcelColumn = (index: number) => {
    const newCols = [...excelColumns];
    newCols[index].enabled = !newCols[index].enabled;
    setExcelColumns(newCols);
    localStorage.setItem("sf_bom_excel_columns", JSON.stringify(newCols));
  };

  const movePdfColumn = (index: number, direction: 'up' | 'down') => {
    const newCols = [...pdfColumns];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < newCols.length) {
      const temp = newCols[index];
      newCols[index] = newCols[targetIndex];
      newCols[targetIndex] = temp;
      setPdfColumns(newCols);
      localStorage.setItem("sf_bom_pdf_columns", JSON.stringify(newCols));
    }
  };

  const togglePdfColumn = (index: number) => {
    const newCols = [...pdfColumns];
    newCols[index].enabled = !newCols[index].enabled;
    setPdfColumns(newCols);
    localStorage.setItem("sf_bom_pdf_columns", JSON.stringify(newCols));
  };

  const handleDragEndTable = (event: any) => {
    const {active, over} = event;
    if (active.id !== over?.id && over) {
      setTableColumns((items: any[]) => {
        const oldIndex = items.findIndex((i: any) => i.id === active.id);
        const newIndex = items.findIndex((i: any) => i.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        localStorage.setItem("sf_bom_table_columns", JSON.stringify(newItems));
        return newItems;
      });
    }
  };

  const moveTableColumn = (index: number, direction: 'up' | 'down') => {
    const newCols = [...tableColumns];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < newCols.length) {
      const temp = newCols[index];
      newCols[index] = newCols[targetIndex];
      newCols[targetIndex] = temp;
      setTableColumns(newCols);
      localStorage.setItem("sf_bom_table_columns", JSON.stringify(newCols));
    }
  };

  const toggleTableColumn = (index: number) => {
    const newCols = [...tableColumns];
    newCols[index].enabled = !newCols[index].enabled;
    setTableColumns(newCols);
    localStorage.setItem("sf_bom_table_columns", JSON.stringify(newCols));
  };

  const handleMouseDownTable = (e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = tableColumns.find((c: any) => c.id === colId)?.width || 120;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(50, startWidth + deltaX);
      setTableColumns((prev: any[]) => {
        const next = prev.map(c => c.id === colId ? { ...c, width: newWidth } : c);
        localStorage.setItem("sf_bom_table_columns", JSON.stringify(next));
        return next;
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleDoubleClickTable = (colId: string) => {
    const col = tableColumns.find((c: any) => c.id === colId);
    if (!col || !editingBom) return;
    
    let maxCharLen = col.label.length;
    
    editingBom.items.forEach(item => {
      const p = products.find((prod: any) => prod.sku === item.sku);
      const val = getColumnValue(item, p, colId);
      const valStr = val === null || val === undefined ? "" : val.toString();
      if (valStr.length > maxCharLen) {
        maxCharLen = valStr.length;
      }
    });

    // 8.5px per character + 30px padding
    const autoWidth = Math.max(80, (maxCharLen * 8.5) + 30);
    
    setTableColumns((prev: any[]) => {
      const next = prev.map(c => c.id === colId ? { ...c, width: autoWidth } : c);
      localStorage.setItem("sf_bom_table_columns", JSON.stringify(next));
      return next;
    });
  };

  const handleSelectLogo = async () => {
    try {
      const file = await invoke<string | null>("select_image_file");
      if (file) {
        setLogoPath(file);
        localStorage.setItem("sf_bom_logo_path", file);
      }
    } catch (err) {
      alert("Erreur lors de la sélection du logo : " + err);
    }
  };

  const handleClearLogo = () => {
    setLogoPath("");
    localStorage.removeItem("sf_bom_logo_path");
  };

  const getExcelPreviewData = () => {
    if (!editingBom) return [];
    const activeCols = excelColumns.filter((c: any) => c.enabled);
    return editingBom.items.slice(0, 5).map(item => {
      const p = products.find((prod: any) => prod.sku === item.sku);
      return activeCols.map((col: any) => {
        const val = getColumnValue(item, p, col.id);
        return val === null || val === undefined ? "" : val;
      });
    });
  };

  const getPdfPreviewData = () => {
    if (!editingBom) return [];
    const activeCols = pdfColumns.filter((c: any) => c.enabled);
    
    // Sort items
    const sortedItems = [...editingBom.items].sort((a, b) => {
      const pA = products.find((prod: any) => prod.sku === a.sku);
      const pB = products.find((prod: any) => prod.sku === b.sku);
      
      let valA = "";
      let valB = "";
      
      if (pdfSortBy === "category") {
        valA = pA?.category || "";
        valB = pB?.category || "";
      } else if (pdfSortBy === "sub_category") {
        valA = pA?.sub_category || "";
        valB = pB?.sub_category || "";
      } else if (pdfSortBy === "location") {
        valA = pA?.location || "";
        valB = pB?.location || "";
      } else if (pdfSortBy === "sku") {
        valA = a.sku || "";
        valB = b.sku || "";
      } else if (pdfSortBy === "label") {
        valA = pA?.label || "";
        valB = pB?.label || "";
      } else {
        return 0;
      }
      
      const comp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      if (comp !== 0) return comp;
      return a.sku.localeCompare(b.sku);
    });

    const previewRows: string[][] = [];
    let prevGroupVal = "";

    // Show up to 10 items in the preview so group spacing is clearly visible
    const itemsToPreview = sortedItems.slice(0, 10);

    itemsToPreview.forEach((item, index) => {
      const p = products.find((prod: any) => prod.sku === item.sku);
      
      let currentGroupVal = "";
      if (pdfLineBreakBy === "category") {
        currentGroupVal = p?.category || "";
      } else if (pdfLineBreakBy === "sub_category") {
        currentGroupVal = p?.sub_category || "";
      } else if (pdfLineBreakBy === "location") {
        currentGroupVal = p?.location || "";
      }
      
      if (pdfLineBreakBy !== "none" && index > 0 && currentGroupVal !== prevGroupVal) {
        previewRows.push(activeCols.map(() => ""));
      }
      
      const rowData = activeCols.map((col: any) => {
        if (col.id === "checkbox") return "[ ]";
        const val = getColumnValue(item, p, col.id);
        return val === null || val === undefined ? "" : val.toString();
      });
      previewRows.push(rowData);
      
      prevGroupVal = currentGroupVal;
    });

    return previewRows;
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "DRAFT":
        return "stock-low";
      case "RESERVED":
        return "stock-ok";
      case "COMPLETED":
        return "status-online";
      default:
        return "";
    }
  };

  if (editingBom) {
    const isLocked = editingBom.status === "COMPLETED";
    
    return (
      <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <div>
          <button className="btn btn-secondary" onClick={() => setEditingBom(null)}>← Retour</button>
        </div>
        
        <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <input 
            value={editingBom.name} 
            onChange={e => setEditingBom({...editingBom, name: e.target.value})}
            disabled={isLocked}
            style={{ 
              fontSize: "1.6rem", 
              fontWeight: "bold",
              fontFamily: "var(--font-title)",
              backgroundColor: "var(--bg-tertiary)",
              border: isLocked ? "1px solid transparent" : "1px solid var(--border-color)",
              color: "var(--text-primary)",
              padding: "0.4rem 0.8rem",
              borderRadius: "8px",
              width: "auto",
              minWidth: "300px"
            }}
          />
          <span className={`stock-status-badge ${getStatusBadgeClass(editingBom.status)}`} style={{ fontSize: "12px", padding: "0.25rem 0.6rem" }}>
            Statut: {editingBom.status}
          </span>
          <span className="stock-status-badge status-online" style={{ fontSize: "12px", padding: "0.25rem 0.6rem" }}>
            Prix Total : {calculateProjectTotal(editingBom).toFixed(2)} €
          </span>
        </div>

        <div style={{ marginTop: "0.8rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <label style={{ fontSize: "0.85rem", fontWeight: "600", color: "var(--text-secondary)" }}>
            Note / Équipement machine (Saisie libre) :
          </label>
          <textarea
            value={editingBom.equipment_note || ""}
            onChange={e => setEditingBom({ ...editingBom, equipment_note: e.target.value })}
            disabled={isLocked}
            placeholder="Saisissez une note ou l'emplacement sur la machine (ex: Equipement n°3 sur Zone A)..."
            style={{
              width: "100%",
              maxWidth: "600px",
              height: "50px",
              fontSize: "0.85rem",
              padding: "0.4rem 0.6rem",
              borderRadius: "6px",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-color)",
              fontFamily: "var(--font-sans)",
              resize: "none"
            }}
          />
        </div>

        <div style={{ marginTop: "1.2rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {!isLocked && <button className="btn" onClick={() => setIsPickerOpen(true)}>➕ Ajouter des articles</button>}
          <button className="btn" onClick={handleSaveDraft} disabled={isLocked}>💾 Enregistrer</button>
          {editingBom.status === "DRAFT" && <button className="btn btn-secondary" onClick={handleReserve}>🔒 Réserver</button>}
          {editingBom.status !== "COMPLETED" && (
            <button 
              className="btn btn-secondary" 
              onClick={handleWithdraw} 
              style={{ borderColor: "var(--success)", color: "var(--success)" }}
            >
              ✅ Valider Sortie
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setIsPdfPreviewOpen(true)}>📄 PDF Atelier</button>
          <button className="btn btn-secondary" onClick={() => setIsExcelPreviewOpen(true)}>📊 Excel Achat</button>
          <button className="btn btn-secondary" onClick={() => setIsTableConfigOpen(true)}>⚙️ Affichage</button>
        </div>

        {(() => {
          if (!isPickerOpen) return null;

          const pickerCategories = ["all", ...Array.from(new Set(products.map((p: any) => p.category).filter(Boolean)))];
          const pickerSubCategories = ["all", ...Array.from(new Set(products
            .filter((p: any) => pickerCategoryFilter === "all" || p.category === pickerCategoryFilter)
            .map((p: any) => p.sub_category)
            .filter(Boolean)
          ))];

          const filteredPickerProducts = products.filter((p: any) => {
            const query = pickerSearchQuery.toLowerCase().trim();
            if (query) {
              const matchesSku = p.sku?.toLowerCase().includes(query);
              const matchesMpn = p.mpn?.toLowerCase().includes(query);
              const matchesBrand = p.brand?.toLowerCase().includes(query);
              const matchesLabel = p.label?.toLowerCase().includes(query);
              const matchesCategory = p.category?.toLowerCase().includes(query);
              const matchesSubCategory = p.sub_category?.toLowerCase().includes(query);
              if (!matchesSku && !matchesMpn && !matchesBrand && !matchesLabel && !matchesCategory && !matchesSubCategory) {
                return false;
              }
            }
            if (pickerCategoryFilter !== "all" && p.category !== pickerCategoryFilter) {
              return false;
            }
            if (pickerSubCategoryFilter !== "all" && p.sub_category !== pickerSubCategoryFilter) {
              return false;
            }
            return true;
          });

          return (
            <div className="modal-overlay" onClick={() => setIsPickerOpen(false)}>
              <div className="modal-container" onClick={e => e.stopPropagation()} style={{ width: "95vw", height: "90vh", maxWidth: "none" }}>
                <div className="modal-header">
                  <h3>Sélectionnez les articles</h3>
                  <button className="modal-close" onClick={() => setIsPickerOpen(false)}>×</button>
                </div>
                
                <div className="toolbar" style={{ borderBottom: "1px solid var(--border-color)", padding: "0.8rem 1rem", background: "var(--bg-secondary)", display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" }}>
                  <div className="search-bar" style={{ width: "280px" }}>
                    🔍
                    <input
                      type="text"
                      placeholder="Rechercher référence, marque, désignation..."
                      value={pickerSearchQuery}
                      onChange={(e) => setPickerSearchQuery(e.target.value)}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <label htmlFor="picker-cat-filter" style={{ fontWeight: "600" }}>Famille :</label>
                    <select
                      id="picker-cat-filter"
                      value={pickerCategoryFilter}
                      onChange={(e) => {
                        setPickerCategoryFilter(e.target.value);
                        setPickerSubCategoryFilter("all");
                      }}
                      style={{ width: "auto", padding: "0.3rem 0.6rem" }}
                    >
                      {pickerCategories.map((c: any, i: number) => (
                        <option key={i} value={c}>{c === "all" ? "Toutes" : c}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <label htmlFor="picker-subcat-filter" style={{ fontWeight: "600" }}>Sous-Famille :</label>
                    <select
                      id="picker-subcat-filter"
                      value={pickerSubCategoryFilter}
                      onChange={(e) => setPickerSubCategoryFilter(e.target.value)}
                      style={{ width: "auto", padding: "0.3rem 0.6rem" }}
                    >
                      {pickerSubCategories.map((sc: any, i: number) => (
                        <option key={i} value={sc}>{sc === "all" ? "Toutes" : sc}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="modal-body" style={{ padding: "0", overflow: "hidden", display: "flex", flexDirection: "row", flex: 1 }}>
                  {/* Left: Product selection table */}
                  <div style={{ flex: 1, overflow: "auto" }}>
                    {renderProductTable(filteredPickerProducts, true)}
                  </div>
                  
                  {/* Right: Selected items cart with quantities */}
                  <div style={{ width: "320px", borderLeft: "1px solid var(--border-color)", padding: "1rem", display: "flex", flexDirection: "column", background: "var(--bg-secondary)", overflowY: "auto" }}>
                    <h4 style={{ fontFamily: "var(--font-title)", marginBottom: "1rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.5rem", color: "var(--text-primary)" }}>
                      Articles sélectionnés ({selectedSkus.length})
                    </h4>
                    {selectedSkus.length === 0 ? (
                      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", marginTop: "2rem" }}>
                        Cochez des articles à gauche pour les ajouter.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                        {selectedSkus.map((sku: string) => {
                          const p = products.find((prod: any) => prod.sku === sku);
                          const currentQty = pickerQuantities[sku] !== undefined ? pickerQuantities[sku] : 1;
                          return (
                            <div key={sku} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", padding: "0.5rem", borderRadius: "6px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <span style={{ fontFamily: "var(--font-mono)", fontWeight: "600", fontSize: "0.8rem", color: "var(--text-primary)" }}>{sku}</span>
                                <button 
                                  className="btn btn-secondary" 
                                  onClick={() => setSelectedSkus(selectedSkus.filter((s: string) => s !== sku))}
                                  style={{ padding: "0.1rem 0.3rem", fontSize: "0.75rem", minHeight: "auto" }}
                                >
                                  ✕
                                </button>
                              </div>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {p?.label || "Article inconnu"}
                              </div>
                              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Qté :</label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={currentQty}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 1;
                                      setPickerQuantities({ ...pickerQuantities, [sku]: val });
                                    }}
                                    style={{ width: "55px", padding: "0.15rem", fontSize: "0.75rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                                  />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", flex: 1 }}>
                                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Note :</label>
                                  <input
                                    type="text"
                                    placeholder="ex: Moteur..."
                                    value={pickerNotes[sku] || ""}
                                    onChange={(e) => {
                                      setPickerNotes({ ...pickerNotes, [sku]: e.target.value });
                                    }}
                                    style={{ minWidth: "80px", flex: 1, padding: "0.15rem 0.3rem", fontSize: "0.75rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="modal-footer">
                  <button className="btn" onClick={() => {
                    const newItems = [...editingBom.items];
                    if (replacingSku) {
                      const idx = newItems.findIndex(i => i.sku === replacingSku);
                      if (idx !== -1 && selectedSkus.length > 0) {
                        const newSku = selectedSkus[0];
                        const newQty = pickerQuantities[newSku] !== undefined ? pickerQuantities[newSku] : newItems[idx].qty;
                        const newNote = pickerNotes[newSku] !== undefined ? pickerNotes[newSku] : (newItems[idx].note || "");
                        newItems[idx] = { sku: newSku, qty: newQty, note: newNote };
                      }
                      setReplacingSku(null);
                    } else {
                      for (const sku of selectedSkus) {
                        const qty = pickerQuantities[sku] !== undefined ? pickerQuantities[sku] : 1;
                        const note = pickerNotes[sku] || "";
                        const existingIndex = newItems.findIndex(i => i.sku === sku);
                        if (existingIndex !== -1) {
                          newItems[existingIndex].qty += qty;
                          if (note) newItems[existingIndex].note = note;
                        } else {
                          newItems.push({ sku, qty, note });
                        }
                      }
                    }
                    setEditingBom({ ...editingBom, items: newItems });
                    setSelectedSkus([]);
                    setPickerSearchQuery("");
                    setPickerNotes({});
                    setIsPickerOpen(false);
                  }}>Valider la sélection</button>
                  <button className="btn btn-secondary" onClick={() => {
                    setSelectedSkus([]);
                    setPickerSearchQuery("");
                    setPickerNotes({});
                    setReplacingSku(null);
                    setIsPickerOpen(false);
                  }}>Fermer</button>
                </div>
              </div>
            </div>
          );
        })()}

        {isTableConfigOpen && (
          <div className="modal-overlay" onClick={() => setIsTableConfigOpen(false)}>
            <div className="modal-container" onClick={e => e.stopPropagation()} style={{ width: "95vw", height: "80vh", maxWidth: "600px", display: "flex", flexDirection: "column" }}>
              <div className="modal-header">
                <h3>Options d'affichage de la Nomenclature</h3>
                <button className="modal-close" onClick={() => setIsTableConfigOpen(false)}>×</button>
              </div>
              <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "1.2rem", overflowY: "auto", padding: "1.5rem" }}>
                
                {/* Sorting Config */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)", fontSize: "0.95rem" }}>Trier par</h4>
                  <select
                    value={tableSortBy}
                    onChange={(e) => {
                      setTableSortBy(e.target.value);
                      localStorage.setItem("sf_bom_table_sort_by", e.target.value);
                    }}
                    style={{ width: "100%", padding: "0.4rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                  >
                    <option value="none">Aucun (Ordre d'ajout)</option>
                    <option value="sku">SKU</option>
                    <option value="label">Désignation</option>
                    <option value="location">Emplacement</option>
                    <option value="category">Famille</option>
                    <option value="sub_category">Sous-famille</option>
                  </select>
                </div>

                {/* Line Break Config */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)", fontSize: "0.95rem" }}>Sauter une ligne à chaque changement de</h4>
                  <select
                    value={tableLineBreakBy}
                    onChange={(e) => {
                      setTableLineBreakBy(e.target.value);
                      localStorage.setItem("sf_bom_table_line_break_by", e.target.value);
                    }}
                    style={{ width: "100%", padding: "0.4rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                  >
                    <option value="none">Aucun</option>
                    <option value="category">Famille</option>
                    <option value="sub_category">Sous-famille</option>
                    <option value="location">Emplacement</option>
                  </select>
                </div>

                {/* Columns Config */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)", fontSize: "0.95rem" }}>Colonnes du tableau</h4>
                  <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    Décochez pour masquer. Utilisez les flèches pour réordonner.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndTable}>
                      <SortableContext items={tableColumns.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
                        {tableColumns.map((col: any, index: number) => (
                          <SortableItem key={col.id} id={col.id}>
                            {(listeners: any, isDragging: boolean) => (
                              <div 
                                style={{ 
                                  display: "flex", 
                                  alignItems: "center", 
                                  justifyContent: "space-between", 
                                  padding: "0.35rem 0.5rem", 
                                  backgroundColor: isDragging ? "var(--bg-primary)" : "var(--bg-tertiary)", 
                                  borderRadius: "6px", 
                                  border: "1px solid var(--border-color)"
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <span 
                                    {...listeners}
                                    style={{ color: "var(--text-muted)", marginRight: "0.2rem", userSelect: "none", cursor: "grab" }}
                                  >☰</span>
                                  <input
                                    type="checkbox"
                                    checked={col.enabled}
                                    onChange={() => toggleTableColumn(index)}
                                    style={{ cursor: "pointer" }}
                                  />
                                  <input
                                    type="text"
                                    value={col.label}
                                    onChange={(e) => {
                                      const newCols = [...tableColumns];
                                      newCols[index].label = e.target.value;
                                      setTableColumns(newCols);
                                      localStorage.setItem("sf_bom_table_columns", JSON.stringify(newCols));
                                    }}
                                    title="Cliquez pour renommer"
                                    style={{ 
                                      fontSize: "0.85rem", 
                                      backgroundColor: "transparent", 
                                      color: "var(--text-primary)", 
                                      border: "none", 
                                      borderBottom: "1px dashed var(--border-color)", 
                                      padding: "0.1rem 0.2rem",
                                      width: "150px" 
                                    }}
                                  />
                                </div>
                                <div style={{ display: "flex", gap: "0.2rem" }}>
                                  <button
                                    className="btn btn-secondary"
                                    disabled={index === 0}
                                    onClick={() => moveTableColumn(index, 'up')}
                                    style={{ padding: "0.05rem 0.25rem", minHeight: "auto", fontSize: "0.7rem" }}
                                    title="Monter"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    disabled={index === tableColumns.length - 1}
                                    onClick={() => moveTableColumn(index, 'down')}
                                    style={{ padding: "0.05rem 0.25rem", minHeight: "auto", fontSize: "0.7rem" }}
                                    title="Descendre"
                                  >
                                    ▼
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    disabled={tableColumns.length <= 1}
                                    onClick={() => {
                                      const newCols = tableColumns.filter((c: any) => c.id !== col.id);
                                      setTableColumns(newCols);
                                      localStorage.setItem("sf_bom_table_columns", JSON.stringify(newCols));
                                    }}
                                    style={{ padding: "0.05rem 0.25rem", minHeight: "auto", fontSize: "0.7rem", color: "var(--danger)", borderColor: "var(--danger)" }}
                                    title="Supprimer"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )}
                          </SortableItem>
                        ))}
                      </SortableContext>
                    </DndContext>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                    <select
                      id="add-table-col-select"
                      style={{ flex: 1, padding: "0.3rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", fontSize: "0.85rem" }}
                    >
                      {Object.entries(ALL_AVAILABLE_COLUMNS)
                        .filter(([id]) => !tableColumns.some((c: any) => c.id === id))
                        .map(([id, name]) => (
                          <option key={id} value={id}>{name}</option>
                        ))}
                    </select>
                    <button
                      className="btn"
                      style={{ padding: "0.3rem 0.6rem", minHeight: "auto", fontSize: "0.85rem" }}
                      onClick={() => {
                        const selectEl = document.getElementById("add-table-col-select") as HTMLSelectElement;
                        if (selectEl && selectEl.value) {
                          const colId = selectEl.value;
                          const newCols = [...tableColumns, { id: colId, label: COLUMN_HEADERS[colId], enabled: true, width: 120 }];
                          setTableColumns(newCols);
                          localStorage.setItem("sf_bom_table_columns", JSON.stringify(newCols));
                        }
                      }}
                    >
                      ➕ Ajouter
                    </button>
                  </div>

                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: "1rem", width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                    onClick={() => {
                      const defaultTableCols = [
                        { id: "sku", label: "SKU", enabled: true, width: 120 },
                        { id: "label", label: "Désignation", enabled: true, width: 300 },
                        { id: "location", label: "Emplacement", enabled: true, width: 130 },
                        { id: "note", label: "Note article", enabled: true, width: 200 },
                        { id: "qty", label: "Qté Requise", enabled: true, width: 90 },
                        { id: "current_stock", label: "Stock Actuel", enabled: true, width: 100 },
                        { id: "pack_size", label: "Pack Size", enabled: true, width: 100 }
                      ];
                      setTableColumns(defaultTableCols);
                      localStorage.setItem("sf_bom_table_columns", JSON.stringify(defaultTableCols));
                    }}
                  >
                    🔄 Réinitialiser par défaut
                  </button>
                </div>

              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => setIsTableConfigOpen(false)}>
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="table-container" style={{ marginTop: "1.5rem", flex: 1, border: "1px solid var(--border-color)", borderRadius: "8px", overflow: "auto" }}>
          <table 
            className="spreadsheet" 
            style={{ 
              tableLayout: "fixed", 
              width: tableColumns.filter((c: any) => c.enabled).reduce((sum: number, c: any) => sum + (c.width || 120), 0) + (isLocked ? 0 : 80)
            }}
          >
            <thead>
              <tr>
                {tableColumns.filter((c: any) => c.enabled).map((col: any) => {
                  const width = `${col.width || 120}px`;
                  return (
                    <th 
                      key={col.id} 
                      style={{ 
                        width,
                        minWidth: width,
                        maxWidth: width,
                        position: "relative",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {col.label}
                      <div
                        className="column-resize-handle"
                        onMouseDown={(e) => handleMouseDownTable(e, col.id)}
                        onDoubleClick={() => handleDoubleClickTable(col.id)}
                      />
                    </th>
                  );
                })}
                {!isLocked && <th style={{ width: "80px", minWidth: "80px", maxWidth: "80px", position: "relative" }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Sort items
                const sortedItems = [...editingBom.items].sort((a, b) => {
                  const pA = products.find((prod: any) => prod.sku === a.sku);
                  const pB = products.find((prod: any) => prod.sku === b.sku);
                  
                  let valA = "";
                  let valB = "";
                  
                  if (tableSortBy === "category") {
                    valA = pA?.category || "";
                    valB = pB?.category || "";
                  } else if (tableSortBy === "sub_category") {
                    valA = pA?.sub_category || "";
                    valB = pB?.sub_category || "";
                  } else if (tableSortBy === "location") {
                    valA = pA?.location || "";
                    valB = pB?.location || "";
                  } else if (tableSortBy === "sku") {
                    valA = a.sku || "";
                    valB = b.sku || "";
                  } else if (tableSortBy === "label") {
                    valA = pA?.label || "";
                    valB = pB?.label || "";
                  } else {
                    return 0;
                  }
                  
                  const comp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                  if (comp !== 0) return comp;
                  return a.sku.localeCompare(b.sku);
                });

                const activeCols = tableColumns.filter((c: any) => c.enabled);
                const rows: React.ReactNode[] = [];
                let prevGroupVal = "";

                sortedItems.forEach((item, index) => {
                  const p = products.find((prod: any) => prod.sku === item.sku);
                  const hasSufficientStock = p ? p.current_stock >= item.qty : false;
                  
                  let currentGroupVal = "";
                  if (tableLineBreakBy === "category") {
                    currentGroupVal = p?.category || "";
                  } else if (tableLineBreakBy === "sub_category") {
                    currentGroupVal = p?.sub_category || "";
                  } else if (tableLineBreakBy === "location") {
                    currentGroupVal = p?.location || "";
                  }
                  
                  if (tableLineBreakBy !== "none" && index > 0 && currentGroupVal !== prevGroupVal) {
                    rows.push(
                      <tr 
                        key={`spacer-${item.sku}`} 
                        className="spacer-row" 
                        style={{ height: '1.25rem', backgroundColor: 'var(--bg-secondary)' }}
                      >
                        <td colSpan={activeCols.length + (isLocked ? 0 : 1)}></td>
                      </tr>
                    );
                  }

                  rows.push(
                    <tr key={item.sku} style={{ cursor: "default" }}>
                      {activeCols.map((col: any) => {
                        const cellWidth = `${col.width || 120}px`;
                        const cellStyle = {
                          width: cellWidth,
                          minWidth: cellWidth,
                          maxWidth: cellWidth,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap" as const
                        };
                        switch (col.id) {
                          case "sku":
                            return <td key="sku" style={{ ...cellStyle, fontFamily: "var(--font-mono)" }}>{item.sku}</td>;
                          case "label":
                            return <td key="label" style={cellStyle} title={p?.label}>{p?.label || <span style={{ color: "var(--text-muted)" }}>Article inconnu</span>}</td>;
                          case "location":
                            return <td key="location" style={cellStyle}>{p?.location || "-"}</td>;
                          case "note":
                            return (
                              <td key="note" style={cellStyle}>
                                <input
                                  type="text"
                                  value={item.note || ""}
                                  disabled={isLocked}
                                  placeholder="Note ou emplacement machine..."
                                  onChange={e => {
                                    const newItems = editingBom.items.map(i => i.sku === item.sku ? { ...i, note: e.target.value } : i);
                                    setEditingBom({ ...editingBom, items: newItems });
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "0.2rem 0.4rem",
                                    backgroundColor: "var(--bg-primary)",
                                    border: "1px solid var(--border-color)",
                                    color: "var(--text-primary)",
                                    borderRadius: "4px",
                                    fontSize: "0.8rem"
                                  }}
                                />
                              </td>
                            );
                          case "qty":
                            return (
                              <td key="qty" style={cellStyle}>
                                <input 
                                  type="number" 
                                  value={item.qty}
                                  disabled={isLocked}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    const newItems = editingBom.items.map(i => i.sku === item.sku ? { ...i, qty: val } : i);
                                    setEditingBom({ ...editingBom, items: newItems });
                                  }}
                                  style={{ 
                                    width: "100%", 
                                    padding: "0.2rem 0.4rem", 
                                    backgroundColor: "var(--bg-primary)",
                                    border: "1px solid var(--border-color)",
                                    color: "var(--text-primary)",
                                    borderRadius: "4px"
                                  }}
                                />
                              </td>
                            );
                          case "current_stock":
                            return (
                              <td key="current_stock" style={cellStyle}>
                                {p ? (
                                  <span className={`stock-status-badge ${hasSufficientStock ? "stock-ok" : "stock-empty"}`}>
                                    {p.current_stock}
                                  </span>
                                ) : "?"}
                              </td>
                            );
                          default: {
                            const val = getColumnValue(item, p, col.id);
                            const valStr = val === null || val === undefined ? "" : val.toString();
                            return <td key={col.id} style={cellStyle} title={valStr}>{valStr}</td>;
                          }
                        }
                      })}
                      {!isLocked && (
                        <td style={{ display: "flex", gap: "0.25rem", alignItems: "center", width: "80px", minWidth: "80px", maxWidth: "80px" }}>
                          <button 
                            className="btn btn-secondary" 
                            onClick={() => handleReplaceClick(item)}
                            title="Remplacer cette référence"
                            style={{ padding: "0.2rem 0.4rem", minHeight: "auto", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          >
                            🔄
                          </button>
                          <button 
                            className="btn btn-secondary" 
                            onClick={() => {
                              const newItems = editingBom.items.filter(i => i.sku !== item.sku);
                              setEditingBom({ ...editingBom, items: newItems });
                            }}
                            title="Supprimer"
                            style={{ padding: "0.2rem 0.4rem", minHeight: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ❌
                          </button>
                        </td>
                      )}
                    </tr>
                  );

                  prevGroupVal = currentGroupVal;
                });

                if (rows.length === 0) {
                  return (
                    <tr>
                      <td colSpan={activeCols.length + (isLocked ? 0 : 1)} style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)" }}>
                        Aucun article ajouté. Cliquez sur "Ajouter des articles" pour commencer.
                      </td>
                    </tr>
                  );
                }

                return rows;
              })()}
            </tbody>
          </table>
        </div>

        {isExcelPreviewOpen && (
          <div className="modal-overlay" onClick={() => setIsExcelPreviewOpen(false)}>
            <div className="modal-container" onClick={e => e.stopPropagation()} style={{ width: "95vw", height: "85vh", maxWidth: "1600px", display: "flex", flexDirection: "column" }}>
              <div className="modal-header">
                <h3>Aperçu et personnalisation Excel (Achat)</h3>
                <button className="modal-close" onClick={() => setIsExcelPreviewOpen(false)}>×</button>
              </div>
              <div className="modal-body" style={{ display: "flex", flexDirection: "row", flex: 1, overflow: "hidden", padding: "1rem", gap: "1.5rem" }}>
                {/* Left side: config */}
                <div style={{ width: "350px", display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto", borderRight: "1px solid var(--border-color)", paddingRight: "1.5rem" }}>
                  <h4 style={{ margin: 0, color: "var(--text-primary)" }}>Colonnes à exporter</h4>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    Décochez pour masquer. Utilisez les flèches pour réordonner.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndExcel}>
                      <SortableContext items={excelColumns.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
                        {excelColumns.map((col: any, index: number) => (
                          <SortableItem key={col.id} id={col.id}>
                            {(listeners: any, isDragging: boolean) => (
                              <div 
                                style={{ 
                                  display: "flex", 
                                  alignItems: "center", 
                                  justifyContent: "space-between", 
                                  padding: "0.4rem 0.6rem", 
                                  backgroundColor: isDragging ? "var(--bg-primary)" : "var(--bg-tertiary)", 
                                  borderRadius: "6px", 
                                  border: "1px solid var(--border-color)"
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <span 
                                    {...listeners}
                                    style={{ color: "var(--text-muted)", marginRight: "0.2rem", userSelect: "none", cursor: "grab" }}
                                  >☰</span>
                                  <input
                                    type="checkbox"
                                    checked={col.enabled}
                                    onChange={() => toggleExcelColumn(index)}
                                    style={{ cursor: "pointer" }}
                                  />
                                  <input
                                    type="text"
                                    value={col.label}
                                    onChange={(e) => {
                                      const newCols = [...excelColumns];
                                      newCols[index].label = e.target.value;
                                      setExcelColumns(newCols);
                                      localStorage.setItem("sf_bom_excel_columns", JSON.stringify(newCols));
                                    }}
                                    title="Cliquez pour renommer"
                                    style={{ 
                                      fontSize: "0.85rem", 
                                      backgroundColor: "transparent", 
                                      color: "var(--text-primary)", 
                                      border: "none", 
                                      borderBottom: "1px dashed var(--border-color)", 
                                      padding: "0.1rem 0.2rem",
                                      width: "150px" 
                                    }}
                                  />
                                </div>
                                <div style={{ display: "flex", gap: "0.2rem" }}>
                                  <button
                                    className="btn btn-secondary"
                                    disabled={index === 0}
                                    onClick={() => moveExcelColumn(index, 'up')}
                                    style={{ padding: "0.1rem 0.3rem", minHeight: "auto", fontSize: "0.75rem" }}
                                    title="Monter"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    disabled={index === excelColumns.length - 1}
                                    onClick={() => moveExcelColumn(index, 'down')}
                                    style={{ padding: "0.1rem 0.3rem", minHeight: "auto", fontSize: "0.75rem" }}
                                    title="Descendre"
                                  >
                                    ▼
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    disabled={excelColumns.length <= 1}
                                    onClick={() => {
                                      const newCols = excelColumns.filter((c: any) => c.id !== col.id);
                                      setExcelColumns(newCols);
                                      localStorage.setItem("sf_bom_excel_columns", JSON.stringify(newCols));
                                    }}
                                    style={{ padding: "0.1rem 0.3rem", minHeight: "auto", fontSize: "0.75rem", color: "var(--danger)", borderColor: "var(--danger)" }}
                                    title="Supprimer"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )}
                          </SortableItem>
                        ))}
                      </SortableContext>
                    </DndContext>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                    <select
                      id="add-excel-col-select"
                      style={{ flex: 1, padding: "0.3rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", fontSize: "0.85rem" }}
                    >
                      {Object.entries(ALL_AVAILABLE_COLUMNS)
                        .filter(([id]) => !excelColumns.some((c: any) => c.id === id))
                        .map(([id, name]) => (
                          <option key={id} value={id}>{name}</option>
                        ))}
                    </select>
                    <button
                      className="btn"
                      style={{ padding: "0.3rem 0.6rem", minHeight: "auto", fontSize: "0.85rem" }}
                      onClick={() => {
                        const selectEl = document.getElementById("add-excel-col-select") as HTMLSelectElement;
                        if (selectEl && selectEl.value) {
                          const colId = selectEl.value;
                          const newCols = [...excelColumns, { id: colId, label: COLUMN_HEADERS[colId], enabled: true }];
                          setExcelColumns(newCols);
                          localStorage.setItem("sf_bom_excel_columns", JSON.stringify(newCols));
                        }
                      }}
                    >
                      ➕ Ajouter
                    </button>
                  </div>

                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: "1rem", width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                    onClick={() => {
                      const defaultExcelCols = [
                        { id: "vpcCode", label: "Code VPC", enabled: true },
                        { id: "mpn", label: "MPN", enabled: true },
                        { id: "label", label: "Désignation", enabled: true },
                        { id: "category", label: "Famille", enabled: true },
                        { id: "sub_category", label: "Sous-famille", enabled: true },
                        { id: "note", label: "Note article", enabled: true },
                        { id: "qty", label: "Qté Nette", enabled: true },
                        { id: "roundedQty", label: "Qté à Commander (Arrondie)", enabled: true }
                      ];
                      setExcelColumns(defaultExcelCols);
                      localStorage.setItem("sf_bom_excel_columns", JSON.stringify(defaultExcelCols));
                    }}
                  >
                    🔄 Réinitialiser par défaut
                  </button>
                </div>

                {/* Right side: Live Preview */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)" }}>Aperçu des données (5 premières lignes)</h4>
                  <div className="table-container" style={{ flex: 1, border: "1px solid var(--border-color)", borderRadius: "8px", overflow: "auto" }}>
                    <table className="spreadsheet" style={{ width: "100%", fontSize: "0.85rem" }}>
                      <thead>
                        <tr>
                          {excelColumns.filter((c: any) => c.enabled).map((col: any) => (
                            <th key={col.id}>{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {getExcelPreviewData().map((row: any, rIdx: number) => (
                          <tr key={rIdx}>
                            {row.map((val: any, cIdx: number) => (
                              <td key={cIdx}>{val}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => {
                  handleGenerateExcel();
                  setIsExcelPreviewOpen(false);
                }}>
                  📥 Exporter en Excel
                </button>
                <button className="btn btn-secondary" onClick={() => setIsExcelPreviewOpen(false)}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {isPdfPreviewOpen && (
          <div className="modal-overlay" onClick={() => setIsPdfPreviewOpen(false)}>
            <div className="modal-container" onClick={e => e.stopPropagation()} style={{ width: "95vw", height: "85vh", maxWidth: "1600px", display: "flex", flexDirection: "column" }}>
              <div className="modal-header">
                <h3>Aperçu et personnalisation PDF (Atelier)</h3>
                <button className="modal-close" onClick={() => setIsPdfPreviewOpen(false)}>×</button>
              </div>
              <div className="modal-body" style={{ display: "flex", flexDirection: "row", flex: 1, overflow: "hidden", padding: "1rem", gap: "1.5rem" }}>
                {/* Left side: config */}
                <div style={{ width: "380px", display: "flex", flexDirection: "column", gap: "1.2rem", overflowY: "auto", borderRight: "1px solid var(--border-color)", paddingRight: "1.5rem" }}>
                  
                  {/* Logo Config */}
                  <div>
                    <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)", fontSize: "0.95rem" }}>Logo de l'en-tête</h4>
                    {logoPath ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0.5rem", border: "1px solid var(--border-color)", borderRadius: "6px", backgroundColor: "var(--bg-tertiary)" }}>
                        <img 
                          src={convertFileSrc(logoPath)} 
                          alt="Logo entreprise" 
                          style={{ maxHeight: "60px", maxWidth: "100%", objectFit: "contain", alignSelf: "center", borderRadius: "4px" }} 
                        />
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", wordBreak: "break-all" }}>{logoPath}</div>
                        <button className="btn btn-secondary" onClick={handleClearLogo} style={{ width: "100%", minHeight: "auto", padding: "0.25rem", color: "var(--danger)", borderColor: "var(--danger)" }}>
                          Supprimer le logo
                        </button>
                      </div>
                    ) : (
                      <button className="btn" onClick={handleSelectLogo} style={{ width: "100%", padding: "0.4rem" }}>
                        📁 Sélectionner un logo
                      </button>
                    )}
                  </div>

                  {/* Margins Config */}
                  <div>
                    <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)", fontSize: "0.95rem" }}>Marges du document</h4>
                    <select
                      value={pdfMargin}
                      onChange={(e) => {
                        setPdfMargin(e.target.value);
                        localStorage.setItem("sf_bom_pdf_margin", e.target.value);
                      }}
                      style={{ width: "100%", padding: "0.4rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    >
                      <option value="default">Standard (14 mm / 20 mm)</option>
                      <option value="minimal">Minimales (10 mm)</option>
                    </select>
                  </div>

                  {/* Sorting Config */}
                  <div>
                    <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)", fontSize: "0.95rem" }}>Trier par</h4>
                    <select
                      value={pdfSortBy}
                      onChange={(e) => {
                        setPdfSortBy(e.target.value);
                        localStorage.setItem("sf_bom_pdf_sort_by", e.target.value);
                      }}
                      style={{ width: "100%", padding: "0.4rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    >
                      <option value="none">Aucun (Ordre d'ajout)</option>
                      <option value="sku">SKU</option>
                      <option value="label">Désignation</option>
                      <option value="location">Emplacement</option>
                      <option value="category">Famille</option>
                      <option value="sub_category">Sous-famille</option>
                    </select>
                  </div>

                  {/* Line Break Config */}
                  <div>
                    <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)", fontSize: "0.95rem" }}>Sauter une ligne à chaque changement de</h4>
                    <select
                      value={pdfLineBreakBy}
                      onChange={(e) => {
                        setPdfLineBreakBy(e.target.value);
                        localStorage.setItem("sf_bom_pdf_line_break_by", e.target.value);
                      }}
                      style={{ width: "100%", padding: "0.4rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    >
                      <option value="none">Aucun</option>
                      <option value="category">Famille</option>
                      <option value="sub_category">Sous-famille</option>
                      <option value="location">Emplacement</option>
                    </select>
                  </div>

                  {/* Columns Config */}
                  <div>
                    <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)", fontSize: "0.95rem" }}>Colonnes du tableau</h4>
                    <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Décochez pour masquer. Utilisez les flèches pour réordonner.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndPdf}>
                        <SortableContext items={pdfColumns.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
                          {pdfColumns.map((col: any, index: number) => (
                            <SortableItem key={col.id} id={col.id}>
                              {(listeners: any, isDragging: boolean) => (
                                <div 
                                  style={{ 
                                    display: "flex", 
                                    alignItems: "center", 
                                    justifyContent: "space-between", 
                                    padding: "0.35rem 0.5rem", 
                                    backgroundColor: isDragging ? "var(--bg-primary)" : "var(--bg-tertiary)", 
                                    borderRadius: "6px", 
                                    border: "1px solid var(--border-color)"
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                    <span 
                                      {...listeners}
                                      style={{ color: "var(--text-muted)", marginRight: "0.2rem", userSelect: "none", cursor: "grab" }}
                                    >☰</span>
                                    <input
                                      type="checkbox"
                                      checked={col.enabled}
                                      onChange={() => togglePdfColumn(index)}
                                      style={{ cursor: "pointer" }}
                                    />
                                    <input
                                      type="text"
                                      value={col.label}
                                      onChange={(e) => {
                                        const newCols = [...pdfColumns];
                                        newCols[index].label = e.target.value;
                                        setPdfColumns(newCols);
                                        localStorage.setItem("sf_bom_pdf_columns", JSON.stringify(newCols));
                                      }}
                                      title="Cliquez pour renommer"
                                      style={{ 
                                        fontSize: "0.85rem", 
                                        backgroundColor: "transparent", 
                                        color: "var(--text-primary)", 
                                        border: "none", 
                                        borderBottom: "1px dashed var(--border-color)", 
                                        padding: "0.1rem 0.2rem",
                                        width: "150px" 
                                      }}
                                    />
                                  </div>
                                  <div style={{ display: "flex", gap: "0.2rem" }}>
                                    <button
                                      className="btn btn-secondary"
                                      disabled={index === 0}
                                      onClick={() => movePdfColumn(index, 'up')}
                                      style={{ padding: "0.05rem 0.25rem", minHeight: "auto", fontSize: "0.7rem" }}
                                      title="Monter"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      className="btn btn-secondary"
                                      disabled={index === pdfColumns.length - 1}
                                      onClick={() => movePdfColumn(index, 'down')}
                                      style={{ padding: "0.05rem 0.25rem", minHeight: "auto", fontSize: "0.7rem" }}
                                      title="Descendre"
                                    >
                                      ▼
                                    </button>
                                    <button
                                      className="btn btn-secondary"
                                      disabled={pdfColumns.length <= 1}
                                      onClick={() => {
                                        const newCols = pdfColumns.filter((c: any) => c.id !== col.id);
                                        setPdfColumns(newCols);
                                        localStorage.setItem("sf_bom_pdf_columns", JSON.stringify(newCols));
                                      }}
                                      style={{ padding: "0.05rem 0.25rem", minHeight: "auto", fontSize: "0.7rem", color: "var(--danger)", borderColor: "var(--danger)" }}
                                      title="Supprimer"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              )}
                            </SortableItem>
                          ))}
                        </SortableContext>
                      </DndContext>
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                      <select
                        id="add-pdf-col-select"
                        style={{ flex: 1, padding: "0.3rem", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", fontSize: "0.85rem" }}
                      >
                        {Object.entries(ALL_AVAILABLE_COLUMNS)
                          .filter(([id]) => !pdfColumns.some((c: any) => c.id === id))
                          .map(([id, name]) => (
                            <option key={id} value={id}>{name}</option>
                          ))}
                      </select>
                      <button
                        className="btn"
                        style={{ padding: "0.3rem 0.6rem", minHeight: "auto", fontSize: "0.85rem" }}
                        onClick={() => {
                          const selectEl = document.getElementById("add-pdf-col-select") as HTMLSelectElement;
                          if (selectEl && selectEl.value) {
                            const colId = selectEl.value;
                            const newCols = [...pdfColumns, { id: colId, label: COLUMN_HEADERS[colId], enabled: true }];
                            setPdfColumns(newCols);
                            localStorage.setItem("sf_bom_pdf_columns", JSON.stringify(newCols));
                          }
                        }}
                      >
                        ➕ Ajouter
                      </button>
                    </div>

                    <button
                      className="btn btn-secondary"
                      style={{ marginTop: "1rem", width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                      onClick={() => {
                        const defaultPdfCols = [
                          { id: "checkbox", label: "[ ]", enabled: true },
                          { id: "sku", label: "SKU", enabled: true },
                          { id: "label", label: "Désignation", enabled: true },
                          { id: "location", label: "Emplacement", enabled: true },
                          { id: "note", label: "Note", enabled: true },
                          { id: "qty", label: "Qté", enabled: true }
                        ];
                        setPdfColumns(defaultPdfCols);
                        localStorage.setItem("sf_bom_pdf_columns", JSON.stringify(defaultPdfCols));
                      }}
                    >
                      🔄 Réinitialiser par défaut
                    </button>
                  </div>

                </div>

                {/* Right side: Live Preview */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-primary)" }}>Aperçu PDF (En-tête et tableau)</h4>
                  <div style={{ 
                    flex: 1, 
                    border: "1px solid var(--border-color)", 
                    borderRadius: "8px", 
                    backgroundColor: "var(--bg-tertiary)", 
                    padding: pdfMargin === "minimal" ? "10px" : "20px", 
                    overflowY: "auto",
                    boxShadow: "inset 0 0 10px rgba(0,0,0,0.1)",
                    display: "flex",
                    flexDirection: "column"
                  }}>
                    {/* Header preview */}
                    <div style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "1rem", marginBottom: "1rem" }}>
                      {logoPath && (
                        <div style={{ marginBottom: "0.5rem" }}>
                          <img 
                            src={convertFileSrc(logoPath)} 
                            alt="Logo preview" 
                            style={{ maxHeight: pdfMargin === "minimal" ? "35px" : "50px", maxWidth: "200px", objectFit: "contain" }} 
                          />
                        </div>
                      )}
                      <h3 style={{ margin: "0.5rem 0", color: "var(--text-primary)", fontSize: "1.3rem" }}>Fiche Projet: {editingBom.name}</h3>
                      <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Statut: {editingBom.status}</div>
                      {editingBom.equipment_note && (
                        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                          <strong>Note / Équipement:</strong> {editingBom.equipment_note}
                        </div>
                      )}
                    </div>

                    {/* Table preview */}
                    <div style={{ flex: 1, overflowX: "auto" }}>
                      <table className="spreadsheet" style={{ width: "100%", fontSize: "0.8rem" }}>
                        <thead>
                          <tr>
                            {pdfColumns.filter((c: any) => c.enabled).map((col: any) => (
                              <th key={col.id}>{col.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {getPdfPreviewData().map((row: any, rIdx: number) => (
                            <tr key={rIdx}>
                              {row.map((val: any, cIdx: number) => (
                                <td key={cIdx}>{val}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

              </div>
              <div className="modal-footer">
                <button className="btn" onClick={() => {
                  handleGeneratePdf();
                  setIsPdfPreviewOpen(false);
                }}>
                  📥 Exporter en PDF
                </button>
                <button className="btn btn-secondary" onClick={() => setIsPdfPreviewOpen(false)}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-title)", fontSize: "1.8rem", fontWeight: "700", color: "var(--text-primary)" }}>Nomenclatures & Projets</h1>
        <button className="btn" onClick={handleCreateNew}>➕ Nouveau Projet</button>
      </div>

      <div className="table-container" style={{ flex: 1, border: "1px solid var(--border-color)", borderRadius: "8px" }}>
        <table className="spreadsheet" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: "35%" }}>Nom du Projet</th>
              <th style={{ width: "15%" }}>Statut</th>
              <th style={{ width: "20%" }}>Dernière Modif</th>
              <th style={{ width: "15%" }}>Prix Total</th>
              <th style={{ width: "15%" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {boms.map(bom => {
              const totalVal = calculateProjectTotal(bom);
              return (
                <tr key={bom.id} onClick={(e) => {
                  if ((e.target as HTMLElement).tagName !== "BUTTON" && !(e.target as HTMLElement).closest("button")) {
                    setEditingBom(bom);
                  }
                }}>
                  <td style={{ fontWeight: "600", color: "var(--text-primary)" }}>{bom.name}</td>
                  <td>
                    <span className={`stock-status-badge ${getStatusBadgeClass(bom.status)}`}>
                      {bom.status}
                    </span>
                  </td>
                  <td>{new Date(bom.updated_at).toLocaleString()}</td>
                  <td style={{ fontWeight: "600", color: "var(--text-primary)" }}>{totalVal.toFixed(2)} €</td>
                  <td>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => handleDuplicate(bom)}
                      style={{ padding: "0.2rem 0.6rem", minHeight: "auto" }}
                    >
                      👯 Dupliquer
                    </button>
                  </td>
                </tr>
              );
            })}
            {boms.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)" }}>
                  Aucune nomenclature existante.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

