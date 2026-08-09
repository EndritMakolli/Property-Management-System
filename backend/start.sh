#!/usr/bin/env bash
# Render START command (runs from the backend/ rootDir).
# Runs at runtime, where the container is on Render's private network and can
# resolve the internal DATABASE_URL host (the build environment cannot).
set -o errexit

python manage.py migrate
# Shared cache backing the rate limiter. Without it every limit would be
# enforced per-worker, silently multiplying each limit by WEB_CONCURRENCY.
python manage.py createcachetable
python manage.py bootstrap_admin

# Threaded workers: several endpoints make blocking outbound calls (SMTP for
# 2FA codes, iCal fetches, the Anthropic API). With plain sync workers, two
# slow calls would occupy every worker and take the whole site down.
exec gunicorn backend.wsgi:application \
  --worker-class gthread \
  --threads "${GUNICORN_THREADS:-4}" \
  --timeout "${GUNICORN_TIMEOUT:-60}" \
  --log-file -
