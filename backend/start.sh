#!/usr/bin/env bash
# Render START command (runs from the backend/ rootDir).
# Runs at runtime, where the container is on Render's private network and can
# resolve the internal DATABASE_URL host (the build environment cannot).
set -o errexit

python manage.py migrate
python manage.py bootstrap_admin
exec gunicorn backend.wsgi:application --log-file -
