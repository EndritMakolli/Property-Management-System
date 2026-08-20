import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Drop the superseded PromoCode model and the fields it replaces.

    Every price adjustment now lives on PricingRule, seeded from PromoCode by
    migration 0028. Two orderings here are load-bearing:

    - RemoveField(bookingrequest.promo_code) must run before the rename of
      promo_rule -> promo_code, or the new name collides with the old column.
    - DeleteModel(PromoCode) must run last, after the FK pointing at it
      (bookingrequest.promo_code, before the rename) is gone, or Postgres
      refuses to drop the table.
    """

    dependencies = [
        ("pms", "0028_seed_pricing_groups"),
    ]

    operations = [
        migrations.RemoveField(model_name="bookingrequest", name="promo_code"),
        migrations.RenameField(
            model_name="bookingrequest", old_name="promo_rule", new_name="promo_code"
        ),
        migrations.RemoveField(model_name="pricingrule", name="discount_pct"),
        migrations.RemoveField(
            model_name="bookingsitesettings", name="non_refundable_discount_pct"
        ),
        migrations.AlterField(
            model_name="pricingrule",
            name="group",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="rules",
                to="pms.pricinggroup",
            ),
        ),
        migrations.DeleteModel(name="PromoCode"),
        # Not in the brief's 6-operation list, but required for makemigrations
        # --check to pass: dropping RuleType.MINIMUM_NIGHTS (Step 1) changes
        # the field's `choices` metadata, which Django tracks as migration
        # state even though choices aren't enforced by a DB constraint.
        migrations.AlterField(
            model_name="pricingrule",
            name="rule_type",
            field=models.CharField(
                choices=[
                    ("long_stay", "Long Stay Discount"),
                    ("seasonal", "Seasonal / Date-Range Pricing"),
                    ("last_minute", "Last-Minute Discount"),
                    ("non_refundable", "Non-Refundable Discount"),
                    ("promo", "Promo Code"),
                    ("manual", "Manual Discount"),
                ],
                max_length=20,
            ),
        ),
    ]
