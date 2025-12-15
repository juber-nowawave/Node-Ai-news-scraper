const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");
require('dotenv').config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const aiService = {
  
  async fetchRSSNews() {
      const RSS_FEEDS = [
          "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
          "https://www.moneycontrol.com/rss/MCtopnews.xml"
      ];

      let allNewsItems = [];

      for (const url of RSS_FEEDS) {
          try {
              console.log(`📡 Fetching RSS Feed: ${url}`);
              const { data } = await axios.get(url, {
                  headers: {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                  }
              });
              const $ = cheerio.load(data, { xmlMode: true });

              $('item').each((i, el) => {
                  const title = $(el).find('title').text();
                  const link = $(el).find('link').text();
                  const description = $(el).find('description').text();
                  const pubDate = $(el).find('pubDate').text();

                  allNewsItems.push({ title, link, description, pubDate });
              });

          } catch (error) {
              console.error(`❌ Error fetching RSS ${url}:`, error.message);
          }
      }

      return allNewsItems;
  },

  /**
   * Fetches news using RSS Feeds and filters/formats it using Groq.
   */
  async fetchNewsWithGroq() {
    try {
      console.log(`🔄 Fetching news from RSS feeds...`);
      const newsItems = await this.fetchRSSNews();

      if (!newsItems || newsItems.length === 0) {
        return "No news found.";
      }

      // Limit results to fit context (latest 30 items)
      const snippets = newsItems.slice(0, 30).map(r => 
        `Title: ${r.title}\nLink: ${r.link}\nPublished: ${r.pubDate}\nSnippet: ${r.description}`
      ).join("\n\n---\n\n");

      const prompt = `
      You are a news aggregator. 
      Review the provided RSS news items and select the top 5 most important stories.
      
      Categories to include:
      - India’s Economy (Stock Market, IPOs, Indices, etc.).
      - Political/Geopolitical News impacting the market.
      - Major Financial Updates.
      - Global Market News affecting India.

      Format each news as:
      Headline: [Exact Headline]
      News Content: [Summary based on snippet (approx 30 words)]
      Date & Time: [Extracted from Published Date]
      Source Link: [Exact URL]

      Important:
      - Do NOT include irrelevant, duplicate, or broken-link articles.
      - Prioritize the most recent news.
      
      RSS News Items:
      ${snippets}
      `;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: "You are a helpful financial news assistant." },
          { role: "user", content: prompt }
        ],
        model: "llama-3.1-8b-instant",
        temperature: 0.5,
      });

      return completion.choices[0]?.message?.content || "";

    } catch (error) {
      console.error("❌ Error in fetchNewsWithGroq:", error);
      return "";
    }
  },

  /**
   * Uses Gemini to rewrite the news content into JSON format.
   * Mirrors the 'chat_with_gemini' function in app.py.
   */
  async rewriteNewsWithGemini(rawNewsContent) {
    if (!rawNewsContent) return null;

    console.log("🤖 Sending to Gemini for rewriting...");
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
    INSTRUCTIONS:
    - Rewrite each headline in a suspenseful yet professional way.
    - Only include that news that may impact the economy or the stock market or like financial related or may affect the indian market only. discard other irrelevant news.
    - Strictly get news article from each news[sourcelink] and then rewrite each news article while maintaining accuracy.
    - Ensure rewritten content is **exactly 200 characters**.
    - Format into well-structured paragraphs.
    - Strictly preserve numerical data, stock indices, and key facts.
    - Strictly Include only unique articles from today, avoiding duplicates.
    - Strictly Identify and remove duplicate articles that convey the same core event or information, even if phrased differently, and keep only one.
    - Analyze the news content and assign a sentiment score from -5 to 5, where -5 to -4 is "worse," -3 to -1 is "bad," 0 is "average," 1 to 3 is "good," 4 is "better," and 5 is "best," returning only the numerical score.
    - Analyze the news content and calculate its overall weightage based on its economic impact on Indian Economy (High, Moderate, Low) and sentiment score (-5 to 5). Assign a final weightage score that reflects both factors, emphasizing news with high impact and high sentiment scores.
    - Follow this JSON format strictly:
    The output must be an array where each news article follows this structure:

             [
                 {"title": "Rewritten Headline", 
                   "description": "Rewritten News should be in simple english - easy to understand (strictly in 200 characters only)", 
                   "url": "take Source Link as it is from the provided data ", 
                    "category":"put India in all." ,
                    "sentiment":"Analyze the news content and assign a sentiment score from -5 to 5, where -5 to -4 is "worse," -3 to -1 is "bad," 0 is "average," 1 to 3 is "good," 4 is "better," and 5 is "best," returning only the numerical score.",
                    "weightage":"Analyze the news content and calculate its overall weightage based on its economic impact on Indian Economy (High, Moderate, Low) and sentiment score (-5 to 5). Assign a final weightage score that reflects both factors, emphasizing news with high impact and extreme sentiment scores."

                }
                 {next news in the same format}, ...
             ]

              EXTRACT ALL NEWS ARTICLES FROM THE FOLLOWING DATA AND STRICTLY FOLLOW THE ABOVE INSTRUCTIONS:

          ${rawNewsContent}

        REMEMBER: Strictly From this whole data above Identify and remove duplicate articles that convey the same core event or information, even if phrased differently, and keep only one.

                    
     `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // Extract JSON from markdown code block if present
    const jsonMatch = text.match(/\[\s*\{.*\}\s*\]/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    } else {
      // Try parsing the whole text if no block found
      try {
          // Check if it starts with [ or {
          if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
              return JSON.parse(text);
          }
      } catch(e) {
          console.error("❌ Failed to parse JSON from Gemini response:", text);
          return null;
      }
    }
    return null;
  },

  /**
   * Identifies and removes duplicate news.
   * Mirrors remove_duplicate_agent.py
   */
  async removeDuplicateNews(data) {
    if (!data) return "nan";
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `
        INSTRUCTIONS:
        - Identify and remove duplicate news that convey the same core event.
        - Output strictly an array of maximum 30 objects.
        - JSON Format: [{"title": "...", "description": "...", "url": "...", "category": "...", "sentiment": 0, "weightage": "..."}]
        
        EXTRACT FROM:
        ${JSON.stringify(data)}
        `;

        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        return `Error: ${e}`;
    }
  },

  /**
   * Scrapes world news from multiple sources:
   * 1. India Today (Business) - Note: Python code had this but description said Livemint? 
   *    Actually Python code calls fetch_indiatoday_news, fetch_livemint_world_news, fetch_moneycontrol_news, fetch_economic_times_news.
   *    I will implement Livemint, Moneycontrol, ET as per user request + code analysis.
   */
  async fetchWorldNewsFromWeb() {
      let allNewsItems = [];
      const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };

      const fetchSafe = async (url, sourceName, parseFn) => {
          try {
              console.log(`📡 Fetching ${sourceName}: ${url}`);
              const { data } = await axios.get(url, { headers });
              const $ = cheerio.load(data);
              parseFn($);
          } catch (error) {
              console.error(`❌ Error fetching ${sourceName}:`, error.message);
          }
      };

      // 1. LiveMint World News
      await fetchSafe("https://www.livemint.com/news/world", "LiveMint", ($) => {
          $("h2.headline").slice(0, 25).each((i, el) => {
              const titleTag = $(el).find('a');
              if (titleTag.length) {
                  const title = $(el).text().trim();
                  let link = titleTag.attr('href');
                  if (link && !link.startsWith('http')) {
                      link = `https://www.livemint.com${link}`;
                  }
                  allNewsItems.push({ headline: title, sourcelink: link });
              }
          });
      });

      // 2. MoneyControl World News
      await fetchSafe("https://www.moneycontrol.com/world/news/", "MoneyControl", ($) => {
          $("ul#cagetory li").slice(0, 20).each((i, el) => {
             const titleTag = $(el).find("h2 a");
             if (titleTag.length) {
                 const title = titleTag.text().trim();
                 let link = titleTag.attr('href');
                 if (link && !link.startsWith('http')) {
                     link = `https://www.moneycontrol.com${link}`;
                 }
                 allNewsItems.push({ headline: title, sourcelink: link });
             }
          });
      });

      // 3. Economic Times International
      await fetchSafe("https://economictimes.indiatimes.com/news/international", "Economic Times", ($) => {
          $(".top-news ul.list1 li a").slice(0, 20).each((i, el) => {
              const title = $(el).text().trim();
              let link = $(el).attr('href');
              if (link && !link.startsWith('http')) {
                  link = `https://economictimes.indiatimes.com${link}`;
              }
              allNewsItems.push({ headline: title, sourcelink: link });
          });
      });

      console.log(`✅ Fetched ${allNewsItems.length} world news items.`);
      return allNewsItems;
  },

  /**
   * Rewrites World News using Gemini with the specific World prompt.
   */
  async rewriteWorldNewsWithGemini(rawNewsItems) {
    if (!rawNewsItems || rawNewsItems.length === 0) return null;

    console.log("🤖 Sending World News to Gemini for rewriting...");
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
    INSTRUCTIONS:
    - Rewrite each headline in a suspenseful yet professional way.
    - Only include that news that may impact the economy or the stock market or like financial related or may affect the indian market only. discard other irrelevant news.
    - Strictly get news article from each news[sourcelink] and then rewrite each news article while maintaining accuracy.
    - Ensure rewritten content is **exactly 200 characters**.
    - Format into well-structured paragraphs.
    - Strictly preserve numerical data, stock indices, and key facts.
    - Strictly Include only unique articles from today, avoiding duplicates.
    - Strictly Identify and remove duplicate articles that convey the same core event or information, even if phrased differently, and keep only one.
    - Analyze the news content and assign a sentiment score from -5 to 5, where -5 to -4 is "worse," -3 to -1 is "bad," 0 is "average," 1 to 3 is "good," 4 is "better," and 5 is "best," returning only the numerical score.
    - Analyze the news content and calculate its overall weightage based on its economic impact on Indian Economy (High, Moderate, Low) and sentiment score (-5 to 5). Assign a final weightage score that reflects both factors, emphasizing news with high impact and high sentiment scores.
    - Follow this JSON format strictly:
    The output must be an array where each news article follows this structure:

             [
                 {"title": "Rewritten Headline", 
                   "description": "Rewritten News should be in simple english - easy to understand (strictly in 200 characters only)", 
                   "url": "take Source Link as it is from the provided data ",
                   "category":"put World in all." ,
                   "sentiment":"Analyze the news content and assign a sentiment score from -5 to 5, where -5 to -4 is "worse," -3 to -1 is "bad," 0 is "average," 1 to 3 is "good," 4 is "better," and 5 is "best," returning only the numerical score.",
                   "weightage":"Analyze the news content and calculate its overall weightage based on its economic impact on Indian Economy (High, Moderate, Low) and sentiment score (-5 to 5). Assign a final weightage score that reflects both factors, emphasizing news with high impact and extreme sentiment scores."
                   }
                 {next news in the same format}, ...
             ]

              EXTRACT ALL NEWS ARTICLES FROM THE FOLLOWING DATA AND STRICTLY FOLLOW THE ABOVE INSTRUCTIONS:

          ${JSON.stringify(rawNewsItems)}

        REMEMBER: Strictly From this whole data above Identify and remove duplicate articles that convey the same core event or information, even if phrased differently, and keep only one.
     `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Extract JSON from markdown code block if present
        const jsonMatch = text.match(/\[\s*\{.*\}\s*\]/s);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
                return JSON.parse(text);
            }
        }
        return null;
    } catch (e) {
        console.error("❌ Failed to process World News with Gemini:", e);
        return null;
    }
  }
};

module.exports = aiService;
