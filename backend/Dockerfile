# Stage 1: Build the Rust native chunk generator.
# rust:alpine targets musl, matching the Node Alpine image so the .so is ABI-compatible.
FROM rust:alpine AS native-builder
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY native/ .
# -C target-feature=-crt-static: don't statically link libc into the cdylib
# so Node can dlopen it at runtime on musl.
ENV RUSTFLAGS="-C target-feature=-crt-static"
RUN cargo build --release

# Stage 2: Node.js application.
FROM node:18-alpine3.18

WORKDIR /usr/src/app

ARG NODE_ENV=development
ENV NODE_ENV=${NODE_ENV}

COPY package*.json ./
RUN npm install --include=dev

COPY . .

# Install the compiled native addon. Renamed to index.node — Node loads it via require().
COPY --from=native-builder /build/target/release/libsweeptogether_native.so ./native/index.node

RUN if [ "$NODE_ENV" = "production" ]; then \
      npm run build && npm prune --production; \
    fi

EXPOSE 3000

# Production default: run the compiled output. Dev compose overrides this with
# `npm run dev` (nodemon) and builds with NODE_ENV=development so dev deps remain.
CMD ["npm", "start"]
