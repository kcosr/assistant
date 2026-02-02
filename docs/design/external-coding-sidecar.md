# External (pre-existing) Coding Sidecar Container

## Summary

The `coding` tool plugin currently supports host execution (`local`) and a managed-container mode (`container`).

This document proposes simplifying the system to a single containerized execution strategy: **connect to an already-running sidecar over a Unix domain socket** ("sidecar" mode).

In the target end state:

- The agent-server does not create/start/stop containers (no Docker/Podman socket access, no `dockerode`).
- The sidecar container is started and supervised externally (your existing always-on container).
- The socket path is configured globally via the coding plugin config.
- The sidecar runs against a single explicit workspace root (no per-session subdirectories).

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
- Provide clear operational guidance for running the sidecar server in an existing long-lived container.

## Non-goals

- Redesign the tool API surface.
- Replace Unix socket transport with TCP (unless explicitly desired later).
- Provide multi-tenant isolation beyond what the sidecar already implements.
- Design a general “containerize any tool plugin” framework (this proposal is scoped to the existing coding sidecar).

---

## Current implementation (baseline)

### Legacy: managed container mode today (planned removal)

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

Target behavior for this proposal is a **single explicit workspace root** inside the sidecar container (no per-session subdirectories).

In the target end state we remove the shared/per-session toggle entirely:

- `coding-executor` always resolves paths relative to `WORKSPACE_ROOT` directly.
- `sessionId` remains part of the sidecar API for compatibility and logging, but it does **not** affect path resolution.
- There is no `sharedWorkspace` flag in assistant config, and no `SHARED_WORKSPACE` env var to manage.

---

## Proposed design: connect-only sidecar mode (Option A)

### High-level behavior

Add a new coding executor that:

- does **not** create containers
- does **not** require Docker/Podman sockets
- only connects to an existing Unix socket file and uses `SidecarClient`

The sidecar container is managed externally.

### Configuration changes

Add a new `plugins.coding.mode` value and configuration block.

#### Proposed config shape (example)

```json
{
  "plugins": {
    "coding": {
      "enabled": true,
      "mode": "sidecar",
      "sidecar": {
        "socketPath": "/var/run/assistant/coding-sidecar.sock",
        "waitForReadyMs": 10000
      }
    }
  }
}
```

Notes:

- `socketPath` is the **host path** to the Unix socket file.
- The socket file must be created by the sidecar server inside the long-lived container, and exposed to the host via a bind mount.
- `waitForReadyMs` mirrors the existing 10s polling behavior in `ContainerExecutor.waitForSocketReady()`.

#### Rationale

- We cannot reuse `plugins.coding.container.socketPath` because that field currently means the **Docker/Podman daemon socket**, not the sidecar Unix socket.
- The existing `socketDir` + fixed filename scheme is convenient for managed mode, but connect-only mode benefits from an explicit `socketPath` to match whatever your container setup uses.

### Implementation sketch

#### New executor

Create `SidecarSocketExecutor` (name flexible) implementing `ToolExecutor`:

- constructor takes `{ socketPath, waitForReadyMs? }`
- `ensureReady()`:
  - wait for `socketPath` to appear and be a socket (poll)
  - optionally: call `GET /health` via `SidecarClient` once the socket exists
- methods delegate to `SidecarClient`:
  - `runBash`, `readFile`, `writeFile`, `editFile`, `ls`, `find`, `grep`

#### Coding plugin wiring

In `packages/agent-server/src/plugins/coding/index.ts`:

- extend mode parsing to include `sidecar`
- instantiate `executor = new SidecarSocketExecutor(...)`

#### Shutdown

- In connect-only mode, `shutdown()` should be a no-op (or just drop references).
- The agent-server must not stop/remove the externally-managed container.

---

## Operational guide: what you need to do in your existing container

Your long-lived container must run the sidecar server and expose its Unix socket to the host.

### 1) Run the sidecar server process

If you use the existing `@assistant/coding-sidecar` image behavior:

- the server runs via: `node dist/server.js`
- it reads environment variables:
  - `SOCKET_PATH` (where it will create the Unix socket)
  - `WORKSPACE_ROOT` (root directory for file operations)

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

### Kubernetes / orchestrators

Use a `hostPath` (or shared volume) mount for the socket directory so the host agent-server process can access the Unix socket. If the agent-server itself is also in a container, ensure both containers share the same volume for the socket path.

---

## Compatibility and migration

- `local` mode can remain for development/testing (optional).
- `container` (managed) mode is deprecated and planned for removal once sidecar deployments are validated.
- `sidecar` mode becomes the recommended/primary containerized execution mode.
- In the target end state, workspace behavior is always “shared”: `WORKSPACE_ROOT` is used directly (no per-session subdirectories).

---

## Risks and considerations

- **Stale socket file:** if the container crashes and restarts, the socket file may disappear/reappear. The executor should reconnect cleanly and ideally re-check `/health`.
- **Single point of failure:** all tool execution relies on the externally managed sidecar.
- **Security boundary:** any process with access to the socket can run commands in the container. Treat socket path permissions as a security boundary.
- **No per-session isolation:** all sessions share the same filesystem root inside the sidecar. Concurrent sessions can overwrite each other’s files; isolation requires separate sidecar instances and/or distinct `WORKSPACE_ROOT` mounts.

---

## Open questions

1. Do we want connect-only mode to support TCP (localhost port) as an alternative to Unix sockets?
2. Should we add a lightweight auth token to the sidecar protocol (even on Unix sockets) for defense-in-depth?
3. Should `sessionId` remain a required parameter in the sidecar API even though it no longer affects path resolution?
