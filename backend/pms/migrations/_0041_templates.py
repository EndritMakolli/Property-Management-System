# backend/pms/migrations/_0041_templates.py
"""The four starter templates, extracted so they can be read and tested.
Leading underscore keeps Django's migration loader from treating it as one.

Albanian is the operator's own wording, kept in their orthography (no ë/ç).
English is the same message for international guests. Both are editable in the
app afterwards; these exist so the feature works the moment it deploys.

`(placeholder)` is resolved by views/_drafts.py. `[...]` is an optional
segment: it disappears when the placeholders inside it have no value, which is
how the discount clause vanishes on a stay too short to earn one.
"""

PARKING_SQ = """Parkingu eshte i perfshire ne cmim,
- 2 kat me parkingje ne garazh
- 2 lifta afer parkingjeve"""

PARKING_EN = """Parking is included in the price,
- 2 garage parking levels
- 2 lifts next to the parking"""

AVAILABLE_SQ = f"""Pershendetje,

Faleminderit per kerkesen e rezervimit. Per datat qe keni kerkuar, nga (check-in) deri me (check-out) (check-out), rezervimi juaj perfshine (nights) nate dhe kemi te lire banese me (bedrooms list) dhoma gjumi.

- [ ] Banesa me (bedrooms) dhoma gjumi ka kapacitet deri ne (capacity) persona dhe cmimi eshte (nightly price)€ per nate, pra (nights) nate × (nightly price)€ = (subtotal)€[ − (discount)€ zbritje] = (total price)€ cmimi total i qendrimit.

{PARKING_SQ}

Nese keni ndonje pyetje shtese ose deshironi te vazhdojme me rezervimin, ju lutem na kontaktoni lirisht.

Me respekt,"""

AVAILABLE_EN = f"""Hello,

Thank you for your booking enquiry. For the dates you asked about, from (check-in) to (check-out) (check-out), your stay is (nights) nights and we have apartments available with (bedrooms list) bedrooms.

- [ ] The (bedrooms)-bedroom apartment sleeps up to (capacity) guests and costs (nightly price)€ per night, so (nights) nights × (nightly price)€ = (subtotal)€[ − (discount)€ discount] = (total price)€ total for the stay.

{PARKING_EN}

If you have any further questions or would like to go ahead with the booking, please get in touch.

Kind regards,"""

SPLIT_STAY_SQ = f"""Pershendetje,

Faleminderit per kerkesen e rezervimit. Per datat qe keni kerkuar, nga (check-in) deri me (check-out) (check-out), rezervimi juaj perfshine (nights) nate. Nuk kemi nje banese te vetme te lire per gjithe kohen, por mund t'jua sigurojme qendrimin me nderrim banesash me date (change date).

- [ ] Banesa me (bedrooms) dhoma gjumi ka kapacitet deri ne (capacity) persona dhe cmimi eshte (nightly price)€ per nate, pra (nights) nate × (nightly price)€ = (subtotal)€[ − (discount)€ zbritje] = (total price)€ cmimi total i qendrimit.

Nderrimi behet me (change date), brenda te njejtit objekt, keshtu qe nuk keni nevoje te largoheni — vetem nderroni banesen.

{PARKING_SQ}

Nese kjo mundesi ju pershtatet ose keni ndonje pyetje shtese, ju lutem na kontaktoni lirisht.

Me respekt,"""

SPLIT_STAY_EN = f"""Hello,

Thank you for your booking enquiry. For the dates you asked about, from (check-in) to (check-out) (check-out), your stay is (nights) nights. We do not have a single apartment free for the whole period, but we can host you with apartment changes on (change date).

- [ ] The (bedrooms)-bedroom apartment sleeps up to (capacity) guests and costs (nightly price)€ per night, so (nights) nights × (nightly price)€ = (subtotal)€[ − (discount)€ discount] = (total price)€ total for the stay.

The change happens on (change date), within the same building, so you would not need to leave — only move apartment.

{PARKING_EN}

If this works for you or you have any further questions, please get in touch.

Kind regards,"""

ALTERNATIVE_SQ = f"""Pershendetje,

Faleminderit per kerkesen e rezervimit. Fatkeqesisht, per datat qe keni kerkuar, nga (check-in) deri me (check-out) (check-out), nuk kemi banese te lire.

Data e pare e lire per (nights) nate eshte (next free date).

- [ ] Banesa me (bedrooms) dhoma gjumi ka kapacitet deri ne (capacity) persona dhe cmimi eshte (nightly price)€ per nate, pra (nights) nate × (nightly price)€ = (subtotal)€[ − (discount)€ zbritje] = (total price)€ cmimi total i qendrimit.

{PARKING_SQ}

Nese datat e reja ju pershtaten ose keni ndonje pyetje shtese, ju lutem na kontaktoni lirisht.

Me respekt,"""

ALTERNATIVE_EN = f"""Hello,

Thank you for your booking enquiry. Unfortunately we have nothing free for the dates you asked about, from (check-in) to (check-out) (check-out).

The first date we are free for (nights) nights is (next free date).

- [ ] The (bedrooms)-bedroom apartment sleeps up to (capacity) guests and costs (nightly price)€ per night, so (nights) nights × (nightly price)€ = (subtotal)€[ − (discount)€ discount] = (total price)€ total for the stay.

{PARKING_EN}

If the new dates suit you or you have any further questions, please get in touch.

Kind regards,"""

NONE_SQ = """Pershendetje,

Faleminderit per kerkesen e rezervimit. Fatkeqesisht, per datat qe keni kerkuar, nga (check-in) deri me (check-out) (check-out), nuk kemi banese te lire dhe jemi te zene edhe per periudhen ne vijim.

Nese keni mundesi te na tregoni data te tjera, me kenaqesi kontrollojme perseri per ju.

Me respekt,"""

NONE_EN = """Hello,

Thank you for your booking enquiry. Unfortunately we have nothing free for the dates you asked about, from (check-in) to (check-out) (check-out), and we are fully booked for the period after them as well.

If you can tell us some other dates, we would be glad to check again for you.

Kind regards,"""

TEMPLATES = [
    ("available", AVAILABLE_SQ, AVAILABLE_EN),
    ("split_stay", SPLIT_STAY_SQ, SPLIT_STAY_EN),
    ("alternative_dates", ALTERNATIVE_SQ, ALTERNATIVE_EN),
    ("no_availability", NONE_SQ, NONE_EN),
]


def seed_templates(apps):
    """Create the four rows. Idempotent, and never overwrites an edit."""
    MessageTemplate = apps.get_model("pms", "MessageTemplate")
    for scenario, body_sq, body_en in TEMPLATES:
        MessageTemplate.objects.get_or_create(
            scenario=scenario,
            defaults={"body_sq": body_sq, "body_en": body_en},
        )
