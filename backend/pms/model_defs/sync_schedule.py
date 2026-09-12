"""When each feed is fetched next, and who is fetching right now.

Two models, because they answer two questions that fail in different ways.

`SyncRun` is the lock. Two imports running at once reconcile the same
apartment against two different snapshots of the same feed, and whichever
finishes last wins - so the calendar ends up reflecting the slower fetch rather
than a decision anybody made. A row in the database is the lock rather than a
process-local one because the importer is started from a scheduler, from the
web process and from a terminal, and those share nothing but the database.

`ChannelSyncState` is the per-feed clock. It exists so that a channel which
cannot be reached is retried sooner than its next scheduled run, without being
hammered - and so the page can say *why* a feed is behind instead of showing a
stale timestamp with no explanation.
"""

import uuid

from django.db import models

from .properties import Property


class SyncRun(models.Model):
    """One pass of the importer. At most one may be in progress."""

    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    class Trigger(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        MANUAL = "manual", "Manual"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.RUNNING)
    trigger = models.CharField(max_length=12, choices=Trigger.choices, default=Trigger.SCHEDULED)
    started_at = models.DateTimeField(auto_now_add=True)
    # Touched as the run works. A run that has stopped beating has died with
    # the lock held, and may be taken over; one that is merely slow has not.
    heartbeat_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    properties_synced = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["status", "started_at"])]

    def __str__(self):
        return f"Sync run {self.status} @ {self.started_at:%Y-%m-%d %H:%M}"


class ChannelSyncState(models.Model):
    """One apartment's feed on one channel: when it was last reached, and when
    it will be tried again."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, related_name="channel_sync_states"
    )
    channel = models.CharField(max_length=20)

    last_attempt_at = models.DateTimeField(null=True, blank=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    # Drives the backoff, and tells the page how long a feed has been down.
    consecutive_failures = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["property", "channel"], name="unique_channel_sync_state"
            ),
        ]
        indexes = [models.Index(fields=["next_attempt_at"])]

    def __str__(self):
        return f"{self.property} [{self.channel}] next {self.next_attempt_at}"
