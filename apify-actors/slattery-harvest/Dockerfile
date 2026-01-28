# Slattery Harvester - Node.js Playwright Actor
FROM apify/actor-node-playwright-chrome:20

# Copy package files first for better caching
COPY package.json ./

# Install dependencies
RUN npm install --omit=dev --omit=optional

# Copy source code
COPY . ./

# Run the actor
CMD ["node", "main.js"]
