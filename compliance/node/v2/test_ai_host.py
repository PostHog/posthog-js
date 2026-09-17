"""AI capture checks against the real installed public SDK, not a controlled engine."""

import os
from pathlib import Path
from uuid import UUID

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from host import Host
from test_host import allocate, invocation, post

from posthog_test_harness.v2.contracts import Contracts


@pytest.mark.parametrize("capture_mode", ["v0", "v1"])
async def test_native_ai_uuid_delivery_and_disabled_result(capture_mode):
    consumer = os.environ.get("POSTHOG_NODE_CONSUMER")
    if not consumer:
        pytest.skip("Set POSTHOG_NODE_CONSUMER for the real packaged consumer smoke")
    contracts = Contracts(os.environ["POSTHOG_V2_CONTRACTS"])
    traffic = []

    async def service(request):
        traffic.append((request.path, await request.json()))
        return web.json_response({"status": 1})

    app = web.Application()
    app.router.add_post("/{path:.*}", service)
    async with TestServer(app) as server:
        host = Host(contracts, Path(consumer), capture_mode)
        await host.initialize()
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
            assert "/capture_ai" in negotiation["supported_routes"]
            assert "capture_ai_v0" in negotiation["profiles"][0]["sdk_capabilities"]
            assert "ai" in negotiation["profiles"][0]["products"]
            client.session.headers["Authorization"] = (
                "Bearer " + negotiation["session_id"]
            )
            receiver = await allocate(client, profile_id=host.profile_id)
            config = {
                "host": str(server.make_url("/")).rstrip("/"),
                "flush_at": 100,
                "flush_interval_ms": 0,
            }
            await post(
                client,
                "invoke",
                invocation(
                    receiver, args={"project_token": "test-project", "config": config}
                ),
            )
            args = {
                "event": "$ai_generation",
                "distinct_id": "person",
                "timestamp": "2025-01-02T08:34:05+05:30",
                "properties": {
                    "timestamp_like": "2025-01-02T08:34:05+05:30",
                    "false": False,
                },
            }
            generated = (
                await post(
                    client,
                    "invoke",
                    invocation(receiver, "generated", "/capture_ai", args),
                )
            )["receipt"]["completion"]["outcome"]
            assert generated["kind"] == "value"
            UUID(generated["value"])
            supplied_uuid = "0198c0de-0000-7000-8000-000000000abc"
            supplied = (
                await post(
                    client,
                    "invoke",
                    invocation(
                        receiver,
                        "supplied",
                        "/capture_ai",
                        {
                            "event": "$ai_embedding",
                            "distinct_id": "person",
                            "uuid": supplied_uuid,
                        },
                    ),
                )
            )["receipt"]["completion"]["outcome"]
            assert supplied == {"kind": "value", "value": supplied_uuid}
            assert traffic == []
            await post(client, "invoke", invocation(receiver, "flush", "/flush"))
            assert len(traffic) == 1 and traffic[0][0] == "/i/v0/ai/batch/"
            events = traffic[0][1]["batch"]
            assert [e["uuid"] for e in events] == [generated["value"], supplied_uuid]
            assert events[0]["timestamp"] == "2025-01-02T03:04:05.000Z"
            assert (
                events[0]["properties"]["timestamp_like"]
                == args["properties"]["timestamp_like"]
            )
            assert events[0]["properties"]["false"] is False
            observations = await post(
                client,
                "fixtures/observations",
                {"fixture_id": "f", "after_sequence": 0},
            )
            assert [o["receipt"]["route"] for o in observations["observations"]] == [
                "/setup",
                "/capture_ai",
                "/capture_ai",
                "/flush",
            ]
            disabled = await allocate(client, "disabled", profile_id=host.profile_id)
            await post(
                client,
                "invoke",
                invocation(
                    disabled,
                    "disabled-setup",
                    args={
                        "project_token": "",
                        "config": config,
                    },
                    fixture="disabled",
                ),
            )
            result = await post(
                client,
                "invoke",
                invocation(
                    disabled,
                    "disabled-ai",
                    "/capture_ai",
                    {
                        "event": "$ai_generation",
                        "distinct_id": "person",
                    },
                    fixture="disabled",
                ),
            )
            assert result["receipt"]["completion"]["outcome"] == {"kind": "undefined"}
            await post(
                client,
                "invoke",
                invocation(disabled, "disabled-flush", "/flush", fixture="disabled"),
            )
            assert len(traffic) == 1
