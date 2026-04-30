import unittest

from project_utils.security import redact_dsn


class SecurityTests(unittest.TestCase):
    def test_dsn_redaction_masks_password(self):
        masked = redact_dsn("postgresql://alice:secret@db.example.com:5432/irs990")
        self.assertEqual(masked, "postgresql://alice:***@db.example.com:5432/irs990")

    def test_empty_dsn_redaction(self):
        self.assertEqual(redact_dsn(""), "<not set>")


if __name__ == "__main__":
    unittest.main()
