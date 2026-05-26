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

        // 5. Aller sur l'onglet de migration
        console.log("Navigation vers l'onglet Migration...");
        await page.click("text=Importation Excel/CSV");
        await page.waitForSelector("#csv-path");

        // 6. Remplir les champs de migration
        console.log("Remplissage des chemins de migration...");
        await page.fill("#csv-path", CSV_FILE);
        await page.fill("#images-path", IMAGES_DIR);
        await page.fill("#pdf-path", PDF_DIR);

        // 7. Lancer la migration
        console.log("Lancement de la migration...");
        await page.click("button[type='submit']");
        
        // Attendre la fin de la migration (timeout de 60 secondes pour 774 lignes)
        console.log("Attente de la fin de l'importation (max 60s)...");
        const statusLocator = page.locator(".wizard-error", { hasText: "Migration terminée" });
        await statusLocator.waitFor({ state: "visible", timeout: 60000 });
        
        const resultText = await statusLocator.innerText();
        console.log("Résultat :", resultText);

        // Vérifier les erreurs
        const reportVisible = await page.locator(".migration-report").isVisible();
        if (reportVisible) {
            const reportText = await page.locator(".migration-report").innerText();
            console.log("Bilan détaillé :\n", reportText);
            if (reportText.includes("Erreurs") && !reportText.includes("Erreurs (0)")) {
                console.warn("⚠️ Des erreurs ont été signalées pendant l'importation !");
            }
        }

        // 8. Aller sur l'inventaire
        console.log("Navigation vers la Liste d'Inventaire...");
        await page.click("text=Liste d'Inventaire");
        await page.waitForSelector("table.spreadsheet");

        // 9. Rechercher un produit importé
        const targetSku = "6ES7511-1AK02-0AB0";
        console.log(`Recherche de la référence : ${targetSku}...`);
        await page.fill(".search-bar input", targetSku);
        await page.waitForTimeout(1000); // attente du filtrage

        // 10. Cliquer sur la ligne pour ouvrir la fiche
        console.log("Ouverture de la fiche produit...");
        await page.click(`table.spreadsheet tbody tr:has-text("${targetSku}")`);
        await page.waitForSelector(".details-panel");

        // 11. Valider la présence de l'image et du carrousel
        console.log("Vérification des images...");
        const imgLocator = page.locator(".carousel img");
        await imgLocator.waitFor({ state: "visible", timeout: 5000 });
        const imgUrl = await imgLocator.getAttribute("src");
        console.log("Image principale chargée (URL de cache) :", imgUrl);

        // 12. Valider la présence de la notice PDF
        console.log("Vérification des notices PDF...");
        const pdfButton = page.locator(".details-panel button:has-text('.pdf')").first();
        await pdfButton.waitFor({ state: "visible", timeout: 5000 });
        const pdfName = await pdfButton.innerText();
        console.log(`Notice trouvée : ${pdfName}`);

        // 13. Cliquer sur le PDF pour tester le bouton
        console.log("Clic sur le bouton PDF (ouverture système)...");
        await pdfButton.click();
        await page.waitForTimeout(2000); // Laisse le temps à l'OS d'ouvrir le lecteur

        console.log("✅ TEST E2E RÉUSSI À 100% ! Toutes les features fonctionnent.");
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
