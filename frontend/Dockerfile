# Use Node image as the base for development
FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
# Note: This will be overwritten by the volume mount in dev mode,
# but it's useful if building without mounts or for other stages.
COPY . .

# Expose Vite's default port
EXPOSE 3000

# Default command can be overridden in docker-compose.yml
# CMD ["npm", "run", "dev", "--", "--host"] # We set this in docker-compose.yml

# --- Optional Production Build Stage (Not used for dev server) ---
# FROM node:20-alpine AS build
# WORKDIR /app
# COPY package*.json ./
# RUN npm ci --only=production # Or npm install --only=production
# COPY . .
# RUN npm run build

# FROM nginx:stable-alpine AS production
# COPY --from=build /app/dist /usr/share/nginx/html
# COPY nginx.conf /etc/nginx/conf.d/default.conf # Use the simplified frontend/nginx.conf
# EXPOSE 80
# CMD ["nginx", "-g", "daemon off;"]
