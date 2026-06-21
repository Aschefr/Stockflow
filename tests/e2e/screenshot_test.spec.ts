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

  console.log("Démarrage de l'application Tauri pour capture...");
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

test('Capture WebView Scraping', async () => {
  // Navigation
  await page.click('text=Liste d\'Inventaire');
  await page.waitForSelector('button:has-text("Ajouter un SKU")');
  await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
  await page.waitForSelector('#modal-autofill-code');

  // Sélectionner la source 'RS'
  await page.selectOption('#modal-autofill-type', 'RS');
  await page.fill('#modal-autofill-code', '114-8175');

  console.log("Déclenchement du scraping...");
  await page.click('text=Auto-remplir');

  // Attendre quelques secondes que la WebView s'ouvre et charge la page
  console.log("Attente de 6 secondes pour le chargement de la WebView...");
  await new Promise(r => setTimeout(r, 6000));

  // Trouver toutes les pages (fenêtres WebView)
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  console.log(`Nombre de pages détectées : ${pages.length}`);
  
  let screenshotCaptured = false;
  for (const p of pages) {
    const url = p.url();
    console.log(`Page détectée : ${url}`);
    if (url.includes('rs-online.com') || url.includes('rsdelivers')) {
      console.log(`Capture d'écran de la WebView de scraping en cours (${url})...`);
      const screenshotPath = 'C:\\Users\\Adminlocal\\.gemini\\antigravity-ide\\brain\\522fecbc-f86c-4eab-a92d-d02f769c4d3e\\webview_screenshot.png';
      await p.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Capture d'écran sauvegardée sous : ${screenshotPath}`);
      screenshotCaptured = true;
      break;
    }
  }

  expect(screenshotCaptured).toBe(true);
});
