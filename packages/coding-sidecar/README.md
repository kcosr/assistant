# @assistant/coding-sidecar

HTTP server that exposes the coding executor via Unix socket or TCP for containerized deployments.
Runs inside a sandbox container and provides the same operations as the local executor.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Docker](#docker)
- [Configuration](#configuration)
- [API](#api)

## Overview

The coding sidecar is designed for sandboxed code execution:

1. The agent server runs on the host with the `coding` plugin in `sidecar` mode
2. A container is started with the sidecar server inside (managed externally)
3. The host communicates with the container via a Unix socket or TCP
4. All file operations and bash commands run inside the container at a single workspace root

This provides isolation and security for untrusted code execution.

## Source files

- `src/server.ts` - HTTP server with JSON API over Unix socket or TCP
- `Dockerfile` - Container image definition

## Docker

Build the container image:

```bash
docker build -t assistant-sandbox:latest -f packages/coding-sidecar/Dockerfile .
```

The Dockerfile:
- Uses Node.js base image
- Installs common development tools (git, ripgrep, fd-find, etc.)
- Runs the sidecar server on startup

## Configuration

Environment variables:

| Variable               | Default                         | Description                                      |
| ---------------------- | ------------------------------- | ------------------------------------------------ |
| `SOCKET_PATH`          | `/var/run/sidecar/sidecar.sock` | Unix socket path                                 |
| `TCP_HOST`             | (unset)                         | TCP host to bind (set with `TCP_PORT`)           |
| `TCP_PORT`             | (unset)                         | TCP port to bind                                 |
| `WORKSPACE_ROOT`       | `/workspace`                    | Root directory for operations                    |
| `SIDECAR_ALLOW_OUTSIDE_WORKSPACE_ROOT` | `false` | Allow file operations on paths outside `WORKSPACE_ROOT` (unsafe) |
| `SIDECAR_AUTH_TOKEN`   | (unset)                         | Bearer token for HTTP auth                       |
| `SIDECAR_REQUIRE_AUTH` | `false`                         | Require auth token for all requests when `true`  |

The socket directory must be mounted from the host for communication when using Unix sockets.
If `TCP_HOST`/`TCP_PORT` are set and `SOCKET_PATH` is unset, the sidecar only listens on TCP.

## API

All endpoints accept JSON POST requests and return JSON responses.
When `SIDECAR_AUTH_TOKEN` is configured, send `Authorization: Bearer <token>`.

### Health Check

```
GET /health
```

Returns:
```json
{
  "ok": true,
  "version": "1.0.0"
}
```

### Run Bash

```
POST /bash
Content-Type: application/json

{
  "command": "ls -la",
  "timeoutSeconds": 30
}
```

### Read File

```
POST /read
Content-Type: application/json

{
  "path": "src/main.ts",
  "offset": 1,
  "limit": 100
}
```

### Write File

```
POST /write
Content-Type: application/json

{
  "path": "src/main.ts",
  "content": "console.log('hello');"
}
```

### Edit File

```
POST /edit
Content-Type: application/json

{
  "path": "src/main.ts",
  "oldText": "hello",
  "newText": "world"
}
```

### List Directory

```
POST /ls
Content-Type: application/json

{
  "path": "src",
  "limit": 500
}
```

### Find Files

```
POST /find
Content-Type: application/json

{
  "pattern": "*.ts",
  "path": "src",
  "limit": 1000
}
```

### Grep Files

```
POST /grep
Content-Type: application/json

{
  "pattern": "function",
  "path": "src",
  "glob": "*.ts",
  "ignoreCase": true,
  "limit": 100
}
```

## Error Handling

Errors return appropriate HTTP status codes:

- `400` - Invalid request body
- `404` - Unknown endpoint
- `500` - Internal server error

Error response format:
```json
{
  "ok": false,
  "error": "Error message"
}
```
