# @sidflow/web

Next.js web UI for SIDFlow.

## Usage

```bash
bun run dev     # Development server at http://localhost:3000
bun run build   # Production build
bun run start   # Start production server
```

## Routes

- `/` — Public player
- `/admin` — Admin console (requires auth)
- `/api/*` — REST API

## Environment

- `SIDFLOW_ADMIN_USER` / `SIDFLOW_ADMIN_PASSWORD` — Admin credentials
- `PORT` — Server port (default: 3000)
