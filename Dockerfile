FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Pinned to bookworm to match the runtime stage below. The floating `rust:1-slim`
# tag moved to a newer Debian, and the binary it produced linked GLIBC_2.38 -
# which bookworm (2.36) doesn't have, so the container built fine and then died
# on start. Both stages must track the same Debian release.
FROM rust:1-slim-bookworm AS backend
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
