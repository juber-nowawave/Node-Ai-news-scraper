const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment'); // You might need moment or just use native Date

const headers = { "User-Agent": "Mozilla/5.0" };

function getTodayDate() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

const scraperService = {
    async fetchLiveMintNews() {
        const url = "https://www.livemint.com/latest-news";
        const news = [];
        try {
            const { data } = await axios.get(url, { headers });
            const $ = cheerio.load(data);
            
            // Limit to 5
            $('h2').slice(0, 5).each((i, el) => {
                const title = $(el).text().trim();
                const anchor = $(el).find('a');
                let link = anchor.attr('href');
                if (link && !link.startsWith('http')) {
                    link = `https://www.livemint.com${link}`;
                }
                news.push({ headline: title, sourcelink: link, date: getTodayDate() });
            });
        } catch (error) {
            console.error("Error fetching LiveMint:", error.message);
        }
        return news;
    },

    async fetchEconomicTimesNews() {
        const url = "https://economictimes.indiatimes.com/markets/stocks/news";
        const news = [];
        try {
            const { data } = await axios.get(url, { headers });
            const $ = cheerio.load(data);

            $('h3').slice(0, 5).each((i, el) => {
                const title = $(el).text().trim();
                const anchor = $(el).find('a');
                let link = anchor.attr('href');
                if (link && !link.startsWith('http')) {
                    link = `https://economictimes.indiatimes.com${link}`;
                }
                news.push({ headline: title, sourcelink: link, date: getTodayDate() });
            });
        } catch (error) {
            console.error("Error fetching Economic Times:", error.message);
        }
        return news;
    },

    async fetchNews18News() {
        const url = "https://www.news18.com/business/";
        const news = [];
        try {
            const { data } = await axios.get(url, { headers });
            const $ = cheerio.load(data);

            $('h2').slice(0, 5).each((i, el) => {
                const title = $(el).text().trim();
                const anchor = $(el).find('a');
                if (anchor.length) {
                    let link = anchor.attr('href');
                    if (link) {
                        if (!link.startsWith('http')) {
                            link = `https://www.news18.com${link}`;
                        }
                        news.push({ headline: title, sourcelink: link, date: getTodayDate() });
                    }
                }
            });
        } catch (error) {
            console.error("Error fetching News18:", error.message);
        }
        return news;
    },

    async fetchMoneyControlNews() {
        const url = "https://www.moneycontrol.com/news/business/economy/";
        const news = [];
        try {
            const { data } = await axios.get(url, { headers });
            const $ = cheerio.load(data);

            $('h2').slice(0, 5).each((i, el) => {
                const title = $(el).text().trim();
                const anchor = $(el).find('a');
                if (anchor.length) {
                     let link = anchor.attr('href');
                     if (link) {
                        if (!link.startsWith('http')) {
                            link = `https://www.moneycontrol.com${link}`;
                        }
                        news.push({ headline: title, sourcelink: link, date: getTodayDate() });
                     }
                }
            });
        } catch (error) {
            console.error("Error fetching MoneyControl:", error.message);
        }
        return news;
    },

    async fetchAllNews() {
        const [livemint, et, news18, moneycontrol] = await Promise.all([
            this.fetchLiveMintNews(),
            this.fetchEconomicTimesNews(),
            this.fetchNews18News(),
            this.fetchMoneyControlNews()
        ]);
        return [...livemint, ...et, ...news18, ...moneycontrol];
    }
};

module.exports = scraperService;
