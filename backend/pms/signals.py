from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import DoorCode, Property


@receiver(post_save, sender=Property)
def create_door_code_for_property(sender, instance, created, **kwargs):
    if created:
        DoorCode.objects.get_or_create(property=instance)
