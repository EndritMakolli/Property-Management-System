# Property Management System

## Deployment

Render deployment settings, required environment variables, and first-deploy
steps are documented in [DEPLOYMENT.md](DEPLOYMENT.md).

## Seed only the properties

The repository does not include the local SQLite database or private data.
To load only the apartment/property list on a new machine:

```powershell
cd backend
python manage.py migrate
python manage.py loaddata properties_seed
```

This fixture includes property names, bedroom counts, reference prices, addresses, and active status only.
It does not include reservations, guests, finance data, door codes, sync URLs, uploaded media, or environment files.
