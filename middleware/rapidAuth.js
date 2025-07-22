const rapidAuth = (req, res, next) => {
    console.log('\n=== RapidAPI Auth Check ===');
    
    // Get RapidAPI key from either header format
    const rapidApiKey = req.headers['x-rapidapi-key'] || req.headers['x-rapidapi-proxy-secret'];
    
    // Enhanced logging for troubleshooting
    console.log('Request details:', {
        method: req.method,
        path: req.path,
        host: req.headers['host'],
        rapidApiKeyPresent: !!rapidApiKey,
        envSecretPresent: !!process.env.RAPIDAPI_SECRET,
        headersPresent: Object.keys(req.headers)
    });

    // Check if RapidAPI key is present
    if (!rapidApiKey) {
        console.log('=> Auth Failed: Missing RapidAPI key');
        return res.status(401).json({
            error: 'Missing RapidAPI authentication header'
        });
    }

    // Verify RapidAPI key against your secret
    if (rapidApiKey !== process.env.RAPIDAPI_SECRET) {
        console.log('=> Auth Failed: Invalid RapidAPI key');
        console.log('Key comparison:', {
            keyLength: rapidApiKey.length,
            expectedLength: process.env.RAPIDAPI_SECRET.length,
            keyFirstChar: rapidApiKey.charAt(0),
            expectedFirstChar: process.env.RAPIDAPI_SECRET.charAt(0),
            keyLastChar: rapidApiKey.charAt(rapidApiKey.length - 1),
            expectedLastChar: process.env.RAPIDAPI_SECRET.charAt(process.env.RAPIDAPI_SECRET.length - 1)
        });
        return res.status(401).json({
            error: 'Invalid RapidAPI credentials'
        });
    }

    // If authentication successful
    console.log('=> Auth Successful: Valid RapidAPI key');
    next();
};

module.exports = rapidAuth;
