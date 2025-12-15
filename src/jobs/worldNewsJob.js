const { connectDB, sql } = require('../config/db');
const aiService = require('../services/aiService');
const moment = require('moment-timezone');

async function fetchAndStoreWorldNews() {
    console.log("🔄 Fetching WORLD news from web sources...");
    
    // 1. Fetch News (Scraping Step)
    const rawNewsItems = await aiService.fetchWorldNewsFromWeb();
    
    if (!rawNewsItems || rawNewsItems.length === 0) {
        console.log("❌ No world news fetched from sources.");
        return;
    }

    // 2. Rewrite News (Gemini Step)
    let processedNews = [];
    let retryCount = 0;
    const maxRetries = 5;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    while (retryCount < maxRetries) {
        try {
            processedNews = await aiService.rewriteWorldNewsWithGemini(rawNewsItems);
            if (processedNews && Array.isArray(processedNews) && processedNews.length > 0) {
                break;
            }
            console.log(`⚠️ Invalid response from Gemini for World News. Retrying... (${retryCount + 1}/${maxRetries})`);
            retryCount++;
            
        } catch (error) {
            console.error(`❌ Gemini World News Error (Attempt ${retryCount + 1}):`, error.message);
            // Simple backoff
            await sleep(5000);
            retryCount++;
        }
    }

    if (!processedNews || !Array.isArray(processedNews)) {
        console.log("❌ Failed to process World News with Gemini.");
        return;
    }

    // 3. Store in DB
    try {
        const pool = await connectDB();

        let currentDate = moment().tz("Asia/Kolkata");
        
        processedNews.forEach(item => {
            item.category = "World"; 
            item.date = currentDate.format('YYYY-MM-DD HH:mm:ss.SSS');
            // Decrement 2 minutes for next item
            currentDate.subtract(2, 'minutes');
        });

        const jsonInput = JSON.stringify(processedNews);
        
        console.log("📝 Storing WORLD news in MSSQL...");
        
        await pool.request()
        .input('p1', sql.VarChar, 'save_powered_news')
        .input('p2', sql.NVarChar, null)
        .input('p3', sql.NVarChar(sql.MAX), jsonInput)
        .query('EXEC Jobs_USP_News_Feeds_Daily @p1, @p2, @p3');

        console.log("✅ WORLD News stored in MSSQL successfully.");
        
    } catch (err) {
        console.error("❌ Database error storing World News:", err);
    }
}

module.exports = { fetchAndStoreWorldNews };
