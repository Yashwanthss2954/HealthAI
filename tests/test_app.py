import json
from unittest.mock import MagicMock, patch

import pytest
from google.genai import errors

from app import create_app, generate_assessment, validate_assessment


@pytest.fixture
def client():
    return create_app({"TESTING": True, "GEMINI_API_KEY": "test-key"}).test_client()


@pytest.fixture
def assessment():
    return {
        "conditions": [
            {"name": name, "explanation": "A possibility to discuss with a clinician."}
            for name in ("Common cold", "Influenza", "COVID-19")
        ],
        "next_steps": "Speak with a clinician if symptoms persist or worsen.",
        "urgent": False,
    }


@pytest.mark.parametrize("symptoms", ["", "   ", "a" * 201, None, 4, [], {}])
def test_invalid_symptoms(client, symptoms):
    with patch("app.generate_assessment") as generate:
        response = client.post("/api/assess", json={"symptoms": symptoms})
    assert response.status_code == 400
    assert response.json["error"]
    generate.assert_not_called()


def test_success_and_boundary(client, assessment):
    with patch("app.generate_assessment", return_value=assessment):
        response = client.post("/api/assess", json={"symptoms": "a" * 200, "consent": True})
    assert response.status_code == 200
    assert response.json["symptoms"] == "a" * 200
    assert len(response.json["assessment"]["conditions"]) >= 3
    assert response.headers["Cache-Control"] == "no-store"


def test_consent_required(client):
    assert client.post("/api/assess", json={"symptoms": "headache"}).status_code == 400


def test_unconfigured():
    client = create_app({"GEMINI_API_KEY": ""}).test_client()
    assert client.post("/api/assess", json={"symptoms": "headache"}).status_code == 503


@pytest.mark.parametrize("error", [errors.APIError(503, {"error": {"message": "Unavailable"}}), ValueError("Bad JSON")])
def test_provider_failure(client, error):
    with patch("app.generate_assessment", side_effect=error):
        response = client.post("/api/assess", json={"symptoms": "headache", "consent": True})
    assert response.status_code == 502
    assert "error" in response.json


def test_cache(assessment):
    client = create_app({"GEMINI_API_KEY": "test", "CACHE_ENABLED": True}).test_client()
    with patch("app.generate_assessment", return_value=assessment) as generate:
        first = client.post("/api/assess", json={"symptoms": "Headache", "consent": True})
        second = client.post("/api/assess", json={"symptoms": " headache ", "consent": True})
    assert not first.json["cached"]
    assert second.json["cached"]
    generate.assert_called_once()


def test_expired_cache(assessment):
    client = create_app({"GEMINI_API_KEY": "test", "CACHE_ENABLED": True, "CACHE_TTL": 0}).test_client()
    with patch("app.generate_assessment", return_value=assessment) as generate:
        for _ in range(2):
            client.post("/api/assess", json={"symptoms": "headache", "consent": True})
    assert generate.call_count == 2


def test_invalid_model_output(assessment):
    assessment["conditions"] = assessment["conditions"][:2]
    with pytest.raises(ValueError):
        validate_assessment(assessment)


def test_non_json_and_oversized(client):
    assert client.post("/api/assess", data="not json").status_code == 400
    assert client.post("/api/assess", json={"symptoms": "a" * 5000}).status_code == 413


def test_home_and_assets(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"AI provider configured" in response.data
    assert b"Content-Security-Policy" not in response.data
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/style.css").status_code == 200


def test_sdk_response_parsing(assessment):
    client = MagicMock()
    client.models.generate_content.return_value.text = json.dumps(assessment)
    with patch("app.genai.Client", return_value=client) as sdk:
        result = generate_assessment("sore throat", "test", "gemini-flash-latest")
    assert result == assessment
    sdk.assert_called_once()
    arguments = client.models.generate_content.call_args.kwargs
    assert arguments["contents"] == "sore throat"
    assert arguments["model"] == "gemini-flash-latest"
    assert arguments["config"].response_mime_type == "application/json"
    assert arguments["config"].response_json_schema["properties"]["conditions"]["minItems"] == 3
    client.close.assert_called_once()


@pytest.mark.parametrize("field,value", [("urgent", "false"), ("next_steps", ""), ("conditions", None)])
def test_rejects_invalid_fields(assessment, field, value):
    assessment[field] = value
    with pytest.raises(ValueError):
        validate_assessment(assessment)
