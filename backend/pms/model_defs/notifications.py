from django.contrib.auth.models import User
from django.db import models

from .base import TimeStampedModel


class NotificationRead(TimeStampedModel):
    """One row per notification a person has read.

    The feed itself is computed, never stored - every source is a fact about
    current state, so deriving it on each read means it cannot go stale and
    nothing has to retract a reminder for a service that has since been done.

    What has to persist is the *reading*, and it is per person: one manager
    clearing the bell must not clear it for everyone.

    `key` carries a fingerprint of the state that produced the notification, so
    an alert that lapses, is dealt with, and lapses again comes back unread
    rather than staying dismissed forever.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notification_reads")
    key = models.CharField(max_length=200)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "key"], name="unique_notification_read"),
        ]
        indexes = [models.Index(fields=["user", "key"])]

    def __str__(self):
        return f"{self.user_id} read {self.key}"
