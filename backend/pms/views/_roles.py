from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.http import JsonResponse

ROLE_ADMIN = "admin"
ROLE_MANAGEMENT = "management"
ROLE_CLEANING = "cleaning"
ROLE_GROUPS = {
    ROLE_ADMIN: "Admin",
    ROLE_MANAGEMENT: "Management",
    ROLE_CLEANING: "Cleaning",
}


def user_role(user):
    if not user.is_authenticated:
        return ""
    if user.is_superuser or user.groups.filter(name="Admin").exists():
        return ROLE_ADMIN
    if user.groups.filter(name="Management").exists():
        return ROLE_MANAGEMENT
    if user.groups.filter(name="Cleaning").exists():
        return ROLE_CLEANING
    return ROLE_CLEANING


def role_allowed(request, allowed_roles):
    return request.user.is_authenticated and user_role(request.user) in allowed_roles


def forbidden_response():
    return JsonResponse({"error": "You do not have permission for this action."}, status=403)


def unauthenticated_response():
    return JsonResponse({"error": "Login required."}, status=401)


def require_roles(request, allowed_roles):
    if not request.user.is_authenticated:
        return unauthenticated_response()
    if not role_allowed(request, allowed_roles):
        return forbidden_response()
    return None
