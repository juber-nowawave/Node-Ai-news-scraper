const { connectDB } = require('../config/db');
const { TwitterApi } = require('twitter-api-v2');
require('dotenv').config();

console.log('----__>>>',{
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

async function postNewsToTwitter() {
    console.log("🐦 Checking news for Twitter...");
    try {
        const pool = await connectDB();
        
        
        // Fetch latest 2 news
        const result = await pool.request().query(`
            SELECT TOP 2 title, description, url, created_at
            FROM ai_powered_news
            ORDER BY created_at DESC
        `);

        const newsList = result.recordset;

        if (newsList && newsList.length > 0) {
            for (const news of newsList) {
                let tweet = `${news.title} - ${news.description.substring(0, 100)}... ${news.url}`;
                if (tweet.length > 280) {
                    tweet = `${news.title} ${news.url}`;
                }

                try {
                    await client.v2.tweet(tweet);
                    console.log(`✅ Posted to X: ${tweet}`);
                } catch (e) {
                    console.error("❌ X Posting Error:", e);
                }
            }
        } else {
            console.log("❌ No news to post.");
        }

    } catch (err) {
        console.error("❌ Database/Twitter error:", err);
    }
}

module.exports = { postNewsToTwitter };
