import unittest

from project_utils.export_filters import build_safe_where_clause, ensure_allowed_table


class ExportFilterTests(unittest.TestCase):
    def test_single_numeric_filter(self):
        sql, params = build_safe_where_clause("tax_year=2024")
        self.assertEqual(sql, "tax_year = %s")
        self.assertEqual(params, [2024])

    def test_text_search_filter(self):
        sql, params = build_safe_where_clause("grantmaker_name~foundation")
        self.assertEqual(sql, "grantmaker_name ILIKE %s")
        self.assertEqual(params, ["%foundation%"])

    def test_multiple_filters(self):
        sql, params = build_safe_where_clause("expense_type='Jews' AND grant_amount>=50000")
        self.assertEqual(sql, "expense_type = %s AND grant_amount >= %s")
        self.assertEqual(params, ["Jews", 50000])

    def test_invalid_field_is_rejected(self):
        with self.assertRaises(ValueError):
            build_safe_where_clause("drop_table=yes")

    def test_invalid_table_is_rejected(self):
        with self.assertRaises(ValueError):
            ensure_allowed_table("irs_grants; DROP TABLE irs_grants")


if __name__ == "__main__":
    unittest.main()

