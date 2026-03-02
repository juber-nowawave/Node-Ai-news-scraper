const { connectDB, sql } = require('../config/db');
const aiService = require('../services/aiService');
const moment = require('moment-timezone');

async function fetchAndStoreNews() {
    console.log("🔄 Fetching Indian Stock Market News...");
    
    // 1. Fetch News (Agent Step)
    const rawNews = await aiService.fetchNewsWithGroq("latest indian stock market news today");
    
    if (!rawNews || rawNews.includes("No response")) {
        console.log("❌ No Indian News fetched from Groq.");
        return;
    }

    // 2. Rewrite News (Gemini Step)
    let processedNews = [];
    let retryCount = 0;
    const maxRetries = 5;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    while (retryCount < maxRetries) {
        try {
            processedNews = await aiService.rewriteNewsWithGemini(rawNews);
            if (processedNews && Array.isArray(processedNews) && processedNews.length > 0) {
                break;
            }
            // If we get here but result is empty/invalid, treat as non-fatal but retry
            console.log(`⚠️ Invalid response from Gemini. Retrying... (${retryCount + 1}/${maxRetries})`);
            retryCount++;
            
        } catch (error) {
            console.error(`❌ Gemini Error (Attempt ${retryCount + 1}):`, error.message);

            let waitTimeMs = 5000; // Default 5s for non-rate-limit errors

            // Extract retryDelay from error object if available
            // Structure: error.errorDetails[].retryDelay = "43s"
            if (error.status === 429) {
                 waitTimeMs = 60000; // Default 60s for 429s without explicit delay
                 if (error.errorDetails) {
                    const retryInfo = error.errorDetails.find(d => d.retryDelay);
                    if (retryInfo) {
                        const seconds = parseInt(retryInfo.retryDelay.replace('s', ''), 10);
                        if (!isNaN(seconds)) {
                            waitTimeMs = (seconds + 2) * 1000; // Add 2s buffer
                        }
                    }
                 }
            }

            console.log(`⏳ Waiting ${waitTimeMs/1000}s before retrying (as requested by API or default)...`);
            await sleep(waitTimeMs);
            retryCount++;
        }
    }

    if (!processedNews || !Array.isArray(processedNews)) {
        console.log("❌ Failed to process Indian News with Gemini.");
        return;
    }

    // 3. Store in DB
    try {
        const pool = await connectDB();

        // Post-processing to match Python logic
        // 1. Set Category to 'World'
        // 2. Add 'date' field with decrementing timestamps
        // Python: date.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        
        let currentDate = moment().tz("Asia/Kolkata");
        
        processedNews.forEach(item => {
            item.category = "India";
            item.date = currentDate.format('YYYY-MM-DD HH:mm:ss.SSS');
            // Decrement 2 minutes for next item
            currentDate.subtract(2, 'minutes');
        });

        const jsonInput = JSON.stringify(processedNews);
        
        console.log("📝 Storing Indian News in MSSQL...");
        
        // EXEC Jobs_USP_News_Feeds_Daily ?, ?, ?
        // Parameters: @Action, @Date (null), @Json
        
        // Python usage: cursor.execute("EXEC Jobs_USP_News_Feeds_Daily ?, ?, ?", "save_powered_news", None, json.dumps(news_data))
        // We replicate this using .query() to avoid needing        // EXEC Jobs_USP_News_Feeds_Daily ?, ?, ?
       await pool.request()
        .input('p1', sql.VarChar, 'save_powered_news')  // param 1
        .input('p2', sql.NVarChar, null)                // param 2 (NULL)
        .input('p3', sql.NVarChar(sql.MAX), jsonInput)  // param 3
        .query('EXEC Jobs_USP_News_Feeds_Daily @p1, @p2, @p3');
       console.log("✅ News stored in MSSQL successfully.");
    //    console.log('-------------->',jsonInput);
       
        // --- Post-Processing Deduplication (Same as Python) ---
        console.log("⏳ Waiting 60s before deduplication...");
        await sleep(60000);
          
        console.log("🔄 Starting deduplication process...");
        
        // 1. Fetch Top 20 News (Latest)
        const recentNewsResult = await pool.request().query(`
            SELECT TOP 20 * 
            FROM ai_powered_news 
            WHERE category = 'India' AND created_at IS NOT NULL 
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
                     } catch(e) {
                         console.error("❌ Failed to parse deduplicated JSON");
                     }
                 } else if (filteredNewsJson.trim().startsWith('[') || filteredNewsJson.trim().startsWith('{')) {
                     try {
                        parsedFilteredNews = JSON.parse(filteredNewsJson);
                     } catch(e) { console.error("❌ Failed to parse deduplicated JSON (direct)"); }
                 }

                 if (parsedFilteredNews && Array.isArray(parsedFilteredNews)) {
                     console.log(`✅ Deduplication Agent returned ${parsedFilteredNews.length} items.`);
                     
                     // 3. Delete the original Top 15/20 items from DB
                     const idsToDelete = recentNews.slice(0, 15).map(r => r.id);
                     if (idsToDelete.length > 0) {
                        await pool.request().query(`
                            DELETE FROM ai_powered_news WHERE id IN (${idsToDelete.join(',')})
                        `);
                        console.log("🗑️ Deleted original items for replacement.");
                     }

                     // 4. Re-insert Deduplicated Items
                     let reInsertDate = moment().tz("Asia/Kolkata");
                     parsedFilteredNews.forEach(item => {
                         item.category = "India";
                         item.date = reInsertDate.format('YYYY-MM-DD HH:mm:ss.SSS');
                         reInsertDate.subtract(2, 'minutes');
                     });
                     
                     await pool.request()
                        .input('p1', sql.VarChar, 'save_powered_news')
                        .input('p2', sql.NVarChar, null)
                        .input('p3', sql.NVarChar(sql.MAX), JSON.stringify(parsedFilteredNews))
                        .query('EXEC Jobs_USP_News_Feeds_Daily @p1, @p2, @p3');
                     
                     console.log("✅ Re-inserted deduplicated news.");
                 }
            } else {
                console.log("⚠️ Deduplication agent returned invalid data or 'nan'.");
            }
        }

        // 5. Final SQL Deduplication (Delete strict duplicates by title/category)
        console.log("🧹 Running final SQL deduplication...");
        await pool.request().query(`
            WITH CTE AS (
                SELECT 
                    id, 
                    title,
                    category,
                    ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at DESC) AS rn
                FROM ai_powered_news
                WHERE category = 'India'  
            )
            DELETE FROM ai_powered_news
            WHERE id IN (
                SELECT id FROM CTE WHERE rn > 1
            );
        `);
        console.log("✅ Final SQL deduplication complete.");
        
    } catch (err) {
        console.error("❌ Database error:", err);
    }
}
// fetchAndStoreNews()
module.exports = { fetchAndStoreNews };
