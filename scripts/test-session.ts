import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    try {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach((line) => {
            // Handle lines with comments or multiple =
            const cleanLine = line.split('#')[0].trim();
            if (!cleanLine) return;

            const firstEqualIndex = cleanLine.indexOf('=');
            if (firstEqualIndex > 0) {
                const key = cleanLine.substring(0, firstEqualIndex).trim();
                const value = cleanLine.substring(firstEqualIndex + 1).trim();
                // Remove quotes if present
                const cleanValue = value.replace(/^["'](.*)["']$/, '$1');
                process.env[key] = cleanValue;
            }
        });
        console.log("Loaded .env.local");
    } catch (e) {
        console.error("Error loading .env.local", e);
    }
} else {
    console.log("Warning: .env.local not found at " + envPath);
}

const logFile = path.join(process.cwd(), 'logs', 'session-test.log');

function log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(message);
    // Ensure logs directory exists
    const logsDir = path.dirname(logFile);
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(logFile, logMessage);
}

async function testSession() {
    // Clear previous log
    if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
    }

    log("🔍 Starting LinkedIn session test...");

    try {
        log("📦 Dynamically importing libraries...");
        // Dynamic imports to ensure env vars are loaded first
        const { default: db } = await import('../lib/db');
        const { decrypt } = await import('../lib/encryption');
        log("✅ Libraries imported.");

        // 1. Get latest account
        const stmt = db.prepare('SELECT * FROM linkedin_accounts ORDER BY created_at DESC LIMIT 1');
        const account = stmt.get() as any;

        if (!account) {
            log("❌ No accounts found in database.");
            return;
        }

        log(`👤 Found account for user: ${account.user_id}`);

        // 2. Decrypt cookie
        const li_at = decrypt(account.li_at_encrypted);
        log("🔓 Successfully decrypted li_at token");

        // 3. Launch browser
        log("🚀 Launching browser...");
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        });

        // 4. Set cookie
        await context.addCookies([
            {
                name: 'li_at',
                value: li_at,
                domain: '.linkedin.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'None',
            },
        ]);

        log("🍪 Cookie injected. Navigating to LinkedIn...");

        // 5. Open LinkedIn
        const page = await context.newPage();
        await page.goto('https://www.linkedin.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 6. Check login status
        try {
            log("⏳ Waiting for page load/redirects...");
            await page.waitForTimeout(5000); // Wait for potential redirects

            const url = page.url();
            const title = await page.title();

            log(`📍 Current URL: ${url}`);
            log(`📄 Page Title: ${title}`);

            // Primary check: URL indicates feed
            if (url.includes('/feed')) {
                log("✅ SESSION VALID - Confirmed by URL '/feed'");
                await page.screenshot({ path: 'logs/session-success.png' });
            }
            // Secondary check: Title indicates feed or general signed-in state
            else if (title.includes("Feed") || (title.includes("LinkedIn") && !title.includes("Login") && !title.includes("Sign In"))) {
                log("✅ SESSION VALID - Confirmed by Page Title");
                await page.screenshot({ path: 'logs/session-success.png' });
            }
            // Tertiary check: Selectors
            else {
                try {
                    await page.waitForSelector('nav.global-nav', { timeout: 5000 });
                    log("✅ SESSION VALID - Confirmed by Global Nav");
                    await page.screenshot({ path: 'logs/session-success.png' });
                } catch (e) {
                    throw new Error("Login indicators not found");
                }
            }

        } catch (e) {
            log("❌ SESSION EXPIRED or Unable to detect login.");
            log(`Body text snippet: ${(await page.evaluate(() => document.body.innerText)).substring(0, 200)}...`);
            await page.screenshot({ path: 'logs/session-failed.png' });
        }

        // Keep browser open for manual inspection for a few seconds
        await page.waitForTimeout(2000);
        await browser.close();
        log("🏁 Test completed.");

    } catch (error) {
        log(`❌ Error during test: ${error}`);
        if (error instanceof Error && error.stack) {
            fs.appendFileSync(logFile, error.stack + '\n');
        }
    }
}

testSession();
