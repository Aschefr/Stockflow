# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scraper.spec.ts >> Scraping Fallback (Fluke 117)
- Location: tests\e2e\scraper.spec.ts:92:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.waitForSelector: Target page, context or browser has been closed
```

# Test source

```ts
  1   | import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
  2   | import { spawn, ChildProcess } from 'child_process';
  3   | import path from 'path';
  4   | import fs from 'fs';
  5   | 
  6   | let tauriApp: ChildProcess;
  7   | let browser: Browser;
  8   | let page: Page;
  9   | 
  10  | test.beforeAll(async () => {
  11  |   const executablePath = path.resolve(process.cwd(), 'src-tauri/target/debug/tauri-app.exe');
  12  |   
  13  |   if (!fs.existsSync(executablePath)) {
  14  |     throw new Error(`Exécutable Tauri introuvable: ${executablePath}. Lancez 'cargo build' dans src-tauri.`);
  15  |   }
  16  | 
  17  |   console.log("Démarrage de l'application Tauri avec le port de débogage...");
  18  |   tauriApp = spawn(executablePath, [], {
  19  |     env: {
  20  |       ...process.env,
  21  |       WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222"
  22  |     }
  23  |   });
  24  | 
  25  |   tauriApp.stdout?.on('data', (data) => console.log(`[Tauri] ${data}`));
  26  |   tauriApp.stderr?.on('data', (data) => console.error(`[Tauri Err] ${data}`));
  27  | 
  28  |   // Attendre que le port s'ouvre
  29  |   let connected = false;
  30  |   for (let i = 0; i < 20; i++) {
  31  |     try {
  32  |       browser = await chromium.connectOverCDP('http://localhost:9222');
  33  |       connected = true;
  34  |       break;
  35  |     } catch (e) {
  36  |       await new Promise(r => setTimeout(r, 1000));
  37  |     }
  38  |   }
  39  | 
  40  |   if (!connected) throw new Error("Impossible de se connecter à Tauri via CDP sur le port 9222");
  41  | 
  42  |   const contexts = browser.contexts();
  43  |   page = contexts[0].pages()[0];
  44  | });
  45  | 
  46  | test.afterAll(async () => {
  47  |   if (browser) await browser.close();
  48  |   if (tauriApp) tauriApp.kill();
  49  | });
  50  | 
  51  | test('Scraping RS Standard (114-8175)', async () => {
  52  |   // Navigation vers la page Liste d'Inventaire
  53  |   await page.click('text=Liste d\'Inventaire');
  54  |   await page.waitForSelector('button:has-text("Ajouter un SKU")');
  55  | 
  56  |   // Ouvrir la modale d'ajout
  57  |   await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
  58  |   
  59  |   // Attendre l'input du modal
  60  |   await page.waitForSelector('#modal-autofill-code');
  61  | 
  62  |   // Sélectionner la source 'RS'
  63  |   await page.selectOption('#modal-autofill-type', 'RS');
  64  | 
  65  |   // Saisir la référence
  66  |   await page.fill('#modal-autofill-code', '114-8175');
  67  | 
  68  |   // Lancer l'auto-remplissage
  69  |   await page.click('text=Auto-remplir');
  70  | 
  71  |   // Attendre que la désignation (label) ou marque soit remplie
  72  |   // L'ID du champ marque est "#modal-p-brand"
  73  |   await page.waitForFunction(() => {
  74  |     const inputs = document.querySelectorAll('input');
  75  |     for (let input of inputs) {
  76  |       // Trouver l'input qui contient la marque ou la désignation
  77  |       if (input.placeholder?.toLowerCase().includes('marque') && input.value !== '') return true;
  78  |       if (input.placeholder?.toLowerCase().includes('siemens') && input.value !== '') return true; // generic placeholder
  79  |     }
  80  |     // Alternative: vérifier la présence de texte RS
  81  |     return document.body.innerHTML.includes('RS') && document.body.innerHTML.includes('Auto-remplissage');
  82  |   }, { timeout: 15000 });
  83  | 
  84  |   // On peut vérifier explicitement que le texte de la marque ou de la modale inclut des données
  85  |   const pageContent = await page.content();
  86  |   expect(pageContent.toLowerCase()).toContain('rs');
  87  | 
  88  |   // Fermer la modale
  89  |   await page.locator('button', { hasText: 'Annuler' }).first().click({ force: true });
  90  | });
  91  | 
  92  | test('Scraping Fallback (Fluke 117)', async () => {
  93  |   await page.click('text=Liste d\'Inventaire').catch(() => {}); // might already be there
> 94  |   await page.waitForSelector('button:has-text("Ajouter un SKU")');
      |              ^ Error: page.waitForSelector: Target page, context or browser has been closed
  95  |   await page.locator('button', { hasText: 'Ajouter un SKU' }).click();
  96  |   await page.waitForSelector('#modal-autofill-code');
  97  | 
  98  |   // Selectionner MPN (Manufacturer Part Number)
  99  |   await page.selectOption('#modal-autofill-type', 'mpn');
  100 |   
  101 |   // Saisir la référence inconnue pour déclencher le fallback
  102 |   await page.fill('#modal-autofill-code', 'Fluke 117');
  103 |   
  104 |   // Lancer l'auto-remplissage
  105 |   await page.click('text=Auto-remplir');
  106 | 
  107 |   // Attendre la résolution (ça peut prendre jusqu'à 20s via SearxNG/WebView)
  108 |   await page.waitForFunction(() => {
  109 |     return document.body.innerHTML.toLowerCase().includes('fluke');
  110 |   }, { timeout: 30000 });
  111 | 
  112 |   const pageContent = await page.content();
  113 |   expect(pageContent.toLowerCase()).toContain('fluke');
  114 |   
  115 |   await page.locator('button', { hasText: 'Annuler' }).first().click({ force: true });
  116 | });
  117 | 
```