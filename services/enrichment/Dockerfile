FROM golang:1.26-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git ca-certificates

# Not `go.sum*`: the glob makes the checksum file optional, so if it ever went
# missing this build would still succeed and `go mod download` would resolve
# the module graph unverified.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /enrichment-service ./main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /enrichment-service .

# Run unprivileged; the code stays root-owned and read-only to the process.
RUN adduser -S -D -H -u 10001 aisoc
USER aisoc

EXPOSE 8082

CMD ["./enrichment-service"]
