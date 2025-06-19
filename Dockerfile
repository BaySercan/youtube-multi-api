# Use updated Node.js 20 Alpine base image with security fixes
FROM node:20-alpine3.19

# Update system packages and install necessary dependencies
RUN apk --no-cache update && \
    apk --no-cache upgrade && \
    apk add --no-cache ca-certificates

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy application source code
COPY . .

# Generate RSA keys for JWT authentication
RUN mkdir -p keys && node generateKeys.js

# Expose port
EXPOSE 3500

# Start the application
CMD ["node", "index.js"]
