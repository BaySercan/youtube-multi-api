require('dotenv').config();
const { spawn } = require('child_process');
const express = require("express");
const cors = require("cors");
const { promises: fs } = require("fs");
const path = require("path");
const axios = require('axios');
const rapidApiAuth = require('./middleware/auth');
const ytdl = require('youtube-dl-exec');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Helper function to validate cookies file
async function validateCookiesFile() {
    try {
        await fs.access('cookies.txt');
        const stats = await fs.stat('cookies.txt');
        const content = await fs.readFile('cookies.txt', 'utf8');
        
        // Basic validation for Netscape cookie format
        if (!content.includes('# Netscape HTTP Cookie File')) {
            console.warn('WARNING: cookies.txt does not appear to be in Netscape format. YouTube may reject it.');
        }
        
        if (stats.size < 100) {
            console.warn('WARNING: cookies.txt file is too small (less than 100 bytes). YouTube may still block requests.');
        }
        
        // Check for YouTube-specific cookies
        const hasYoutubeCookies = content.includes('youtube.com') || content.includes('.youtube.com');
        if (!hasYoutubeCookies) {
            console.warn('WARNING: cookies.txt does not contain YouTube domain cookies. Export cookies specifically for YouTube.');
        }
        
        // Check for authentication cookies
        const hasAuthCookies = content.includes('LOGIN_INFO') ||
                               content.includes('SID') ||
                               content.includes('HSID') ||
                               content.includes('SSID');
        if (!hasAuthCookies) {
            console.warn('WARNING: cookies.txt is missing authentication cookies. Make sure you export cookies while logged into YouTube.');
        }
        
        return hasYoutubeCookies && hasAuthCookies;
    } catch (error) {
        console.error('ERROR: cookies.txt file is missing or inaccessible. YouTube may block requests.');
        console.error('To fix this, export your YouTube cookies and save them as cookies.txt in the project root.');
        console.error('See: https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies');
        return false;
    }
}

const app = express();
app.use(cors());

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, "temp");
fs.mkdir(tempDir, { recursive: true }).catch(console.error);

// Function to call OpenRouter API
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
            
            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', 
            {
                model: model,
                messages: messages
            }, 
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'https://github.com/yourusername/youtube-download-api',
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.choices && response.data.choices[0]) {
                console.log('API Response:', {
                    model: model,
                    usage: response.data.usage,
                    content_length: response.data.choices[0].message.content.length
                });
                return response.data;
            } else {
                throw new Error('Invalid API response format');
            }
        } catch (error) {
            console.error(`API Error (Attempt ${attempt + 1}):`, error.message);
            
            if (error.response) {
                console.error('Response Data:', error.response.data);
                console.error('Status:', error.response.status);
            }

            attempt++;
            
            // On last attempt, try the other model as fallback
            if (attempt === maxRetries - 1 && useDeepSeek) { // one hop only
                console.log('Switching to backup model (qwen)…');
                return callAIModel(messages, false);
            }
            
            // Wait before retry (exponential backoff)
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw new Error('Failed to get response after maximum retries');
}

// Helper function to get video info with retry
async function getVideoInfo(url, retries = 3) {
    // Fix common URL formatting issues
    let fixedUrl = url;
    if (url.includes('/watch/v=')) {
        fixedUrl = url.replace('/watch/v=', '/watch?v=');
    }
    
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const hasValidCookies = await validateCookiesFile();
    
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Fetching video info for: ${fixedUrl}`);
            
            // Use spawn directly for better path handling
            // Get the path to yt-dlp executable and quote it for Windows
            const ytDlpPath = require.resolve('youtube-dl-exec/bin/yt-dlp' + (process.platform === 'win32' ? '.exe' : ''));
            const quotedPath = process.platform === 'win32' ? `"${ytDlpPath}"` : ytDlpPath;
            
            const args = [
                '--dump-json',
                '--no-warnings',
                '--no-check-certificates',
                '--ignore-errors',   // Continue even if there are errors (e.g., format not available)
                '--skip-download',  // Explicitly skip download attempts
                `--user-agent="${USER_AGENT}"`,
                fixedUrl
            ];
            
            // Add cookies only if valid cookies file exists
            if (hasValidCookies) {
                // Use absolute path to cookies.txt to ensure yt-dlp can find it
                const cookiesPath = path.resolve(__dirname, 'cookies.txt');
                // Properly quote the path to handle spaces
                args.push('--cookies', `"${cookiesPath}"`);
                console.log(`Using cookies from ${cookiesPath} for authentication`);
            } else {
                console.log('Proceeding without cookies - YouTube may block requests');
            }
            
            // Use spawn instead of execAsync to avoid shell parsing issues
            const { stdout, stderr } = await new Promise((resolve, reject) => {
                const child = spawn(quotedPath, args, { shell: true });
                let stdoutData = '';
                let stderrData = '';
                
                child.stdout.on('data', data => stdoutData += data);
                child.stderr.on('data', data => stderrData += data);
                
                child.on('error', reject);
                child.on('close', code => {
                    // Try to parse JSON even if there's an error code
                    if (stdoutData.trim() !== '') {
                        try {
                            // Try to parse the output as JSON
                            JSON.parse(stdoutData);
                            resolve({ stdout: stdoutData, stderr: stderrData });
                            return;
                        } catch (e) {
                            // Not valid JSON, continue to error handling
                        }
                    }
                    
                    if (code === 0) {
                        resolve({ stdout: stdoutData, stderr: stderrData });
                    } else {
                        reject(new Error(`yt-dlp exited with code ${code}: ${stderrData}`));
                    }
                });
            });
            
            console.log('yt-dlp stdout:', stdout.substring(0, 500) + (stdout.length > 500 ? '...' : ''));
            if (stderr) {
                console.warn('yt-dlp stderr:', stderr);
            }
            
            const info = JSON.parse(stdout);
            console.log(`Successfully fetched info for video: ${info.title}`);
            return info;
        } catch (error) {
            console.error(`Error getting video info (attempt ${i+1}/${retries}):`, error);
            
            // Handle authentication errors specifically
            if (error.message.includes('Sign in to confirm you’re not a bot')) {
                console.error('\nAUTHENTICATION REQUIRED:');
                
                if (hasValidCookies) {
                    console.error('The provided cookies.txt file exists but YouTube rejected it.');
                    console.error('Possible reasons:');
                    console.error('1. Cookies are expired - export fresh cookies from YouTube');
                    console.error('2. Cookies are from wrong domain - ensure they include .youtube.com');
                    console.error('3. Cookies file format is invalid - must be Netscape format');
                } else {
                    console.error('No valid cookies.txt file found.');
                }
                
                console.error('Export fresh YouTube cookies:');
                console.error('1. Use a browser extension: https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp');
                console.error('2. Export manually: https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies');
                console.error('Save as cookies.txt in the project root directory.');
            }
            
            if (i === retries - 1) {
                throw error;
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Helper function to get video transcript
async function getVideoTranscript(url, lang = 'tr') {
    const info = await getVideoInfo(url);
    console.log(`Available automatic captions: ${JSON.stringify(info.automatic_captions)}`);
    console.log(`Available subtitles: ${JSON.stringify(info.subtitles)}`);
    
    const tracks = info.automatic_captions?.[lang] || info.subtitles?.[lang] || [];
    
    if (tracks.length === 0) {
        const availableLangs = Object.keys(info.automatic_captions || {});
        console.error(`No subtitles available for language: ${lang}. Available languages: ${availableLangs.join(', ')}`);
        throw new Error(`No subtitles available for language: ${lang}`);
    }
    
    // Prefer XML format if available, otherwise take the first one
    const track = tracks.find(t => t.ext === 'ttml' || t.ext === 'xml' || t.ext === 'srv1') || tracks[0];
    console.log(`Using transcript track: ${track.url}`);
    const transcriptResponse = await axios.get(track.url);
    return transcriptResponse.data;
}


// Health check endpoint (no authentication required)
app.get("/ping", (req, res) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0"
    });
});

// Cookie validation endpoint (no authentication required)
app.get("/validate-cookies", async (req, res) => {
    try {
        const cookiesPath = path.resolve(__dirname, 'cookies.txt');
        const exists = await fs.access(cookiesPath).then(() => true).catch(() => false);
        
        if (!exists) {
            return res.status(404).json({
                valid: false,
                message: 'cookies.txt file not found',
                path: cookiesPath,
                requiredCookies: ['LOGIN_INFO', 'SID', 'HSID', 'SSID']
            });
        }
        
        const content = await fs.readFile(cookiesPath, 'utf8');
        const cookies = content.split('\n')
            .filter(line => line.trim() && !line.startsWith('#'))
            .map(line => {
                const parts = line.split('\t');
                return {
                    domain: parts[0],
                    includeSubdomains: parts[1] === 'TRUE',
                    path: parts[2],
                    secure: parts[3] === 'TRUE',
                    expiration: parts[4],
                    name: parts[5],
                    value: parts[6]
                };
            });
            
        const youtubeCookies = cookies.filter(c =>
            c.domain.includes('youtube.com') || c.domain.includes('.youtube.com')
        );
        
        const authCookies = youtubeCookies.filter(c =>
            ['LOGIN_INFO', 'SID', 'HSID', 'SSID'].includes(c.name)
        );
        
        const isValid = youtubeCookies.length > 0 && authCookies.length > 0;
        
        res.json({
            valid: isValid,
            path: cookiesPath,
            fileSize: content.length,
            youtubeCookiesCount: youtubeCookies.length,
            authCookiesFound: authCookies.map(c => c.name),
            requiredCookies: ['LOGIN_INFO', 'SID', 'HSID', 'SSID'],
            validationMessage: isValid ?
                'Valid cookies.txt file with authentication cookies' :
                'Missing required YouTube authentication cookies'
        });
        
    } catch (error) {
        res.status(500).json({
            valid: false,
            error: error.message
        });
    }
});

// Apply RapidAPI authentication middleware to all routes except /ping
app.use(rapidApiAuth);

app.get("/info", async (req, res) => {
    const { url } = req.query;

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
        res.send({
            title: info.title,
            thumbnail: info.thumbnail,
            video_id: info.id,
            channel_id: info.channel_id,
            channel_name: info.channel,
            post_date: new Date(
              `${info.upload_date.substring(0,4)}-${info.upload_date.substring(4,6)}-${info.upload_date.substring(6,8)}`
            ).toISOString()
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(400).send("Invalid url or error fetching video info");
    }
});

app.get("/mp3", async (req, res) => {
    const { url } = req.query;

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
        // Get video info using existing function
        const info = await getVideoInfo(videoUrl);
        const fileName = `${info.title.replace(/[^\w\s]/gi, '')}.mp3`;
        
        // Set headers for streaming response
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'audio/mpeg');

        // Use youtube-dl-exec to stream the audio (platform-independent)
        const ytDlpPath = require.resolve('youtube-dl-exec/bin/yt-dlp' + (process.platform === 'win32' ? '.exe' : ''));
        const hasValidCookies = await validateCookiesFile();
        const args = [
            '--extract-audio',
            '--audio-format', 'mp3',
            '--no-check-certificates',
            '--no-warnings',
            '--user-agent', `"${USER_AGENT}"`,
            '-o', '-',
            videoUrl
        ];
        
        if (hasValidCookies) {
            const cookiesPath = path.resolve(__dirname, 'cookies.txt');
            args.push('--cookies', `"${cookiesPath}"`);
            console.log('Using cookies.txt for MP3 download');
        }
        
        const quotedPath = process.platform === 'win32' ? `"${ytDlpPath}"` : ytDlpPath;
        const child = spawn(quotedPath, args, { shell: true });
        
        child.stdout.pipe(res);
        
        // Handle errors
        child.on('error', (err) => {
            console.error('Streaming error:', err);
            if (!res.headersSent) {
                res.status(500).send('Error streaming audio');
            }
        });
        
        child.stderr.on('data', (data) => {
            console.error(`[yt-dlp stderr] ${data}`);
        });

    } catch (error) {
        console.error("Error:", error);
        if (!res.headersSent) {
            res.status(400).send("Error downloading audio");
        }
    }
});

app.get("/mp4", async (req, res) => {
    const { url } = req.query;

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
        // Get video info using existing function
        const info = await getVideoInfo(videoUrl);
        const fileName = `${info.title.replace(/[^\w\s]/gi, '')}.mp4`;
        
        // Set headers for streaming response
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'video/mp4');

        // Use youtube-dl-exec to stream the video (platform-independent)
        const ytDlpPath = require.resolve('youtube-dl-exec/bin/yt-dlp' + (process.platform === 'win32' ? '.exe' : ''));
        const hasValidCookies = await validateCookiesFile();
        const args = [
            '--format', 'mp4',
            '--no-check-certificates',
            '--no-warnings',
            '--user-agent', `"${USER_AGENT}"`,
            '-o', '-',
            videoUrl
        ];
        
        if (hasValidCookies) {
            const cookiesPath = path.resolve(__dirname, 'cookies.txt');
            args.push('--cookies', `"${cookiesPath}"`);
            console.log('Using cookies.txt for MP4 download');
        }
        
        const quotedPath = process.platform === 'win32' ? `"${ytDlpPath}"` : ytDlpPath;
        const child = spawn(quotedPath, args, { shell: true });
        
        child.stdout.pipe(res);
        
        // Handle errors
        child.on('error', (err) => {
            console.error('Streaming error:', err);
            if (!res.headersSent) {
                res.status(500).send('Error streaming video');
            }
        });
        
        child.stderr.on('data', (data) => {
            console.error(`[yt-dlp stderr] ${data}`);
        });


    } catch (error) {
        console.error("Error:", error);
        if (!res.headersSent) {
            res.status(400).send("Error downloading video");
        }
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
                        4. Only remove repetitions, do not add or remove any new information
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

        // Format the response
        res.json({
            success: true,
            title: info.title,
            language: lang,
            transcript: finalTranscript,
            ai_notes: aiNotes,
            isProcessed: !skipAI,
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

// Get port from environment or use default
const PORT = process.env.PORT || 3500;

// Bind to 0.0.0.0 in production, use default binding in development
if (process.env.NODE_ENV === 'production') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running in production mode on PORT: ${PORT}`);
    });
} else {
    app.listen(PORT, () => {
        console.log(`Server running in development mode on PORT: ${PORT}`);
    });
}
