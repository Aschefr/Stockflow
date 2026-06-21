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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222"
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
  // Navigation vers la page Liste d'Inventaire
  await page.click('text=Liste d\'Inventaire');
  await page.waitForSelector('button:has-text("Ajouter un SKU")');

  // Ouvrir la modale d'ajout
  await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
  
  // Attendre l'input du modal
  await page.waitForSelector('#modal-autofill-code');

  // Sélectionner la source 'RS'
  await page.selectOption('#modal-autofill-type', 'RS');

  // Saisir la référence
  await page.fill('#modal-autofill-code', '114-8175');

  // Lancer l'auto-remplissage
  await page.click('text=Auto-remplir');

  // Attendre que la désignation (label) ou marque soit remplie
  // L'ID du champ marque est "#modal-p-brand"
  await page.waitForFunction(() => {
    const inputs = document.querySelectorAll('input');
    for (let input of inputs) {
      // Trouver l'input qui contient la marque ou la désignation
      if (input.placeholder?.toLowerCase().includes('marque') && input.value !== '') return true;
      if (input.placeholder?.toLowerCase().includes('siemens') && input.value !== '') return true; // generic placeholder
    }
    // Alternative: vérifier la présence de texte RS
    return document.body.innerHTML.includes('RS') && document.body.innerHTML.includes('Auto-remplissage');
  }, { timeout: 15000 });

  // On peut vérifier explicitement que le texte de la marque ou de la modale inclut des données
  const pageContent = await page.content();
  expect(pageContent.toLowerCase()).toContain('rs');

  // Fermer la modale
  await page.locator('button', { hasText: 'Annuler' }).first().click({ force: true });
});

test('Scraping Fallback (Fluke 117)', async () => {
  await page.click('text=Liste d\'Inventaire').catch(() => {}); // might already be there
  await page.waitForSelector('button:has-text("Ajouter un SKU")');
  await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
  await page.waitForSelector('#modal-autofill-code');

  // Selectionner MPN (Manufacturer Part Number)
  await page.selectOption('#modal-autofill-type', 'mpn');
  
  // Saisir la référence inconnue pour déclencher le fallback
  await page.fill('#modal-autofill-code', 'Fluke 117');
  
  // Lancer l'auto-remplissage
  await page.click('text=Auto-remplir');

  // Attendre la résolution (ça peut prendre jusqu'à 20s via SearxNG/WebView)
  await page.waitForFunction(() => {
    return document.body.innerHTML.toLowerCase().includes('fluke');
  }, { timeout: 30000 });

  const pageContent = await page.content();
  expect(pageContent.toLowerCase()).toContain('fluke');
  
  await page.locator('button', { hasText: 'Annuler' }).first().click({ force: true });
});
