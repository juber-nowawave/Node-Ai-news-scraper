const { connectDB, sql } = require('../config/db');
const aiService = require('../services/aiService');

async function fetchAndStoreNews() {
    console.log("🔄 Fetching stock market news...");
    
    // 1. Fetch News (Agent Step)
    const rawNews = await aiService.fetchNewsWithGroq("latest indian stock market news today");
    
    if (!rawNews || rawNews.includes("No response")) {
        console.log("❌ No news fetched from Groq.");
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
        console.log("❌ Failed to process news with Gemini.");
        return;
    }

    // 3. Store in DB
    try {
        const pool = await connectDB();

        // Post-processing to match Python logic
        // 1. Set Category to 'World'
        // 2. Add 'date' field with decrementing timestamps
        // Python: date.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        
        let currentDate = new Date();
        // Convert to IST roughly if needed, but here using server time (UTC/Local) as base
        // Python uses: pytz.timezone("Asia/Kolkata")
        
        const formatPythonLikeDate = (d) => {
             // YYYY-MM-DD HH:mm:ss.SSS
             const pad = (n, width=2) => n.toString().padStart(width, '0');
             const yyyy = d.getFullYear();
             const mm = pad(d.getMonth() + 1);
             const dd = pad(d.getDate());
             const hh = pad(d.getHours());
             const min = pad(d.getMinutes());
             const ss = pad(d.getSeconds());
             const ms = pad(d.getMilliseconds(), 3);
             return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
        };

        processedNews.forEach(item => {
            item.category = "India";
            item.date = formatPythonLikeDate(currentDate);
            // Decrement 2 minutes for next item
            currentDate.setMinutes(currentDate.getMinutes() - 2);
        });

        const jsonInput = JSON.stringify(processedNews);
        
        console.log("📝 Storing news in MSSQL...");
        
        // EXEC Jobs_USP_News_Feeds_Daily ?, ?, ?
        // Parameters: @Action, @Date (null), @Json
        
        // Python usage: cursor.execute("EXEC Jobs_USP_News_Feeds_Daily ?, ?, ?", "save_powered_news", None, json.dumps(news_data))
        // We replicate this using .query() to avoid needing exact parameter names.

       await pool.request()
        .input('p1', sql.VarChar, 'save_powered_news')  // param 1
        .input('p2', sql.NVarChar, null)                // param 2 (NULL)
        .input('p3', sql.NVarChar(sql.MAX), jsonInput)  // param 3
        .query('EXEC Jobs_USP_News_Feeds_Daily @p1, @p2, @p3');
       console.log("✅ News stored in MSSQL successfully.");
        
    } catch (err) {
        console.error("❌ Database error:", err);
    }
}

module.exports = { fetchAndStoreNews };
