"""Staff leaves: a register the office keeps.

This replaced leave hung off the Django login accounts. Two things were wrong
with that. Leave is recorded for cleaners and handymen who have no login at
all, so `auth.User` could not describe the people it was for. And nobody was
ever going to file a request through the PMS - the office knows who was off and
needs somewhere to write it down, not a workflow.

So there is no status here, and nothing to approve. A period exists or it does
not, and `recorded_by` says who wrote it down.
"""

import uuid

from django.db import models

from .base import TimeStampedModel


class StaffMember(TimeStampedModel):
    """Somebody who works here. A name and a yearly allowance, nothing more.

    Deliberately not a Django user: most of the people in this list cannot sign
    in, and tying the register to who has an account would leave them out of it.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    role = models.CharField(max_length=80, blank=True)
    # 21 is the usual statutory year here; it is per person because it is not
    # the same for everyone, and it changes with length of service.
    annual_leave_days = models.PositiveIntegerField(default=21)
    # Somebody who has left is deactivated, never deleted: their leave last
    # year still happened and that year's figures have to keep adding up.
    active = models.BooleanField(default=True, db_index=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class StaffLeave(TimeStampedModel):
    class LeaveType(models.TextChoices):
        ANNUAL = "annual", "Annual leave"
        SICK = "sick", "Sick leave"
        UNPAID = "unpaid", "Unpaid leave"
        PARENTAL = "parental", "Parental leave"
        OTHER = "other", "Other"

    # Only annual leave spends the yearly allowance. Sick days are not holiday,
    # and counting them against the 21 would quietly punish being ill; unpaid
    # leave is by definition not part of it either.
    SPENDS_ALLOWANCE = {LeaveType.ANNUAL}

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    staff_member = models.ForeignKey(
        StaffMember, on_delete=models.CASCADE, related_name="leave_periods"
    )
    leave_type = models.CharField(max_length=20, choices=LeaveType.choices)

    start_date = models.DateField()
    # Inclusive. Monday to Friday off is five days, not four - and a single day
    # off has the same date at both ends rather than a null.
    end_date = models.DateField()

    note = models.TextField(blank=True)

    # The register's own audit trail. Not an approval - nothing is decided here.
    recorded_by = models.ForeignKey(
        "auth.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["-start_date"]
        indexes = [
            models.Index(fields=["staff_member", "start_date"]),
            models.Index(fields=["start_date", "end_date"]),
        ]

    def __str__(self):
        return f"{self.staff_member} {self.leave_type} {self.start_date}→{self.end_date}"

    @property
    def days(self):
        """Whole days off, both ends included."""
        return (self.end_date - self.start_date).days + 1

    def days_in_year(self, year):
        """Days of this period that fall inside `year`.

        A stay over new year belongs to both years. Charging the whole of it to
        whichever year it started in is how an allowance quietly gains or loses
        days.
        """
        from datetime import date

        start = max(self.start_date, date(year, 1, 1))
        end = min(self.end_date, date(year, 12, 31))
        return max((end - start).days + 1, 0)

    def spends_allowance(self):
        return self.leave_type in self.SPENDS_ALLOWANCE
