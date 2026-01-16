# YouTube Multi API

REST API to download YouTube videos as MP3/MP4 files and get video transcripts. Built with Node.js, Express, and yt-dlp.

**New Authentication System**: This API now uses JWT authentication for enhanced security.

## Important Limitations

- All processing results are temporary and immediately discarded after delivery
- Files are streamed directly without server storage
- Progress data is ephemeral and not persisted
- Do not rely on long-term result availability

## API Base URL

`https://p01--youtube-multi-api-private-srv--yfb9ttcdx8bx.code.run`

## Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Generate RSA key pair for JWT authentication:

```bash
npm run build
```

4. Create `.env` file with your API keys and settings:

```
# Required for transcript AI cleaning:
OPENROUTER_API_KEY=your_api_key_here

# Optional: OpenAI Whisper API for speech-to-text fallback
# When YouTube captions are unavailable, Whisper will transcribe the audio
# Get your API key from https://platform.openai.com/api-keys
OPENAI_API_KEY=your_openai_key_here

# JWT configuration:
JWT_EXPIRES_IN=1h
JWT_ALGORITHM=RS256
```

> **Note:** The transcript endpoint uses a multi-fallback system:
>
> 1. YouTube auto-captions (primary)
> 2. youtube-transcript-plus library
> 3. yt-dlp auto-subs extraction
> 4. OpenAI Whisper STT (requires `OPENAI_API_KEY`)
>
> **Whisper STT Features:**
>
> - Automatically transcribes videos without captions
> - Handles long videos by splitting audio into 10-minute chunks
> - Cost: ~$0.006 per minute of audio
> - Requires `ffmpeg` and `ffprobe` for audio processing

5. Start the server: `npm start`

## Authentication

All endpoints except `/ping`, `/test-token`, and `/auth/exchange-token` require authentication. The API supports two authentication methods:

### 1. JWT Authentication

- **Getting a Test Token (Development Only):**  
  `GET /test-token`  
  Returns a JWT token for testing in development environment.

  **Response:**

  ```json
  {
    "token": "your_jwt_token_here"
  }
  ```

- **Using the Token:**  
  Include the token in the Authorization header:  
  `Authorization: Bearer <your_token>`

### 2. RapidAPI Authentication

- **Required Headers:**

  - `x-rapidapi-proxy-secret`: Your RapidAPI proxy secret
  - `x-rapidapi-user`: Your RapidAPI user identifier

- **Note:** In development mode (`NODE_ENV=development`), RapidAPI authentication is automatically bypassed.

### Token Exchange Endpoint

`POST /auth/exchange-token`  
Exchange your Supabase access token for a custom JWT token (for Supabase users)

**Request Body:**

```json
{
  "supabaseAccessToken": "your_supabase_access_token"
}
```

**Response:**

```json
{
  "apiToken": "generated_jwt_token",
  "expiresIn": 3600
}
```

## API Endpoints

### GET /ping

Health check endpoint (no authentication required)

**Response:**

```json
{
  "status": "ok",
  "timestamp": "current ISO timestamp",
  "version": "2.1.0"
}
```

### GET /info

Get video metadata

**Query Parameters:**

- `url` (required) - YouTube video URL
- `type` (optional) - Type of information to return.
  - `sum` (default): Returns a summary of the video information.
  - `full`: Returns the complete video information object from yt-dlp.

**Response (type=sum):**

```json
{
  "availability": null,
  "automatic_captions": {},
  "categories": ["Music"],
  "channel_name": "Official Channel",
  "channel_follower_count": 1000000,
  "channel_id": "UC12345678",
  "channel_url": "https://www.youtube.com/channel/UC12345678",
  "comment_count": 5000,
  "description": "Video description text.",
  "display_id": "dQw4w9WgXcQ",
  "duration": 212,
  "duration_string": "3:32",
  "filesize_approx": 5000000,
  "fulltitle": "Full Video Title",
  "video_id": "dQw4w9WgXcQ",
  "language": "en",
  "license": "Standard YouTube License",
  "like_count": 100000,
  "original_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "playable_in_embed": true,
  "tags": ["tag1", "tag2"],
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "timestamp": 1254000000,
  "title": "Video Title",
  "post_date": "2009-10-25T00:00:00.000Z",
  "uploader": "Uploader Name",
  "uploader_id": "uploaderID",
  "uploader_url": "https://www.youtube.com/user/uploaderID",
  "view_count": 100000000,
  "was_live": false
}
```

**Response (type=full):**
The response for `type=full` includes the complete JSON output from `yt-dlp`. This object can be quite large and its structure may vary. Refer to the `yt-dlp` documentation for details on the possible fields.

**Example `curl` commands:**

```bash
# Get summary video info (default)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Get full video info
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&type=full"
```

### GET /mp3

Download video as MP3 file with progress tracking

**Query Parameters:**

- `url` (required) - YouTube video URL

**Response Headers:**

- `X-Processing-Id`: ID for tracking progress and cancellation
- `X-Video-Id`: YouTube video ID
- `X-Video-Title`: Video title
- `Content-Disposition`: Download filename hint (e.g., `attachment; filename="video-title.mp3"`)
- `Content-Type`: Response MIME type (`audio/mpeg`)

**Header Behavior:**  
All response headers are sent immediately via `flushHeaders()` before processing begins.  
This allows frontends to access the X-Processing-Id immediately for cancellation requests.

**Response:** MP3 file download

### GET /mp4

Download video as MP4 file with progress tracking

**Query Parameters:**

- `url` (required) - YouTube video URL

**Response Headers:**

- `X-Processing-Id`: ID for tracking progress and cancellation
- `X-Video-Id`: YouTube video ID
- `X-Video-Title`: Video title
- `Content-Disposition`: Download filename hint (e.g., `attachment; filename="video-title.mp4"`)
- `Content-Type`: Response MIME type (`video/mp4`)

**Header Behavior:**  
All response headers are sent immediately via `flushHeaders()` before processing begins.  
This allows frontends to access the X-Processing-Id immediately for cancellation requests.

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

### POST /cancel/:id

Cancel a processing job

Cancel an in-progress MP3, MP4, or transcript processing job. This is useful for stopping long-running operations.

**Path Parameters:**

- `id` (required) - Processing ID obtained from the original request

**Response (200 OK):**

```json
{
  "message": "Process canceled successfully",
  "video_id": "YouTube video ID",
  "video_title": "Video title",
  "queue_position": "Was #3 in queue" // Only present if job was queued
}
```

**Error Responses:**

- 400: Process cannot be canceled or is already complete
- 404: Processing ID not found

**Example:**

```bash
# Cancel a processing job
curl -X POST -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/cancel/your_processing_id_here"
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

# Cancel a download in progress
curl -X POST -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/cancel/$processing_id"

# Initiate transcript processing (with JWT)
response=$(curl -s -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ")
processing_id=$(echo $response | jq -r '.processingId')
curl "http://localhost:3500/progress/$processing_id"

# Cancel transcript processing
curl -X POST -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3500/cancel/$processing_id"

# Get processing result
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
