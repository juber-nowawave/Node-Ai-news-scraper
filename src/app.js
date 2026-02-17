const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { connectDB, sql } = require('./config/db');
const { fetchAndStoreNews } = require('./jobs/newsJob');
const { fetchAndStoreWorldNews } = require('./jobs/worldNewsJob');
// const { postNewsToTwitter } = require('./jobs/twitterJob');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;

// Test DB Connection
connectDB().catch(console.error);

// API Endpoint: Get Latest News
app.get('/api/news', async (req, res) => {
    try {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT TOP 2 title, description, url, created_at
            FROM ai_powered_news
            ORDER BY created_at DESC
        `);
        
        res.json({
            status: "success",
            data: result.recordset
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: "Failed to fetch news" });
    }
});

// Health Check
app.get('/health', (req, res) => res.send('AI News Data Service is Running...'));

app.get('/', (req, res) => {
    res.send("Stock Market News Cron Job is Running!");
});

// Manual Trigger
app.get('/trigger-news', async (req, res) => {
    await fetchAndStoreNews();
    res.send('News fetch triggered!');
});

// Manual Trigger World News
app.get('/trigger-world-news', async (req, res) => {
    await fetchAndStoreWorldNews();
    res.send('World News fetch triggered!');
});


// Schedule Jobs
// Python app runs every 50 minutes.
// fetchAndStoreNews();
cron.schedule('*/50 * * * *', () => {
    console.log("⏰ Running Scheduled Indian News Fetch Job...");
    fetchAndStoreNews();
});

// World News Job - Run every 50 minutes
// fetchAndStoreWorldNews();
cron.schedule('*/50 * * * *', () => {
    console.log("⏰ Running Scheduled WORLD News Fetch Job...");
    fetchAndStoreWorldNews();
});

//    postNewsToTwitter();
// Twitter Job - Every 1 hour
// cron.schedule('*/50 * * * *', () => {
//    postNewsToTwitter();
// });

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ News Job scheduled to run every 50 minutes.`);
});
