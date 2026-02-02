# External (pre-existing) Coding Sidecar Container

## Summary

The `coding` tool plugin currently supports host execution (`local`) and a managed-container mode (`container`).
This proposal removes managed containers in favor of a connect-only sidecar and simplifies all coding execution to a single workspace root (no per-session directories).

This document proposes a connect-only execution strategy: **connect to an already-running sidecar** ("sidecar" mode) over a Unix domain socket or TCP. Managed container mode is removed.

In the target end state:

- The agent-server does not create/start/stop containers (no Docker/Podman socket access, no `dockerode`).
- The sidecar container is started and supervised externally (your existing always-on container).
- The socket path (or TCP host/port) is configured globally via the coding plugin config.
- Workspace semantics are simplified: operations are rooted at a single workspace root with no per-session directories.
- TCP access supports optional token auth (configurable to require or allow anonymous).

---

## Motivation / Problem

We want to run Assistant tools (bash/file ops) inside a container for isolation. The current `container` mode works, but it assumes the agent-server is responsible for:

- connecting to the Docker/Podman daemon socket
- creating a container image instance
- managing its lifecycle

In environments where:

- container lifecycle is controlled externally (systemd, Kubernetes, a devbox), or
- the agent-server must not have access to Docker/Podman socket,

we need a **connect-only** mode.

---

## Goals

- Execute the existing coding tools (`bash`, `read`, `write`, `edit`, `ls`, `find`, `grep`) inside a container.
- Reuse the existing `@assistant/coding-sidecar` HTTP API and `SidecarClient` implementation.
- Avoid requiring the agent-server to manage containers (no dockerode, no daemon socket).
- Support Unix sockets and TCP endpoints for sidecar connectivity.
- Support optional token auth for TCP (configurable whether it is required).
- Provide clear operational guidance for running the sidecar server in an existing long-lived container.

## Non-goals

- Redesign the tool API surface.
- Remove Unix socket support (TCP is additive).
- Provide multi-tenant isolation beyond what the sidecar already implements.
- Design a general “containerize any tool plugin” framework (this proposal is scoped to the existing coding sidecar).

---

## Current implementation (baseline)

### Legacy: managed container mode today (removed)

Code locations:

- Agent-server:
  - `packages/agent-server/src/plugins/coding/containerExecutor.ts`
  - `packages/agent-server/src/plugins/coding/sidecarClient.ts`
- Sidecar server:
  - `packages/coding-sidecar/src/server.ts`

In `container` mode, `ContainerExecutor`:

1. Uses Dockerode to `createContainer()` and `start()` a container (named `assistant-coding-sidecar`).
2. Bind-mounts a host directory into the container so the sidecar can create a Unix socket file there.
3. Sets env vars for the sidecar:
   - `SOCKET_PATH=<host-mounted socket file path>`
   - optionally `WORKSPACE_ROOT=/workspace` if a workspace volume is mounted
4. Waits for the Unix socket to exist.
5. Creates `SidecarClient({ socketPath })` and sends HTTP requests over the Unix socket.

### Sidecar server today

`@assistant/coding-sidecar`:

- starts an HTTP server that listens on a Unix domain socket (`SOCKET_PATH`)
- executes operations via `LocalExecutor({ workspaceRoot: WORKSPACE_ROOT })`

Change in this proposal:

- allow an optional TCP listener (configurable host/port) in addition to the Unix socket
- remove `sessionId` from request bodies
- add optional token auth (configurable required vs optional)

Target behavior for this proposal is a single explicit workspace root inside the sidecar container (no per-session subdirectories):

- `coding-executor` resolves paths relative to `WORKSPACE_ROOT` directly.
- The sidecar API does not accept `sessionId`; paths are always resolved from `WORKSPACE_ROOT`.
- There is no `sharedWorkspace` flag in assistant config, and no `SHARED_WORKSPACE` env var to manage.
- The same root-only semantics apply to `local` mode to keep behavior consistent across executors.

---

## Proposed design: connect-only sidecar mode

### High-level behavior

Add a new coding executor that:

- does **not** create containers
- does **not** require Docker/Podman sockets
- only connects to an existing Unix socket file **or** TCP endpoint and uses `SidecarClient`

The sidecar container is managed externally.

### Configuration changes

Add a new `plugins.coding.mode` value and configuration block.

#### Proposed config shape (Unix socket example)

```json
{
  "plugins": {
    "coding": {
      "enabled": true,
      "mode": "sidecar",
      "sidecar": {
        "socketPath": "/var/run/assistant/coding-sidecar.sock",
        "waitForReadyMs": 10000,
        "auth": {
          "token": "${SIDECAR_AUTH_TOKEN}",
          "required": false
        }
      }
    }
  }
}
```

Notes:

- `socketPath` is the **host path** to the Unix socket file.
- The socket file must be created by the sidecar server inside the long-lived container, and exposed to the host via a bind mount.
- `tcp.host` + `tcp.port` are used when TCP is preferred (e.g., localhost or a shared network).
- Exactly one endpoint should be configured: Unix socket **or** TCP.
- `waitForReadyMs` mirrors the existing 10s polling behavior in `ContainerExecutor.waitForSocketReady()`.
- Workspace root is configured in the sidecar container via `WORKSPACE_ROOT`.
- Standardize documentation on a single default socket path (current sidecar README default differs from container mode).
- `auth.token` enables token auth (sent as `Authorization: Bearer <token>`). When `auth.required` is `true`,
  the sidecar rejects requests without a valid token.

#### Rationale

- We should not overload the existing `plugins.coding.container.socketPath` field (it currently means the Docker/Podman daemon socket), and that block is removed.
- Connect-only mode benefits from an explicit `socketPath` to match whatever your container setup uses.

#### TCP config example

```json
{
  "plugins": {
    "coding": {
      "enabled": true,
      "mode": "sidecar",
      "sidecar": {
        "tcp": {
          "host": "127.0.0.1",
          "port": 8765
        },
        "waitForReadyMs": 10000,
        "auth": {
          "token": "${SIDECAR_AUTH_TOKEN}",
          "required": true
        }
      }
    }
  }
}
```

### Implementation sketch

#### New executor

Create `SidecarSocketExecutor` (name flexible) implementing `ToolExecutor`:

- constructor takes `{ socketPath?, tcpHost?, tcpPort?, waitForReadyMs? }`
- `ensureReady()`:
  - wait for the endpoint to be reachable
  - for Unix sockets, wait for `socketPath` to appear and be a socket (poll)
  - for TCP, attempt a `GET /health` until success or timeout
- methods delegate to `SidecarClient`:
  - `runBash`, `readFile`, `writeFile`, `editFile`, `ls`, `find`, `grep`

Update `SidecarClient` to accept either a Unix socket path or TCP host/port, and to include
`Authorization: Bearer <token>` when `auth.token` is configured.

#### Coding plugin wiring

In `packages/agent-server/src/plugins/coding/index.ts`:

- extend mode parsing to include `sidecar`
- instantiate `executor = new SidecarSocketExecutor(...)`

#### Shutdown

- In connect-only mode, `shutdown()` should be a no-op (or just drop references).
- The agent-server must not stop/remove the externally-managed container.

---

---

## Operational guide: what you need to do in your existing container

Your long-lived container must run the sidecar server and expose its Unix socket to the host.

### 1) Run the sidecar server process

If you use the existing `@assistant/coding-sidecar` image behavior:

- the server runs via: `node dist/server.js`
- it reads environment variables:
  - `SOCKET_PATH` (where it will create the Unix socket)
  - `WORKSPACE_ROOT` (root directory for file operations)
  - `TCP_HOST` / `TCP_PORT` (optional TCP listener; if unset, TCP is disabled)
  - `SIDECAR_AUTH_TOKEN` / `SIDECAR_REQUIRE_AUTH` (optional auth; when required, reject requests without a valid token)

So your container entrypoint/start script must ensure the sidecar server is started and remains running.

### 2) Bind-mount a host directory for the Unix socket

The socket is a *file*. For the host agent-server to connect to it, the socket file must exist on the host filesystem. The simplest approach:

- choose a host directory (example): `/var/run/assistant`
- mount it into the container at the **same path** (recommended): `/var/run/assistant`
- set `SOCKET_PATH` to a file inside that directory (example): `/var/run/assistant/coding-sidecar.sock`

This mirrors how managed mode works.

### 3) Ensure correct permissions

- The sidecar process in the container must be able to create the socket file in the mounted directory.
- The host agent-server process must be able to open the socket file.

In practice this may require:

- running the container user/group compatible with the host directory permissions, or
- ensuring the mounted directory is writable to the container user.

### 4) (Optional) Mount a workspace volume

If you want tool operations to persist and/or to operate on a particular filesystem:

- mount a host directory/volume into the container at `/workspace` (or another path)
- set `WORKSPACE_ROOT` accordingly

Example: `WORKSPACE_ROOT=/workspace`.

### Example: Docker run (illustrative)

```bash
docker run -d \
  --name assistant-sidecar \
  -v /var/run/assistant:/var/run/assistant \
  -v /srv/assistant-workspaces:/workspace \
  -e SOCKET_PATH=/var/run/assistant/coding-sidecar.sock \
  -e SIDECAR_AUTH_TOKEN=changeme \
  -e SIDECAR_REQUIRE_AUTH=false \
  -e WORKSPACE_ROOT=/workspace \
  <your-image-with-coding-sidecar>
```

Then configure the agent-server:

```json
{
  "plugins": {
    "coding": {
      "enabled": true,
      "mode": "sidecar",
      "sidecar": {
        "socketPath": "/var/run/assistant/coding-sidecar.sock"
      }
    }
  }
}
```

### Example: TCP listener (illustrative)

```bash
docker run -d \
  --name assistant-sidecar \
  -v /srv/assistant-workspaces:/workspace \
  -p 8765:8765 \
  -e TCP_HOST=0.0.0.0 \
  -e TCP_PORT=8765 \
  -e SIDECAR_AUTH_TOKEN=changeme \
  -e SIDECAR_REQUIRE_AUTH=true \
  -e WORKSPACE_ROOT=/workspace \
  <your-image-with-coding-sidecar>
```

Then configure the agent-server:

```json
{
  "plugins": {
    "coding": {
      "enabled": true,
      "mode": "sidecar",
      "sidecar": {
        "tcp": { "host": "127.0.0.1", "port": 8765 }
      }
    }
  }
}
```

### Kubernetes / orchestrators

Use a `hostPath` (or shared volume) mount for the socket directory so the host agent-server process can access the Unix socket. If the agent-server itself is also in a container, ensure both containers share the same volume for the socket path.

If using TCP, ensure the service/network policy allows the agent-server to reach the sidecar port.
If `SIDECAR_REQUIRE_AUTH=true`, ensure the agent-server is configured with the matching `auth.token`.

---

## Compatibility and migration

- `local` mode can remain for development/testing (optional).
- `container` (managed) mode is removed along with dockerode usage.
- `sidecar` mode becomes the only containerized execution mode.
- Per-session isolation is removed; workflows relying on isolated workspaces must run separate sidecars or separate agent-server instances per workspace root.
- Remove `sharedWorkspace` config fields and `SHARED_WORKSPACE` env usage.

---

## Risks and considerations

- **Stale socket file:** if the container crashes and restarts, the socket file may disappear/reappear. The executor should reconnect cleanly and ideally re-check `/health`.
- **Single point of failure:** all tool execution relies on the externally managed sidecar.
- **Security boundary:** any process with access to the socket can run commands in the container. Treat socket path permissions as a security boundary.
- **No per-session isolation:** all sessions share the same filesystem root inside the sidecar. Concurrent sessions can overwrite each other’s files; isolation requires separate sidecar instances and/or distinct `WORKSPACE_ROOT` mounts.

---

## Files to update

- `packages/agent-server/src/plugins/coding/index.ts` (config parsing + mode wiring)
- `packages/agent-server/src/plugins/coding/sidecarClient.ts` (support Unix socket + TCP)
- `packages/agent-server/src/plugins/coding/sidecarSocketExecutor.ts` (new connect-only executor)
- `packages/agent-server/src/plugins/coding/containerExecutor.ts` (remove)
- `packages/agent-server/src/plugins/coding/codingPlugin.test.ts` (add sidecar mode coverage)
- `docs/CONFIG.md` (document `sidecar` mode and config block)
- `packages/agent-server/README.md` (coding plugin mode docs)
- `packages/coding-sidecar/README.md` (operational guide and external mode notes)
- `packages/coding-sidecar/src/server.ts` (remove sessionId handling; workspace root only; auth token)
- `packages/coding-executor/src/utils/pathUtils.ts` (root-only path resolution; remove shared/session)
- `packages/coding-executor/src/localExecutor.ts` (align with root-only paths)
- `packages/coding-executor/src/types.ts` (remove `sessionId` from ToolExecutor API)
- `packages/coding-executor/README.md` (update semantics)
- `packages/coding-executor/src/utils/pathUtils.test.ts` (update expectations)
- `packages/coding-executor/src/localExecutor.test.ts` (remove per-session isolation tests; add root-only coverage)
