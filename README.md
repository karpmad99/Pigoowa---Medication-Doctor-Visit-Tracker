# Pigoowa

**Medication and doctor appointment tracker** — a web application for organising medications, dosage schedules, intake history and doctor appointments. The user interface is in Polish.

> **Project status: planning stage.** The application has not been implemented yet. This repository currently contains documentation only. Sections marked *(planned)* describe intended behaviour, not existing functionality.

## Important notice

Pigoowa is an organisational tool. It does not give medical advice, does not recommend or change doses, and does not decide whether a medication should be taken. Schedules are configured by the user and are not verified by any healthcare professional. The planned public demo uses fictional data only.

## Planned features (MVP)

- **Dashboard** – today's doses with taken/skipped actions, next appointments, stock summary.
- **Medications** – add/edit/delete, daily schedule with several times per day, optional stock with an explicitly documented estimate, intake history.
- **Doctor appointments** – add/edit/delete, upcoming and past lists grouped by date, completed/cancelled status.

Out of scope for the MVP: AI assistant, OCR, billing, caregiver sharing, calendar sync, push notifications, advanced analytics, interaction checking. See [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md).

## Technology stack (planned)

React · TypeScript (strict) · Vite · Tailwind CSS · React Router · React Hook Form · Zod · Supabase (Auth + PostgreSQL) · Vitest · React Testing Library · Playwright · ESLint + Prettier · GitHub Actions · Vercel.

Exact versions will be recorded here after the project is scaffolded (stage 1).

## Documentation

| Document | Contents |
|---|---|
| [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) | Requirements, business rules, decisions, architecture, risks, testing strategy |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Development stages with completion criteria |
| [docs/DATABASE.md](docs/DATABASE.md) | Data model, constraints, Row Level Security, migration approach |

## Getting started

*(Not available yet — will be added in stage 1 together with the project scaffold: prerequisites, `npm install`, scripts for dev/build/test/lint/e2e, environment variables.)*

## Deployment

*(Planned — Vercel; instructions and live demo link will be added in stage 9.)*

## Screenshots

*(Planned — added in stage 9.)*

## Language convention

User interface and user-facing messages: Polish. Code identifiers, database identifiers, commit messages and technical documentation: English.
