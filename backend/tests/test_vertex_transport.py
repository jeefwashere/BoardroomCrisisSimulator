"""Vertex HTTPS context and redirect behavior, with no network requests."""

import ssl
import sys
import unittest
from unittest.mock import Mock, patch
import urllib.request

from backend.app.vertex_text import VertexText
from playtest.vertex import NoRedirect, VertexError


class VertexTransportTests(unittest.TestCase):
    def assert_secure_opener(self, provider, context):
        handlers = provider.opener.handlers
        https = [item for item in handlers if isinstance(item, urllib.request.HTTPSHandler)]
        self.assertEqual(len(https), 1)
        self.assertIs(https[0]._context, context)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        redirect = next(item for item in handlers if isinstance(item, NoRedirect))
        with self.assertRaisesRegex(VertexError, "redirect refused"):
            redirect.redirect_request(
                urllib.request.Request("https://example.invalid"), None, 302,
                "Found", {}, "https://elsewhere.invalid")

    def test_native_system_context_is_used_without_global_injection(self):
        original = ssl.SSLContext
        context = ssl.create_default_context()
        with patch("truststore.SSLContext", return_value=context) as native:
            provider = VertexText("inert-fixture")
        native.assert_called_once_with(ssl.PROTOCOL_TLS_CLIENT)
        self.assert_secure_opener(provider, context)
        self.assertIs(ssl.SSLContext, original)

    def test_missing_truststore_uses_secure_default_context(self):
        context = ssl.create_default_context()
        with patch.dict(sys.modules, {"truststore": None}):
            with patch("ssl.create_default_context", return_value=context) as fallback:
                provider = VertexText("inert-fixture")
        fallback.assert_called_once_with()
        self.assert_secure_opener(provider, context)

    def test_injected_opener_is_preserved(self):
        opener = Mock()
        with patch("urllib.request.build_opener", side_effect=AssertionError("Unexpected opener")):
            provider = VertexText("inert-fixture", opener=opener)
        self.assertIs(provider.opener, opener)


if __name__ == "__main__":
    unittest.main()
