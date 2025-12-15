const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.TERMS_PORT || 4000;
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("❌ Missing GEMINI_API_KEY");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const MODEL_NAME = "gemini-2.0-flash";

const systemInstruction = `
You are Parikshit, an AI assistant from Now a Wave. Your goal is to automate tasks and streamline business processes efficiently. 
You are an expert in financial and market-related terminology. Follow these instructions based on user queries:

1. If the user asks "What is [term]?" (e.g., 'What is Alpha?' or 'What is Affiliate?') for any financial or market-related term, provide a detailed response in a dictionary-like format with the following keys:
   - "Definition": Provide a precise, finance-specific definition.
   - "Formula" (if applicable): Include formula or 'Not applicable'.
   - "Usage in Stock Market Investing": Explain usage with example.
   - "Usage in Mutual Funds": Describe relevance.
   - "Usage in Portfolio Management": Discuss application.
   - "Comparison" (if applicable): Compare to related concept.
   - "Historical Case Study": Provide specific historical example.
   Format as JSON dictionary provided in a code block.

2. If the user asks for terms starting with a specific letter (e.g., 'Tell me the terms that start with A'), generate exactly 50 unique financial terms in an array format.
3. If the user says 'tell me more', generate 50 more unique terms.
4. Treat letter requests as case-insensitive.
5. For other queries, respond naturally.
6. Ensure no repetition.
7. Avoid generic interpretations.
8. OUTPUT MUST BE VALID JSON inside a markdown code block for structured requests.
`;

const model = genAI.getGenerativeModel({ 
    model: MODEL_NAME,
    systemInstruction: {
        role: "system",
        parts: [{ text: systemInstruction }]
    }
});

let chatHistory = [
    {
        role: "user",
        parts: [{ text: "Hello" }],
    },
    {
        role: "model",
        parts: [{ text: "Hi there! I'm Parikshit, your AI assistant from Now a Wave. How can I automate your tasks and streamline your business today? 😊" }],
    },
];

let chatSession = model.startChat({
    history: chatHistory
});

app.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: "Missing 'message' field" });
        }

        const result = await chatSession.sendMessage(message);
        const responseText = result.response.text();

        // Update local history if needed, but startChat maintains it in session usually.
        // However, JS SDK maintains history in the session object.
        
        let normalizedData = responseText;

        // Try to extract JSON
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
            try {
                normalizedData = JSON.parse(jsonMatch[1]);
            } catch (e) {
                console.error("JSON Parse Error:", e);
                // Fallback to raw text if parse fails but block exists
                // or keep normalizedData as string
            }
        } else {
             // Try parsing the whole text if it looks like JSON
             try {
                // If it starts with { or [, try parsing
                const trimmed = responseText.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    normalizedData = JSON.parse(trimmed);
                }
             } catch(e) {
                 // Not JSON, return text
             }
        }

        res.json({ response: normalizedData });

    } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ Terms App (Parikshit) running on port ${PORT}`);
    });
}

module.exports = app;
