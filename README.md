# Taskflow

A responsive task manager built with a Node.js REST API, SQLite, Socket.IO, and browser JavaScript. It includes account registration and sign-in, private per-user tasks, live task updates, reminders, and light/dark appearance settings.

## Run it

Requires Node.js 22.13 or newer. On a fresh checkout, install the Socket.IO dependency and start the server:

```sh
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000). This Desktop copy already has Socket.IO installed; if `node` is not on your PowerShell PATH, run the Node executable directly. The server uses `taskflow.sqlite` in the project folder by default. If `data.json` exists and the database is empty, accounts and tasks are imported automatically on first startup; the JSON file is kept as a backup.

## Features

- Register and sign in with email and password. Passwords use Node's `scrypt`; session tokens are random, stored as SHA-256 digests in SQLite, and expire after seven days. Cookies are HTTP-only and same-site; they use `Secure` in production.
- Create, view, edit, update status, and delete tasks. Each task API operation is scoped to the authenticated user's ID.
- Socket.IO connections authenticate from the session cookie and join a server-selected room for that user. Task create, edit, status, and delete operations notify only that user's other open tabs, which reload the authorized task list.
- Filter by date view and status, search task titles and notes, and sort by due date, recently added, or priority.
- Responsive sidebar, dashboard, task list, and task editor for desktop and mobile screens.
- In-app reminders list tasks due today or overdue. Optional browser notifications send a daily summary while Taskflow is open.
- Choose Light or Dark from the appearance control in the top bar; the selection is remembered in the browser.

## Storage and deployment

The SQLite file is the source of truth for accounts, tasks, and sessions. For a host with persistent disk storage, set `DATA_DIR` to the mounted persistent directory before starting the server. Set `NODE_ENV=production` behind HTTPS so session cookies receive the `Secure` flag. To back it up safely, stop the server before copying the database or use SQLite's online backup support while it is running.

This setup runs as one Node.js server instance. A multi-instance deployment needs shared session storage and a Socket.IO adapter; do not point multiple unrelated instances at copies of the SQLite file. For larger public deployments, use a managed database and rate limiting, CSRF protections appropriate to the deployment, and a production-grade account recovery flow.

## Project layout

```text
server.js              Node HTTP server, SQLite storage, auth, REST API, and Socket.IO rooms
public/index.html      App markup and sign-in / registration views
public/styles.css      Responsive light and dark interface styles
public/app.js          Browser task state, API integration, rendering, and interactions
public/appearance.js   Persistent appearance setting
public/notifications.js In-app and browser reminders
public/realtime.js     Socket.IO client and live task refresh
taskflow.sqlite       Created at runtime; ignored by Git
```

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account and sign in |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | End the current session |
| GET | `/api/auth/me` | Read the current account |
| GET | `/api/tasks` | List the current user's tasks |
| POST | `/api/tasks` | Create a task |
| PATCH | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task |

All task routes require a signed-in session. Task status values are `todo`, `in-progress`, and `done`; priority values are `low`, `medium`, and `high`.