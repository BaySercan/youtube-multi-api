require('dotenv').config();
const { spawn } = require('child_process');
const express = require("express");
const cors = require("cors");
const { promises: fs } = require("fs");
const path = require("path");
const axios = require('axios');
const rapidApiAuth = require('./middleware/auth');
const YTDlpWrap = require('yt-dlp-wrap').default;

// Initialize yt-dlp-wrap
let ytDlpWrap;

// Function to ensure yt-dlp binary is available
async function ensureYtDlpBinary() {
    try {
        // First try to initialize without path
        ytDlpWrap = new YTDlpWrap();
        // Test if binary exists
        await ytDlpWrap.getVersion();
        console.log('Using system yt-dlp binary');
    } catch (error) {
        console.log('yt-dlp binary not found, downloading...');
        // Download binary to bin directory
        const binDir = path.join(__dirname, 'bin');
        await fs.mkdir(binDir, { recursive: true });
        // Add .exe extension for Windows
        const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
        const binaryPath = path.join(binDir, binaryName);
        await YTDlpWrap.downloadFromGithub(binaryPath);
        ytDlpWrap = new YTDlpWrap(binaryPath);
        console.log('Downloaded yt-dlp to:', binaryPath);
    }
}

// Wrap initialization in async function
async function initializeServer() {
    await ensureYtDlpBinary();
    
    // Server listening logic
    const PORT = process.env.PORT || 3500;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on PORT: ${PORT}`);
    });
}

initializeServer().catch(err => {
    console.error('Failed to initialize server:', err);
    process.exit(1);
});

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Helper function to validate cookies file
async function validateCookiesFile() {
    try {
        await fs.access('cookies.txt');
        const stats = await fs.stat('cookies.txt');
        const content = await fs.readFile('cookies.txt', 'utf8');
        if (!content.includes('# Netscape HTTP Cookie File')) {
            console.warn('WARNING: cookies.txt does not appear to be in Netscape format.');
        }
        if (stats.size < 100) {
            console.warn('WARNING: cookies.txt file is too small.');
        }
        const hasYoutubeCookies = content.includes('youtube.com') || content.includes('.youtube.com');
        if (!hasYoutubeCookies) {
            console.warn('WARNING: cookies.txt does not contain YouTube domain cookies.');
        }
        const hasAuthCookies = content.includes('LOGIN_INFO') || content.includes('SID') || content.includes('HSID') || content.includes('SSID');
        if (!hasAuthCookies) {
            console.warn('WARNING: cookies.txt is missing authentication cookies.');
        }
        return hasYoutubeCookies && hasAuthCookies;
    } catch (error) {
        console.error('ERROR: cookies.txt file is missing or inaccessible.');
        return false;
    }
}

const app = express();
app.use(cors());

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, "temp");
fs.mkdir(tempDir, { recursive: true }).catch(console.error);

// Function to call OpenRouter API (no changes)
async function callAIModel(messages, useDeepSeek = true) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
        throw new Error('OPENROUTER_API_KEY environment variable is not set or empty');
    }
    const model = useDeepSeek ? 'deepseek/deepseek-r1-0528:free' : 'qwen/qwen3-14b:free';
    const maxRetries = 3;
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            console.log(`Calling ${model} - Attempt ${attempt + 1}`);
            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: model,
                messages: messages
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'https://github.com/yourusername/youtube-download-api',
                    'Content-Type': 'application/json'
                }
            });
            if (response.data && response.data.choices && response.data.choices[0]) {
                return response.data;
            } else {
                throw new Error('Invalid API response format');
            }
        } catch (error) {
            console.error(`API Error (Attempt ${attempt + 1}):`, error.message);
            if (error.response) {
                console.error('Response Data:', error.response.data);
            }
            attempt++;
            if (attempt === maxRetries - 1 && useDeepSeek) {
                console.log('Switching to backup model (qwen)…');
                return callAIModel(messages, false);
            }
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw new Error('Failed to get response after maximum retries');
}

// Helper function to get video info using yt-dlp-wrap
async function getVideoInfo(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Fetching video info for: ${url}`);
            const args = [
                '--dump-json',
                '--no-warnings',
                '--no-check-certificates',
                '--user-agent', USER_AGENT,
                url
            ];

            const hasValidCookies = await validateCookiesFile();
            if (hasValidCookies) {
                args.push('--cookies', path.resolve(__dirname, 'cookies.txt'));
                console.log('Using cookies for authentication');
            }

            // The library finds the binary automatically.
            const stdout = await ytDlpWrap.execPromise(args);
            const info = JSON.parse(stdout);
            console.log(`Successfully fetched info for video: ${info.title}`);
            return info;

        } catch (error) {
            console.error(`Error getting video info (attempt ${i+1}/${retries}):`, error);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Helper function to get video transcript
async function getVideoTranscript(url, lang = 'tr') {
    const info = await getVideoInfo(url);
    const tracks = info.automatic_captions?.[lang] || info.subtitles?.[lang] || [];
    if (tracks.length === 0) {
        const availableLangs = Object.keys(info.automatic_captions || {});
        throw new Error(`No subtitles available for language: ${lang}. Available: ${availableLangs.join(', ')}`);
    }
    const track = tracks.find(t => t.ext === 'ttml' || t.ext === 'xml' || t.ext === 'srv1') || tracks[0];
    const transcriptResponse = await axios.get(track.url);
    return transcriptResponse.data;
}

// Routes

app.get("/ping", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});
app.get("/validate-cookies", async (req, res) => {
    // This endpoint remains the same
    try {
        const cookiesPath = path.resolve(__dirname, 'cookies.txt');
        const exists = await fs.access(cookiesPath).then(() => true).catch(() => false);
        if(!exists) return res.status(404).json({ valid: false, message: 'cookies.txt not found' });
        const content = await fs.readFile(cookiesPath, 'utf8');
        const youtubeCookies = content.includes('.youtube.com');
        const authCookies = content.includes('LOGIN_INFO') && content.includes('SID');
        const isValid = youtubeCookies && authCookies;
        res.json({ valid: isValid, message: isValid ? 'Valid cookies found' : 'Missing required YouTube cookies' });
    } catch (error) {
        res.status(500).json({ valid: false, error: error.message });
    }
});

app.use(rapidApiAuth);

app.get("/info", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url parameter");
    try {
        const info = await getVideoInfo(Array.isArray(url) ? url[0] : url);
        res.send({
            title: info.title,
            thumbnail: info.thumbnail,
            video_id: info.id,
            channel_id: info.channel_id,
            channel_name: info.channel,
            post_date: new Date(`${info.upload_date.substring(0,4)}-${info.upload_date.substring(4,6)}-${info.upload_date.substring(6,8)}`).toISOString()
        });
    } catch (error) {
        res.status(400).send("Invalid url or error fetching video info");
    }
});

app.get("/mp3", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url parameter");
    const videoUrl = Array.isArray(url) ? url[0] : url;

    try {
        const info = await getVideoInfo(videoUrl);
        const fileName = `${info.title.replace(/[^\w\s.-]/gi, '')}.mp3`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'audio/mpeg');

        const args = [
            '--extract-audio',
            '--audio-format', 'mp3',
            '--no-check-certificates',
            '--no-warnings',
            '--user-agent', USER_AGENT,
            '-o', '-', // Output to stdout
            videoUrl
        ];

        const hasValidCookies = await validateCookiesFile();
        if (hasValidCookies) {
            args.push('--cookies', path.resolve(__dirname, 'cookies.txt'));
        }

        // Use Node.js spawn directly for better stream control
        const child = spawn(ytDlpWrap.binaryPath, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        child.stdout.pipe(res);
        child.stderr.on('data', (data) => console.error(`[yt-dlp stderr] ${data}`));
        
        child.on('error', (err) => {
            console.error('Streaming error:', err);
            if (!res.headersSent) res.status(500).send('Error streaming audio');
        });

    } catch (error) {
        console.error("Error:", error);
        if (!res.headersSent) res.status(400).send("Error downloading audio");
    }
});

app.get("/mp4", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url parameter");
    const videoUrl = Array.isArray(url) ? url[0] : url;

    try {
        const info = await getVideoInfo(videoUrl);
        const fileName = `${info.title.replace(/[^\w\s.-]/gi, '')}.mp4`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'video/mp4');

        const args = [
            '--format', 'mp4',
            '--no-check-certificates',
            '--no-warnings',
            '--user-agent', USER_AGENT,
            '-o', '-', // Output to stdout
            videoUrl
        ];
        
        const hasValidCookies = await validateCookiesFile();
        if (hasValidCookies) {
            args.push('--cookies', path.resolve(__dirname, 'cookies.txt'));
        }

        // Use Node.js spawn directly for better stream control
        const child = spawn(ytDlpWrap.binaryPath, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        child.stdout.pipe(res);
        child.stderr.on('data', (data) => console.error(`[yt-dlp stderr] ${data}`));
        
        child.on('error', (err) => {
            console.error('Streaming error:', err);
            if (!res.headersSent) res.status(500).send('Error streaming video');
        });

    } catch (error) {
        console.error("Error:", error);
        if (!res.headersSent) res.status(400).send("Error downloading video");
    }
});

app.get("/transcript", async (req, res) => {
    const { url, lang = 'tr' } = req.query;
    const skipAI = req.query.skipAI === 'true';
    const useDeepSeek = req.query.useDeepSeek !== 'false';

    // Validate and normalize URL parameter
    if (!url) {
        return res.status(400).send("Missing url parameter");
    }
    
    // Handle case where url might be an array (multiple params)
    const videoUrl = Array.isArray(url) ? url[0] : url;
    
    if (typeof videoUrl !== 'string') {
        return res.status(400).send("url parameter must be a string");
    }

    try {
        const info = await getVideoInfo(videoUrl);
        const transcriptXml = await getVideoTranscript(videoUrl, lang);
        
        // Parse transcript (supports XML and WebVTT formats)
        let subtitleLines = [];
        if (transcriptXml.includes('<text')) {
            // TTML/XML format
            const lines = transcriptXml.match(/<text[^>]*>([^<]+)<\/text>/g) || [];
            subtitleLines = lines.map(line => {
                return line.replace(/<text[^>]*>/, '').replace(/<\/text>/, '');
            });
        } else if (transcriptXml.includes('WEBVTT')) {
            // WebVTT format
            subtitleLines = transcriptXml.split('\n')
                .filter(line => line.trim() && !line.startsWith('WEBVTT') && 
                                !line.startsWith('NOTE') && !line.includes('-->'))
                .map(line => line.trim());
        } else {
            throw new Error('Unsupported transcript format');
        }

        // Basic cleanup of the text
        const cleanedLines = subtitleLines.map(line => 
            line.replace(/\r/g, '')
                .replace(/<[^>]+>/g, '') // Remove HTML-like tags
                .replace(/\{[^\}]+\}/g, '') // Remove curly brace annotations
                .replace(/^\s*-\s*/gm, '') // Remove leading dashes
                .trim()
        ).filter(line => line); // Remove empty lines

        let finalTranscript;
        let aiNotes = null;
        let processorUsed = useDeepSeek ? 'deepseek' : 'qwen';

        if (!skipAI) {
            try {
                // Process entire text at once
                const rawText = cleanedLines.join(' ');
                const messages = [
                    {
                        role: "system",
                        content: `You are a transcript editor. When processing the following text, you MUST follow these rules:
                        1. Detect the language of the text and do not attempt to translate it
                        2. Remove ALL repeated sentences or phrases (only those that are exact or very similar)
                        3. Correct punctuation, spelling, and basic grammar mistakes
                        4. Convert spoken language to standard written language, but DO NOT change the structure or order of sentences
                        5. DO NOT rewrite, merge, split, summarize, or interpret sentences
                        6. DO NOT add or remove any information, only remove repetitions and fix writing errors
                        7. STRICTLY PRESERVE the meaning, tone, and original structure of the sentences
                        8. Only remove unnecessary repetitions and fix writing errors, NEVER summarize or rephrase the text
                        9. RETURN ONLY THE EDITED TRANSCRIPT as output. Do NOT add explanations, summaries, process notes, or any other information.
                        10. If you must add an explanation or process note, start it on a separate line with 'NOTE:'. But if possible, return only the transcript.`
                    },
                    {
                        role: "user",
                        content: rawText
                    }
                ];

                // First pass - clean up and format
                const firstResponse = await callAIModel(messages, useDeepSeek);
                
                // Update processor if we switched to backup model
                if (firstResponse.modelUsed === 'qwen') {
                    processorUsed = 'qwen';
                }
                
                // Second pass - final cleanup for duplicates
                const cleanupMessages = [
                    {
                        role: "system",
                        content: `You are a text editor. Do a final check of the following text:
                        1. Detect the language of the text and do not attempt to translate it
                        2. Find and remove any remaining repeated sentences or phrases (only those that are exact or very similar)
                        3. DO NOT change the order, structure, or meaning of the sentences
                        4. Only remove repetitions, do not add or remove any new information. Remove \n characters as needed.
                        5. STRICTLY PRESERVE the main idea, details, and original form of the sentences
                        6. RETURN ONLY THE TRANSCRIPT as output. Do NOT add explanations, summaries, process notes, or any other information.
                        7. If you must add an explanation or process note, start it on a separate line with 'NOTE:'. But if possible, return only the transcript.`
                    },
                    {
                        role: "user",
                        content: firstResponse.choices[0].message.content
                    }
                ];

                const finalResponse = await callAIModel(cleanupMessages, useDeepSeek);
                
                // After getting finalResponse, split transcript and notes if needed
                let transcriptText = finalResponse.choices[0].message.content.trim();
                if (transcriptText.includes('NOTE:')) {
                    const [main, ...notes] = transcriptText.split(/\n?NOTE:/);
                    transcriptText = main.trim();
                    aiNotes = notes.join('NOTE:').trim();
                }
                finalTranscript = transcriptText;

            } catch (error) {
                console.error('AI processing error:', error);
                // Fallback to basic cleaned text if AI processing fails
                finalTranscript = cleanedLines.join(' ');
            }
        } else {
            // Skip AI processing and just return the cleaned text
            finalTranscript = cleanedLines.join(' ');
        }

        const isProcessed = !skipAI && finalTranscript && finalTranscript.trim().length > 0;
        // Format the response
        res.json({
            success: true,
            title: info.title,
            language: lang,
            transcript: finalTranscript,
            ai_notes: aiNotes,
            isProcessed: isProcessed,
            processor: processorUsed,
            video_id: info.id,
            channel_id: info.channel_id,
            channel_name: info.channel,
            post_date: new Date(
                `${info.upload_date.substring(0,4)}-${info.upload_date.substring(4,6)}-${info.upload_date.substring(6,8)}`
            ).toISOString()
        });

    } catch (error) {
        console.error("Transcript Error:", error);
        res.status(400).json({
            success: false,
            error: `Could not fetch transcript: ${error.message}. Video might not have subtitles in the requested language or they are disabled.`
        });
    }
});
