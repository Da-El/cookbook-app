FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM rust:1-slim AS backend
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY backend/seed ./seed
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=backend /app/target/release/cookbook-backend /app/cookbook-backend
COPY --from=backend /app/migrations /app/migrations
COPY --from=frontend /app/frontend/dist /app/static
ENV STATIC_DIR=/app/static
ENV SECURE_COOKIES=true
EXPOSE 8090
CMD ["/app/cookbook-backend"]
