"""Control-boundary tests use an explicitly local test consumer, not SDK conformance."""

import asyncio
import json
import os
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer
from host import PROFILE, Host

from posthog_test_harness.v2.contracts import MAX_BODY, Contracts


@pytest.fixture(scope="module")
def contracts():
    path = os.environ.get("POSTHOG_V2_CONTRACTS")
    if not path:
        pytest.fail("Set POSTHOG_V2_CONTRACTS to the shared contracts/v2 directory")
    return Contracts(path)


@pytest.fixture(params=["5.52.4", "97.3.1-test"])
async def host_client(tmp_path, contracts, request):
    # A test-only packaged public API makes even a blocked JS loop reproducible.
    (tmp_path / "package.json").write_text('{"private":true}')
    package = tmp_path / "node_modules/posthog-node"
    package.mkdir(parents=True)
    (package / "package.json").write_text(
        json.dumps({"name": "posthog-node", "version": request.param, "main": "index.cjs"})
    )
    (package / "index.cjs").write_text(
        """
        exports.PostHog = class {
            constructor(...args) {
                this.arguments = args; this.calls = 0;
                this.featureFlagsPoller = { computeFlagAndPayloadLocally() { return { value: true }; } };
            }
            capture(args) {
                if (args.event === 'block') while (true) {}
                this.calls++;
                return args;
            }
            captureAi(args) { this.calls++; return args.uuid; }
            async flush() { this.calls++; }
            async getFeatureFlag(key) {
                if (key === 'incompatible') return this.featureFlagsPoller.computeFlagAndPayloadLocally({ key }).value;
                if (key === 'throw') throw new Error('native');
                if (key === 'hang') await new Promise(() => {});
                if (key === 'config') return this.arguments;
                return this.calls;
            }
        }
    """
    )
    host = Host(contracts, tmp_path)
    await host.initialize()
    assert host.profile()["module"]["version"] == request.param
    async with TestClient(TestServer(host.app())) as client:
        result = await post(
            client,
            "negotiate",
            {
                "contract_version": "2.0.0",
                "catalog_sha256": contracts.catalog_hash,
                "transport": "http-json-v2",
            },
        )
        client.session.headers["Authorization"] = "Bearer " + result["session_id"]
        yield host, client


async def post(client, path, data, status=200):
    response = await client.post("/v2/" + path, json=data)
    assert response.status == status, await response.text()
    return await response.json()


async def allocate(client, fixture_id="f", profile_id=PROFILE):
    result = await post(
        client,
        "fixtures/allocate",
        {
            "fixture_id": fixture_id,
            "case_id": "case",
            "profile_id": profile_id,
            "timeout_ms": 3000,
        },
    )
    assert result["kind"] == "allocated"
    return result["receiver"]


def invocation(
    receiver, call="call", route="/setup", args=None, fixture="f", timeout=2000
):
    return {
        "fixture_id": fixture,
        "timeout_ms": timeout,
        "invoke": {
            "call_id": call,
            "route": route,
            "receiver": receiver,
            "args": {} if args is None else args,
        },
    }


async def setup(client, receiver):
    result = await post(
        client, "invoke", invocation(receiver, args={"project_token": "test-project"})
    )
    assert result["receipt"]["completion"] == {
        "kind": "sdk",
        "outcome": {"kind": "void"},
    }


def fixture(host, name="f"):
    return next(iter(host.sessions.values()))["fixtures"][name]


async def test_missing_provenance_and_expired_observation_deadline(host_client):
    host, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)
    await post(
        client,
        "invoke",
        invocation(
            receiver,
            "getter",
            "/get_feature_flag",
            {"key": "flag", "distinct_id": "person"},
        ),
    )
    request = {
        "fixture_id": "f",
        "timeout_ms": 5000,
        "command": {"kind": "evaluation_provenance", "call_id": "getter"},
    }
    assert (await post(client, "fixtures/flags", request))["failure"][
        "kind"
    ] == "blocked_fixture"
    result = await host.dispatch(
        "fixtures/flags",
        request,
        next(iter(host.sessions.values())),
        asyncio.get_running_loop().time() - 1,
        True,
    )
    assert result["failure"]["kind"] == "timeout"
    assert fixture(host).state == "dead"
    await asyncio.gather(*host.tasks)
    assert fixture(host).child.process.returncode is not None


@pytest.mark.parametrize("wrong", [{"call_id": "foreign"}, {"key": "foreign"}])
async def test_wrong_native_provenance_is_a_harness_failure(
    host_client, monkeypatch, wrong
):
    host, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)

    async def bad_frame(invoke):
        return {
            "completion": {"kind": "sdk", "outcome": {"kind": "value", "value": True}},
            "provenance": {
                "layer": "native_component",
                "implementation": "controlled-fault",
                "call_id": invoke["call_id"],
                "key": "flag",
                "resolution": "local",
                "value": True,
                **wrong,
            },
        }

    monkeypatch.setattr(fixture(host).child, "invoke", bad_frame)
    receipt = (
        await post(
            client,
            "invoke",
            invocation(
                receiver,
                "getter",
                "/get_feature_flag",
                {"key": "flag", "distinct_id": "person"},
            ),
        )
    )["receipt"]
    assert receipt["completion"]["failure"]["kind"] == "harness_error"
    assert fixture(host).provenance == {}
    assert fixture(host).state == "dead"


async def test_negotiation_profile_and_exact_identity(host_client, contracts):
    host, client = host_client
    assert host.profile()["fixture_capabilities"] == [
        "storage.empty.v1",
        "flags.evaluation_provenance.v1",
    ]
    assert "encoding_gzip" in host.profile()["sdk_capabilities"]
    assert host.profile()["sdk_type"] == "server"
    for key, value, code in [
        ("contract_version", "1.0.0", "incompatible_version"),
        ("catalog_sha256", "wrong", "catalog_mismatch"),
        ("transport", "wrong", "unsupported_transport"),
    ]:
        request = {
            "contract_version": "2.0.0",
            "catalog_sha256": contracts.catalog_hash,
            "transport": "http-json-v2",
            key: value,
        }
        assert (await post(client, "negotiate", request))["code"] == code
    assert len(host.sessions) == 1
    assert not next(iter(host.sessions.values()))["fixtures"]


@pytest.mark.parametrize(
    "raw",
    [
        b'{"fixture_id":"f","fixture_id":"g"}',
        b'{"x":NaN}',
        b'{"x":1e999}',
        b'{"x":1} trailing',
        b'{"x":1,}',
        b'{"x":"\xff"}',
    ],
)
async def test_strict_json(host_client, raw):
    _, client = host_client
    response = await client.post(
        "/v2/invoke", data=raw, headers={"Content-Type": "application/json"}
    )
    assert response.status == 400
    assert (await response.json())["code"] == "invalid_json"


async def test_envelope_auth_body_limit_and_unknown_paths(host_client):
    _, client = host_client
    await post(client, "fixtures/allocate", {"fixture_id": "f"}, status=400)
    response = await client.post(
        "/v2/fixtures/observations",
        json={"fixture_id": "f", "after_sequence": 0},
        headers={"Authorization": "Bearer wrong"},
    )
    assert response.status == 401
    await post(
        client,
        "fixtures/observations",
        {"fixture_id": "f", "after_sequence": 0},
        status=404,
    )
    response = await client.post(
        "/v2/invoke",
        data=b" " * (MAX_BODY + 1),
        headers={"Content-Type": "application/json"},
    )
    assert response.status == 400
    assert (await client.post("/v2/unknown", json={})).status == 404


async def test_semantic_negatives_and_global_duplicate_ids(host_client):
    host, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)
    request = invocation(
        receiver,
        "capture",
        "/capture",
        {"event": 42, "properties": None, "distinct_id": False},
    )
    result = await post(client, "invoke", request)
    assert result["receipt"]["completion"]["outcome"] == {
        "kind": "value",
        "value": {"event": 42, "properties": None, "distinctId": False},
    }
    await post(client, "invoke", request, status=409)
    other = await allocate(client, "other")
    await post(
        client, "invoke", invocation(other, "capture", fixture="other"), status=409
    )
    result = await post(
        client,
        "invoke",
        invocation(receiver, "count", "/get_feature_flag", {"key": "count"}),
    )
    assert result["receipt"]["completion"]["outcome"]["value"] == 1
    assert len(fixture(host).receipts) == 3


async def test_reference_registry_scope_collisions_and_missing_fixture(host_client):
    _, client = host_client
    receiver = await allocate(client)
    other = await allocate(client, "other")
    await post(client, "invoke", invocation(other), status=400)
    request = invocation(receiver)
    request["invoke"]["receiver"]["kind"] = "value"
    await post(client, "invoke", request, status=400)
    receiver["kind"] = "instance"
    ref = {
        "fixture_id": "f",
        "reference_id": "r",
        "fixture": {"kind": "value", "value": {"value": "undefined"}},
    }
    assert (await post(client, "fixtures/references", ref))["failure"][
        "kind"
    ] == "blocked_fixture"
    await post(client, "fixtures/references", ref, status=409)
    request = invocation(receiver)
    request["invoke"]["references"] = {"/project_token": {"kind": "value", "id": "r"}}
    await post(client, "invoke", request, status=400)
    request["invoke"]["references"] = {"/project_token": receiver}
    request["invoke"]["args"] = {"project_token": None}
    await post(client, "invoke", request, status=400)


@pytest.mark.parametrize(
    "token", ["9007199254740993", "9007199254740993.0", "0.1234567890123456789", "-0"]
)
async def test_number_precision_is_attributed_blocker_not_rounded(host_client, token):
    _, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)
    request = invocation(
        receiver,
        "number",
        "/capture",
        {"event": "test", "properties": {"number": "TOKEN"}},
    )
    raw = json.dumps(request).replace('"TOKEN"', token)
    response = await client.post(
        "/v2/invoke", data=raw, headers={"Content-Type": "application/json"}
    )
    assert response.status == 200
    receipt = (await response.json())["receipt"]
    assert receipt["call_id"] == "number"
    assert receipt["completion"]["failure"]["code"] == "number-representation"


async def test_storage_empty_is_fresh_process_pre_setup_only(host_client):
    host, client = host_client
    receiver = await allocate(client)
    command = {
        "fixture_id": "f",
        "timeout_ms": 1000,
        "command": {"kind": "storage_empty"},
    }
    assert (await post(client, "fixtures/flush", command))["kind"] == "applied"
    assert not fixture(host).receipts
    await setup(client, receiver)
    assert (await post(client, "fixtures/flush", command))["failure"][
        "kind"
    ] == "blocked_fixture"
    for name in ["queue_snapshot", "scheduler_manual", "clock_fixed"]:
        command["command"] = {"kind": name}
        if name == "clock_fixed":
            command["command"]["timestamp"] = "2026-01-01T00:00:00Z"
        assert (await post(client, "fixtures/flush", command))["failure"][
            "kind"
        ] == "blocked_fixture"
    result = await post(
        client,
        "invoke",
        invocation(receiver, "config", "/get_feature_flag", {"key": "config"}),
    )
    assert result["receipt"]["completion"]["outcome"]["value"] == ["test-project"]


async def test_blocked_js_loop_times_out_independently_and_invalidates(host_client):
    host, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)
    start = asyncio.get_running_loop().time()
    result = await post(
        client,
        "invoke",
        invocation(receiver, "blocked", "/capture", {"event": "block"}, timeout=80),
    )
    assert result["receipt"]["completion"]["failure"]["kind"] == "timeout"
    assert asyncio.get_running_loop().time() - start < 1
    await asyncio.wait_for(fixture(host).child.process.wait(), 1)
    assert not fixture(host).references
    await post(client, "invoke", invocation(receiver, "late"), status=409)
    observations = await post(
        client, "fixtures/observations", {"fixture_id": "f", "after_sequence": 0}
    )
    assert observations["cursor"] == 2
    assert observations["observations"][-1]["receipt"] == result["receipt"]


async def test_cancel_busy_loop_observations_serialization_and_close(host_client):
    host, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)
    pending = asyncio.create_task(
        post(
            client,
            "invoke",
            invocation(receiver, "blocked", "/capture", {"event": "block"}),
        )
    )
    while fixture(host).pending is None:
        await asyncio.sleep(0.001)
    await post(client, "invoke", invocation(receiver, "overlap"), status=409)
    command = {
        "fixture_id": "f",
        "timeout_ms": 1000,
        "command": {"kind": "storage_empty"},
    }
    await post(client, "fixtures/flush", command, status=409)
    await post(
        client,
        "fixtures/flags",
        {**command, "command": {"kind": "evaluation_provenance", "call_id": "blocked"}},
        status=409,
    )
    assert (
        await post(
            client, "fixtures/observations", {"fixture_id": "f", "after_sequence": 1}
        )
    )["observations"] == []
    cancel = {"fixture_id": "f", "call_id": "blocked", "reason": "test"}
    assert (await post(client, "cancel", cancel))["state"] == "cancelled"
    assert (await pending)["receipt"]["completion"]["failure"]["kind"] == "cancelled"
    assert (await post(client, "cancel", cancel))["state"] == "already_completed"
    close = {"fixture_id": "f", "timeout_ms": 1000}
    assert (await post(client, "fixtures/close", close))["kind"] == "closed"
    assert (await post(client, "fixtures/close", close))["kind"] == "closed"
    assert fixture(host).child.process.returncode is not None
    await post(
        client,
        "fixtures/allocate",
        {
            "fixture_id": "f",
            "case_id": "case",
            "profile_id": PROFILE,
            "timeout_ms": 1000,
        },
        status=409,
    )
    other = await allocate(client, "other")
    assert other != receiver
    await post(
        client, "invoke", invocation(receiver, "stale", fixture="other"), status=400
    )


async def test_completion_wins_cancel_and_worker_death_is_not_sdk_throw(host_client):
    host, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)
    cancel = {"fixture_id": "f", "call_id": "call", "reason": "late"}
    assert (await post(client, "cancel", cancel))["state"] == "already_completed"
    pending = asyncio.create_task(
        post(
            client,
            "invoke",
            invocation(receiver, "hanging", "/get_feature_flag", {"key": "hang"}),
        )
    )
    while fixture(host).pending is None:
        await asyncio.sleep(0.001)
    await fixture(host).child.stop()
    assert (await pending)["receipt"]["completion"]["failure"][
        "kind"
    ] == "harness_error"


async def test_exception_reference_observations_and_close_invalidation(host_client):
    host, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)
    result = await post(
        client,
        "invoke",
        invocation(receiver, "thrown", "/get_feature_flag", {"key": "throw"}),
    )
    reference = result["receipt"]["completion"]["outcome"]["error"]
    assert fixture(host).references[reference["id"]] == "exception"
    await post(client, "fixtures/close", {"fixture_id": "f", "timeout_ms": 1000})
    assert not fixture(host).references
    observations = await post(
        client, "fixtures/observations", {"fixture_id": "f", "after_sequence": 1}
    )
    assert observations["observations"][0]["receipt"] == result["receipt"]
    assert observations["cursor"] == 2


async def test_child_mode_is_legacy_even_with_parent_v1(host_client, monkeypatch):
    host, client = host_client
    monkeypatch.setenv("POSTHOG_CAPTURE_MODE", "v1")
    await allocate(client)
    assert fixture(host).state == "active"


@pytest.mark.parametrize("capture_mode", ["v0", "v1"])
async def test_real_packaged_consumer_gzip_offset_and_remote_getter(
    contracts, capture_mode, monkeypatch
):
    """Real public-entry smoke; independent of the controlled consumer above."""
    from aiohttp import web

    consumer = os.environ.get("POSTHOG_NODE_CONSUMER")
    if not consumer:
        pytest.skip("Set POSTHOG_NODE_CONSUMER for the real packaged consumer smoke")
    traffic = []

    async def service(request):
        body = await request.json()
        traffic.append((request.path, dict(request.headers), body))
        if request.path == "/flags/":
            return web.json_response(
                {"featureFlags": {"enabled": True}, "featureFlagPayloads": {}}
            )
        return web.json_response({"status": 1})

    app = web.Application()
    app.router.add_post("/{path:.*}", service)
    async with TestServer(app) as service_server:
        monkeypatch.setenv(
            "POSTHOG_CAPTURE_MODE", "v1" if capture_mode == "v0" else "v0"
        )
        host = Host(contracts, Path(consumer), capture_mode)
        await host.initialize()
        assert host.metadata["capture_mode"] == capture_mode
        async with TestClient(TestServer(host.app())) as client:
            negotiation = await post(
                client,
                "negotiate",
                {
                    "contract_version": "2.0.0",
                    "catalog_sha256": contracts.catalog_hash,
                    "transport": "http-json-v2",
                },
            )
            client.session.headers["Authorization"] = (
                "Bearer " + negotiation["session_id"]
            )
            expected_capabilities = (
                ["capture_v0", "capture_v0_batch"]
                if capture_mode == "v0"
                else ["capture_v1"]
            )
            assert negotiation["profiles"][0][
                "sdk_capabilities"
            ] == expected_capabilities + [
                "capture_ai_v0",
                "encoding_gzip",
                "flags_v2",
                "flags_getter_remote_uncached",
                "feature_flags_local_evaluation_v1",
            ]
            receiver = await allocate(client, profile_id=host.profile_id)
            config = {
                "host": str(service_server.make_url("/")).rstrip("/"),
                "compression": "gzip",
                "flush_interval_ms": 0,
                "historical_migration": True,
            }
            result = await post(
                client,
                "invoke",
                invocation(
                    receiver, args={"project_token": "test-project", "config": config}
                ),
            )
            assert result["receipt"]["completion"]["outcome"]["kind"] == "void"
            capture = {
                "event": "offset",
                "distinct_id": "person",
                "timestamp": "2026-01-02T03:04:05.123+02:30",
            }
            if capture_mode == "v1":
                capture["options"] = {
                    "cookieless_mode": False,
                    "process_person_profile": False,
                    "disable_skew_correction": True,
                    "product_tour_id": "tour",
                }
            await post(
                client, "invoke", invocation(receiver, "capture", "/capture", capture)
            )
            assert traffic == []
            await post(client, "invoke", invocation(receiver, "flush", "/flush"))
            assert len(traffic) == 1
            path = "/batch/" if capture_mode == "v0" else "/i/v1/analytics/events"
            assert traffic[0][0] == path
            assert traffic[0][2]["historical_migration"] is True
            if capture_mode == "v1":
                event = traffic[0][2]["batch"][0]
                assert event["options"] == capture["options"]
                assert "$cookieless_mode" not in event["properties"]
            assert traffic[0][1]["Content-Encoding"] == "gzip"
            assert traffic[0][2]["batch"][0]["timestamp"] == "2026-01-02T00:34:05.123Z"
            for key, expected in [
                ("enabled", {"kind": "value", "value": True}),
                ("missing", {"kind": "undefined"}),
            ]:
                result = await post(
                    client,
                    "invoke",
                    invocation(
                        receiver,
                        key,
                        "/get_feature_flag",
                        {"key": key, "distinct_id": "person", "send_event": False},
                    ),
                )
                assert result["receipt"]["completion"]["outcome"] == expected
            assert [entry[0] for entry in traffic] == [path, "/flags/", "/flags/"]


@pytest.mark.parametrize("change", ["version", "metadata", "entry"])
async def test_fixture_rejects_package_changed_since_probe(host_client, change):
    host, client = host_client
    package = host.consumer / "node_modules/posthog-node"
    if change == "entry":
        with (package / "index.cjs").open("a") as output:
            output.write("\n// changed public entry\n")
    else:
        path = package / "package.json"
        metadata = json.loads(path.read_text())
        metadata["version" if change == "version" else "description"] = "changed"
        path.write_text(json.dumps(metadata))
    result = await post(client, "fixtures/allocate", {
        "fixture_id": "f", "case_id": "case", "profile_id": PROFILE, "timeout_ms": 3000,
    })
    assert result["kind"] == "failed"
    assert result["failure"]["kind"] == "harness_error"
    assert fixture(host).state == "dead"
    assert fixture(host).child.process.returncode is not None


async def test_incompatible_private_result_keeps_public_result_and_provenance_gap(host_client):
    _, client = host_client
    receiver = await allocate(client)
    await setup(client, receiver)
    result = await post(client, "invoke", invocation(
        receiver, "getter", "/get_feature_flag", {"key": "incompatible", "distinct_id": "person"},
    ))
    assert result["receipt"]["completion"] == {
        "kind": "sdk", "outcome": {"kind": "value", "value": True},
    }
    provenance = await post(client, "fixtures/flags", {
        "fixture_id": "f", "timeout_ms": 5000,
        "command": {"kind": "evaluation_provenance", "call_id": "getter"},
    })
    assert provenance["kind"] == "failed"
    assert provenance["failure"]["kind"] == "blocked_fixture"
