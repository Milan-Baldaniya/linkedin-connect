const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sessionId = process.argv[2];

if (!sessionId) {
  console.error('Session ID is required');
  process.exit(1);
}

const logPath = path.join(os.tmpdir(), `linkedin-script-${sessionId}.log`);
const log = (msg) => fs.appendFileSync(logPath, `${new Date().toISOString()} - ${msg}\n`);

log('Script started');
log(`Session ID: ${sessionId}`);

const TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL = 2000; // 2 seconds

(async () => {
  let browser;
  try {
    log('Launching browser...');
    browser = await chromium.launch({ headless: false });
    log('Browser launched');
    const context = await browser.newContext();
    const page = await context.newPage();

    log('Navigating to login...');
    try {
      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    } catch (e) {
      log(`Initial navigation failed: ${e.message}, but keeping browser open.`);
    }

    const startTime = Date.now();
    let loginDetected = false;

    while (Date.now() - startTime < TIMEOUT) {
      try {
        const cookies = await context.cookies();
        const li_at = cookies.find((c) => c.name === 'li_at');

        if (li_at) {
          log('✅ Valid "li_at" cookie detected!');

          // Optional: Wait for redirect to feed for good measure, but cookie is strict enough
          console.log('Login success! Cookie found.');

          const resultPath = path.join(os.tmpdir(), `linkedin-session-${sessionId}.json`);
          fs.writeFileSync(resultPath, JSON.stringify({ status: 'success', cookie: li_at.value }));
          console.log(`Cookie saved to ${resultPath}`);

          log('Waiting 5s to ensure session stability...');
          await page.waitForTimeout(5000);

          await browser.close();
          process.exit(0);
        }

        // No checks for visuals causing early exit anymore. 
        // We purely wait for the cookie.

      } catch (checkErr) {
        console.error('Error during check:', checkErr);
      }



      // Wait before next check
      await new Promise(r => setTimeout(r, CHECK_INTERVAL));
    }

    // Timeout triggered
    console.log('Timeout reached. Login not detected.');
    const resultPath = path.join(os.tmpdir(), `linkedin-session-${sessionId}.json`);
    fs.writeFileSync(resultPath, JSON.stringify({ status: 'timeout' }));

    await browser.close();
    process.exit(0);

  } catch (error) {
    console.error('Fatal error:', error);
    if (log) log(`FATAL ERROR: ${error.message}\n${error.stack}`);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
