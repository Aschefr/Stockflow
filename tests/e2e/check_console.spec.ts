import { test, chromium } from '@playwright/test';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

test('check root innerHTML', async () => {
  const executablePath = path.resolve(process.cwd(), 'src-tauri/target/debug/tauri-app.exe');
  
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Executable not found: ${executablePath}`);
  }

  console.log("Spawning tauri app...");
  const tauriApp = spawn(executablePath, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222"
    }
  });

  let browser;
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

  if (!connected || !browser) {
    tauriApp.kill();
    throw new Error("Could not connect to Tauri over CDP");
  }

  const contexts = browser.contexts();
  const page = contexts[0].pages()[0];

  await page.waitForTimeout(5000);

  const innerHTML = await page.locator('#root').innerHTML();
  
  fs.writeFileSync('C:\\Users\\Adminlocal\\.gemini\\antigravity-ide\\brain\\522fecbc-f86c-4eab-a92d-d02f769c4d3e\\inner_html.txt', innerHTML);

  await browser.close();
  tauriApp.kill();
});
