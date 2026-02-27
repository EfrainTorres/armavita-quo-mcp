# Authentication

`armavita-quo-mcp` authenticates using a single environment variable:

- `QUO_API_KEY`

Example:

```bash
export QUO_API_KEY="YOUR_QUO_API_KEY"
bash ./run.sh
```

## Timeout Configuration

Optional:

- `QUO_HTTP_TIMEOUT_MS` (default `30000`)

Example:

```bash
export QUO_HTTP_TIMEOUT_MS="45000"
```

## Troubleshooting

`QUO_API_KEY environment variable is required`

- Set `QUO_API_KEY` in the same environment where your MCP client starts the server.

`Quo API 401 ...` or `Quo API 403 ...`

- Key is invalid, expired, or lacks permissions.
- Generate a fresh key and restart the MCP server process.

`Quo API request timed out after ...`

- Increase `QUO_HTTP_TIMEOUT_MS`.
- Check network path and Quo API availability.

`No fields provided for update_contact`

- Pass at least one updatable field: `firstName`, `lastName`, `company`, `role`, `phoneNumbers`, or `emails`.
