import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

let tauriApp: ChildProcess;
let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  const executablePath = path.resolve(process.cwd(), 'src-tauri/target/debug/tauri-app.exe');
  
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Exécutable Tauri introuvable: ${executablePath}.`);
  }

  console.log("Démarrage de l'application Tauri pour capture sidebar...");
  tauriApp = spawn(executablePath, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222"
    }
  });

  // Attendre que le port s'ouvre
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

test('Capture WebView Scraping depuis la Sidebar', async () => {
  // Navigation
  await page.click('text=Liste d\'Inventaire');
  await page.waitForSelector('button:has-text("Ajouter un SKU")');
  
  // Vérifier si le SKU existe déjà, sinon le créer
  const hasSku = await page.locator('tr', { hasText: '0828772' }).count() > 0;
  if (!hasSku) {
    console.log("Le SKU 0828772 n'est pas présent en DB. Création...");
    await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
    await page.waitForSelector('#modal-p-sku');
    await page.fill('#modal-p-sku', '0828772');
    await page.fill('#modal-p-label', 'Phoenix US-WMTB 29x5.5');
    await page.selectOption('#modal-p-vpc-site', 'RS');
    await page.fill('#modal-p-vpc-code', '803-8700');
    await page.click('text=Créer le SKU');
    await new Promise(r => setTimeout(r, 2000));
  }

  // Cliquer sur le SKU dans le tableau pour l'afficher dans la sidebar
  console.log("Sélection du SKU 0828772...");
  await page.locator('tr', { hasText: '0828772' }).first().click();
  await page.waitForSelector('text=Sources de scraping :');

  // Enregistrer les écouteurs de console sur le contexte pour intercepter les erreurs WebView
  browser.contexts()[0].on('page', p => {
    p.on('console', msg => console.log(`[WebView Console] ${msg.text()}`));
    p.on('pageerror', err => console.log(`[WebView Error] ${err.message}`));
  });

  // Déclencher le scraping de prix depuis la sidebar
  console.log("Déclenchement du scrap de prix depuis la sidebar...");
  await page.click('text=Scraper Prix');

  // 1. Attente courte pour voir la page de recherche initiale
  console.log("Attente de 2.5 secondes pour capture de la page de recherche...");
  await new Promise(r => setTimeout(r, 2500));
  
  let contexts = browser.contexts();
  let pages = contexts[0].pages();
  for (const p of pages) {
    const url = p.url();
    if (url.includes('rs-online.com') || url.includes('rsdelivers')) {
      const pathSearch = 'C:\\Users\\Adminlocal\\.gemini\\antigravity-ide\\brain\\522fecbc-f86c-4eab-a92d-d02f769c4d3e\\webview_search_page.png';
      try {
        await p.screenshot({ path: pathSearch, fullPage: true });
        console.log(`[Capture] Page de recherche sauvegardée sous : ${pathSearch}`);
      } catch (e) {}
    }
  }

  // 2. Attente de la redirection et du chargement de la page produit
  console.log("Attente de 4 secondes supplémentaires pour capture de la page produit redirigée...");
  await new Promise(r => setTimeout(r, 4000));

  contexts = browser.contexts();
  pages = contexts[0].pages();
  for (const p of pages) {
    const url = p.url();
    if (url.includes('rs-online.com') || url.includes('rsdelivers')) {
      console.log(`Retrait du flou et de l'overlay pour observation...`);
      try {
        await p.evaluate(() => {
          const overlay = document.getElementById('sf-scrape-overlay');
          if (overlay) overlay.remove();
          const style = document.getElementById('sf-scrape-style');
          if (style) style.remove();
          document.querySelectorAll('body > :not(#sf-scrape-overlay)').forEach((el: any) => {
            el.style.filter = 'none';
            el.style.pointerEvents = 'auto';
          });
          document.body.style.filter = 'none';
        });
      } catch (e) {}

      const pathProd = 'C:\\Users\\Adminlocal\\.gemini\\antigravity-ide\\brain\\522fecbc-f86c-4eab-a92d-d02f769c4d3e\\webview_product_page.png';
      try {
        await p.screenshot({ path: pathProd, fullPage: true });
        console.log(`[Capture] Page produit sauvegardée sous : ${pathProd}`);
      } catch (e) {}
    }
  }

  // 3. Attente et capture du modal de choix du prix sur la fenêtre principale
  console.log("Attente de l'apparition du modal de choix du prix (.price-candidate-item)...");
  await page.waitForSelector('.price-candidate-item', { timeout: 15000 });

  const pathModal = 'C:\\Users\\Adminlocal\\.gemini\\antigravity-ide\\brain\\522fecbc-f86c-4eab-a92d-d02f769c4d3e\\main_price_modal.png';
  await page.screenshot({ path: pathModal });
  console.log(`[Capture] Fenêtre principale avec modal de choix de prix sauvegardée sous : ${pathModal}`);

  // 4. Sélectionner le premier candidat de prix pour valider
  console.log("Sélection du premier candidat de prix dans le modal...");
  await page.click('.price-candidate-item');

  // 5. Attendre la validation et capture finale
  console.log("Attente de 6 secondes pour observer l'enregistrement final et le retour à l'état initial...");
  await new Promise(r => setTimeout(r, 6000));

  const pathFinal = 'C:\\Users\\Adminlocal\\.gemini\\antigravity-ide\\brain\\522fecbc-f86c-4eab-a92d-d02f769c4d3e\\main_updated_price.png';
  await page.screenshot({ path: pathFinal });
  console.log(`[Capture] Fenêtre principale finale avec prix mis à jour sauvegardée sous : ${pathFinal}`);
});
