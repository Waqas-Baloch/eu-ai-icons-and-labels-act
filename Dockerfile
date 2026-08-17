# Production image for the Remix app.
#
# Works as-is on Fly.io, Railway, Render and anything else that builds a
# Dockerfile. The Shopify CLI is removed from the runtime image — it is a
# development tool, it is large, and it has no business in production.

FROM node:20-alpine

EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install everything first: the build needs devDependencies (vite, remix,
# typescript), which are pruned afterwards.
RUN npm ci --include=dev && npm cache clean --force

COPY . .

RUN npx prisma generate
RUN npm run build

# Drop build-only and development packages from the shipped image.
RUN npm prune --omit=dev && npm remove @shopify/cli || true

CMD ["npm", "run", "docker-start"]
