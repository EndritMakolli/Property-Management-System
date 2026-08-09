from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import Group, User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie

from ..model_defs.security import MAX_CODES_PER_HOUR
from ..models import LoginChallenge, UserSecurity
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_GROUPS, require_roles
from ._serializers import serialize_managed_user, serialize_user
from ._two_factor import start_challenge
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

    # Second factor: the password alone must not create a session.
    security = UserSecurity.for_user(user)
    if security.is_active:
        challenge, _security, delivered = start_challenge(user, request)
        if not delivered:
            # Fail closed — never fall back to a password-only session.
            return JsonResponse(
                {
                    "error": (
                        "We could not send your verification code. "
                        "Please try again shortly or contact an administrator."
                    )
                },
                status=503,
            )
        return JsonResponse(
            {
                "twoFactorRequired": True,
                "challengeToken": str(challenge.token),
                "emailHint": security.masked_email(),
                "csrfToken": get_token(request),
            }
        )

    login(request, user)
    # login() rotates the CSRF token — hand the new one back to the SPA.
    return JsonResponse({"user": serialize_user(user), "csrfToken": get_token(request)})


@throttle("15/m")
def auth_login_verify(request):
    """Complete a 2FA login by exchanging a challenge token + code for a session."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        payload = json_payload(request)
    except ValidationError as error:
        return JsonResponse({"error": error.messages}, status=400)

    token = (payload.get("challengeToken") or "").strip()
    code = (payload.get("code") or "").strip()
    if not token or not code:
        return JsonResponse({"error": "Enter the code we emailed you."}, status=400)

    try:
        challenge = LoginChallenge.objects.select_related("user").get(token=token)
    except (LoginChallenge.DoesNotExist, ValidationError, ValueError):
        # Same message for unknown/expired/used tokens — no oracle.
        return JsonResponse({"error": "This code is no longer valid. Please sign in again."}, status=400)

    if not challenge.is_usable:
        return JsonResponse({"error": "This code is no longer valid. Please sign in again."}, status=400)

    if not challenge.verify(code):
        return JsonResponse({"error": "That code is incorrect. Please check and try again."}, status=400)

    user = challenge.user
    if not user.is_active:
        return JsonResponse({"error": "This user is inactive."}, status=403)

    login(request, user)
    return JsonResponse({"user": serialize_user(user), "csrfToken": get_token(request)})


@throttle("3/m")
def auth_login_resend(request):
    """Re-send a code for an in-flight challenge, without revealing its state.

    Resending must NOT hand the attacker a fresh attempt budget: a challenge
    whose attempts are exhausted is dead, and the number of codes issued per
    account per hour is capped. Otherwise 'guess 5, resend, repeat' would make
    the per-challenge attempt cap meaningless.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        payload = json_payload(request)
    except ValidationError as error:
        return JsonResponse({"error": error.messages}, status=400)

    token = (payload.get("challengeToken") or "").strip()
    # Always the same body, so this endpoint reveals nothing about a token.
    generic = JsonResponse({"sent": True})
    if not token:
        return generic

    try:
        challenge = LoginChallenge.objects.select_related("user").get(token=token)
    except (LoginChallenge.DoesNotExist, ValidationError, ValueError):
        return generic

    if not challenge.is_usable:
        # Expired, already used, OR out of attempts — all require a fresh login.
        return generic

    security = UserSecurity.for_user(challenge.user)
    if not security.is_active:
        return generic

    if LoginChallenge.recent_count(challenge.user) >= MAX_CODES_PER_HOUR:
        # Also bounds outbound email, so one account cannot burn the SMTP quota
        # and lock every 2FA user out (login fails closed when mail fails).
        return generic

    new_challenge, _security, _delivered = start_challenge(challenge.user, request)
    return JsonResponse({"sent": True, "challengeToken": str(new_challenge.token)})


def auth_security(request):
    """GET/PATCH the signed-in user's own two-factor settings."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Sign in first."}, status=401)

    security = UserSecurity.for_user(request.user)

    if request.method == "GET":
        return JsonResponse({"security": serialize_security(security)})

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
        except ValidationError as error:
            return JsonResponse({"error": error.messages}, status=400)

        # Weakening your own second factor requires proving you know the
        # password, so a stolen session cannot quietly switch 2FA off and
        # outlive a password reset.
        weakening = security.is_active and (
            payload.get("twoFactorEnabled") is False
            or (
                "twoFactorEmail" in payload
                and (payload.get("twoFactorEmail") or "").strip() != security.two_factor_email
            )
        )
        if weakening:
            current_password = payload.get("currentPassword") or ""
            if not request.user.check_password(current_password):
                return JsonResponse(
                    {"error": {"currentPassword": "Enter your current password to change this."}},
                    status=400,
                )

        try:
            apply_security_payload(security, payload)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"security": serialize_security(security)})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def serialize_security(security):
    return {
        "twoFactorEmail": security.two_factor_email,
        "twoFactorEnabled": security.two_factor_enabled,
        "twoFactorActive": security.is_active,
        "emailHint": security.masked_email(),
    }


def apply_security_payload(security, payload):
    """Validate and save 2FA settings. Raises ValidationError on bad input."""
    if "twoFactorEmail" in payload:
        email = (payload.get("twoFactorEmail") or "").strip()
        if email:
            try:
                validate_email(email)
            except ValidationError:
                raise ValidationError({"twoFactorEmail": "Enter a valid email address."})
        security.two_factor_email = email

    if "twoFactorEnabled" in payload:
        security.two_factor_enabled = bool(payload.get("twoFactorEnabled"))

    if security.two_factor_enabled and not security.two_factor_email:
        raise ValidationError(
            {"twoFactorEmail": "Add an email address before turning on two-step verification."}
        )

    security.save()
    return security


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
        users = User.objects.select_related("security").order_by("username")
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
            # AUTH_PASSWORD_VALIDATORS otherwise only applies to createsuperuser
            # and the Django admin forms -- not to accounts made through the app.
            validate_password(password, user)
            user.set_password(password)
            user.save()
            set_user_role(user, role)
            user.save()
            apply_security_payload(UserSecurity.for_user(user), payload)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )

        user.refresh_from_db()
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
            validate_password(password, managed_user)
            managed_user.set_password(password)
        managed_user.save()
        apply_security_payload(UserSecurity.for_user(managed_user), payload)
    except ValidationError as error:
        return JsonResponse(
            {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
            status=400,
        )

    # Changing your own password rotates the session auth hash, which would log
    # you out on the next request — keep the current session signed in.
    if is_self and password:
        update_session_auth_hash(request, managed_user)

    managed_user.refresh_from_db()
    return JsonResponse({"user": serialize_managed_user(managed_user)})
