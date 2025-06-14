# YouTube Multi API

REST API to download YouTube videos as MP3/MP4 files and get video transcripts. Built with Node.js, Express, and yt-dlp.

## Features
- Download YouTube videos as MP3 or MP4 files
- Get video metadata (title, thumbnail, channel info)
- Generate transcripts with AI-powered cleanup
- Automatic cleanup of temporary files

## Installation
1. Clone the repository
2. Install dependencies: `npm install`
3. Create `.env` file with your OpenRouter API key:
```
OPENROUTER_API_KEY=your_api_key_here
```
4. Start the server: `npm start`

## API Endpoints

### GET /ping
Health check endpoint (no authentication required)

**Response:**
```json
{
  "status": "ok",
  "timestamp": "current ISO timestamp",
  "version": "1.0.0"
}
```

### GET /info
Get video metadata

**Query Parameters:**
- `url` (required) - YouTube video URL

**Response:**
```json
{
  "title": "Video title",
  "thumbnail": "Video thumbnail URL",
  "video_id": "YouTube video ID",
  "channel_id": "YouTube channel ID",
  "channel_name": "Channel name",
  "post_date": "Upload date (YYYYMMDD)"
}
```

### GET /mp3
Download video as MP3 file

**Query Parameters:**
- `url` (required) - YouTube video URL

**Response:** MP3 file download

### GET /mp4
Download video as MP4 file

**Query Parameters:**
- `url` (required) - YouTube video URL

**Response:** MP4 file download

## Asynchronous Processing System

The `/transcript` endpoint now uses asynchronous processing to handle long-running operations. Instead of waiting for the full processing to complete, it returns immediately with a processing ID that can be used to track progress and retrieve results later.

### GET /transcript
Initiate transcript processing

**Query Parameters:**
- `url` (required) - YouTube video URL
- `lang` (optional) - Language code (default: 'tr')
- `skipAI` (optional) - Skip AI processing (default: false)
- `useDeepSeek` (optional) - Use DeepSeek model (default: true)

**Response (202 Accepted):**
```json
{
  "processingId": "unique-job-id",
  "message": "Processing started. Use /progress and /result endpoints to track and retrieve results.",
  "progressEndpoint": "/progress/unique-job-id",
  "resultEndpoint": "/result/unique-job-id"
}
```

### GET /progress/:id
Get processing status

**Path Parameters:**
- `id` (required) - Processing ID from /transcript response

**Response:**
```json
{
  "id": "unique-job-id",
  "status": "queued|processing|completed|failed",
  "progress": 30,
  "createdAt": "ISO timestamp",
  "lastUpdated": "ISO timestamp"
}
```

### GET /result/:id
Get processing result

**Path Parameters:**
- `id` (required) - Processing ID from /transcript response

**Response (if completed):**
```json
{
  "success": true,
  "title": "Video title",
  "language": "tr",
  "transcript": "Cleaned transcript text",
  "ai_notes": "Optional AI processing notes",
  "isProcessed": true,
  "processor": "deepseek | qwen",
  "video_id": "YouTube video ID",
  "channel_id": "YouTube channel ID",
  "channel_name": "Channel name",
  "post_date": "Upload date in ISO format"
}
```

**Response (if not completed):**
```json
{
  "message": "Processing not complete",
  "status": "processing",
  "progress": 50
}
```

## Example Usage
```bash
# Get video info
curl "http://localhost:3500/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Download MP3
curl -O "http://localhost:3500/mp3?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Initiate transcript processing
response=$(curl -s "http://localhost:3500/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ")
processing_id=$(echo $response | jq -r '.processingId')

# Check progress
curl "http://localhost:3500/progress/$processing_id"

# Get result (when progress is 100%)
curl "http://localhost:3500/result/$processing_id"
```

## Dependencies
- express
- cors
- yt-dlp-wrap
- dotenv
- axios
- p-queue
- uuid
- child_process
