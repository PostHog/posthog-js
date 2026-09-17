"""Bounded adapter runtime using the runner distribution's bundled contracts."""

import asyncio
import sys

from host import parse_args, serve
from posthog_test_harness.v2.bundle import specification_inputs

with specification_inputs() as (specs, _):
    args = parse_args([
        "--contracts", str(specs / "contracts/v2"),
        "--consumer", "/runtime/consumer", *sys.argv[1:],
    ])
    try:
        asyncio.run(serve(args))
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
