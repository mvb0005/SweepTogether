# Use an official Node.js runtime as a parent image
FROM node:18-alpine3.18

# Set the working directory in the container
WORKDIR /usr/src/app

# Add build argument for NODE_ENV, default to production
ARG NODE_ENV=development
ENV NODE_ENV=${NODE_ENV}

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies based on NODE_ENV
RUN npm install;

# Bundle app source
# For development, we might mount the source code instead of copying
COPY . .

# Build TypeScript if in production
RUN if [ "$NODE_ENV" = "production" ]; then \
      npm run build; \
    fi

# Make port 3000 available
EXPOSE 3000

