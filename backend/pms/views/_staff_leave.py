"""Staff leaves: the register, and what is left of each allowance.

There is no request-and-approve flow here and deliberately so. The office knows
who was off; what it lacked was somewhere to write it down and a running total.
Cleaning staff are recorded in this register and do not keep it, so it is
office-only.
"""

from datetime import date

from django.http import JsonResponse

from ..models import StaffLeave, StaffMember
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._utils import date_value, json_payload

# Who keeps the register. Not cleaning: they appear in it.
KEEPERS = [ROLE_ADMIN, ROLE_MANAGEMENT]


def serialize_member(member):
    return {
        "id": str(member.id),
        "name": member.name,
        "role": member.role,
        "annualLeaveDays": member.annual_leave_days,
        "active": member.active,
        "notes": member.notes,
    }


def serialize_leave(leave):
    return {
        "id": str(leave.id),
        "staffMemberId": str(leave.staff_member_id),
        "staffName": leave.staff_member.name,
        "leaveType": leave.leave_type,
        "leaveTypeLabel": leave.get_leave_type_display(),
        "startDate": leave.start_date.isoformat(),
        "endDate": leave.end_date.isoformat(),
        "days": leave.days,
        "note": leave.note,
        "recordedBy": leave.recorded_by.username if leave.recorded_by else "",
    }


def _summary(members, periods, year):
    """Each person's year: allowance, what annual leave has spent of it, and
    what is left. Sick and unpaid days are reported beside it, never inside it."""
    rows = {}
    for member in members:
        rows[member.id] = {
            "id": str(member.id),
            "name": member.name,
            "role": member.role,
            "annualAllowance": member.annual_leave_days,
            "annualTaken": 0,
            "annualRemaining": member.annual_leave_days,
            "sickDays": 0,
            "unpaidDays": 0,
            "otherDays": 0,
        }

    for leave in periods:
        row = rows.get(leave.staff_member_id)
        if row is None:
            continue
        days = leave.days_in_year(year)
        if leave.spends_allowance():
            row["annualTaken"] += days
            # Deliberately allowed to go negative: somebody who has taken 25 of
            # 21 has, and clamping to zero would hide it.
            row["annualRemaining"] = row["annualAllowance"] - row["annualTaken"]
        elif leave.leave_type == StaffLeave.LeaveType.SICK:
            row["sickDays"] += days
        elif leave.leave_type == StaffLeave.LeaveType.UNPAID:
            row["unpaidDays"] += days
        else:
            row["otherDays"] += days

    return list(rows.values())


def staff_member_list(request):
    denied = require_roles(request, KEEPERS)
    if denied:
        return denied

    if request.method == "GET":
        wants_inactive = request.GET.get("inactive") == "1"
        members = StaffMember.objects.filter(active=not wants_inactive)
        return JsonResponse({"staff": [serialize_member(m) for m in members]})

    if request.method == "POST":
        payload = json_payload(request)
        name = (payload.get("name") or "").strip()
        if not name:
            return JsonResponse({"error": {"name": "Enter a name."}}, status=400)

        allowance, error = _allowance(payload, default=21)
        if error:
            return error

        member = StaffMember.objects.create(
            name=name,
            role=(payload.get("role") or "").strip(),
            annual_leave_days=allowance,
            notes=(payload.get("notes") or "").strip(),
        )
        return JsonResponse({"member": serialize_member(member)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def _allowance(payload, default):
    """The yearly allowance from a payload, or (default, None). Returns
    `(value, error_response)` so callers stay flat."""
    if "annualLeaveDays" not in payload:
        return default, None
    try:
        value = int(payload.get("annualLeaveDays"))
    except (TypeError, ValueError):
        return None, JsonResponse(
            {"error": {"annualLeaveDays": "Enter a whole number of days."}}, status=400
        )
    if value < 0:
        return None, JsonResponse(
            {"error": {"annualLeaveDays": "Enter zero or more days."}}, status=400
        )
    return value, None


def staff_member_detail(request, member_id):
    denied = require_roles(request, KEEPERS)
    if denied:
        return denied

    try:
        member = StaffMember.objects.get(pk=member_id)
    except (StaffMember.DoesNotExist, ValueError):
        return JsonResponse({"error": "Staff member not found."}, status=404)

    if request.method == "PATCH":
        payload = json_payload(request)
        if "name" in payload:
            name = (payload.get("name") or "").strip()
            if not name:
                return JsonResponse({"error": {"name": "Enter a name."}}, status=400)
            member.name = name
        if "role" in payload:
            member.role = (payload.get("role") or "").strip()
        if "notes" in payload:
            member.notes = (payload.get("notes") or "").strip()
        if "active" in payload:
            member.active = bool(payload.get("active"))
        if "annualLeaveDays" in payload:
            allowance, error = _allowance(payload, default=member.annual_leave_days)
            if error:
                return error
            member.annual_leave_days = allowance
        member.save()
        return JsonResponse({"member": serialize_member(member)})

    if request.method == "DELETE":
        # Deactivating is the normal way out and keeps last year's figures
        # adding up. This is for a name typed in error.
        member.delete()
        return JsonResponse({"ok": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def staff_leave_list(request):
    denied = require_roles(request, KEEPERS)
    if denied:
        return denied

    if request.method == "GET":
        try:
            year = int(request.GET.get("year") or date.today().year)
        except ValueError:
            return JsonResponse({"error": "Choose a valid year."}, status=400)

        members = list(StaffMember.objects.filter(active=True))
        # Overlap, not containment: a period running over new year belongs to
        # both years and must appear in the grid for each.
        periods = list(
            StaffLeave.objects.select_related("staff_member", "recorded_by").filter(
                start_date__lte=date(year, 12, 31), end_date__gte=date(year, 1, 1)
            )
        )

        return JsonResponse({
            "year": year,
            "staff": _summary(members, periods, year),
            "leave": [serialize_leave(leave) for leave in periods],
        })

    if request.method == "POST":
        payload = json_payload(request)

        leave_type = payload.get("leaveType")
        if leave_type not in StaffLeave.LeaveType.values:
            return JsonResponse({"error": {"leaveType": "Choose a kind of leave."}}, status=400)

        try:
            member = StaffMember.objects.get(pk=payload.get("staffMemberId"))
        except (StaffMember.DoesNotExist, ValueError, TypeError):
            return JsonResponse({"error": {"staffMemberId": "Choose a member of staff."}}, status=400)

        start, end, error = _period(payload)
        if error:
            return error

        leave = StaffLeave.objects.create(
            staff_member=member,
            leave_type=leave_type,
            start_date=start,
            end_date=end,
            note=(payload.get("note") or "").strip(),
            recorded_by=request.user if request.user.is_authenticated else None,
        )
        return JsonResponse({"leave": serialize_leave(leave)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def _period(payload, current=None):
    """(start, end, error_response) from a payload, keeping what is not sent."""
    try:
        start = (
            date_value(payload.get("startDate"), "startDate")
            if "startDate" in payload
            else (current.start_date if current else None)
        )
        end = (
            date_value(payload.get("endDate"), "endDate")
            if "endDate" in payload
            else (current.end_date if current else None)
        )
    except Exception:
        return None, None, JsonResponse({"error": {"startDate": "Choose valid dates."}}, status=400)

    if not start or not end:
        return None, None, JsonResponse({"error": {"startDate": "Choose valid dates."}}, status=400)
    if end < start:
        return None, None, JsonResponse(
            {"error": {"endDate": "Leave cannot end before it starts."}}, status=400
        )
    return start, end, None


def staff_leave_detail(request, leave_id):
    denied = require_roles(request, KEEPERS)
    if denied:
        return denied

    try:
        leave = StaffLeave.objects.select_related("staff_member", "recorded_by").get(pk=leave_id)
    except (StaffLeave.DoesNotExist, ValueError):
        return JsonResponse({"error": "Leave not found."}, status=404)

    if request.method == "PATCH":
        payload = json_payload(request)

        if "leaveType" in payload:
            if payload.get("leaveType") not in StaffLeave.LeaveType.values:
                return JsonResponse({"error": {"leaveType": "Choose a kind of leave."}}, status=400)
            leave.leave_type = payload["leaveType"]

        if "startDate" in payload or "endDate" in payload:
            start, end, error = _period(payload, current=leave)
            if error:
                return error
            leave.start_date, leave.end_date = start, end

        if "note" in payload:
            leave.note = (payload.get("note") or "").strip()

        leave.save()
        return JsonResponse({"leave": serialize_leave(leave)})

    if request.method == "DELETE":
        leave.delete()
        return JsonResponse({"ok": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)
