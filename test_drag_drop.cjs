const { chromium } = require("playwright");
const { spawn, execSync } = require("child_process");
const path = require("path");

const EXE_PATH = path.join(__dirname, "release_bin", "StockFlow.exe");

async function runDragDropTest() {
    console.log("=== Lancement du Test Dédié Drag & Drop ===");
    
    // 1. Fermer les instances existantes
    try {
        execSync('taskkill /F /IM StockFlow.exe /T', { stdio: 'ignore' });
        execSync('taskkill /F /IM tauri-app.exe /T', { stdio: 'ignore' });
    } catch (e) {
        // Ignorer si aucun processus ne tournait
    }

    // 2. Lancer l'exécutable avec le port de débogage
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

    // Attendre que l'application s'initialise
    await new Promise(resolve => setTimeout(resolve, 5000));

    let browser;
    try {
        console.log("Connexion de Playwright à l'application...");
        browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
        const contexts = browser.contexts();
        if (contexts.length === 0) throw new Error("Aucun contexte de navigateur trouvé.");
        
        const pages = contexts[0].pages();
        if (pages.length === 0) throw new Error("Aucune page trouvée.");
        const page = pages[0];
        
        console.log("Page connectée. URL actuelle :", page.url());

        // Navigation vers la section Projets & Nomenclatures
        console.log("Navigation vers la section Projets & Nomenclatures...");
        await page.click(".sidebar .nav-item:has-text('Projets')");
        await page.waitForTimeout(1000);

        // Cliquer sur Nouveau Projet
        console.log("Création d'une nouvelle nomenclature...");
        await page.click("button:has-text('Nouveau Projet')");
        await page.waitForTimeout(1000);

        // Ouvrir la modale d'export Excel
        console.log("Ouverture du modal de personnalisation Excel...");
        await page.click("button:has-text('Excel Achat')");
        await page.waitForSelector(".modal-body span:has-text('☰')");

        const handles = page.locator(".modal-body span:has-text('☰')");
        const inputs = page.locator(".modal-body input[type='text'][title='Cliquez pour renommer']");
        const headers = page.locator(".modal-container table.spreadsheet thead th");
        
        const col0_before = await inputs.nth(0).inputValue();
        const col1_before = await inputs.nth(1).inputValue();
        const head0_before = await headers.nth(0).innerText();
        const head1_before = await headers.nth(1).innerText();
        console.log(`Colonnes config avant drag-and-drop: 1: ${col0_before}, 2: ${col1_before}`);
        console.log(`En-têtes de l'aperçu avant drag-and-drop: 1: ${head0_before}, 2: ${head1_before}`);
        
        // Simuler le drag and drop
        console.log("Exécution du glisser-déposer sur les deux premières colonnes...");
        await handles.nth(0).hover();
        await page.mouse.down();
        await page.waitForTimeout(200);
        
        // Déplacer la souris sur la deuxième poignée
        await handles.nth(1).hover();
        await page.waitForTimeout(200);
        await page.mouse.up();
        await page.waitForTimeout(1000);
        
        const col0_after = await inputs.nth(0).inputValue();
        const col1_after = await inputs.nth(1).inputValue();
        const head0_after = await headers.nth(0).innerText();
        const head1_after = await headers.nth(1).innerText();
        console.log(`Colonnes config après drag-and-drop: 1: ${col0_after}, 2: ${col1_after}`);
        console.log(`En-têtes de l'aperçu après drag-and-drop: 1: ${head0_after}, 2: ${head1_after}`);
        
        if (col0_before === col0_after) {
            throw new Error("ÉCHEC : Les colonnes de configuration n'ont pas été réordonnées par le drag-and-drop !");
        }
        if (head0_before === head0_after) {
            throw new Error("ÉCHEC : Les colonnes de l'aperçu en direct n'ont pas été réordonnées par le drag-and-drop !");
        }
        
        console.log("✔️ RÉUSSITE : Le drag-and-drop des colonnes (config + aperçu en direct) fonctionne parfaitement !");
        
        // Fermer la modale
        await page.click(".modal-header button.modal-close");
        await page.waitForTimeout(500);
        // Retourner à la liste
        await page.click("button:has-text('Retour')");
        await page.waitForTimeout(500);

    } catch (err) {
        console.error("❌ TEST DRAG-AND-DROP ÉCHOUÉ :", err);
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

runDragDropTest();
