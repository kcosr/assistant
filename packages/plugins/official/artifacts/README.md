# Artifacts Plugin

Share files between agents and users. Agents can upload artifacts for users to download, and users can upload files for agents to access.

## Features

- **Bidirectional file sharing**: Agents can upload files for users, users can upload files for agents
- **Multiple instances**: Organize artifacts into separate instances (e.g., work, personal)
- **Drag and drop**: Drop files onto the panel to upload
- **Inline rename**: Click the edit icon to rename artifacts
- **Download**: Click artifact title or download icon to download
- **Selection context**: Cmd/Ctrl-click or long-press to select artifacts and include them in chat context

## Configuration

Enable the plugin in `config.json`:

```json
{
  "plugins": {
    "artifacts": {
      "enabled": true,
      "maxFileSizeMb": 64,
      "instances": ["default", { "id": "work", "label": "Work" }]
    }
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable the plugin |
| `maxFileSizeMb` | number | `64` | Maximum file size in megabytes |
| `instances` | array | `["default"]` | Instance configuration |
| `gitVersioning.enabled` | boolean | `false` | Enable git backups |
| `gitVersioning.intervalMinutes` | number | `1` | Backup interval in minutes |

### Git Versioning

Enable automatic git backups of artifacts:

```json
{
  "plugins": {
    "artifacts": {
      "enabled": true,
      "gitVersioning": {
        "enabled": true,
        "intervalMinutes": 5
      }
    }
  }
}
```

Each instance directory is initialized as a git repository with automatic commits on changes.

## Operations

### `instance_list`

List configured instances.

```bash
artifacts-cli instance_list
```

### `list`

List artifacts in an instance.

```bash
artifacts-cli list --instance_id default
```

### `upload`

Upload a file as an artifact. The CLI reads the file and sends the content.

```bash
artifacts-cli upload --title "Report" --file ./report.pdf
```

### `download` (CLI) / `get` (API)

Download an artifact to a local file path. The CLI command is `download`, which internally calls the `get` operation and writes the file locally.

```bash
artifacts-cli download --id <artifact-id> --path ./downloaded.pdf
```

The `get` operation returns the artifact metadata and base64-encoded content.

### `update`

Replace an artifact's file content.

```bash
artifacts-cli update --id <artifact-id> --file ./updated.pdf
```

### `rename`

Rename an artifact's title.

```bash
artifacts-cli rename --id <artifact-id> --title "New Title"
```

### `delete`

Delete an artifact.

```bash
artifacts-cli delete --id <artifact-id>
```

## HTTP API

### Download file

```
GET /api/plugins/artifacts/files/:instanceId/:artifactId
```

Returns the file with appropriate `Content-Type` and `Content-Disposition` headers.

- Default: `Content-Disposition: inline` (view in browser)
- With `?download=1`: `Content-Disposition: attachment` (force download)

## Desktop/Mobile Download Behavior

- **Web:** Uses browser tab for viewing and native download behavior.
- **Tauri Desktop:** Uses a native save dialog (via `tauri-plugin-dialog`) and writes the file from the app.
- **Capacitor Mobile:** Uses `@capacitor/filesystem` to save the file to Documents and opens a share sheet if available.

## Panel Events

The panel communicates with the server via WebSocket events:

- `request_list` - Request artifact list
- `request_instances` - Request instance list
- `upload` - Upload a file
- `rename` - Rename an artifact
- `delete` - Delete an artifact
- `panel_update` - Broadcast updates to all panels

## Storage

Artifacts are stored in `data/plugins/artifacts/<instance_id>/`:

```
data/plugins/artifacts/default/
  metadata.json    # Artifact index
  files/
    <uuid>.<ext>   # Uploaded files
```
