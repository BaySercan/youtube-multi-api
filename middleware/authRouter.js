const jwtAuth = require('./jwtAuth');
const rapidAuth = require('./rapidAuth');

const authRouter = (req, res, next) => {
    // Enhanced logging for debugging
    console.log('Auth Headers:', {
        rapidApiKey: req.headers['x-rapidapi-key'],
        rapidApiSecret: req.headers['x-rapidapi-proxy-secret'],
        authorization: req.headers['authorization']
    });

    // List of paths that don't require authentication
    const publicPaths = ['/ping', '/test-token', '/auth/exchange-token'];
    
    // Skip authentication for public paths
    if (publicPaths.includes(req.path)) {
        console.log('Public path accessed:', req.path);
        return next();
    }

    // Check if this is a RapidAPI request
    const isRapidApiRequest = !!(req.headers['x-rapidapi-key'] || req.headers['x-rapidapi-proxy-secret']);

    if (isRapidApiRequest) {
        console.log('RapidAPI request detected - Using RapidAPI auth');
        // Skip JWT check completely for RapidAPI requests
        return rapidAuth(req, res, next);
    } else if (req.headers['authorization']) {
        console.log('JWT token detected - Using JWT auth');
        return jwtAuth(req, res, next);
    } else {
        console.log('No valid authentication method found');
        return res.status(401).json({
            error: 'Authentication required. Please provide either RapidAPI key or JWT token.'
        });
    }
};

module.exports = authRouter;
