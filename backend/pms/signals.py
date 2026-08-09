from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import DoorCode, Property


@receiver(post_save, sender=Property)
def create_door_code_for_property(sender, instance, created, raw=False, **kwargs):
    # `raw` is True when the row is being loaded from a fixture (e.g. a backup
    # import). The fixture carries its own DoorCode, so creating one here would
    # collide — skip side effects during raw loads.
    if raw:
        return
    if created:
        DoorCode.objects.get_or_create(property=instance)
