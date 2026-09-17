"""V2 control host (loopback by default). Run with the production harness's Python environment."""

import argparse
import asyncio
import json
import math
import os
import secrets
import signal
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from aiohttp import web

from posthog_test_harness.v2.contracts import (
    MAX_BODY,
    VERSION,
    BoundaryError,
    Contracts,
    decode_json,
    encode_json,
    require,
)
from posthog_test_harness.v2.network import url_host, validate_host

ROUTES = [
    "/setup",
    "/capture",
    "/capture_ai",
    "/flush",
    "/get_feature_flag",
    "/reload_feature_flags",
    "/wait_for_local_evaluation_ready",
]
PROFILE = "node-legacy"
WORKER = Path(__file__).with_name("worker.mjs")
ENDPOINTS = {
    "negotiate": ("NegotiateRequest", "NegotiateResponse"),
    "fixtures/allocate": ("AllocateRequest", "AllocateResponse"),
    "fixtures/references": ("ReferenceRequest", "ReferenceResponse"),
    "invoke": ("InvokeRequest", "InvokeResponse"),
    "fixtures/observations": ("ObservationsRequest", "ObservationsResponse"),
    "fixtures/context-scope": ("ContextScopeRequest", "ContextScopeResponse"),
    "fixtures/flush": ("FlushFixtureRequest", "FlushFixtureResponse"),
    "fixtures/flags": ("FlagStateRequest", "FlagStateResponse"),
    "cancel": ("CancelRequest", "CancelResponse"),
    "fixtures/close": ("CloseRequest", "CloseResponse"),
}


def failure(kind, code, message):
    return {"kind": kind, "code": code, "message": message}


def harness(kind, code, message):
    return {"kind": "harness", "failure": failure(kind, code, message)}


def numbers_lossless(raw):
    """Compare decimal JSON tokens before Python/JS binary64 rounding can hide loss."""
    exact = json.loads(raw, parse_int=Decimal, parse_float=Decimal)

    def check(value):
        if isinstance(value, Decimal):
            number = float(value)
            return (
                math.isfinite(number)
                and Decimal(str(number)) == value
                and not (value.is_zero() and value.is_signed())
                and (value != value.to_integral_value() or abs(value) <= 2**53 - 1)
            )
        if isinstance(value, dict):
            return all(check(item) for item in value.values())
        if isinstance(value, list):
            return all(check(item) for item in value)
        return True

    return check(exact)


class NodeChild:
    def __init__(self, consumer, capture_mode="v0"):
        self.consumer, self.process = consumer, None
        self.capture_mode = capture_mode

    async def start(self):
        self.process = await asyncio.create_subprocess_exec(
            "node",
            str(WORKER),
            str(self.consumer),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=None,
            limit=MAX_BODY + 1,
            env={**os.environ, "POSTHOG_CAPTURE_MODE": self.capture_mode},
        )
        metadata = await self.read()
        require(
            metadata.get("ready") is True
            and isinstance(metadata.get("sdk_version"), str)
            and bool(metadata["sdk_version"].strip())
            and isinstance(metadata.get("sdk_identity"), dict)
            and metadata["sdk_identity"].get("name") == "posthog-node"
            and metadata["sdk_identity"].get("version") == metadata["sdk_version"]
            and all(
                isinstance(metadata["sdk_identity"].get(key), str)
                and len(metadata["sdk_identity"][key]) == 64
                and all(c in "0123456789abcdef" for c in metadata["sdk_identity"][key])
                for key in ("metadata_sha256", "entry_sha256")
            )
            and metadata.get("routes") == ROUTES
            and metadata.get("capture_mode") == self.capture_mode,
            "worker-startup",
            "Invalid packaged worker handshake",
        )
        return metadata

    async def read(self):
        line = await self.process.stdout.readline()
        require(
            bool(line) and len(line) <= MAX_BODY,
            "worker-frame",
            "Missing or oversized worker frame",
        )
        return decode_json(line)

    async def invoke(self, invoke):
        self.process.stdin.write(encode_json(invoke) + b"\n")
        await self.process.stdin.drain()
        response = await self.read()
        require(
            response.get("call_id") == invoke["call_id"],
            "worker-frame",
            "Wrong worker call attribution",
        )
        return response

    async def stop(self):
        if self.process is not None:
            if self.process.returncode is None:
                try:
                    self.process.kill()
                except ProcessLookupError:
                    pass
            await self.process.wait()


@dataclass
class Fixture:
    id: str
    child: NodeChild
    receiver: dict
    state: str = "allocating"
    references: dict = field(default_factory=dict)
    reference_ids: set = field(default_factory=set)
    pending: dict | None = None
    setup_attempted: bool = False
    observations: list = field(default_factory=list)
    receipts: dict = field(default_factory=dict)
    provenance: dict = field(default_factory=dict)

    def invalidate(self):
        self.state = "dead"
        self.references.clear()
        self.provenance.clear()


class Host:
    def __init__(self, contracts, consumer, capture_mode="v0"):
        if capture_mode not in ("v0", "v1"):
            raise ValueError("Unknown native capture mode")
        self.capture_mode = capture_mode
        self.profile_id = PROFILE if capture_mode == "v0" else "node-analytics-v1"
        self.contracts, self.consumer = contracts, Path(consumer).resolve()
        self.sessions = {}
        self.metadata = None
        self.tasks = set()

    async def initialize(self):
        probe = NodeChild(self.consumer, self.capture_mode)
        try:
            async with asyncio.timeout(5):
                self.metadata = await probe.start()
        finally:
            await probe.stop()

    def profile(self):
        return {
            "id": self.profile_id,
            "sdk_type": "server",
            "runtime": {
                "family": "server",
                "name": "node",
                "version": self.metadata["node_version"],
                "execution_context": "async_local",
            },
            "identity": "request_scoped",
            "protocol": "legacy" if self.capture_mode == "v0" else "analytics_v1",
            "products": ["analytics", "ai", "flags"],
            "module": {
                "entry": "posthog-node",
                "format": "commonjs",
                "package": "posthog-node",
                "version": self.metadata["sdk_version"],
            },
            "fixture_capabilities": [
                "storage.empty.v1",
                "flags.evaluation_provenance.v1",
            ],
            "sdk_capabilities": [
                *(
                    ["capture_v0", "capture_v0_batch"]
                    if self.capture_mode == "v0"
                    else ["capture_v1"]
                ),
                "capture_ai_v0",
                "encoding_gzip",
                "flags_v2",
                "flags_getter_remote_uncached",
                "feature_flags_local_evaluation_v1",
            ],
        }

    def response(self, name, value, status=200):
        self.contracts.validate(name, value)
        body = encode_json(value)
        require(
            len(body) <= MAX_BODY, "body_limit", "Response exceeds protocol body limit"
        )
        return web.Response(body=body, status=status, content_type="application/json")

    async def handle(self, request):
        admitted = asyncio.get_running_loop().time()
        path = request.match_info["path"]
        if path not in ENDPOINTS:
            raise web.HTTPNotFound()
        try:
            require(
                request.content_type == "application/json"
                and not request.headers.get("Content-Encoding"),
                "invalid_envelope",
                "Expected uncompressed JSON",
            )
            raw = await request.read()
            data = decode_json(raw)
            request_name, response_name = ENDPOINTS[path]
            self.contracts.validate(request_name, data)
            if path == "negotiate":
                result = self.negotiate(data)
            else:
                session = self.sessions.get(request.headers.get("Authorization", ""))
                require(
                    session is not None,
                    "unknown_session",
                    "Unknown negotiation session",
                )
                deadline = admitted + data.get("timeout_ms", 5000) / 1000
                result = await self.dispatch(
                    path, data, session, deadline, numbers_lossless(raw)
                )
            return self.response(response_name, result)
        except web.HTTPRequestEntityTooLarge:
            return self.response(
                "ProtocolError",
                {
                    "kind": "protocol_error",
                    "code": "invalid_envelope",
                    "message": "Request exceeds protocol body limit",
                },
                400,
            )
        except BoundaryError as error:
            statuses = {
                "unknown_session": 401,
                "unknown_fixture": 404,
                "duplicate_id": 409,
                "invalid_state": 409,
                "invalid_json": 400,
                "invalid_envelope": 400,
                "invalid_reference": 400,
            }
            if error.code not in statuses:
                raise web.HTTPInternalServerError(
                    text="Host boundary failure"
                ) from error
            return self.response(
                "ProtocolError",
                {"kind": "protocol_error", "code": error.code, "message": str(error)},
                statuses[error.code],
            )

    def negotiate(self, data):
        for key, expected, code in [
            ("contract_version", VERSION, "incompatible_version"),
            ("catalog_sha256", self.contracts.catalog_hash, "catalog_mismatch"),
            ("transport", "http-json-v2", "unsupported_transport"),
        ]:
            if data[key] != expected:
                return {
                    "kind": "rejected",
                    "code": code,
                    "message": f"Incompatible {key}",
                }
        token = secrets.token_urlsafe(32)
        self.sessions["Bearer " + token] = {"fixtures": {}, "call_ids": set()}
        return {
            "kind": "accepted",
            **data,
            "session_id": token,
            "adapter": {"name": "posthog-node-v2", "version": "0.1.0"},
            "profiles": [self.profile()],
            "supported_routes": ROUTES,
            "max_timeout_ms": 300000,
        }

    async def dispatch(self, path, data, session, deadline, lossless):
        fixture_id = data["fixture_id"]
        fixtures = session["fixtures"]
        if path == "fixtures/allocate":
            require(
                fixture_id not in fixtures,
                "duplicate_id",
                "Fixture ID already reserved",
            )
            require(
                data["profile_id"] == self.profile_id,
                "invalid_envelope",
                "Unknown profile ID",
            )
            child = NodeChild(self.consumer, self.capture_mode)
            receiver = {"kind": "instance", "id": secrets.token_urlsafe(24)}
            fixture = Fixture(fixture_id, child, receiver)
            fixtures[fixture_id] = fixture
            try:
                async with asyncio.timeout_at(deadline):
                    metadata = await child.start()
                    require(
                        metadata == self.metadata,
                        "worker-identity",
                        "Packaged worker identity changed since probe",
                    )
                fixture.references[receiver["id"]] = "instance"
                fixture.state = "active"
                return {
                    "kind": "allocated",
                    "fixture_id": fixture_id,
                    "receiver": receiver,
                }
            except Exception as error:
                fixture.invalidate()
                await child.stop()
                return {
                    "kind": "failed",
                    "fixture_id": fixture_id,
                    "failure": failure(
                        (
                            "timeout"
                            if isinstance(error, TimeoutError)
                            else "harness_error"
                        ),
                        "worker-allocation",
                        "Could not allocate isolated Node worker",
                    ),
                }
        require(fixture_id in fixtures, "unknown_fixture", "Unknown fixture")
        fixture = fixtures[fixture_id]
        if path == "fixtures/observations":
            require(
                data["after_sequence"] <= len(fixture.observations),
                "invalid_state",
                "Cursor is ahead of observations",
            )
            return {
                "fixture_id": fixture_id,
                "cursor": len(fixture.observations),
                "observations": fixture.observations[data["after_sequence"] :],
            }
        if path == "cancel":
            call_id = data["call_id"]
            if fixture.pending and fixture.pending["invoke"]["call_id"] == call_id:
                self.finish(
                    fixture,
                    harness("cancelled", "cancelled", "Call cancelled by controller"),
                )
                await fixture.child.stop()
                state = "cancelled"
            else:
                require(
                    call_id in fixture.receipts,
                    "invalid_state",
                    "No such admitted call in fixture",
                )
                state = "already_completed"
            return {"fixture_id": fixture_id, "call_id": call_id, "state": state}
        if path == "fixtures/close":
            require(
                fixture.state != "allocating",
                "invalid_state",
                "Fixture is still allocating",
            )
            if fixture.pending:
                self.finish(
                    fixture,
                    harness(
                        "cancelled",
                        "fixture-closed",
                        "Fixture closed while call pending",
                    ),
                )
            fixture.invalidate()
            try:
                async with asyncio.timeout_at(deadline):
                    await fixture.child.stop()
                fixture.state = "closed"
                return {"kind": "closed", "fixture_id": fixture_id}
            except TimeoutError:
                return {
                    "kind": "failed",
                    "fixture_id": fixture_id,
                    "failure": failure(
                        "timeout", "close-timeout", "Worker disposal deadline elapsed"
                    ),
                }
        require(fixture.state == "active", "invalid_state", "Fixture is not live")
        if path == "fixtures/flags":
            require(
                fixture.pending is None,
                "invalid_state",
                "Fixture already has an owning invocation",
            )
            command = data["command"]
            if asyncio.get_running_loop().time() >= deadline:
                fixture.invalidate()
                task = asyncio.create_task(fixture.child.stop())
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)
                return {
                    "kind": "failed",
                    "fixture_id": fixture_id,
                    "command": command["kind"],
                    "failure": failure(
                        "timeout", "provenance-timeout", "Observation deadline elapsed"
                    ),
                }
            observation = fixture.provenance.get(command.get("call_id"))
            if command["kind"] == "evaluation_provenance" and observation is not None:
                return {
                    "kind": "provenance",
                    "fixture_id": fixture_id,
                    "command": command["kind"],
                    "observation": observation,
                }
            return {
                "kind": "failed",
                "fixture_id": fixture_id,
                "command": command["kind"],
                "failure": failure(
                    "blocked_fixture",
                    "native-provenance-unavailable",
                    "No conclusive native observation for this fixture and call",
                ),
            }
        if path == "fixtures/flush":
            require(
                fixture.pending is None,
                "invalid_state",
                "Fixture already has an owning invocation",
            )
            command = data["command"]["kind"]
            if command == "storage_empty" and not fixture.setup_attempted:
                # At this pin the Node client owns a newly constructed, memory-only
                # PostHogMemoryStorage. No SDK exists in this fresh process yet.
                return {"kind": "applied", "fixture_id": fixture_id, "command": command}
            return {
                "kind": "failed",
                "fixture_id": fixture_id,
                "command": command,
                "failure": failure(
                    "blocked_fixture",
                    "native-fixture-unavailable",
                    "Control is unavailable or requires a fresh pre-setup fixture",
                ),
            }
        if path == "fixtures/references":
            reference_id = data["reference_id"]
            require(
                reference_id not in fixture.reference_ids
                and reference_id not in fixture.references,
                "duplicate_id",
                "Reference ID already used",
            )
            if data["fixture"]["kind"] == "callback":
                self.contracts.validate_plan(
                    data["fixture"]["plan"], fixture.references
                )
            fixture.reference_ids.add(reference_id)
            return {
                "kind": "failed",
                "fixture_id": fixture_id,
                "failure": failure(
                    "blocked_fixture",
                    "reference-fixture-unavailable",
                    "Native reference construction is not implemented",
                ),
            }
        if path == "fixtures/context-scope":
            self.contracts.live_reference(data["context"], fixture.references)
            return {
                "fixture_id": fixture_id,
                "scope_id": data["scope_id"],
                "calls": [],
                "result": {
                    "kind": "failed",
                    "failure": failure(
                        "blocked_fixture",
                        "context-scope-unavailable",
                        "Native context scope is not implemented",
                    ),
                },
            }
        invoke = data["invoke"]
        self.contracts.validate_invoke(invoke, fixture.references)
        require(
            fixture.pending is None,
            "invalid_state",
            "Fixture already has an owning invocation",
        )
        require(
            invoke["call_id"] not in session["call_ids"],
            "duplicate_id",
            "Call ID already used",
        )
        session["call_ids"].add(invoke["call_id"])
        if invoke["route"] == "/setup":
            fixture.setup_attempted = True
        terminal = asyncio.get_running_loop().create_future()
        fixture.pending = {"invoke": invoke, "terminal": terminal}
        task = asyncio.create_task(self.execute(fixture, invoke, deadline, lossless))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return {"receipt": await asyncio.shield(terminal)}

    def finish(self, fixture, completion):
        if fixture.pending is None:
            return
        pending = fixture.pending
        receipt = {
            "fixture_id": fixture.id,
            "call_id": pending["invoke"]["call_id"],
            "route": pending["invoke"]["route"],
            "completion": completion,
        }
        observation = {
            "kind": "call",
            "sequence": len(fixture.observations) + 1,
            "receipt": receipt,
        }
        if len(encode_json(fixture.observations + [observation])) > MAX_BODY - 1024:
            receipt["completion"] = completion = harness(
                "harness_error",
                "observation-limit",
                "Fixture observations exceed 1 MiB",
            )
        fixture.receipts[receipt["call_id"]] = receipt
        fixture.observations.append(observation)
        if completion["kind"] == "harness" and completion["failure"]["kind"] in (
            "timeout",
            "cancelled",
            "harness_error",
        ):
            fixture.invalidate()
        elif completion["kind"] == "sdk" and completion["outcome"]["kind"] == "thrown":
            reference = completion["outcome"]["error"]
            fixture.references[reference["id"]] = reference["kind"]
        fixture.pending = None
        pending["terminal"].set_result(receipt)

    async def execute(self, fixture, invoke, deadline, lossless):
        try:
            async with asyncio.timeout_at(deadline):
                if not lossless:
                    completion = harness(
                        "blocked_fixture",
                        "number-representation",
                        "JSON numbers cannot be translated losslessly to Node",
                    )
                elif invoke.get("references"):
                    completion = harness(
                        "blocked_fixture",
                        "reference-fixture-unavailable",
                        "Native argument references are not implemented",
                    )
                else:
                    response = await fixture.child.invoke(invoke)
                    completion = response["completion"]
                    self.contracts.validate("Completion", completion)
                    observation = response.get("provenance")
                    if observation is not None:
                        self.contracts.validate("EvaluationProvenance", observation)
                        require(
                            invoke["route"] == "/get_feature_flag"
                            and observation["call_id"] == invoke["call_id"]
                            and observation["key"] == invoke["args"].get("key"),
                            "worker-provenance",
                            "Wrong native evaluation attribution",
                        )
                        require(
                            len(
                                encode_json(
                                    {
                                        **fixture.provenance,
                                        invoke["call_id"]: observation,
                                    }
                                )
                            )
                            <= MAX_BODY,
                            "provenance-limit",
                            "Native observations exceed 1 MiB",
                        )
                        if fixture.state == "active" and fixture.pending is not None:
                            fixture.provenance[invoke["call_id"]] = observation
            self.finish(fixture, completion)
        except TimeoutError:
            self.finish(
                fixture,
                harness(
                    "timeout", "invoke-timeout", "Host invocation deadline elapsed"
                ),
            )
        except Exception:
            self.finish(
                fixture,
                harness(
                    "harness_error",
                    "worker-execution",
                    "Isolated worker failed during invocation",
                ),
            )
        finally:
            if fixture.state != "active":
                await fixture.child.stop()

    async def cleanup(self, app):
        for session in self.sessions.values():
            for fixture in session["fixtures"].values():
                if fixture.pending:
                    self.finish(
                        fixture,
                        harness("cancelled", "host-stopped", "Control host stopped"),
                    )
                fixture.invalidate()
                await fixture.child.stop()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)

    def app(self):
        app = web.Application(client_max_size=MAX_BODY)
        app.router.add_post("/v2/{path:.*}", self.handle)
        app.on_cleanup.append(self.cleanup)
        return app


async def serve(args):
    task = asyncio.current_task()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
    host = Host(Contracts(args.contracts), args.consumer, args.capture_mode)
    await host.initialize()
    runner = web.AppRunner(host.app(), shutdown_timeout=1)
    await runner.setup()
    try:
        site = web.TCPSite(runner, args.listen_host, args.listen_port)
        await site.start()
        port = runner.addresses[0][1]
        print(f"http://{url_host(args.listen_host)}:{port}", flush=True)
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


def listen_port(value):
    port = int(value)
    if not 0 <= port <= 65535:
        raise argparse.ArgumentTypeError(
            "Port must be between 0 and 65535 (0 allocates an ephemeral port)"
        )
    return port


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contracts", required=True, type=Path)
    parser.add_argument("--consumer", required=True, type=Path)
    parser.add_argument("--capture-mode", choices=("v0", "v1"), default="v0")
    parser.add_argument(
        "--listen-host", type=validate_host, default="127.0.0.1", metavar="HOST"
    )
    parser.add_argument("--listen-port", type=listen_port, default=0)
    return parser.parse_args(argv)


if __name__ == "__main__":
    try:
        asyncio.run(serve(parse_args()))
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
