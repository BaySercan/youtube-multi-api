# Use Node.js 20 base image
FROM node:20

# Install Python and pip
RUN apt-get update && apt-get install -y python3 python3-pip

# Install yt-dlp
RUN pip3 install yt-dlp

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose port
EXPOSE 3500

# Start the application
CMD ["node", "index.js"]
