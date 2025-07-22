const rapidAuth = (req, res, next) => {
    // Get RapidAPI key from either header format
    const rapidApiKey = req.headers['x-rapidapi-key'] || req.headers['x-rapidapi-proxy-secret'];

    console.log('RapidAPI Auth - Checking key:', rapidApiKey ? 'Present' : 'Missing');
    console.log('Expected Secret:', process.env.RAPIDAPI_SECRET ? 'Configured' : 'Missing');

    // Check if RapidAPI key is present
    if (!rapidApiKey) {
        console.log('RapidAPI Auth - Failed: Missing key');
        return res.status(401).json({
            error: 'Missing RapidAPI authentication header'
        });
    }

    // Verify RapidAPI key against your secret
    if (rapidApiKey !== process.env.RAPIDAPI_SECRET) {
        console.log('RapidAPI Auth - Failed: Invalid key');
        return res.status(401).json({
            error: 'Invalid RapidAPI credentials'
        });
    }

    // If authentication successful
    console.log('RapidAPI Auth - Success');
    next();
};

module.exports = rapidAuth;
