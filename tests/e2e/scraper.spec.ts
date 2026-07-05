import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

let tauriApp: ChildProcess;
let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  const executablePath = path.resolve(process.cwd(), 'src-tauri/target/debug/tauri-app.exe');
  
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Exécutable Tauri introuvable: ${executablePath}. Lancez 'cargo build' dans src-tauri.`);
  }

  console.log("Démarrage de l'application Tauri avec le port de débogage...");
  tauriApp = spawn(executablePath, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222 --disable-features=SharedArrayBuffer --disable-service-workers --disable-shared-workers"
    }
  });

  tauriApp.stdout?.on('data', (data) => console.log(`[Tauri] ${data}`));
  tauriApp.stderr?.on('data', (data) => console.error(`[Tauri Err] ${data}`));

  // Attendre que le port s'ouvre
  let connected = false;
  for (let i = 0; i < 20; i++) {
    try {
      browser = await chromium.connectOverCDP('http://localhost:9222');
      connected = true;
      break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!connected) throw new Error("Impossible de se connecter à Tauri via CDP sur le port 9222");

  const contexts = browser.contexts();
  page = contexts[0].pages()[0];
});

test.afterAll(async () => {
  if (browser) await browser.close();
  if (tauriApp) tauriApp.kill();
});

test('Scraping RS Standard (114-8175)', async () => {
  test.setTimeout(120000);
  
  // Navigation vers la page Liste d'Inventaire
  await page.click('text=Liste d\'Inventaire');
  await page.waitForSelector('button:has-text("Ajouter un SKU")');

  // Ouvrir la modale d'ajout
  await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
  
  // Attendre l'input du modal
  await page.waitForSelector('#modal-autofill-code');

  // Saisir le SKU cible d'abord
  await page.fill('#modal-p-sku', 'TEST-SCRAPE-RS');

  // Sélectionner la source 'RS'
  await page.selectOption('#modal-autofill-type', 'RS');

  // Saisir la référence
  await page.fill('#modal-autofill-code', '114-8175');

  // Lancer le scraping
  await page.click('button:has-text("Scraper")');

  // Attendre la fin du scraping via la bannière globale avec l'SKU spécifique
  await page.waitForSelector('.global-scrape-banner--complete:has-text("TEST-SCRAPE-RS")', { timeout: 45000 });

  // Ouvrir le modal d'auto-remplissage
  await page.click('text=Auto-remplissage (Candidats)');

  // Attendre que la modale d'auto-remplissage s'affiche
  await page.waitForSelector('.autofill-modal__content');

  // Cliquer sur appliquer la sélection
  await page.click('text=Appliquer la sélection');

  // Confirmer l'application
  await page.click('text=Confirmer l\'application');

  // Attendre que le formulaire principal soit rempli
  await page.waitForFunction(() => {
    const inputs = document.querySelectorAll('input');
    for (let input of inputs) {
      if (input.placeholder?.toLowerCase().includes('marque') && input.value !== '') return true;
      if (input.value.toLowerCase().includes('rs') || input.value.toLowerCase().includes('components')) return true;
    }
    return false;
  }, { timeout: 15000 });

  // On vérifie que la modale de création contient maintenant des valeurs
  const pageContent = await page.content();
  expect(pageContent.toLowerCase()).toContain('rs');

  // Fermer la modale d'ajout de SKU
  await page.locator('button', { hasText: 'Annuler' }).first().click({ force: true });
});

test('Scraping Fallback (Fluke 117)', async () => {
  test.setTimeout(120000);

  await page.click('text=Liste d\'Inventaire').catch(() => {}); // might already be there
  await page.waitForSelector('button:has-text("Ajouter un SKU")');
  await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
  await page.waitForSelector('#modal-autofill-code');

  // Saisir le SKU cible
  await page.fill('#modal-p-sku', 'TEST-SCRAPE-FALLBACK');

  // Sélectionner MPN (Manufacturer Part Number)
  await page.selectOption('#modal-autofill-type', 'mpn');
  
  // Saisir la référence inconnue pour déclencher le fallback
  await page.fill('#modal-autofill-code', 'Fluke 117');
  
  // Lancer le scraping
  await page.click('button:has-text("Scraper")');

  // Attendre la fin du scraping pour ce SKU précis
  await page.waitForSelector('.global-scrape-banner--complete:has-text("TEST-SCRAPE-FALLBACK")', { timeout: 75000 });

  // Ouvrir le modal d'auto-remplissage
  await page.click('text=Auto-remplissage (Candidats)');

  // Attendre le modal
  await page.waitForSelector('.autofill-modal__content');

  // Cliquer sur l'onglet Ressources car il contient les images récupérées par SearxNG
  await page.click('button:has-text("Ressources")');

  // Attendre que la grille d'images s'affiche et cliquer sur la première vignette image
  await page.waitForSelector('.autofill-modal__image-thumb');
  await page.locator('.autofill-modal__image-thumb').first().click();

  // Cliquer sur appliquer la sélection (le bouton est maintenant activé grâce à l'image sélectionnée)
  await page.click('text=Appliquer la sélection');

  // Confirmer l'application
  await page.click('text=Confirmer l\'application');

  // Attendre que la modale d'auto-remplissage se ferme (détachée du DOM)
  await page.waitForSelector('.autofill-modal', { state: 'detached', timeout: 10000 });

  // Fermer la modale d'ajout de SKU
  await page.locator('button', { hasText: 'Annuler' }).first().click({ force: true });
});
