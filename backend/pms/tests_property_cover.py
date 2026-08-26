"""The cover photo goes through the same door as the gallery.

CLAUDE.md states the invariant plainly: *every upload path calls
`_validate_upload`*. The cover photo did not. It was assigned straight onto the
model on both create and edit, so the one upload a user reaches first was the
one field that would take an `.svg` — and `.svg` executes as script when the
server hands it back from our own origin.

The asymmetry also produced the bug that led here: the same file the gallery
refused, the cover accepted, which reads as "the gallery is broken" rather than
"these two paths disagree about what an image is".
"""

from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from .models import Property
from .tests import make_property
from .tests_property_photos import AVIF_BYTES, PNG_BYTES

SVG = b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(document.cookie)'/>"


class CoverPhotoValidationTests(TestCase):
    def setUp(self):
        self.client = Client()
        group, _ = Group.objects.get_or_create(name="Admin")
        user = User.objects.create_user(username="cover", password="pw")
        user.groups.add(group)
        self.client.force_login(user)

    def create_with(self, upload):
        return self.client.post(
            "/api/properties/",
            data={"name": "Cover test", "bedrooms": "1", "photo": upload},
        )

    # ── create ──────────────────────────────────────────────────────────────

    def test_creating_with_an_svg_cover_is_refused(self):
        upload = SimpleUploadedFile("logo.svg", SVG, content_type="image/svg+xml")
        response = self.create_with(upload)
        self.assertEqual(response.status_code, 400, response.content)

    def test_the_refused_property_is_not_created_at_all(self):
        """A half-made property with no photo would be worse than a clean refusal."""
        upload = SimpleUploadedFile("logo.svg", SVG, content_type="image/svg+xml")
        self.create_with(upload)
        self.assertFalse(Property.objects.filter(name="Cover test").exists())

    def test_creating_with_an_html_cover_is_refused(self):
        upload = SimpleUploadedFile("x.html", b"<script>fetch('/api/codes/door/')</script>",
                                    content_type="image/png")
        self.assertEqual(self.create_with(upload).status_code, 400)

    def test_creating_with_a_png_cover_still_works(self):
        upload = SimpleUploadedFile("shot.png", PNG_BYTES, content_type="image/png")
        self.assertEqual(self.create_with(upload).status_code, 201)

    def test_creating_with_an_avif_cover_works(self):
        upload = SimpleUploadedFile("shot.avif", AVIF_BYTES, content_type="image/avif")
        self.assertEqual(self.create_with(upload).status_code, 201)

    def test_creating_without_a_cover_is_still_allowed(self):
        """The cover is optional — validation must not make it mandatory."""
        response = self.client.post("/api/properties/", data={"name": "No cover", "bedrooms": "1"})
        self.assertEqual(response.status_code, 201, response.content)

    def test_an_oversized_cover_is_refused(self):
        upload = SimpleUploadedFile("huge.png", b"\x89PNG" + b"\x00" * (11 * 1024 * 1024),
                                    content_type="image/png")
        self.assertEqual(self.create_with(upload).status_code, 400)


class CoverPhotoEditValidationTests(TestCase):
    """The same door, reached through the edit form's PATCH."""

    def setUp(self):
        self.client = Client()
        group, _ = Group.objects.get_or_create(name="Admin")
        user = User.objects.create_user(username="coveredit", password="pw")
        user.groups.add(group)
        self.client.force_login(user)
        self.prop = make_property()

    def patch_cover(self, upload):
        body, content_type = encode_multipart_file("photo", upload)
        return self.client.generic(
            "PATCH", f"/api/properties/{self.prop.id}/", body, content_type=content_type
        )

    def test_patching_in_an_svg_cover_is_refused(self):
        upload = SimpleUploadedFile("logo.svg", SVG, content_type="image/svg+xml")
        self.assertEqual(self.patch_cover(upload).status_code, 400)

    def test_the_existing_cover_is_left_alone_when_the_new_one_is_refused(self):
        self.prop.photo = "properties/original.png"
        self.prop.save()
        self.patch_cover(SimpleUploadedFile("logo.svg", SVG, content_type="image/svg+xml"))
        self.prop.refresh_from_db()
        self.assertEqual(self.prop.photo.name, "properties/original.png")

    def test_patching_in_a_png_cover_works(self):
        upload = SimpleUploadedFile("shot.png", PNG_BYTES, content_type="image/png")
        self.assertEqual(self.patch_cover(upload).status_code, 200)

    def test_patching_other_fields_without_a_photo_still_works(self):
        response = self.client.patch(
            f"/api/properties/{self.prop.id}/",
            data={"name": "Renamed"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)


def encode_multipart_file(field, upload):
    """Build a multipart body by hand — the test client has no PATCH-with-files."""
    from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart

    return encode_multipart(BOUNDARY, {field: upload}), MULTIPART_CONTENT
