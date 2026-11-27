FROM golang:1.26-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git ca-certificates gcc musl-dev

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-w -s" -o /ingest-service ./main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /ingest-service .

# Run unprivileged; the code stays root-owned and read-only to the process.
RUN adduser -S -D -H -u 10001 aisoc && mkdir -p /data && chown aisoc /data
USER aisoc

EXPOSE 8080

CMD ["./ingest-service"]
