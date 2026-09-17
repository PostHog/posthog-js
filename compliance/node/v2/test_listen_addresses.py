"""Control listener configuration; no SDK conformance claims."""

import asyncio
import socket

import pytest
import host


BASE = ["--contracts", "/unused/contracts", "--consumer", "/unused/consumer"]


def test_listen_defaults():
    args = host.parse_args(BASE)
    assert args.listen_host == "127.0.0.1"
    assert args.listen_port == 0
    assert args.capture_mode == "v0"


def test_explicit_listen_options():
    args = host.parse_args(BASE + ["--listen-host", "0.0.0.0", "--listen-port", "8080"])
    assert args.listen_host == "0.0.0.0"
    assert args.listen_port == 8080
    assert host.parse_args(BASE + ["--listen-host", "::1"]).listen_host == "::1"


@pytest.mark.parametrize(
    "option,value",
    [
        ("--listen-host", "http://localhost"),
        ("--listen-host", "localhost:8080"),
        ("--listen-host", "user@localhost"),
        ("--listen-host", "localhost/path"),
        ("--listen-host", "[::1]"),
        ("--listen-port", "-1"),
        ("--listen-port", "65536"),
        ("--listen-port", "1.5"),
    ],
)
def test_invalid_listener_options(option, value):
    with pytest.raises(SystemExit) as error:
        host.parse_args(BASE + [option, value])
    assert error.value.code == 2


@pytest.mark.parametrize("explicit", [False, True])
async def test_serve_forwards_listener_options_and_announces_allocated_port(
    monkeypatch, capsys, explicit
):
    import os

    args = host.parse_args(
        [
            "--contracts",
            os.environ["POSTHOG_V2_CONTRACTS"],
            "--consumer",
            "/unused",
        ]
    )
    if explicit:
        # Reserve an available value for the explicit-port check, not a fixed CI port.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            args.listen_port = probe.getsockname()[1]
        args.listen_host = "localhost"
    observed = []
    ready = asyncio.Event()
    original_site = host.web.TCPSite

    class Site(original_site):
        def __init__(self, runner, listen_host, listen_port):
            observed.append((listen_host, listen_port))
            super().__init__(runner, listen_host, listen_port)

        async def start(self):
            await super().start()
            ready.set()

    async def initialize(self):
        pass  # Listener-only check: no SDK worker is allocated.

    monkeypatch.setattr(host.Host, "initialize", initialize)
    monkeypatch.setattr(host.web, "TCPSite", Site)
    monkeypatch.setattr(
        asyncio.get_running_loop(), "add_signal_handler", lambda *args: None
    )
    task = asyncio.create_task(host.serve(args))
    try:
        await asyncio.wait_for(ready.wait(), 5)
        assert observed == [(args.listen_host, args.listen_port)]
        output = capsys.readouterr().out.strip()
        assert output.startswith(f"http://{args.listen_host}:")
        port = int(output.rsplit(":", 1)[1])
        assert port > 0
        if explicit:
            assert port == args.listen_port
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
