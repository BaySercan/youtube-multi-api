const jwtAuth = require('./jwtAuth');
const rapidAuth = require('./rapidAuth');

const authRouter = (req, res, next) => {
    // List of paths that don't require authentication
    const publicPaths = ['/ping', '/test-token', '/auth/exchange-token'];
    
    // Skip authentication for public paths
    if (publicPaths.includes(req.path)) {
        return next();
    }

    // Check for RapidAPI key header
    if (req.headers['x-rapidapi-key']) {
        return rapidAuth(req, res, next);
    }
    
    // Otherwise, use JWT authentication
    return jwtAuth(req, res, next);
};

module.exports = authRouter;
