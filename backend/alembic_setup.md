# Database migrations (Alembic)

Migrations are already scaffolded in `alembic/` with an initial migration
(`alembic/versions/0001_initial_schema.py`) covering the full schema: users,
students, courses, enrollments, exam_sessions, questions, exam_attempts,
answers, alerts, monitoring_events, attention_scores.

`alembic/env.py` reads the DB URL from `app.core.config.settings`
(i.e. your `DATABASE_URL` env var / `.env` file), so it always targets
whatever the app itself is configured to use.

## Apply migrations

```bash
alembic upgrade head
```

This runs automatically in the Docker image's start command and should be
run manually the first time you set up a local (non-Docker) Postgres:

```bash
createdb proctor         
alembic upgrade head
python -m app.seed
```

## After changing models

```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

Always review the generated migration before running it — autogenerate is a
good starting point but doesn't catch everything (data migrations, column
renames, etc.).
