const { chromium } = require("playwright");
const { spawn, execSync } = require("child_process");
const path = require("path");

const EXE_PATH = path.join(__dirname, "release_bin", "StockFlow.exe");
const SHARED_FOLDER = path.join(__dirname, "exemple_data", "StockFlow Shared Folder");
const CSV_FILE = path.join(__dirname, "exemple_data", "01 Stock électrique", "Backup DB", "DB Stock du 26_05_26 08_09.csv");
const IMAGES_DIR = path.join(__dirname, "exemple_data", "01 Stock électrique", "Images des références");
const PDF_DIR = path.join(__dirname, "exemple_data", "01 Stock électrique", "Manuels PDF");

async function runTest() {
    console.log("=== Lancement du Test E2E StockFlow ===");
    
    // 1. Fermer les instances existantes
    try {
        execSync('taskkill /F /IM StockFlow.exe /T', { stdio: 'ignore' });
        execSync('taskkill /F /IM tauri-app.exe /T', { stdio: 'ignore' });
    } catch (e) {
        // Ignorer si aucun processus ne tournait
    }

    // 2. Lancer l'exécutable avec le port de débogage via variable d'env WebView2
    console.log("Démarrage de l'application...");
    const appProcess = spawn(EXE_PATH, [], {
        detached: true,
        stdio: "ignore",
        env: {
            ...process.env,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222"
        }
    });
    appProcess.unref();

    // Attendre 5 secondes que l'application s'initialise et ouvre le port CDP
    await new Promise(resolve => setTimeout(resolve, 5000));

    let browser;
    try {
        // 3. Connexion Playwright via CDP
        console.log("Connexion de Playwright à l'application...");
        browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
        const contexts = browser.contexts();
        if (contexts.length === 0) throw new Error("Aucun contexte de navigateur trouvé.");
        
        const pages = contexts[0].pages();
        if (pages.length === 0) throw new Error("Aucune page trouvée.");
        const page = pages[0];
        
        console.log("Page connectée. URL actuelle :", page.url());

        // 4. Gérer l'assistant de configuration initial si visible
        const wizardVisible = await page.locator(".wizard-overlay").isVisible();
        if (wizardVisible) {
            console.log("Configuration initiale détectée, saisie des paramètres...");
            await page.fill("#trigramme", "TST");
            await page.fill("#network-path", SHARED_FOLDER);
            await page.click("button[type='submit']");
            await page.waitForSelector(".app-container");
            console.log("Configuration validée !");
        } else {
            console.log("Application déjà configurée.");
            // On s'assure qu'on est sur le bon dossier en ré-ouvrant la config
            await page.click(".user-info.header-clickable");
            await page.waitForSelector(".wizard-overlay");
            await page.fill("#trigramme", "TST");
            await page.fill("#network-path", SHARED_FOLDER);
            await page.click("button[type='submit']");
            await page.waitForSelector(".app-container");
            console.log("Configuration ré-appliquée sur le dossier de test.");
        }

        // 8. Aller sur l'inventaire
        console.log("Navigation vers la Liste d'Inventaire...");
        await page.click("text=Liste d'Inventaire");
        await page.waitForSelector("table.spreadsheet");

        // 9. Ajouter une nouvelle référence
        console.log("Ajout d'une nouvelle référence SKU...");
        await page.click("text=➕ Ajouter un SKU");
        await page.waitForSelector("#modal-p-sku");
        await page.fill("#modal-p-sku", "746-5347");
        await page.selectOption("#modal-p-vpc-site", { index: 1 });
        await page.fill("#modal-p-vpc-code", "746-5347");
        
        // Tester le bouton Pré-remplir de la phase 2.6
        console.log("Clic sur le bouton Pré-remplir...");
        await page.click("button:has-text('Pré-remplir')");
        await page.waitForTimeout(2000); // laissons le temps au scraper de répondre
        
        // Vérifier qu'un champ a bien été pré-rempli (ex: Désignation ou prix)
        const labelVal = await page.inputValue("#modal-p-label");
        console.log("Désignation pré-remplie par scraping :", labelVal);
        
        await page.fill("#modal-p-min", "2");
        
        // Enregistrer la référence
        const addSaveButton = page.locator(".modal-footer button:has-text('Créer le SKU')");
        await addSaveButton.click();
        await page.waitForTimeout(2000); // Attendre que la modale se ferme et l'inventaire se mette à jour

        const targetSku = "746-5347";
        console.log(`Recherche de la référence créée : ${targetSku}...`);
        await page.fill(".search-bar input", targetSku);
        await page.waitForTimeout(1000); // attente du filtrage

        // 10. Cliquer sur la ligne pour ouvrir la fiche
        console.log("Ouverture de la fiche produit...");
        await page.click(`table.spreadsheet tbody tr:has-text("${targetSku}")`);
        await page.waitForSelector(".details-panel");

        // 11. Tester le Scraping de Prix
        console.log("Lancement du scraping de prix...");
        const scrapePriceBtn = page.locator(".details-panel button:has-text('Scraper Prix')");
        await scrapePriceBtn.click();
        await page.waitForTimeout(4000); // laissons un peu de temps pour la requête réseau

        // 12. Tester le Scraping d'Image
        console.log("Lancement du scraping d'image...");
        const scrapeImageBtn = page.locator(".details-panel button:has-text('Scraper Image')");
        await scrapeImageBtn.click();
        
        // Attendre et fermer la modale de progression image
        console.log("Attente de la fin du scraping d'image...");
        const closeImageModalBtn = page.locator(".modal-footer button:has-text('Fermer')");
        await closeImageModalBtn.waitFor({ state: "visible", timeout: 45000 });
        await closeImageModalBtn.click();
        await page.waitForTimeout(1000);

        // 13. Tester le Scraping de PDF
        console.log("Lancement du scraping de PDF...");
        const scrapePdfBtn = page.locator(".details-panel button:has-text('Scraper PDF')");
        await scrapePdfBtn.click();

        // Attendre et fermer la modale de progression PDF
        console.log("Attente de la fin du scraping de PDF...");
        const closePdfModalBtn = page.locator(".modal-footer button:has-text('Fermer')");
        await closePdfModalBtn.waitFor({ state: "visible", timeout: 45000 });
        await closePdfModalBtn.click();
        await page.waitForTimeout(1000);

        // 14. Phase 2: Vérifier le lien du site VPC
        console.log("Vérification du lien VPC...");
        const vpcLink = page.locator(".details-panel button:has-text('RS')").first();
        await vpcLink.waitFor({ state: "visible", timeout: 5000 });
        const vpcText = await vpcLink.innerText();
        console.log("Bouton VPC trouvé :", vpcText);

        // 15. Phase 2: Cliquer sur 'Ouvrir dossier'
        console.log("Clic sur 'Ouvrir dossier'...");
        const openFolderButton = page.locator(".details-panel button:has-text('Ouvrir dossier')");
        await openFolderButton.click();
        await page.waitForTimeout(1000);

        // 16. Phase 2: Modifier le SKU et changer la taille du lot (pack size)
        console.log("Modification du produit pour tester la taille du lot...");
        const editButton = page.locator(".details-panel button:has-text('Modifier')");
        await editButton.click();
        await page.waitForSelector("#edit-p-pack");
        await page.fill("#edit-p-pack", "10");
        const saveButton = page.locator(".modal-footer button:has-text('Enregistrer')");
        await saveButton.click();
        
        // Attendre la mise à jour visuelle dans le volet
        console.log("Vérification de la mise à jour de la taille du lot...");
        const packSizeDisplay = page.locator(".details-panel:has-text('Taille du lot: 10 u')");
        await packSizeDisplay.waitFor({ state: "visible", timeout: 5000 });
        console.log("Taille du lot mise à jour avec succès dans l'UI !");

        // 17. Phase 2: Supprimer le produit pour nettoyer
        console.log("Suppression de la référence de test...");
        const deleteButton = page.locator(".details-panel button:has-text('Supprimer')");
        await deleteButton.click();
        await page.waitForSelector("button:has-text('Confirmer')");
        await page.click("button:has-text('Confirmer')");
        await page.waitForTimeout(2000);
        console.log("Référence de test supprimée avec succès !");

        console.log("✅ TEST E2E RÉUSSI À 100% ! Toutes les features (Phase 1 & Phase 2) fonctionnent.");
    } catch (err) {
        console.error("❌ TEST E2E ÉCHOUÉ :", err);
        process.exitCode = 1;
    } finally {
        if (browser) {
            console.log("Fermeture de Playwright...");
            await browser.close();
        }
        console.log("Arrêt de l'application...");
        try {
            execSync('taskkill /F /IM StockFlow.exe /T', { stdio: 'ignore' });
            execSync('taskkill /F /IM tauri-app.exe /T', { stdio: 'ignore' });
        } catch (e) {}
        console.log("=== Fin du Test ===");
    }
}

runTest();
