"""Tests for AI interpreter JSON parsing helpers."""

from app.core.ai_interpreter import _extract_json, _repair_json_text


def test_extract_json_from_markdown_fence():
    raw = """```json
{
  "well_narrative": "Test well.",
  "overall_confidence": "high"
}
```"""
    parsed = _extract_json(raw)
    assert parsed is not None
    assert parsed["well_narrative"] == "Test well."


def test_repair_json_trailing_comma():
    raw = '{"a": 1, "b": [2, 3,],}'
    repaired = _repair_json_text(raw)
    parsed = _extract_json(repaired)
    assert parsed == {"a": 1, "b": [2, 3]}
