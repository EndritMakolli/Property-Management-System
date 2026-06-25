import os
from pathlib import Path
from urllib.parse import urlsplit

from decouple import Csv, config

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

# Google Sheets reservation sync (optional). Leave GOOGLE_SHEETS_ID blank to
# disable the integration entirely.
GOOGLE_SHEETS_ID = config('GOOGLE_SHEETS_ID', default='')
GOOGLE_SHEETS_CREDENTIALS_FILE = config('GOOGLE_SHEETS_CREDENTIALS_FILE', default='')
if GOOGLE_SHEETS_CREDENTIALS_FILE and not os.path.isabs(GOOGLE_SHEETS_CREDENTIALS_FILE):
    GOOGLE_SHEETS_CREDENTIALS_FILE = str(BASE_DIR / GOOGLE_SHEETS_CREDENTIALS_FILE)
GOOGLE_SHEETS_CREDENTIALS_JSON = config('GOOGLE_SHEETS_CREDENTIALS_JSON', default='')
GOOGLE_SHEETS_YEAR = int(config('GOOGLE_SHEETS_YEAR', default=0) or 0)

INSTALLED_APPS = [
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
