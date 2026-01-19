// This file is temporarily created to point to port 8788
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the raw_data.json file
const rawDataPath = join(__dirname, 'raw_data.json');
const rawData = JSON.parse(readFileSync(rawDataPath, 'utf-8'));

const INGEST_URL = 'http://localhost:8788/ingest';
const CONCURRENCY = 5;

async function ingestFeedback(item, index, total) {
    try {
        // Retry logic: 3 attempts
        let attempt = 0;
        while (attempt < 3) {
            try {
                const response = await fetch(INGEST_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                const result = await response.json();
                const textSnippet = item.text.substring(0, 30).replace(/\n/g, ' ');
                const sentimentScore = result.ai_analysis?.sentiment_score || 'N/A';
                console.log(`[${index + 1}/${total}] ${textSnippet}... ✅ (Sem: ${sentimentScore})`);
                return result;
            } catch (e) {
                attempt++;
                if (attempt >= 3) throw e;
                await new Promise(r => setTimeout(r, 1000 * attempt)); // Backoff
            }
        }
    } catch (error) {
        console.error(`[${index + 1}/${total}] ❌ Failed: ${error.message}`);
        // Don't throw to allow other items to proceed
    }
}

async function loadAllData() {
    const total = rawData.length;
    const now = new Date();
    console.log(`Starting to process ${total} feedback items (Concurrency: ${CONCURRENCY})...\n`);

    const urgencyLevels = ['High', 'Neutral', 'Low'];
    const tasks = [];

    for (let i = 0; i < total; i++) {
        const item = { ...rawData[i] };

        // Date distribution
        let daysAgo;
        if (i < 20) daysAgo = Math.floor(Math.random() * 20);
        else if (i < 50) daysAgo = 20 + Math.floor(Math.random() * 10);
        else daysAgo = 31 + Math.floor(Math.random() * 30);

        const dateCallback = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
        item.timestamp = dateCallback.toISOString();
        item.urgency_level = urgencyLevels[Math.floor(Math.random() * urgencyLevels.length)];

        tasks.push(() => ingestFeedback(item, i, total));
    }

    // Process using batches
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const batch = tasks.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(fn => fn()));
    }

    console.log(`\n✅ Completed processing feedback items!`);
}

loadAllData().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
