# Build:  docker build -f crates/cp-server/Dockerfile -t cp-server .
# Rodar:  docker run -p 8787:8787 -v $PWD/hub:/srv/hub -e CP_SERVER_NAME="SC2 Brasil" cp-server
FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p cp-server

FROM debian:bookworm-slim
RUN useradd -r -u 10001 cp && mkdir -p /srv/hub /srv/data && chown -R cp /srv
COPY --from=build /src/target/release/cp-server /usr/local/bin/cp-server
USER cp
ENV PORT=8787 CP_HUB_DIR=/srv/hub CP_DATA_DIR=/srv/data
EXPOSE 8787
CMD ["cp-server"]
