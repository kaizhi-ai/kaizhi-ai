# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.26
ARG NODE_VERSION=24
ARG PNPM_VERSION=10.23.0

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS frontend-builder
ARG PNPM_VERSION

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /src/frontend

RUN npm install -g "pnpm@${PNPM_VERSION}"

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN mkdir -p ../backend/web/dist && pnpm build

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-bookworm AS backend-builder
ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
COPY --from=frontend-builder /src/backend/web/dist ./web/dist

RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
	go build -trimpath -ldflags="-s -w" -o /out/kaizhi-backend .

FROM debian:bookworm-slim AS runtime

RUN set -eux; \
	export DEBIAN_FRONTEND=noninteractive; \
	apt-get update; \
	apt-get install -y --no-install-recommends ca-certificates tzdata; \
	rm -rf /var/lib/apt/lists/*; \
	groupadd --system kaizhi; \
	useradd --system --gid kaizhi --home-dir /app --shell /usr/sbin/nologin kaizhi; \
	mkdir -p /app /data; \
	chown -R kaizhi:kaizhi /app /data

WORKDIR /app

COPY --from=backend-builder /out/kaizhi-backend /app/kaizhi-backend
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/kaizhi-entrypoint

ENV GIN_MODE=release
ENV KAIZHI_DATA_DIR=/data

EXPOSE 8317
VOLUME ["/data"]

USER kaizhi

ENTRYPOINT ["/usr/local/bin/kaizhi-entrypoint"]
