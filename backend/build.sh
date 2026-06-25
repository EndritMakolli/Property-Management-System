#!/usr/bin/env bash
# Render build step for the Django backend (run from the backend/ rootDir).
set -o errexit

pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate
# Creates the admin from ADMIN_USERNAME/ADMIN_PASSWORD on first deploy; no-op afterwards.
python manage.py bootstrap_admin
