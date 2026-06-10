from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pms', '0010_add_new_models_and_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='financeexpense',
            name='platform',
            field=models.CharField(
                max_length=20,
                choices=[('airstay', 'AirStay'), ('fleet', 'Fleet')],
                blank=True,
                null=True,
                default=None,
            ),
        ),
    ]
