# Use a lightweight web server for static files
FROM nginx:alpine

# Remove default Nginx configuration
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static assets from the frontend folder to the default Nginx public directory
COPY . /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Default command to start Nginx
CMD ["nginx", "-g", "daemon off;"]
