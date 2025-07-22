const jwtAuth = require('./jwtAuth');
const rapidAuth = require('./rapidAuth');

const authRouter = (req, res, next) => {
    // Enhanced logging for debugging
    console.log('\n=== Auth Request ===');
    console.log(`Time: ${new Date().toISOString()}`);
    console.log(`Path: ${req.method} ${req.path}`);
    console.log(`Client IP: ${req.ip}`);
    console.log('Headers:', {
        'x-rapidapi-key': req.headers['x-rapidapi-key'] ? 'Present' : 'Missing',
        'x-rapidapi-proxy-secret': req.headers['x-rapidapi-proxy-secret'] ? 'Present' : 'Missing',
        'authorization': req.headers['authorization'] ? 'Present' : 'Missing',
        'host': req.headers['host'],
        'origin': req.headers['origin'],
        'user-agent': req.headers['user-agent']
    });

    // List of paths that don't require authentication
    const publicPaths = ['/ping', '/test-token', '/auth/exchange-token'];
    
    // Skip authentication for public paths
    if (publicPaths.includes(req.path)) {
        console.log('=> Public path accessed, skipping auth');
        return next();
    }

    // Get authentication headers
    const rapidApiKey = req.headers['x-rapidapi-key'] || req.headers['x-rapidapi-proxy-secret'];
    const hasJwtToken = !!req.headers['authorization'];

    // Prevent mixed authentication
    if (rapidApiKey && hasJwtToken) {
        console.log('=> Warning: Mixed authentication attempt detected');
        return res.status(400).json({
            error: 'Mixed authentication not allowed. Use either RapidAPI key or JWT token, not both.'
        });
    }

    if (rapidApiKey) {
        console.log('=> Processing RapidAPI authentication');
        return rapidAuth(req, res, next);
    } else if (hasJwtToken) {
        console.log('=> Processing JWT authentication');
        return jwtAuth(req, res, next);
    } else {
        console.log('=> No valid authentication provided');
        return res.status(401).json({
            error: 'Authentication required. Please provide either RapidAPI key or JWT token.'
        });
    }
};

module.exports = authRouter;
