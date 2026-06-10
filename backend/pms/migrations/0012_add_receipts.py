import uuid
from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pms", "0011_financeexpense_platform"),
    ]

    operations = [
        migrations.CreateModel(
            name="DailyEntry",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("platform", models.CharField(max_length=20)),
                ("date", models.DateField()),
                (
                    "deposit_amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=10,
                    ),
                ),
                ("receipt_left", models.BooleanField(default=False)),
                ("note", models.TextField(blank=True)),
            ],
            options={
                "ordering": ["date"],
            },
        ),
        migrations.AddConstraint(
            model_name="dailyentry",
            constraint=models.UniqueConstraint(
                fields=("platform", "date"), name="unique_platform_date"
            ),
        ),
        migrations.AddIndex(
            model_name="dailyentry",
            index=models.Index(
                fields=["platform", "date"], name="pms_daily_platform_date_idx"
            ),
        ),
        migrations.CreateModel(
            name="ReceiptItem",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "value",
                    models.DecimalField(decimal_places=2, max_digits=10),
                ),
                ("note", models.TextField(blank=True)),
                (
                    "daily_entry",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="receipt_items",
                        to="pms.dailyentry",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.CreateModel(
            name="ReceiptItemReservation",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "receipt_item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reservation_links",
                        to="pms.receiptitem",
                    ),
                ),
                (
                    "reservation",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="receipt_links",
                        to="pms.reservation",
                    ),
                ),
            ],
            options={
                "unique_together": {("receipt_item", "reservation")},
            },
        ),
    ]
