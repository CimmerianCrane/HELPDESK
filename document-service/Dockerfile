# The document service: renders PDFs for the Cloudflare Worker, which cannot run react-pdf.
# Build from the repo root so the service bundles the same renderer modules the app uses:
#   docker build -f document-service/Dockerfile -t cimmerian-documents .
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
# ESM bundle with node_modules external — required, because react-pdf is ESM-only.
RUN npm run documents:build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The bundle imports packages at runtime, so node_modules and package.json ship with it.
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/document-service/dist ./document-service/dist
# No database, no Prisma connection: this process only renders.
EXPOSE 8788
CMD ["node", "document-service/dist/server.mjs"]
