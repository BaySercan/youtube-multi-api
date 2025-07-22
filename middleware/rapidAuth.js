const rapidAuth = (req, res, next) => {
    // Get RapidAPI key from either header format
    const rapidApiKey = req.headers['x-rapidapi-key'] || req.headers['x-rapidapi-proxy-secret'];

    // Check if RapidAPI key is present
    if (!rapidApiKey) {
        return res.status(401).json({
            error: 'Missing RapidAPI authentication header'
        });
    }

    // Verify RapidAPI key against your secret
    if (rapidApiKey !== process.env.RAPIDAPI_SECRET) {
        return res.status(401).json({
            error: 'Invalid RapidAPI credentials'
        });
    }

    // If authentication successful
    console.log('RapidAPI authentication successful');
    next();
};

module.exports = rapidAuth;
