const rapidApiAuth = (req, res, next) => {
    const proxySecret = req.headers['x-rapidapi-proxy-secret'];
    const user = req.headers['x-rapidapi-user'];
    
    if (!proxySecret || !user) {
        return res.status(401).json({
            success: false,
            error: 'Missing RapidAPI authentication headers'
        });
    }

    // Validate against environment variable
    if (proxySecret !== process.env.RAPIDAPI_SECRET) {
        return res.status(401).json({
            success: false,
            error: 'Invalid RapidAPI proxy secret'
        });
    }

    console.log(`Authorized RapidAPI request from: ${user}`);
    next();
};

module.exports = rapidApiAuth;
