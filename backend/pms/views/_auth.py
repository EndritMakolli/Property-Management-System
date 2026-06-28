from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import Group, User
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie

from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_GROUPS, require_roles
from ._serializers import serialize_managed_user, serialize_user
from ._utils import json_payload, throttle


def set_user_role(user, role):
    if role not in ROLE_GROUPS:
        raise ValidationError({"role": "Choose a valid role."})
    groups = {name: Group.objects.get_or_create(name=name)[0] for name in ROLE_GROUPS.values()}
    user.groups.remove(*groups.values())
    user.groups.add(groups[ROLE_GROUPS[role]])
    user.is_staff = role == ROLE_ADMIN
    if role != ROLE_ADMIN:
        user.is_superuser = False


# ensure_csrf_cookie: the SPA calls this on every load, which guarantees the
# csrftoken cookie exists before any POST/PATCH/DELETE is attempted.
@ensure_csrf_cookie
def auth_me(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    # Return the CSRF token in the body so a cross-domain SPA can send it as the
    # X-CSRFToken header (JS can't read the cookie across different domains).
    token = get_token(request)
    if not request.user.is_authenticated:
        return JsonResponse(
            {"user": {"isAuthenticated": False, "role": "", "username": ""}, "csrfToken": token}
        )
    return JsonResponse({"user": serialize_user(request.user), "csrfToken": token})


@throttle("10/m")  # blunt brute-force protection on the login endpoint
def auth_login(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        payload = json_payload(request)
    except ValidationError as error:
        return JsonResponse({"error": error.messages}, status=400)

    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"error": "Invalid username or password."}, status=400)
    if not user.is_active:
        return JsonResponse({"error": "This user is inactive."}, status=403)

    login(request, user)
    # login() rotates the CSRF token — hand the new one back to the SPA.
    return JsonResponse({"user": serialize_user(user), "csrfToken": get_token(request)})


def auth_logout(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    logout(request)
    return JsonResponse(
        {"user": {"isAuthenticated": False, "role": "", "username": ""}, "csrfToken": get_token(request)}
    )


def user_list(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method == "GET":
        users = User.objects.order_by("username")
        return JsonResponse({"users": [serialize_managed_user(user) for user in users]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
        except ValidationError as error:
            return JsonResponse({"error": error.messages}, status=400)

        username = (payload.get("username") or "").strip()
        password = payload.get("password") or ""
        role = payload.get("role") or ROLE_CLEANING
        if not username:
            return JsonResponse({"error": {"username": "Username is required."}}, status=400)
        if not password:
            return JsonResponse({"error": {"password": "Password is required."}}, status=400)
        if User.objects.filter(username=username).exists():
            return JsonResponse({"error": {"username": "This username already exists."}}, status=400)

        try:
            user = User(username=username, is_active=bool(payload.get("isActive", True)))
            user.set_password(password)
            user.save()
            set_user_role(user, role)
            user.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )

        return JsonResponse({"user": serialize_managed_user(user)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def user_detail(request, user_id):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    try:
        managed_user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return JsonResponse({"error": "User not found."}, status=404)

    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    is_self = managed_user.pk == request.user.pk

    try:
        payload = json_payload(request)
    except ValidationError as error:
        return JsonResponse({"error": error.messages}, status=400)

    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    role = payload.get("role") or ROLE_CLEANING
    if not username:
        return JsonResponse({"error": {"username": "Username is required."}}, status=400)
    if User.objects.exclude(pk=managed_user.pk).filter(username=username).exists():
        return JsonResponse({"error": {"username": "This username already exists."}}, status=400)

    try:
        managed_user.username = username
        if is_self:
            # Admins may rename themselves and change their own password, but
            # cannot drop their own role or deactivate their own account here —
            # either would lock them out of the panel.
            managed_user.is_active = True
        else:
            managed_user.is_active = bool(payload.get("isActive", True))
            set_user_role(managed_user, role)
        if password:
            managed_user.set_password(password)
        managed_user.save()
    except ValidationError as error:
        return JsonResponse(
            {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
            status=400,
        )

    # Changing your own password rotates the session auth hash, which would log
    # you out on the next request — keep the current session signed in.
    if is_self and password:
        update_session_auth_hash(request, managed_user)

    return JsonResponse({"user": serialize_managed_user(managed_user)})
