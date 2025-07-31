// 📌 Import dependencies
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import qrcode from 'qrcode-terminal';
import fs from 'fs';
import notifier from 'node-notifier';
import cron from 'node-cron';
import { differenceInMinutes } from 'date-fns';
 import { GoogleGenAI } from "@google/genai";
import { exec } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

// 📌 Config
const GROUP_NAME = "TPO Information IT 2027";
// const GROUP_NAME = "H";
const DB_FILE = path.join(__dirname, 'deadlines.json');
console.log(DB_FILE);


console.log(process.env.GEMINI_API_KEY);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY  });

// 📌 Load deadlines DB
let deadlines = [];

if (fs.existsSync(DB_FILE)) {
    const content = fs.readFileSync(DB_FILE, 'utf-8').trim();
    deadlines = content ? JSON.parse(content) : [];
} else {
    deadlines = [];
}


// 📌 WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true }
});

// Generate QR on first login
client.on('qr', qr => qrcode.generate(qr, { small: true }));

client.on('ready', async () => {
    console.log('✅ WhatsApp Client Ready new');

    
});

// 📌 Message listener
client.on('message', async msg => {
   
    const chat = await msg.getChat();
    
    if (chat.isGroup && chat.name === GROUP_NAME) {
        


        // Analyze with OpenAI
        const analysis = await analyzeMessage(msg.body);
        console.log("analysis",analysis);
        if (analysis.containsDeadline) {
            deadlines.push({
                msg: msg.body,
                time: analysis.deadlineISO,
                notified: false
            });
             
            fs.writeFileSync(DB_FILE, JSON.stringify(deadlines, null, 2));

            notify(`New Deadline Detected`, msg.body);
        }
    }
});

client.initialize();

// 📌 OpenAI Deadline Analyzer
async function analyzeMessage(text) {
    
    const prompt = `
    Analyze this message and determine if it contains a deadline. Your analysis should focus solely on extracting deadline-related information:

* Detect whether the message specifies a deadline (explicit or implicit).
* If a deadline exists, extract it and convert it into an ISO 8601 datetime format (YYYY-MM-DDTHH:mm).
* Current time is ${new Date() } to help with implicit deadline detection.
* If no exact time is mentioned, use "00:00" as the default time.
* If no deadline is found, return "containsDeadline" as false and "deadlineISO" as null.

Respond ONLY in this JSON format and do not include any other text or markdown in the answer:

{
"containsDeadline": true,
"deadlineISO": "2025-08-02T18:00"
}

---

IMPORTANT:

* Respond with *only* valid raw JSON.
* Do NOT include markdown, code fences, comments, or any extra formatting.
* The format must be a raw JSON object.

Repeat: Do not wrap your output in markdown or code fences.

Message: "${text}"

    `;

    const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [{
            role : "user",
            parts : [{text: prompt}],
        }],
    });
    


    
    try {
        let raw;
        if (response.text) {
            raw = response.text;
        } else {
            raw = response?.candidates?.[0]?.content?.parts?.[0]?.text;
        }
        

        const match = raw.match(/```json\s*([\s\S]*?)\s*```/i);
        const jsonString = match ? match[1] : raw.trim();
        const json = JSON.parse(jsonString);
       

        return json;
    } catch {
        return { containsDeadline: false, deadlineISO: null };
    }
}

// 📌 Notification Function
async function  notify (title, message) {

    if (isTermux()) {
        exec(`termux-notification --title "${title}" --content "${message}"`);
    } else {
        notifier.notify({ title, message });
    }

     const chatId = "916261021177@c.us"; // Your own WhatsApp number with country code
    await client.sendMessage(chatId, `🔔 ${title}\n${message}`);

}

// Detect if running in Termux
function isTermux() {
    return process.env.PREFIX && process.env.PREFIX.includes('com.termux');
}


// 📌 Cron job to check deadlines every minute
cron.schedule('* * * * *', () => {
    const now = new Date();
    deadlines.forEach(dl => {
        if (!dl.notified && dl.time) {
            const diff = differenceInMinutes(new Date(dl.time), now);
            if (diff <= 120 && diff > 0) {
                notify(`⏰ Deadline in ${diff} mins`, dl.msg);
                dl.notified = true;
                fs.writeFileSync(DB_FILE, JSON.stringify(deadlines, null, 2));
            }
        }
    });
});
