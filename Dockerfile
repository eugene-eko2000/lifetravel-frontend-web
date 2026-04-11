# Multi-stage production image for Next.js (standalone output).
# Build: docker build -t lifetravel-frontend .
# Run:  docker run -p 3000:3000 lifetravel-frontend
#
# Client env (baked at build): pass --build-arg NEXT_PUBLIC_*=...

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Optional: WebSocket / API URL for the browser bundle (see src/app/page.tsx)
ARG NEXT_PUBLIC_INGRESS_API
ENV NEXT_PUBLIC_INGRESS_API=${NEXT_PUBLIC_INGRESS_API}

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Standalone server + traced dependencies
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
