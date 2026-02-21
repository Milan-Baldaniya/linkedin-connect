import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    try {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach((line) => {
            const cleanLine = line.split('#')[0].trim();
            if (!cleanLine) return;
            const firstEqualIndex = cleanLine.indexOf('=');
            if (firstEqualIndex > 0) {
                const key = cleanLine.substring(0, firstEqualIndex).trim();
                const value = cleanLine.substring(firstEqualIndex + 1).trim();
                const cleanValue = value.replace(/^["'](.*)["']$/, '$1');
                process.env[key] = cleanValue;
            }
        });
    } catch (e) {
        console.error("Error loading .env.local", e);
    }
}

const logFile = path.join(process.cwd(), 'logs', 'fetch-analytics.log');
const postsFile = path.join(process.cwd(), 'data', 'posts.json');
const enrichedFile = path.join(process.cwd(), 'data', 'posts_enriched.json');

function log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(message);
    const logsDir = path.dirname(logFile);
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(logFile, logMessage);
}

async function fetchAnalytics() {
    // Clear previous log
    if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
    }

    log("🔍 Starting LinkedIn post analytics fetcher (Enriched Mode)...");

    try {
        const { default: db } = await import('../lib/db');
        const { decrypt } = await import('../lib/encryption');

        // 1. Read posts
        if (!fs.existsSync(postsFile)) {
            log("❌ data/posts.json not found.");
            return;
        }

        const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
        if (posts.length === 0) {
            log("❌ No posts found.");
            return;
        }

        // Limit to first 5 posts for now to avoid long runtimes
        const targetPosts = posts.slice(0, 5);
        log(`🎯 Processing ${targetPosts.length} posts...`);

        // 2. Get account
        const stmt = db.prepare('SELECT * FROM linkedin_accounts ORDER BY created_at DESC LIMIT 1');
        const account = stmt.get() as any;

        if (!account) {
            log("❌ No accounts found in database.");
            return;
        }

        const li_at = decrypt(account.li_at_encrypted);

        // 3. Launch browser
        log("🚀 Launching browser...");
        const browser = await chromium.launch({ headless: false }); // Debug mode
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        });

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

        const page = await context.newPage();
        const results = [];

        for (const post of targetPosts) {
            const urn = post.postUrn || post.url.split('activity:')[1]?.split('/')[0];
            const postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
            log(`🔗 Processing: ${postUrl}`);

            try {
                await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Wait for content (generic selector)
                try {
                    await page.waitForSelector('div.feed-shared-update-v2, main', { timeout: 10000 });
                } catch (e) {
                    // ignore timeout
                }

                await page.waitForTimeout(3000); // Wait for dynamic content

                // Extract Data
                const data = await page.evaluate(() => {
                    const res = {
                        content: '',
                        imageUrl: '',
                        likes: 0,
                        comments: 0,
                        reposts: 0,
                        impressionsText: '0',
                        date: ''
                    };

                    // Content Text
                    const textEl = document.querySelector('.update-components-text span.break-words, .feed-shared-update-v2__description');
                    if (textEl) {
                        res.content = textEl.textContent?.trim() || '';
                    }

                    // Image
                    const imgEl = document.querySelector('article img, .update-components-image img');
                    if (imgEl) {
                        res.imageUrl = (imgEl as HTMLImageElement).src;
                    }

                    // Date / Time
                    const timeEl = document.querySelector('.update-components-actor__sub-description, .feed-shared-actor__sub-description, .update-components-text-view__mention span[aria-hidden="true"]');
                    // Note: Selector might need adjustment based on exact DOM for "1w"
                    // Often it's in a span nested in the sub-description or a separate time link
                    if (timeEl) {
                        let text = timeEl.textContent?.trim() || '';
                        // Cleanup "1w • Edited" -> "1w"
                        if (text.includes('•')) {
                            text = text.split('•')[0].trim();
                        }
                        res.date = text;
                    } else {
                        // Fallback: try to find a time element
                        const timeTag = document.querySelector('time');
                        if (timeTag) {
                            res.date = timeTag.innerText.trim();
                        }
                    }

                    // Stats
                    // Likes
                    const reactionCountEl = document.querySelector('.social-details-social-counts__reactions-count, button[aria-label*="reaction"] span[aria-hidden="true"]');
                    if (reactionCountEl && reactionCountEl.textContent) {
                        res.likes = parseInt(reactionCountEl.textContent.replace(/[^0-9]/g, '')) || 0;
                    }

                    // Comments
                    const allButtons = Array.from(document.querySelectorAll('button, a'));
                    const commentEl = allButtons.find(el => el.textContent && el.textContent.toLowerCase().includes('comment'));
                    if (commentEl && commentEl.textContent) {
                        res.comments = parseInt(commentEl.textContent.replace(/[^0-9]/g, '')) || 0;
                    }

                    // Reposts
                    const repostEl = allButtons.find(el => el.textContent && el.textContent.toLowerCase().includes('repost'));
                    if (repostEl && repostEl.textContent) {
                        res.reposts = parseInt(repostEl.textContent.replace(/[^0-9]/g, '')) || 0;
                    }


                    // Impressions - Scoped to main post container
                    // Try to find the specific "Post impressions" or "Impressions" stat
                    const allSpans = Array.from(document.querySelectorAll('span'));
                    const impressionSpans = allSpans.filter(s => s.innerText && s.innerText.toLowerCase().includes('impressions'));

                    // Log potential candidates to debug
                    // We can't log directly to Node console here, but we can return them or log to browser console
                    // Let's try to be smarter: Find one inside the 'analytics-entry-point' or 'feed-shared-update-v2'

                    for (const span of impressionSpans) {
                        // Check if it's inside the main update container
                        if (span.closest('.feed-shared-update-v2') || span.closest('main')) {
                            const parentText = span.parentElement ? span.parentElement.innerText : "";
                            // Look for "1,234 post impressions" or similar specific phrasing
                            // avoid "search appearances" or "profile views"
                            if (parentText.includes('post impressions') || parentText.includes('organic impressions')) {
                                const match = parentText.match(/([0-9,]+)\s*(post|organic)?\s*impressions/i);
                                if (match) {
                                    res.impressionsText = match[1];
                                    break; // Found the specific one
                                }
                            }
                        }
                    }

                    // Fallback: If specific "post impressions" not found, look for just "impressions" but ensure it's not profile views
                    if (res.impressionsText === '0' && impressionSpans.length > 0) {
                        // Try the first one that looks like a stat number
                        for (const span of impressionSpans) {
                            const parentText = span.parentElement ? span.parentElement.innerText : "";
                            // Avoid "search appearances"
                            if (!parentText.toLowerCase().includes('search appearance') && !parentText.toLowerCase().includes('profile view')) {
                                const match = parentText.match(/([0-9,]+)\s*impressions/i);
                                if (match) {
                                    res.impressionsText = match[1];
                                    break;
                                }
                            }
                        }
                    }

                    return res;
                });

                const impressionCount = parseInt(data.impressionsText.replace(/[^0-9]/g, ''), 10) || 0;

                if (impressionCount === 0) {
                    log(`   ⏭️  Skipping post (0 impressions): ${postUrl}`);
                } else {
                    results.push({
                        ...post,
                        ...data,
                        impressions: impressionCount,
                    });
                    log(`   ✅ Extracted: ${data.impressionsText} impressions`);
                }

            } catch (e) {
                log(`   ❌ Failed to process post: ${e}`);
            }
        }

        // Final safety filter — exclude any that slipped through with 0 impressions
        const finalResults = results.filter(r => {
            const n = parseInt(String(r.impressionsText || '0').replace(/[^0-9]/g, ''), 10) || 0;
            return n > 0;
        });

        fs.writeFileSync(enrichedFile, JSON.stringify(finalResults, null, 2));
        log(`💾 Saved ${finalResults.length} posts (${results.length - finalResults.length} skipped with 0 impressions) to ${enrichedFile}`);

        await browser.close();
        log("🏁 Analytics fetch completed.");

    } catch (error) {
        log(`❌ Error: ${error}`);
    }
}

fetchAnalytics();
