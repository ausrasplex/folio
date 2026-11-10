# Folio's Docker image (used by the Unraid template in unraid/). Build: docker build -t folio .
# Three stages: install dependencies, build Next.js's standalone server, then a small image that runs it.

# ---- dependencies (postinstall copies the pdf.js assets into public/ and generates the Prisma client)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY tools/copy-pdf-assets.js ./tools/copy-pdf-assets.js
RUN npm ci

# ---- build
FROM deps AS build
COPY . .
ENV FOLIO_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# the Prisma command line on its own, to apply database updates when the container starts
RUN mkdir -p /opt/prisma-cli && cd /opt/prisma-cli && npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund "prisma@$(node -p "require('/app/package.json').devDependencies.prisma || require('/app/package.json').dependencies['@prisma/client']")"

# ---- run
FROM node:22-bookworm-slim AS run
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 FOLIO_BACKUP_DIR=/backups
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /opt/prisma-cli /opt/prisma-cli
COPY docker/entrypoint.sh /entrypoint.sh
# a script checked out on Windows may have CRLF line endings, which sh cannot run
RUN sed -i 's/\r$//' /entrypoint.sh && chmod 755 /entrypoint.sh \
  && mkdir -p /backups /app/.next/cache && chown -R 99:100 /backups /app/.next
# Unraid's usual user and group (nobody:users), so files in the backups share belong to it
USER 99:100
EXPOSE 3000
VOLUME ["/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
