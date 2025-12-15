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

        // --- Post-Processing Deduplication (Same as Python) ---
        console.log("⏳ Waiting 60s before deduplication (World)...");
        await sleep(60000);

        console.log("🔄 Starting deduplication process (World)...");
        
        // 1. Fetch Top 20 News (Latest World)
        const recentNewsResult = await pool.request().query(`
            SELECT TOP 20 * 
            FROM ai_powered_news 
            WHERE category = 'World' AND created_at IS NOT NULL 
            ORDER BY created_at DESC
        `);
        
        const recentNews = recentNewsResult.recordset;
        
        if (recentNews.length > 0) {
            // 2. Call Deduplication Agent
            const filteredNewsJson = await aiService.removeDuplicateNews(recentNews);
            
            if (filteredNewsJson && filteredNewsJson !== "nan" && !filteredNewsJson.startsWith("Error:")) {
                 // Parse JSON result from agent
                 let parsedFilteredNews = null;
                 const jsonMatch = filteredNewsJson.match(/\[\s*\{.*\}\s*\]/s);
                 if (jsonMatch) {
                     try {
                         parsedFilteredNews = JSON.parse(jsonMatch[0]);
                     } catch(e) { console.error("❌ Failed to parse deduplicated JSON"); }
                 } else if (filteredNewsJson.trim().startsWith('[') || filteredNewsJson.trim().startsWith('{')) {
                     try {
                        parsedFilteredNews = JSON.parse(filteredNewsJson);
                     } catch(e) { console.error("❌ Failed to parse deduplicated JSON (direct)"); }
                 }

                 if (parsedFilteredNews && Array.isArray(parsedFilteredNews)) {
                     console.log(`✅ Deduplication Agent returned ${parsedFilteredNews.length} items (World).`);
                     
                     // 3. Delete the original Top 15/20 items from DB
                     const idsToDelete = recentNews.slice(0, 15).map(r => r.id);
                     if (idsToDelete.length > 0) {
                        await pool.request().query(`
                            DELETE FROM ai_powered_news WHERE id IN (${idsToDelete.join(',')})
                        `);
                        console.log("🗑️ Deleted original items for replacement (World).");
                     }

                     // 4. Re-insert Deduplicated Items
                     let reInsertDate = moment().tz("Asia/Kolkata");
                     parsedFilteredNews.forEach(item => {
                         item.category = "World";
                         item.date = reInsertDate.format('YYYY-MM-DD HH:mm:ss.SSS');
                         reInsertDate.subtract(2, 'minutes');
                     });
                     
                     await pool.request()
                        .input('p1', sql.VarChar, 'save_powered_news')
                        .input('p2', sql.NVarChar, null)
                        .input('p3', sql.NVarChar(sql.MAX), JSON.stringify(parsedFilteredNews))
                        .query('EXEC Jobs_USP_News_Feeds_Daily @p1, @p2, @p3');
                     
                     console.log("✅ Re-inserted deduplicated world news.");
                 }
            } else {
                console.log("⚠️ Deduplication agent returned invalid data or 'nan'.");
            }
        }

        // 5. Final SQL Deduplication
        console.log("🧹 Running final SQL deduplication (World)...");
        await pool.request().query(`
            WITH CTE AS (
                SELECT 
                    id, 
                    title,
                    category,
                    ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at DESC) AS rn
                FROM ai_powered_news
                WHERE category = 'World'  
            )
            DELETE FROM ai_powered_news
            WHERE id IN (
                SELECT id FROM CTE WHERE rn > 1
            );
        `);
        console.log("✅ Final SQL deduplication complete (World).");

    } catch (err) {
        console.error("❌ Database error storing World News:", err);
    }
}

module.exports = { fetchAndStoreWorldNews };
