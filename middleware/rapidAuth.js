const rapidAuth = (req, res, next) => {
    const rapidApiKey = req.headers['x-rapidapi-key'];

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
    next();
};

module.exports = rapidAuth;
