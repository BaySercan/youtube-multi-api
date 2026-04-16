// Re-export the logger from the root utils directory
// This allows src/ modules to use require("./logger") or require("../utils/logger")
// while maintaining backward compatibility with middleware/ imports
module.exports = require("../../utils/logger");
