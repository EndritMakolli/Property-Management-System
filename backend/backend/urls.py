"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.http import Http404, JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve as serve_media

from pms.views._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles

# Media paths holding personal or commercially sensitive data. These are never
# reachable over the unauthenticated /media/ route — either a role check runs
# first, or (for ID documents) a dedicated streaming view serves them.
#   guests/documents/       passports, national IDs  -> API view only
#   expenses/               supplier invoices, bank details
#   reservations/           guest attachments
PRIVATE_MEDIA_PREFIXES = ('expenses/', 'reservations/')
BLOCKED_MEDIA_PREFIXES = ('guests/',)


def healthz(request):
    return JsonResponse({"ok": True})


def guarded_media(request, path, **kwargs):
    """Serve an upload, enforcing access rules by path prefix.

    Property photos and the company logo stay public — the guest booking site
    needs them. Everything holding personal data requires a staff session.
    """
    normalized = path.replace('\\', '/').lstrip('/')
    if normalized.startswith(BLOCKED_MEDIA_PREFIXES):
        # Served only by pms.views._guests.guest_document_download.
        raise Http404
    if normalized.startswith(PRIVATE_MEDIA_PREFIXES):
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
        if denied:
            return denied
    return serve_media(request, path, **kwargs)


urlpatterns = [
    path('healthz/', healthz, name='healthz'),
    path('api/', include('pms.urls')),
]

# The Django admin is OFF by default: it is a second login form that does not
# enforce this app's email 2FA, and a session minted there is trusted by the
# whole API. The app has its own user management at /api/users/. Enable it only
# deliberately, and it still sits behind an unguessable path.
if settings.DJANGO_ADMIN_ENABLED:
    from django.contrib import admin

    urlpatterns += [path(f'{settings.DJANGO_ADMIN_PATH}/', admin.site.urls)]

# Same guarded route in both modes so a protected file is never public by
# accident in development either.
urlpatterns += [
    re_path(
        r'^media/(?P<path>.*)$',
        guarded_media,
        {'document_root': settings.MEDIA_ROOT},
        name='media',
    ),
]
