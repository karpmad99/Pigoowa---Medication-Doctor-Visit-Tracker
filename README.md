# Pigoowa

**Medication and doctor appointment tracker** — a web application for organising medications, dosage schedules, intake history and doctor appointments. The user interface is in Polish.

> **Project status: Stage 1 of 12 complete (project scaffold).** The app currently consists of an application shell with navigation between three placeholder pages (Pulpit, Leki, Wizyty). None of the features below exist yet. Sections marked *(planned)* describe intended behaviour, not existing functionality. Progress is tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

## Important notice

Pigoowa is an organisational tool. It does not give medical advice, does not recommend or change doses, and does not decide whether a medication should be taken. Schedules are configured by the user and are not verified by any healthcare professional. The planned public demo uses fictional data only.

## Planned features (MVP)

- **Dashboard** – today's doses with taken/skipped actions, next appointments, stock summary.
- **Medications** – add/edit/delete, daily schedule with several times per day, optional stock with an explicitly documented estimate, intake history.
- **Doctor appointments** – add/edit/delete, upcoming and past lists grouped by date, completed/cancelled status.

Out of scope for the MVP: AI assistant, OCR, billing, caregiver sharing, calendar sync, push notifications, advanced analytics, interaction checking. See [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md).

## Technology stack

Installed now (versions as resolved by `package-lock.json`):

| Purpose | Package | Version |
|---|---|---|
| UI | react, react-dom | 19.3.1 |
| Routing | react-router | 7.18.4 |
| Build/dev server | vite, @vitejs/plugin-react | 8.3.4, 6.1.2 |
| Language | typescript (strict) | 6.0.3 |
| Styling | tailwindcss, @tailwindcss/vite | 4.3.3 |
| Unit/component tests | vitest, jsdom, @testing-library/react, jest-dom, user-event | 5.0.5, 29.1.1, 16.3.3, 7.0.1, 14.6.8 |
| End-to-end tests | @playwright/test | 1.64.1 |
| Linting | eslint, typescript-eslint, react-hooks, jsx-a11y, react-refresh plugins | 9.39.5, 8.71.2, 7.1.1, 6.10.2, 0.5.7 |
| Formatting | prettier | 3.9.10 |

Planned for later stages: React Hook Form + Zod (stage 5), Supabase (stages 10–11), TanStack Query (stage 11), Vercel (stage 9).

Notes on version choices: ESLint is on the 9.x line because `eslint-plugin-jsx-a11y` does not yet support ESLint 10; TypeScript is on 6.0.x because `typescript-eslint` supports `<6.1`; React Router is on 7.x (stable, Node >= 20) rather than 8.x (requires Node >= 22.22).

## Documentation

| Document | Contents |
|---|---|
| [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) | Requirements, business rules, decisions, architecture, risks, testing strategy |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Development stages with completion criteria |
| [docs/DATABASE.md](docs/DATABASE.md) | Data model, constraints, Row Level Security, migration approach |

## Getting started

Prerequisite: Node.js >= 22.12 and npm.

```bash
npm install
npm run dev        # start the dev server at http://localhost:5173
```

No environment variables are needed yet.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check (`tsc -b`) and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript strict type check, no output |
| `npm run lint` | ESLint (type-aware rules, React hooks, accessibility) |
| `npm run format` / `format:check` | Prettier: rewrite / verify formatting of source files |
| `npm test` / `npm run test:watch` | Vitest unit and component tests (once / watch mode) |
| `npm run e2e` | Playwright end-to-end tests (starts the dev server itself) |

### Running end-to-end tests

Install the browser once with `npx playwright install chromium`. If you already have a Chromium binary, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its path instead.

### Continuous integration

`.github/workflows/ci.yml` runs typecheck, lint, format check, unit tests, build and e2e tests on every pull request and push to `main`. *(The workflow file exists; it has not yet been observed running on GitHub.)*

### Project structure (current)

```
src/app/                 Route definitions
src/components/layout/   Application shell and shared layout pieces
src/pages/               One thin component per route
src/test/                Test setup
e2e/                     Playwright tests
docs/                    Specification, roadmap, database design
```

The full target structure is described in [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) §10.

## Deployment

*(Planned — Vercel; instructions and live demo link will be added in stage 9.)*

## Screenshots

*(Planned — added in stage 9.)*

## Language convention

User interface and user-facing messages: Polish. Code identifiers, database identifiers, commit messages and technical documentation: English.
