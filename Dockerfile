FROM node:24-bookworm-slim
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @payment-qr/core build && pnpm --filter @payment-qr/sdk-js build && pnpm --filter @payment-qr/server build && pnpm --filter @payment-qr/web-component build
ENV HOST=0.0.0.0
EXPOSE 4000
CMD ["pnpm","dev"]
