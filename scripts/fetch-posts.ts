import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Load .env.local ───────────────────────────────────────────────────
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    try {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach((line) => {
            const cleanLine = line.split('#')[0].trim();
            if (!cleanLine) return;
            const idx = cleanLine.indexOf('=');
            if (idx > 0) {
                const key = cleanLine.substring(0, idx).trim();
                const val = cleanLine.substring(idx + 1).trim().replace(/^["'](.*)['"']$/, '$1');
                process.env[key] = val;
            }
        });
    } catch (e) {
        console.error('Error loading .env.local', e);
    }
}

const logFile = path.join(process.cwd(), 'logs', 'fetch-posts.log');
const dataFile = path.join(process.cwd(), 'data', 'posts.json');

function log(message: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${message}\n`;
    console.log(message);
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logFile, line);
}

async function fetchPosts() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log('🔍 Starting LinkedIn post fetcher...');

    try {
        const { default: db } = await import('../lib/db');
        const { decrypt } = await import('../lib/encryption');

        const stmt = db.prepare('SELECT * FROM linkedin_accounts ORDER BY created_at DESC LIMIT 1');
        const account = stmt.get() as any;

        if (!account) {
            log('❌ No accounts found in database.');
            return;
        }

        log(`👤 Found account: ${account.user_id}`);
        const li_at = decrypt(account.li_at_encrypted);

        log('🚀 Launching browser...');
        const browser = await chromium.launch({ headless: false }); // visible so you can watch
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 900 },
        });

        await context.addCookies([{
            name: 'li_at', value: li_at, domain: '.linkedin.com',
            path: '/', httpOnly: true, secure: true, sameSite: 'None',
        }]);

        const page = await context.newPage();

        // ── Validate session ──────────────────────────────────────────
        log('🔗 Checking session on LinkedIn Feed...');
        try {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            const s = String(e);
            if (s.includes('ERR_TOO_MANY_REDIRECTS') || s.includes('ERR_ABORTED')) {
                log('❌ Session cookie invalid. Please login again.');
                await browser.close();
                return;
            }
        }

        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('guest')) {
            log('❌ Session expired. Redirected to login.');
            await browser.close();
            return;
        }

        // ── Navigate to activity page ─────────────────────────────────
        const activityUrl = 'https://www.linkedin.com/in/me/recent-activity/all/';
        log(`🔗 Session valid. Navigating to ${activityUrl}...`);
        await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        log('⏳ Waiting for initial posts to load...');
        try {
            await page.waitForSelector('div.feed-shared-update-v2', { timeout: 15000 });
        } catch {
            log('⚠️ Feed selector not found on first wait, continuing...');
        }
        await page.waitForTimeout(3000);

        // ── PHASE 1: Scroll exactly 50 times, one screen height each ────
        log('📜 Phase 1: Scrolling 50 times (1 viewport height per scroll)...');

        const TOTAL_SCROLLS = 50;
        const WAIT_BETWEEN = 3000; // 3 seconds between each scroll

        for (let i = 0; i < TOTAL_SCROLLS; i++) {
            // Scroll down exactly one viewport height
            await page.evaluate(() => window.scrollBy({ top: window.innerHeight, behavior: 'smooth' }));
            await page.waitForTimeout(WAIT_BETWEEN);

            const currentCount = await page.evaluate(() =>
                document.querySelectorAll('div.feed-shared-update-v2').length
            );

            log(`   Scroll ${i + 1}/${TOTAL_SCROLLS}: ${currentCount} posts loaded`);
        }

        // ── PHASE 2: Extract ALL posts from DOM ───────────────────────
        log('📊 Phase 2: Extracting all posts from DOM...');

        const allExtracted = await page.evaluate(() => {
            const updates = document.querySelectorAll('div.feed-shared-update-v2');
            const results: { postUrn: string; postUrl: string; timeText: string }[] = [];

            updates.forEach(update => {
                const urn = update.getAttribute('data-urn') || '';
                if (!urn) return;

                // ── URL ──
                let postUrl = '';
                const links = update.querySelectorAll('a[href]');
                for (const link of links) {
                    const href = (link as HTMLAnchorElement).href;
                    if (href.includes('/feed/update/urn:li:activity:') || href.includes('/posts/')) {
                        postUrl = href.split('?')[0];
                        break;
                    }
                }
                if (!postUrl) {
                    postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
                }

                // ── Raw LinkedIn time text (e.g. "2w", "1d", "3mo") ──
                // Keep it exactly as LinkedIn shows it — no conversion.
                let timeText = '';
                const subDesc = update.querySelector('.update-components-actor__sub-description');
                if (subDesc) {
                    // Prefer the aria-hidden span which has the clean text
                    const ariaHidden = subDesc.querySelector('span[aria-hidden="true"]');
                    timeText = (ariaHidden || subDesc).textContent?.trim() || '';
                    // Strip trailing " • Edited" etc.
                    timeText = timeText.split('•')[0].trim();
                }

                results.push({ postUrn: urn, postUrl, timeText });
            });

            return results;
        });

        log(`   Total DOM posts extracted: ${allExtracted.length}`);

        // ── PHASE 3: Deduplicate (no date filter, no date conversion) ─
        log('🔍 Phase 3: Deduplicating...');

        const uniquePosts = new Map<string, { postUrn: string; postUrl: string; posted_at: string }>();
        let duplicates = 0;

        for (const item of allExtracted) {
            if (!item.postUrn) continue;
            if (uniquePosts.has(item.postUrn)) {
                duplicates++;
                continue;
            }
            uniquePosts.set(item.postUrn, {
                postUrn: item.postUrn,
                postUrl: item.postUrl,
                posted_at: item.timeText,  // raw LinkedIn string preserved as-is
            });
        }

        const allPosts = Array.from(uniquePosts.values()).slice(0, 30); // latest 30 only
        log(`   Duplicates removed: ${duplicates}`);
        log(`   Total unique: ${allPosts.length + duplicates - duplicates} → Keeping latest 30: ${allPosts.length}`);

        // ── PHASE 4: Save to disk ─────────────────────────────────────
        log('💾 Phase 4: Saving to disk...');
        const dataDir = path.dirname(dataFile);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(dataFile, JSON.stringify(allPosts, null, 2));
        log(`   Saved ${allPosts.length} posts to ${dataFile}`);

        // ── PHASE 5: Upsert to Supabase ───────────────────────────────
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;

        if (supabaseUrl && supabaseKey) {
            log('☁️ Phase 5: Upserting posts to Supabase...');

            const rows = allPosts.map(p => ({
                post_urn: p.postUrn,
                post_url: p.postUrl,
                posted_at: p.posted_at,
            }));

            const headers = {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            };

            let saved = 0, failed = 0;
            for (const p of allPosts) {
                const row = { post_urn: p.postUrn, post_url: p.postUrl, posted_at: p.posted_at };
                try {
                    // Delete existing row for this post_urn
                    await fetch(`${supabaseUrl}/rest/v1/linkedin_posts?post_urn=eq.${encodeURIComponent(p.postUrn)}`,
                        { method: 'DELETE', headers });
                    // Insert fresh
                    const res = await fetch(`${supabaseUrl}/rest/v1/linkedin_posts`,
                        { method: 'POST', headers, body: JSON.stringify(row) });
                    if (!res.ok) {
                        const e = await res.text();
                        log(`   ⚠️ Failed ${p.postUrn}: ${e}`);
                        failed++;
                    } else {
                        saved++;
                    }
                } catch (err) {
                    log(`   ❌ Network error: ${err}`);
                    failed++;
                }
            }
            log(`✅ ${saved} posts saved to Supabase${failed > 0 ? `, ${failed} failed` : ''}`);
        } else {
            log('⚠️ Supabase env vars not set. Skipping upsert.');
        }

        await browser.close();
        log('🏁 Fetch completed.');

    } catch (error) {
        log(`❌ Fatal error: ${error}`);
        if (error instanceof Error && error.stack) {
            fs.appendFileSync(logFile, error.stack + '\n');
        }
    }
}

fetchPosts();
