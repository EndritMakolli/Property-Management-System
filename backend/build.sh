#!/usr/bin/env bash
# Render BUILD step (runs from the backend/ rootDir).
# DB-dependent steps (migrate, bootstrap_admin) are NOT here — the build
# environment can't reach Render's internal database hostname. They run at
# startup in start.sh instead.
set -o errexit

pip install -r requirements.txt
python manage.py collectstatic --no-input
