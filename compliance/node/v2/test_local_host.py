"""Local component observations through the packaged SDK and real HTTP loader."""

import os
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from host import Host
from test_host import allocate, invocation, post

from posthog_test_harness.v2.contracts import Contracts


@pytest.mark.parametrize("capture_mode", ["v0", "v1"])
async def test_native_reload_readiness_and_scoped_read_only_provenance(capture_mode):
    consumer = os.environ.get("POSTHOG_NODE_CONSUMER")
    if not consumer:
        pytest.skip("Set POSTHOG_NODE_CONSUMER for the real packaged consumer smoke")
    requests = []
    active, status = True, 200

    async def service(request):
        if request.path.rstrip("/") in ("/batch", "/i/v1/analytics/events"):
            return web.json_response({"status": 1})
        requests.append(
            (
                request.path,
                dict(request.query),
                request.headers.get("Authorization"),
                status,
            )
        )
        assert request.path.rstrip("/") in (
            "/flags/definitions",
            "/api/feature_flag/local_evaluation",
        )
        return web.json_response(
            {
                "flags": [
                    {
                        "id": 1,
                        "key": "flag",
                        "active": active,
                        "filters": {
                            "groups": [{"properties": [], "rollout_percentage": 100}]
                        },
                    },
                    {"id": 2, "key": "123", "active": False, "filters": {"groups": []}},
                ],
                "group_type_mapping": {},
                "cohorts": {},
            },
            status=status,
        )

    app = web.Application()
    app.router.add_route("*", "/{path:.*}", service)
    async with TestServer(app) as server:
        host = Host(
            Contracts(os.environ["POSTHOG_V2_CONTRACTS"]), Path(consumer), capture_mode
        )
        await host.initialize()
        async with TestClient(TestServer(host.app())) as client:
            negotiation = await post(
                client,
                "negotiate",
                {
                    "contract_version": "2.0.0",
                    "catalog_sha256": host.contracts.catalog_hash,
                    "transport": "http-json-v2",
                },
            )
            client.session.headers["Authorization"] = (
                "Bearer " + negotiation["session_id"]
            )
            receiver = await allocate(client, profile_id=host.profile_id)

            async def call(route, args, call_id):
                return (
                    await post(
                        client, "invoke", invocation(receiver, call_id, route, args)
                    )
                )["receipt"]["completion"]

            async def observation(call_id, fixture="f"):
                return await post(
                    client,
                    "fixtures/flags",
                    {
                        "fixture_id": fixture,
                        "timeout_ms": 5000,
                        "command": {
                            "kind": "evaluation_provenance",
                            "call_id": call_id,
                        },
                    },
                )

            assert (await observation("unknown"))["failure"][
                "kind"
            ] == "blocked_fixture"
            await call(
                "/setup",
                {
                    "project_token": "phc_fixture",
                    "config": {
                        "secret_key": "phx_fixture",
                        "host": str(server.make_url("/")).rstrip("/"),
                    },
                },
                "setup",
            )
            assert (
                await call(
                    "/wait_for_local_evaluation_ready",
                    {"timeout_ms": 5000},
                    "initial-ready",
                )
            )["outcome"] == {"kind": "value", "value": True}
            for index, value in enumerate((True, False)):
                active = value
                before = len(requests)
                assert (await call("/reload_feature_flags", {}, f"reload-{index}"))[
                    "outcome"
                ] == {"kind": "void"}
                assert len(requests) == before + 1
                assert requests[-1][1]["token"] == "phc_fixture"
                assert requests[-1][2:] == ("Bearer phx_fixture", 200)
                assert (
                    await call("/wait_for_local_evaluation_ready", {}, f"ready-{index}")
                )["outcome"] == {"kind": "value", "value": True}
                getter = f"getter-{index}"
                outcome = await call(
                    "/get_feature_flag",
                    {
                        "key": "flag",
                        "distinct_id": "person",
                        "only_evaluate_locally": True,
                    },
                    getter,
                )
                assert outcome["outcome"] == {"kind": "value", "value": value}
                seen = (await observation(getter))["observation"]
                assert seen == {
                    "layer": "native_component",
                    "implementation": f"posthog-node@{host.metadata['sdk_version']}:FeatureFlagsPoller.computeFlagAndPayloadLocally",
                    "call_id": getter,
                    "key": "flag",
                    "resolution": "local",
                    "value": value,
                }
                assert (await observation(getter))["observation"] == seen
                assert len(requests) == before + 1
            # Native reload may finish without new definitions. Keep its old readiness;
            # the migration runner independently requires a fresh authenticated HTTP 200.
            status = 304
            assert (await call("/reload_feature_flags", {}, "not-modified"))[
                "outcome"
            ] == {"kind": "void"}
            assert (await call("/wait_for_local_evaluation_ready", {}, "still-ready"))[
                "outcome"
            ] == {"kind": "value", "value": True}
            assert requests[-1][3] == 304
            assert (await observation("getter-0"))["observation"]["value"] is True
            assert (await observation("reload-0"))["failure"][
                "kind"
            ] == "blocked_fixture"
            missing = await call(
                "/get_feature_flag",
                {
                    "key": "missing",
                    "distinct_id": "person",
                    "only_evaluate_locally": True,
                },
                "missing",
            )
            assert missing["outcome"] == {"kind": "undefined"}
            assert (await observation("missing"))["failure"][
                "kind"
            ] == "blocked_fixture"
            # Native JS accepts a numeric lookup key. Observation representation must
            # not turn this semantic negative into a failed public invocation.
            numeric = await call(
                "/get_feature_flag",
                {"key": 123, "distinct_id": "person", "only_evaluate_locally": True},
                "numeric",
            )
            assert numeric["outcome"] == {"kind": "value", "value": False}
            assert (await observation("numeric"))["failure"][
                "kind"
            ] == "blocked_fixture"
            await allocate(client, "other", profile_id=host.profile_id)
            assert (await observation("getter-0", "other"))["failure"][
                "kind"
            ] == "blocked_fixture"
            fixture = next(iter(host.sessions.values()))["fixtures"]["f"]
            assert len(fixture.provenance) == 2
            await post(
                client, "fixtures/close", {"fixture_id": "f", "timeout_ms": 5000}
            )
            assert fixture.provenance == {}
            assert fixture.child.process.returncode is not None
            response = await client.post(
                "/v2/fixtures/flags",
                json={
                    "fixture_id": "f",
                    "timeout_ms": 5000,
                    "command": {"kind": "evaluation_provenance", "call_id": "getter-0"},
                },
            )
            assert response.status == 409
