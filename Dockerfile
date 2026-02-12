FROM node:22-alpine

WORKDIR /app

# Install production deps
COPY package*.json ./
RUN npm install --production 2>/dev/null || true

# Copy app
COPY signal_service.js .

# Environment variables
ENV NODE_ENV=production

# Run the service
CMD ["node", "signal_service.js"]
