# Render Deployment

This project is configured for a Render Blueprint deployment with:

- `pms-db`: managed Postgres
- `pms-backend`: Django API served by Gunicorn
- `pms-frontend`: React/Vite static site
- `pms-media`: persistent disk for uploaded media

Render docs:

- Blueprint reference: https://render.com/docs/blueprint-spec
- Django deployment: https://render.com/docs/deploy-django
- Static sites: https://render.com/docs/static-sites
- Persistent disks: https://render.com/docs/disks

## Values To Fill In Render

After Render creates the services, note these URLs:

- `BACKEND_URL`: your backend URL, for example `https://pms-backend.onrender.com`
- `BACKEND_HOST`: the same backend URL without `https://`, for example `pms-backend.onrender.com`
- `FRONTEND_URL`: your frontend URL, for example `https://pms-frontend.onrender.com`

Use comma-separated lists when you have multiple URLs. Do not add spaces.
For `CSRF_TRUSTED_ORIGINS` and `CORS_ALLOWED_ORIGINS`, use origins only:
`https://example.onrender.com`, not `https://example.onrender.com/` and not
`https://example.onrender.com/some/path`.

### Backend Environment Variables

These are created by `render.yaml`; fill or verify the ones marked "you set".

| Key | Value |
| --- | --- |
| `PYTHON_VERSION` | `3.12.6` |
| `SECRET_KEY` | Let Render generate it. Do not put it in git. |
| `DEBUG` | `False` |
| `DATABASE_URL` | Auto-filled from `pms-db` by the Blueprint. |
| `MEDIA_ROOT` | `/var/data/media` when using the persistent disk. |
| `WEB_CONCURRENCY` | `2` |
| `COOKIE_SAMESITE` | `None` for separate Render frontend/backend domains. Use `Lax` only when frontend and backend are same-site custom domains, such as `app.example.com` and `api.example.com`. |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` | `10485760` |
| `FILE_UPLOAD_MAX_MEMORY_SIZE` | `10485760` |
| `ALLOWED_HOSTS` | You set this to backend hostnames only: `pms-backend.onrender.com` or `api.example.com,pms-backend.onrender.com`. |
| `CSRF_TRUSTED_ORIGINS` | You set this to frontend origins with scheme and no trailing slash: `https://pms-frontend.onrender.com` or `https://app.example.com`. |
| `CORS_ALLOWED_ORIGINS` | You set this to the same frontend origins as CSRF: `https://pms-frontend.onrender.com` or `https://app.example.com`. |
| `PUBLIC_BASE_URL` | You set this to the backend public URL, for example `https://pms-backend.onrender.com`. This is used for public iCal links. |
| `GOOGLE_SHEETS_ID` | Optional. Spreadsheet ID only. Leave blank to disable Sheets sync. |
| `GOOGLE_SHEETS_CREDENTIALS_JSON` | Optional. Paste the service-account JSON here as a Render secret env var. |
| `GOOGLE_SHEETS_YEAR` | Optional. Use `0` or blank for current year, or a fixed year like `2026`. |

### Frontend Environment Variables

| Key | Value |
| --- | --- |
| `VITE_API_BASE_URL` | The backend public URL, for example `https://pms-backend.onrender.com`. |

## Default Render URL Example

If Render gives you:

- Backend: `https://pms-backend.onrender.com`
- Frontend: `https://pms-frontend.onrender.com`

Set backend variables:

```text
ALLOWED_HOSTS=pms-backend.onrender.com
CSRF_TRUSTED_ORIGINS=https://pms-frontend.onrender.com
CORS_ALLOWED_ORIGINS=https://pms-frontend.onrender.com
PUBLIC_BASE_URL=https://pms-backend.onrender.com
COOKIE_SAMESITE=None
```

Set frontend variables:

```text
VITE_API_BASE_URL=https://pms-backend.onrender.com
```

## Custom Domain Example

If you use:

- Backend/API: `https://api.example.com`
- Frontend/app: `https://app.example.com`

Set backend variables:

```text
ALLOWED_HOSTS=api.example.com,pms-backend.onrender.com
CSRF_TRUSTED_ORIGINS=https://app.example.com
CORS_ALLOWED_ORIGINS=https://app.example.com
PUBLIC_BASE_URL=https://api.example.com
COOKIE_SAMESITE=Lax
```

Set frontend variables:

```text
VITE_API_BASE_URL=https://api.example.com
```

## Deploy Steps

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from this repo. Render will read `render.yaml`.
3. Fill the `sync: false` environment variables above. If Render has not assigned final URLs yet, use the expected service URLs and update them after the first deploy.
4. Wait for backend and frontend deploys to finish. The backend build runs dependency install, `collectstatic`, and database migrations.
5. Open the backend service shell and create the first admin user:

```bash
python manage.py createsuperuser
```

6. Optional: load the sanitized property seed data:

```bash
python manage.py loaddata properties_seed
```

7. Test:

- `https://YOUR_BACKEND/healthz/` returns `{"ok": true}`.
- The frontend loads.
- Login works.
- A photo upload survives a redeploy if you kept the persistent disk.
- Calendar/iCal export links use the backend public URL.

## Production Notes

- Keep `DEBUG=False` in Render.
- Keep secrets only in Render environment variables.
- Use a paid backend instance if uploaded media must persist on Render's disk.
- Upgrade the database plan before storing real production data.
- If you use Google Sheets sync, share the spreadsheet with the service-account email as Editor before enabling the env vars.

## Troubleshooting

### `/login` Returns 404

This is a frontend static-site rewrite issue, not a Django login issue. React
Router routes such as `/login`, `/properties`, and `/calendar` must all serve
`/index.html`.

If you created the frontend from `render.yaml`, the rewrite is already included.
If you created the frontend manually in the Render dashboard, add this rule to
the frontend Static Site under Redirects/Rewrites:

```text
Source: /*
Destination: /index.html
Action: Rewrite
```

Also make sure you are opening the frontend URL, not the backend URL. The
backend has `/admin/`, `/api/`, and `/healthz/`; it does not have `/login`.

### Login Fails on iPhone / Safari (cross-site cookies)

If login works on desktop and Android Chrome but fails on iPhone (any browser —
Safari, Chrome, Edge all use WebKit) with a CSRF error or a JSON parse error
("Unrecognized token '<'"), the cause is cross-site cookies. The frontend and
backend are on two different `onrender.com` subdomains, which the browser treats
as cross-site; iOS/WebKit blocks cross-site cookies, so the session/CSRF cookie
is never stored. `onrender.com` is a public suffix, so the two subdomains cannot
share a cookie — there is no settings-only fix.

**Recommended fix (free): proxy the API through the frontend so it's one origin.**
On the frontend Static Site:

1. Set `VITE_API_BASE_URL` to **empty** so the app calls `/api` on its own origin.
2. Under Redirects/Rewrites add **two rules, in this order** (the `/api` rule must
   come first):

   ```text
   Source: /api/*   Destination: https://YOUR_BACKEND.onrender.com/api/*   Action: Rewrite
   Source: /*       Destination: /index.html                              Action: Rewrite
   ```

3. Manual Deploy → Clear build cache & deploy (so the empty `VITE_API_BASE_URL`
   is rebuilt in).

Now the browser only ever talks to the frontend origin; the cookie becomes
first-party and iOS accepts it. (`render.yaml` already encodes these routes for
Blueprint deploys; manually-created services must add them in the dashboard.)

**Alternative (bulletproof): custom domain.** Put the frontend on
`app.example.com` and the backend on `api.example.com`, set
`COOKIE_SAMESITE=Lax`, and they're same-site — see the Custom Domain Example
above.
