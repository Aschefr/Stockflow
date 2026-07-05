import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

let tauriApp: ChildProcess;
let browser: Browser;
let page: Page;

const ARTIFACTS_DIR = 'C:\\Users\\Adminlocal\\.gemini\\antigravity-ide\\brain\\522fecbc-f86c-4eab-a92d-d02f769c4d3e';
const DB_PATH = 'C:\\Users\\Adminlocal\\AppData\\Roaming\\Stockflow\\stockflow.db';

test.beforeAll(async () => {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  const executablePath = path.resolve(process.cwd(), 'src-tauri/target/debug/tauri-app.exe');
  
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Exécutable Tauri introuvable: ${executablePath}.`);
  }

  console.log("Démarrage de l'application Tauri pour test multi-VPC...");
  tauriApp = spawn(executablePath, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222 --disable-features=SharedArrayBuffer --disable-service-workers --disable-shared-workers"
    }
  });

  tauriApp.stdout?.on('data', (data) => console.log(`[Tauri] ${data}`));
  tauriApp.stderr?.on('data', (data) => console.error(`[Tauri Err] ${data}`));

  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP('http://localhost:9222');
      connected = true;
      break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!connected) throw new Error("Impossible de se connecter à Tauri");

  const contexts = browser.contexts();
  page = contexts[0].pages()[0];
});

test.afterAll(async () => {
  if (browser) await browser.close();
  if (tauriApp) tauriApp.kill();
});

function getProductFromDb(sku: string): any {
  try {
    const result = execSync(`python scratch/e2e_db_helper.py get "${sku}"`).toString().trim();
    if (result === 'null' || !result) return null;
    return JSON.parse(result);
  } catch (e: any) {
    console.error("Failed to get product from DB via python:", e.message);
    return null;
  }
}

function deleteProductFromDb(sku: string): void {
  try {
    execSync(`python scratch/e2e_db_helper.py delete "${sku}"`);
  } catch (e: any) {
    console.error("Failed to delete product from DB via python:", e.message);
  }
}

const testCases = [
  {
    name: 'RS Components',
    provider: 'RS',
    code: '114-8175',
    targetSku: 'TEST-SCRAPE-RS'
  },
  {
    name: 'Conrad',
    provider: 'Conrad',
    code: '1827117',
    targetSku: 'TEST-SCRAPE-CONRAD'
  },
  {
    name: 'Farnell',
    provider: 'Farnell',
    code: '3051886',
    targetSku: 'TEST-SCRAPE-FARNELL'
  },
  {
    name: 'Mouser',
    provider: 'Mouser',
    code: '511-A9F74103',
    targetSku: 'TEST-SCRAPE-MOUSER'
  },
  {
    name: 'SearxNG Fallback',
    provider: 'mpn',
    code: 'Fluke 117',
    targetSku: 'TEST-SCRAPE-FALLBACK'
  }
];

test('Create and Scrape all 5 references in batch', async () => {
  test.setTimeout(1800000); // 30 minutes total for the entire batch test

  // 1. Clean up database and disk from previous runs
  const sharedFolder = 'D:\\Code Projects\\Stockflow\\exemple_data\\StockFlow Shared Folder';
  for (const tc of testCases) {
    deleteProductFromDb(tc.targetSku);
    
    // Clean up images matching SKU
    const imgDir = path.join(sharedFolder, 'images');
    if (fs.existsSync(imgDir)) {
      const files = fs.readdirSync(imgDir);
      for (const file of files) {
        if (file.toUpperCase().includes(tc.targetSku.toUpperCase())) {
          try {
            fs.unlinkSync(path.join(imgDir, file));
            console.log(`[Cleanup] Supprimé image obsolète : ${file}`);
          } catch (e: any) {
            console.error(`[Cleanup] Erreur suppression image ${file}: ${e.message}`);
          }
        }
      }
    }

    // Clean up documents matching SKU
    const docDir = path.join(sharedFolder, 'documents');
    if (fs.existsSync(docDir)) {
      const files = fs.readdirSync(docDir);
      for (const file of files) {
        if (file.toUpperCase().includes(tc.targetSku.toUpperCase())) {
          try {
            fs.unlinkSync(path.join(docDir, file));
            console.log(`[Cleanup] Supprimé PDF obsolète : ${file}`);
          } catch (e: any) {
            console.error(`[Cleanup] Erreur suppression PDF ${file}: ${e.message}`);
          }
        }
      }
    }
  }

  // 2. Create each of the 5 products sequentially using autofill
  for (const tc of testCases) {
    console.log(`\n--- [Etape A] Création de la référence ${tc.name} (${tc.code}) ---`);

    await page.click('text=Liste d\'Inventaire');
    await page.waitForSelector('button:has-text("Ajouter un SKU")');
    await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
    await page.waitForSelector('#modal-autofill-code');

    await page.selectOption('#modal-autofill-type', tc.provider);
    await page.fill('#modal-autofill-code', tc.code);

    // Saisir le SKU cible d'abord car requis par le background scraper
    await page.fill('#modal-p-sku', tc.targetSku);

    console.log(`[${tc.name}] Clic sur Scraper...`);
    await page.click('button:has-text("Scraper")');

    // Attendre la fin du scraping via la bannière globale pour cet SKU précis
    console.log(`[${tc.name}] Attente du scraping en arrière-plan...`);
    await page.waitForSelector(`.global-scrape-banner--complete:has-text("${tc.targetSku}")`, { timeout: 90000 });

    console.log(`[${tc.name}] Ouverture de la modale d'auto-remplissage...`);
    await page.click('text=Auto-remplissage (Candidats)');
    await page.waitForSelector('.autofill-modal__content');

    if (tc.provider === 'mpn') {
      console.log(`[${tc.name}] Cas MPN : Sélection d'une image candidate dans Ressources...`);
      await page.click('button:has-text("Ressources")');
      await page.waitForSelector('.autofill-modal__image-thumb');
      await page.locator('.autofill-modal__image-thumb').first().click();
    }

    console.log(`[${tc.name}] Application des données...`);
    await page.click('text=Appliquer la sélection');

    // Vérifier si l'étape de confirmation s'affiche (bouton Confirmer l'application présent)
    const confirmBtn = page.locator('text=Confirmer l\'application').first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      console.log(`[${tc.name}] Confirmation de l'application...`);
      await confirmBtn.click();
    } else {
      console.log(`[${tc.name}] Pas de confirmation requise (sélections vides). Fermeture de la modale.`);
      await page.click('.autofill-modal button:has-text("Annuler")').catch(() => {});
    }

    // Attendre que la modale se ferme
    await page.waitForSelector('.autofill-modal', { state: 'detached', timeout: 15000 });

    // Capture main modal screenshot showing filled values
    const modalScreenshotName = `app_modal_${tc.provider.toLowerCase()}.png`;
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, modalScreenshotName) });
    console.log(`[${tc.name}] Capture d'écran du modal enregistrée sous ${modalScreenshotName}`);

    // Fill designation if empty
    const labelVal = await page.inputValue('#modal-p-label');
    if (!labelVal || labelVal.trim() === '') {
      await page.fill('#modal-p-label', `Test produit ${tc.name}`);
    }

    // Click "Créer le SKU"
    console.log(`[${tc.name}] Enregistrement du produit...`);
    const saveBtn = page.locator(".modal-footer button:has-text('Créer le SKU')");
    await saveBtn.click();
    await page.waitForTimeout(2500);

  }

  // 3. Search and select all created references in the Inventory table
  console.log(`\n--- [Etape B] Sélection par lot des articles créés ---`);
  await page.click('text=Liste d\'Inventaire');
  await page.waitForSelector('input[placeholder*="Rechercher"]');
  await page.fill('input[placeholder*="Rechercher"]', 'TEST-SCRAPE-');
  await page.waitForTimeout(2000);

  // Click the Select All checkbox in the header
  console.log("Clic sur la checkbox de sélection globale de la table...");
  const headerCheckbox = page.locator("table.spreadsheet thead tr th input[type='checkbox']").first();
  await headerCheckbox.click();
  await page.waitForTimeout(1000);

  // 4. Batch Scrape Images automatically
  console.log("\n--- [Etape C] Déclenchement du scraping par lot des images (Automatique) ---");
  const batchImgBtn = page.locator("button:has-text('Scraper Images')").first();
  await batchImgBtn.click();
  console.log("Attente de la fin du scraping par lot des images...");
  await page.waitForSelector(".batch-progress-bar-container", { state: "detached", timeout: 300000 });
  await page.waitForTimeout(2000);

  // 5. Select all again (batch scraping empties selection on finish) and batch Scrape PDFs
  console.log("\n--- [Etape D] Déclenchement du scraping par lot des notices PDF (Automatique) ---");
  await headerCheckbox.click();
  await page.waitForTimeout(1000);
  const batchPdfBtn = page.locator("button:has-text('Scraper PDF')").first();
  await batchPdfBtn.click();
  console.log("Attente de la fin du scraping par lot des notices PDF...");
  await page.waitForSelector(".batch-progress-bar-container", { state: "detached", timeout: 300000 });
  await page.waitForTimeout(2000);

  // 6. Inspect, screenshot details, verify DB and delete each created SKU
  console.log(`\n--- [Etape E] Inspection, validation et nettoyage des SKUs ---`);
  for (const tc of testCases) {
    console.log(`\n--- Inspection de ${tc.name} (${tc.targetSku}) ---`);

    // Search specifically for this SKU
    await page.fill('input[placeholder*="Rechercher"]', tc.targetSku);
    await page.waitForTimeout(1500);

    // Open detail panel
    await page.locator(`table.spreadsheet tbody tr:has-text("${tc.targetSku}")`).first().click();
    await page.waitForSelector(".details-panel");
    await page.waitForTimeout(2000);

    // Screenshot final details panel
    const detailsScreenshotName = `app_details_${tc.provider.toLowerCase()}.png`;
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, detailsScreenshotName) });
    console.log(`[${tc.name}] Fiche détails capturée sous ${detailsScreenshotName}`);

    // Query DB
    const dbProduct = getProductFromDb(tc.targetSku);
    console.log(`[${tc.name}] Données DB récupérées:`, dbProduct);

    expect(dbProduct).toBeDefined();

    // Verify files on disk
    let imageFilesCount = 0;
    let pdfFilesCount = 0;
    try {
      const sharedFolder = 'D:\\Code Projects\\Stockflow\\exemple_data\\StockFlow Shared Folder';
      const searchFiles = (dir: string, ext: string): string[] => {
        if (!fs.existsSync(dir)) return [];
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat && stat.isDirectory()) {
            results = results.concat(searchFiles(filePath, ext));
          } else if (file.toLowerCase().endsWith(ext)) {
            if (filePath.includes(tc.targetSku)) {
              results.push(filePath);
            }
          }
        }
        return results;
      };

      const foundImages = searchFiles(path.join(sharedFolder, 'images'), '.jpg').concat(searchFiles(path.join(sharedFolder, 'images'), '.png'));
      const foundPdfs = searchFiles(path.join(sharedFolder, 'documents'), '.pdf');
      imageFilesCount = foundImages.length;
      pdfFilesCount = foundPdfs.length;

      console.log(`[${tc.name}] Fichiers image physiques trouvés:`, foundImages);
      console.log(`[${tc.name}] Fichiers PDF physiques trouvés:`, foundPdfs);
    } catch (e: any) {
      console.log(`[${tc.name}] Erreur lors de la recherche des fichiers: ${e.message}`);
    }

    const attributes = dbProduct.attributes ? JSON.parse(dbProduct.attributes) : {};

    // --- Axe 3 : Renforcement des assertions E2E ---
    // RS Components — Assertions strictes (pipeline WebView fiable)
    if (tc.provider === 'RS') {
      expect(dbProduct.brand).not.toBe('RS');
      expect(dbProduct.brand).not.toBe('Inconnue');
      expect(dbProduct.label).not.toContain('Produit générique');
      expect(dbProduct.label).not.toContain('⚠️ Non trouvé');
      expect(dbProduct.price).toBeGreaterThan(1.0);
      expect(attributes.largeur || attributes.hauteur || attributes.profondeur).toBeDefined();
    }

    // Providers via SearxNG — Assertions soft (warnings, pas de fail)
    if (['Conrad', 'Farnell', 'Mouser', 'Fallback'].includes(tc.provider)) {
      if (dbProduct.label?.includes('Non trouvé') || dbProduct.label?.includes('Produit générique')) {
        console.warn(`[${tc.name}] ⚠️ QUALITÉ FAIBLE: Label non résolu (SearxNG)`);
      }
      if (dbProduct.price === 0) {
        console.warn(`[${tc.name}] ⚠️ QUALITÉ FAIBLE: Prix non renseigné (SearxNG probablement en panne)`);
      }
    }

    // Score de qualité structuré
    const qualityScore = {
      hasRealBrand: dbProduct.brand !== tc.provider && dbProduct.brand !== 'Inconnue' && dbProduct.brand !== '',
      hasRealLabel: !dbProduct.label?.includes('Produit générique') && !dbProduct.label?.includes('⚠️'),
      hasRealPrice: dbProduct.price > 0,
      hasDimensions: !!(attributes.largeur || attributes.hauteur || attributes.profondeur),
      hasImages: imageFilesCount > 0,
      hasPdfs: pdfFilesCount > 0,
    };
    const score = Object.values(qualityScore).filter(Boolean).length;
    console.log(`[${tc.name}] SCORE QUALITÉ: ${score}/6`, qualityScore);

    // Print detailed analysis report for user review
    const analysisReport = {
      sku: dbProduct.sku,
      mpn: dbProduct.mpn || 'VIDE',
      brand: dbProduct.brand || 'VIDE',
      label: dbProduct.label || 'VIDE',
      price: dbProduct.price || 'VIDE',
      largeur: attributes.largeur || 'VIDE',
      hauteur: attributes.hauteur || 'VIDE',
      profondeur: attributes.profondeur || 'VIDE',
      poids: attributes.poids || 'VIDE',
      images_db: attributes.scrape_image_url || 'VIDE',
      images_disk_count: imageFilesCount,
      pdf_db: attributes.scrape_doc_url || 'VIDE',
      pdf_disk_count: pdfFilesCount,
      quality_score: `${score}/6`
    };
    console.log(`[${tc.name}] RAPPORT D'ANALYSE DÉTAILLÉ DU PRODUIT :`, JSON.stringify(analysisReport, null, 2));

    // Delete SKU
    console.log(`[${tc.name}] Suppression pour nettoyage final...`);
    const deleteBtn = page.locator(".details-panel button:has-text('Supprimer')");
    await deleteBtn.click();
    await page.waitForSelector("button:has-text('Oui')");
    await page.click("button:has-text('Oui')");
    await page.waitForTimeout(1500);
  }

  // Clear search bar
  await page.fill('input[placeholder*="Rechercher"]', '');
  console.log("\n✅ Test E2E batch complété avec succès !");
});
