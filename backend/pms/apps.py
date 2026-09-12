from django.apps import AppConfig


class PmsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'pms'

    def ready(self):
        import pms.signals  # noqa: F401
        # Registers the production-config checks. Importing here rather
        # than at module scope keeps them out of the app-loading path.
        import pms.checks  # noqa: F401
