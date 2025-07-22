const jwtAuth = require('./jwtAuth');
const rapidAuth = require('./rapidAuth');

const authRouter = (req, res, next) => {
    // List of paths that don't require authentication
    const publicPaths = ['/ping', '/test-token', '/auth/exchange-token'];
    
    // Skip authentication for public paths
    if (publicPaths.includes(req.path)) {
        return next();
    }

    // Get RapidAPI key from either header format
    const rapidApiKey = req.headers['x-rapidapi-key'] || req.headers['x-rapidapi-proxy-secret'];

    // Check for RapidAPI key first
    if (rapidApiKey) {
        console.log('RapidAPI request detected');
        return rapidAuth(req, res, next);
    }
    
    // If no RapidAPI key, check for JWT
    console.log('Checking JWT authentication');
    return jwtAuth(req, res, next);
};

module.exports = authRouter;
