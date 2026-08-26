"""Uploading a photo to an apartment's gallery.

These tests run with CSRF enforcement ON, which is unusual and deliberate.

Django's test client sets `_dont_enforce_csrf_checks`, and `CsrfViewMiddleware`
honours it *before* it looks for the token. The token lookup is the part that
matters here: on a POST the middleware reads `request.POST` to find
`csrfmiddlewaretoken`, and reading it parses — and therefore drains — the
multipart body. A view that then parses the body a second time by hand sees
nothing at all.

So an ordinary `self.client.post(...)` test passes against the broken code and
proves nothing. Only a client with `enforce_csrf_checks=True` reproduces what a
browser actually does.

The cover photo never hit this because it is saved with PATCH, and the
middleware only reads `request.POST` when the method is POST.
"""

from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from .models import PropertyPhoto
from .tests import make_property

# The smallest thing Pillow-free code will accept as a PNG: a real 1x1 header.
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDAT\x78\x9c\x63"
    b"\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def png(name="shot.png"):
    return SimpleUploadedFile(name, PNG_BYTES, content_type="image/png")


class GalleryUploadUnderCsrfTests(TestCase):
    """The browser's path: a real session, a real CSRF token, a real POST."""

    def setUp(self):
        # enforce_csrf_checks=True is the whole point — see the module docstring.
        self.client = Client(enforce_csrf_checks=True)
        group, _ = Group.objects.get_or_create(name="Admin")
        user = User.objects.create_user(username="admin", password="pw")
        user.groups.add(group)
        self.client.force_login(user)
        self.prop = make_property()

        # A GET both sets the csrftoken cookie and hands back the token.
        self.client.get("/api/auth/me/")
        self.token = self.client.cookies["csrftoken"].value

    def upload(self, upload=None, **extra):
        return self.client.post(
            f"/api/properties/{self.prop.id}/photos/",
            data={"photo": upload if upload is not None else png(), **extra},
            HTTP_X_CSRFTOKEN=self.token,
        )

    def test_uploading_a_gallery_photo_succeeds(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.content)

    def test_the_uploaded_photo_is_stored(self):
        self.upload()
        self.assertEqual(PropertyPhoto.objects.filter(property=self.prop).count(), 1)

    def test_the_response_carries_a_usable_url(self):
        response = self.upload()
        photo = response.json()["photo"]
        self.assertTrue(photo["url"], "the gallery needs a URL to render the thumbnail")
        self.assertIn("/media/properties/photos/", photo["url"])

    def test_the_photo_then_appears_in_the_listing(self):
        self.upload()
        listed = self.client.get(f"/api/properties/{self.prop.id}/photos/").json()["photos"]
        self.assertEqual(len(listed), 1)

    def test_sort_order_is_read_from_the_form(self):
        self.upload(sortOrder="3")
        self.assertEqual(PropertyPhoto.objects.get(property=self.prop).sort_order, 3)

    def test_sort_order_defaults_to_appending(self):
        self.upload()
        self.upload()
        orders = sorted(
            PropertyPhoto.objects.filter(property=self.prop).values_list("sort_order", flat=True)
        )
        self.assertEqual(orders, [0, 1])

    def test_a_script_disguised_as_an_image_is_still_refused(self):
        """The parsing fix must not weaken the extension check."""
        bad = SimpleUploadedFile("payload.svg", b"<svg onload=alert(1)>", content_type="image/svg+xml")
        response = self.upload(upload=bad)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(PropertyPhoto.objects.count(), 0)

    def test_a_request_with_no_file_is_refused(self):
        response = self.client.post(
            f"/api/properties/{self.prop.id}/photos/",
            data={"sortOrder": "0"},
            HTTP_X_CSRFTOKEN=self.token,
        )
        self.assertEqual(response.status_code, 400)

    def test_a_nonsense_sort_order_is_a_bad_request_not_a_crash(self):
        response = self.upload(sortOrder="abc")
        self.assertEqual(response.status_code, 400)


# A real AVIF file header. AVIF is a mainstream raster format — Chrome, Safari,
# Edge and Firefox all render it, and every apartment photo already in this
# gallery on disk is one — but it is not script, so it belongs on the allow-list
# beside PNG and WebP rather than beside SVG.
AVIF_BYTES = b"\x00\x00\x00\x20ftypavif\x00\x00\x00\x00avifmif1miaf" + b"\x00" * 48


def admin_csrf_client():
    """A signed-in admin with a real CSRF token — the browser's setup."""
    client = Client(enforce_csrf_checks=True)
    group, _ = Group.objects.get_or_create(name="Admin")
    user = User.objects.create_user(username="formats", password="pw")
    user.groups.add(group)
    client.force_login(user)
    client.get("/api/auth/me/")
    return client, client.cookies["csrftoken"].value


class GalleryFormatTests(TestCase):
    """Which image formats the gallery accepts, and which it must keep refusing.

    Two separate reasons an honest photo gets turned away, both seen here:
    the extension allow-list, and the browser's declared Content-Type. The
    second one is worth understanding — it is read from the *client's* OS, so
    on a Windows machine with no registry entry for the format the browser
    sends `application/octet-stream` and a perfectly good PNG is refused.
    """

    def setUp(self):
        self.client, self.token = admin_csrf_client()
        self.prop = make_property()

    def upload(self, upload):
        return self.client.post(
            f"/api/properties/{self.prop.id}/photos/",
            data={"photo": upload},
            HTTP_X_CSRFTOKEN=self.token,
        )

    def test_an_avif_photo_is_accepted(self):
        upload = SimpleUploadedFile("room.avif", AVIF_BYTES, content_type="image/avif")
        self.assertEqual(self.upload(upload).status_code, 201)

    def test_a_photo_the_browser_could_not_type_is_still_accepted(self):
        """Windows sends octet-stream for any extension missing from its registry.

        The extension is the security control — it decides the Content-Type the
        file is served back with. The browser's claim adds nothing an attacker
        could not simply set correctly, so refusing on it alone only ever turns
        away honest uploads.
        """
        upload = SimpleUploadedFile("room.png", PNG_BYTES, content_type="application/octet-stream")
        self.assertEqual(self.upload(upload).status_code, 201)

    def test_an_svg_claiming_to_be_untyped_is_still_refused(self):
        """The relaxation above must not become a way past the extension check."""
        upload = SimpleUploadedFile("x.svg", b"<svg onload=alert(1)>", content_type="application/octet-stream")
        self.assertEqual(self.upload(upload).status_code, 400)
        self.assertEqual(PropertyPhoto.objects.count(), 0)

    def test_an_html_page_is_still_refused(self):
        upload = SimpleUploadedFile("x.html", b"<script>alert(1)</script>", content_type="image/png")
        self.assertEqual(self.upload(upload).status_code, 400)
        self.assertEqual(PropertyPhoto.objects.count(), 0)

    def test_the_refusal_names_the_formats_that_would_work(self):
        upload = SimpleUploadedFile("photo.heic", b"heic", content_type="image/heic")
        error = self.upload(upload).json()["error"]
        self.assertIn("AVIF", error, "the message has to list what the user can actually use")


class PhotoContentTypeTests(TestCase):
    """A stored photo has to come back with a type the browser will render.

    `SECURE_CONTENT_TYPE_NOSNIFF` is on, and it should stay on — it is what
    stops a file being reinterpreted as script. The cost is that the declared
    type is now the only thing the browser will go on, and Django reads that
    from Python's `mimetypes`, which on this interpreter knows neither `.avif`
    nor `.webp`. Both were being served as `application/octet-stream`, so an
    apartment photo uploaded fine and then rendered as a broken image.
    """

    def setUp(self):
        self.client = Client()

    def served_type(self, name, body):
        prop = make_property()
        photo = PropertyPhoto.objects.create(
            property=prop, photo=SimpleUploadedFile(name, body, content_type="image/png")
        )
        with override_settings(ALLOWED_HOSTS=["*"]):
            response = self.client.get(f"/media/{photo.photo.name}")
        self.assertEqual(response.status_code, 200)
        return response.headers.get("Content-Type", "")

    def test_an_avif_is_served_as_an_image(self):
        self.assertEqual(self.served_type("room.avif", AVIF_BYTES), "image/avif")

    def test_a_webp_is_served_as_an_image(self):
        self.assertEqual(self.served_type("room.webp", b"RIFF0000WEBPVP8 "), "image/webp")

    def test_a_png_is_unaffected(self):
        self.assertEqual(self.served_type("room.png", PNG_BYTES), "image/png")

    def test_nosniff_is_still_on(self):
        """The fix is to declare the type correctly, never to stop protecting."""
        prop = make_property()
        photo = PropertyPhoto.objects.create(
            property=prop, photo=SimpleUploadedFile("room.png", PNG_BYTES, content_type="image/png")
        )
        with override_settings(ALLOWED_HOSTS=["*"]):
            response = self.client.get(f"/media/{photo.photo.name}")
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
