# Use Node.js 20 base image
FROM node:20

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
