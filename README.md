# YouTube Multi API

REST API to download YouTube videos as MP3/MP4 files and get video transcripts. Built with Node.js, Express, and yt-dlp.

**New Authentication System**: This API now uses JWT authentication for enhanced security.

## Important Limitations
- All processing results are temporary and immediately discarded after delivery
- Files are streamed directly without server storage
- Progress data is ephemeral and not persisted
- Do not rely on long-term result availability

## API Base URL
`https://youtube-multi-api.onrender.com`

## Installation
1. Clone the repository
2. Install dependencies: `npm install`
3. Generate RSA key pair for JWT authentication:
```bash
node generateKeys.js
```
4. Create `.env` file with your OpenRouter API key and JWT settings:
```
OPENROUTER_API_KEY=your_api_key_here
JWT_EXPIRES_IN=1h
```
4. Start the server: `npm start`

## Authentication
All endpoints except `/ping` and `/test-token` require JWT authentication.

### Getting a Test Token (Development Only)
`GET /test-token`  
Returns a JWT token for testing in development environment.

**Response:**
```json
{
  "token": "your_jwt_token_here"
}
```

### Using the Token
Include the token in the Authorization header:  
`Authorization: Bearer <your_token>`

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
Download video as MP3 file with progress tracking

**Query Parameters:**
- `url` (required) - YouTube video URL

**Response Headers:**
- `X-Processing-Id`: ID for tracking progress
- `X-Video-Id`: YouTube video ID
- `X-Video-Title`: Video title

**Response:** MP3 file download

### GET /mp4
Download video as MP4 file with progress tracking

**Query Parameters:**
- `url` (required) - YouTube video URL

**Response Headers:**
- `X-Processing-Id`: ID for tracking progress
- `X-Video-Id`: YouTube video ID
- `X-Video-Title`: Video title

**Response:** MP4 file download

## Asynchronous Processing System

The `/transcript`, `/mp3`, and `/mp4` endpoints use asynchronous processing to handle operations. Instead of waiting for completion, they return immediately with identifiers for tracking progress.

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
- `id` (required) - Processing ID

**Response:**
```json
{
  "id": "unique-job-id",
  "status": "queued|processing|completed|failed",
  "progress": 30,
  "video_id": "YouTube video ID",
  "video_title": "Video title",
  "createdAt": "ISO timestamp",
  "lastUpdated": "ISO timestamp"
}
```

### GET /result/:id
Get processing result

**Path Parameters:**
- `id` (required) - Processing ID

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
# Get a test token (development only)
curl "http://localhost:3500/test-token"

# Get video info (with JWT)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Download MP3 and track progress (with JWT)
curl -I -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/mp3?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
# Extract X-Processing-Id from headers
processing_id="your_processing_id"
curl "http://localhost:3500/progress/$processing_id"

# Initiate transcript processing (with JWT)
response=$(curl -s -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ")
processing_id=$(echo $response | jq -r '.processingId')
curl "http://localhost:3500/progress/$processing_id"
curl "http://localhost:3500/result/$processing_id"
```

## Legal
- [Terms of Use](TERMS.md) - Important usage guidelines and restrictions

## Dependencies
- express
- cors
- yt-dlp-wrap
- dotenv
- axios
- p-queue
- uuid
- child_process
