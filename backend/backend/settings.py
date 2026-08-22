import os
from pathlib import Path
from urllib.parse import urlsplit

from decouple import Csv, config
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def normalize_origin_list(values):
    """Return scheme://host origins with no path or trailing slash."""
    origins = []
    for value in values:
        raw = value.strip().rstrip('/')
        if not raw:
            continue
        parsed = urlsplit(raw)
        if parsed.scheme and parsed.netloc:
            origins.append(f'{parsed.scheme}://{parsed.netloc}')
        else:
            origins.append(raw)
    return origins

_debug_from_environment = os.environ.get('DEBUG')
if _debug_from_environment and _debug_from_environment.lower() not in {
    '1',
    '0',
    'true',
    'false',
    'yes',
    'no',
    'on',
    'off',
}:
    # Some tools set DEBUG=release, which breaks python-decouple's bool cast.
    # Ignore that unrelated value so the project's .env DEBUG setting can win.
    os.environ.pop('DEBUG')

SECRET_KEY = config('SECRET_KEY')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost', cast=Csv())

# Render injects the service's public hostname at runtime. Trust it
# automatically so the generated *.onrender.com backend host works.
_render_host = os.environ.get('RENDER_EXTERNAL_HOSTNAME')
if _render_host and _render_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_render_host)

PUBLIC_BASE_URL = config('PUBLIC_BASE_URL', default='')

# Where an emailed guest sign-in link points. Deliberately NOT PUBLIC_BASE_URL:
# the SPA and this API are separate origins (see CORS_ALLOWED_ORIGINS), so a
# link built from the API host would land on a domain with no /account page.
GUEST_PORTAL_URL = config('GUEST_PORTAL_URL', default='http://localhost:5173')

# Claude API (optional) — powers expense-invoice auto-extraction. Leave
# ANTHROPIC_API_KEY blank to disable the feature (manual entry still works).
ANTHROPIC_API_KEY = config('ANTHROPIC_API_KEY', default='')
ANTHROPIC_MODEL = config('ANTHROPIC_MODEL', default='claude-haiku-4-5')

# ── Email (two-factor login codes) ───────────────────────────────────────────
# Without EMAIL_HOST configured, codes are printed to the console — fine for
# local development, but 2FA logins will NOT work in production until real SMTP
# credentials are set. For Gmail use an App Password, never the account password.
EMAIL_HOST = config('EMAIL_HOST', default='')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_USE_SSL = config('EMAIL_USE_SSL', default=False, cast=bool)
EMAIL_TIMEOUT = config('EMAIL_TIMEOUT', default=15, cast=int)
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default=EMAIL_HOST_USER or 'no-reply@localhost')

# Only switch to SMTP once the config can actually authenticate. A half-filled
# block (host set, password still blank) would otherwise fail every send — and
# since 2FA login fails closed, that would lock every 2FA user out of the app.
# Falling back to the console backend keeps them able to sign in using the code
# printed in the server log while the credentials are being set up.
EMAIL_IS_CONFIGURED = bool(EMAIL_HOST) and (bool(EMAIL_HOST_PASSWORD) or not EMAIL_HOST_USER)
EMAIL_BACKEND = (
    'django.core.mail.backends.smtp.EmailBackend'
    if EMAIL_IS_CONFIGURED
    else 'django.core.mail.backends.console.EmailBackend'
)

# Only read X-Forwarded-For when a trusted proxy actually sets it; otherwise a
# client could spoof its IP and evade per-IP rate limiting.
TRUST_PROXY_HEADERS = config('TRUST_PROXY_HEADERS', default=not DEBUG, cast=bool)

# The Django admin is a second login form that does NOT enforce this app's
# email two-step verification, and the session it mints is trusted by the whole
# API — so it is disabled unless explicitly turned on, and never on a guessable
# path. Manage staff accounts through the app's own Admin Panel instead.
DJANGO_ADMIN_ENABLED = config('DJANGO_ADMIN_ENABLED', default=False, cast=bool)
DJANGO_ADMIN_PATH = config('DJANGO_ADMIN_PATH', default='admin').strip('/')

INSTALLED_APPS = [
    # django.contrib.admin stays installed (its templates/permissions are cheap
    # and other apps expect it); the URL route is what DJANGO_ADMIN_ENABLED gates.
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'pms',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'backend.wsgi.application'

# Render's managed Postgres exposes a single DATABASE_URL. Prefer it when set
# and fall back to individual DB_* variables for local development.
DATABASE_URL = config('DATABASE_URL', default='')
if DATABASE_URL:
    import dj_database_url

    DATABASES = {
        'default': dj_database_url.parse(
            DATABASE_URL, conn_max_age=600, ssl_require=not DEBUG
        )
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': config('DB_NAME', default='pmsdb'),
            'USER': config('DB_USER', default='postgres'),
            'PASSWORD': config('DB_PASSWORD', default=''),
            'HOST': config('DB_HOST', default='localhost'),
            'PORT': config('DB_PORT', default='5432'),
        }
    }

# Rate limiting must be shared across gunicorn workers, otherwise every limit is
# silently multiplied by WEB_CONCURRENCY and resets on each deploy. The database
# cache needs no extra service; swap in Redis if one is available.
# Run `python manage.py createcachetable` after migrating.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'pms_cache_table',
    }
}

# django-ratelimit keys on REMOTE_ADDR by default, which behind a proxy is the
# load balancer — putting every visitor in one bucket, so a single attacker
# could rate-limit the whole product. Resolve the real client IP instead.
#
# This MUST be a dotted path to a callable, not a raw header name: given a bare
# header, django-ratelimit raises ImproperlyConfigured (a 500) whenever that
# header is absent, which turned every throttled endpoint — including login —
# into a server error for any request that did not arrive through the proxy.
RATELIMIT_IP_META_KEY = 'pms.views._utils.ratelimit_client_ip'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Europe/Budapest'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = 'media/'
MEDIA_ROOT = Path(config('MEDIA_ROOT', default=str(BASE_DIR / 'media')))
DATA_UPLOAD_MAX_MEMORY_SIZE = config('DATA_UPLOAD_MAX_MEMORY_SIZE', default=10 * 1024 * 1024, cast=int)
FILE_UPLOAD_MAX_MEMORY_SIZE = config('FILE_UPLOAD_MAX_MEMORY_SIZE', default=10 * 1024 * 1024, cast=int)

STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOWED_ORIGINS = normalize_origin_list(config('CORS_ALLOWED_ORIGINS', default='', cast=Csv()))
if DEBUG and not CORS_ALLOWED_ORIGINS:
    CORS_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    'accept',
    'authorization',
    'content-type',
    'x-csrftoken',
]

CSRF_TRUSTED_ORIGINS = normalize_origin_list(config('CSRF_TRUSTED_ORIGINS', default='', cast=Csv()))
if DEBUG:
    CSRF_TRUSTED_ORIGINS += ['http://localhost:5173', 'http://127.0.0.1:5173']

SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False  # The SPA reads this cookie to send X-CSRFToken.
X_FRAME_OPTIONS = 'DENY'
SECURE_REFERRER_POLICY = 'same-origin'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'
_cookie_samesite = (config('COOKIE_SAMESITE', default='Lax') or 'Lax').strip().lower()
COOKIE_SAMESITE = {
    'lax': 'Lax',
    'strict': 'Strict',
    'none': 'None',
}.get(_cookie_samesite, 'Lax')

if not DEBUG:
    # Fail loudly rather than shipping with the development key: every signature
    # Django makes (sessions, CSRF, password reset) derives from SECRET_KEY, so a
    # published or default value undermines all of them at once.
    if SECRET_KEY.startswith('django-insecure-') or len(SECRET_KEY) < 32:
        raise ImproperlyConfigured(
            'Set a strong, unique SECRET_KEY in the environment before running '
            'with DEBUG=False.'
        )

    # Render terminates TLS at its load balancer and forwards the real scheme in
    # this header. Without it, Django may think HTTPS requests are plain HTTP.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SESSION_COOKIE_SAMESITE = COOKIE_SAMESITE
    CSRF_COOKIE_SAMESITE = COOKIE_SAMESITE
