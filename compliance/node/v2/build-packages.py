"""Stage an explicit SDK checkout, build fresh public packages, and install a consumer.

Requires Docker with Linux containers. Output must not already exist. No checkout
writes, registry publication, or source checkout switching are performed.
"""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(root):
    paths = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root
    ).decode().split("\0")
    return {name: sha(root / name) for name in sorted(set(paths)) if name and (root / name).is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk-root", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--node-image", default="node:24-bookworm-slim")
    parser.add_argument("--runner-image", help="Optional packaged harness runtime for adapter image assembly")
    parser.add_argument("--adapter-image", help="Local adapter tag; requires --runner-image")
    args = parser.parse_args()
    if bool(args.runner_image) != bool(args.adapter_image):
        parser.error("--runner-image and --adapter-image must be supplied together")
    root, out = args.sdk_root.resolve(), args.out.resolve()
    if root == out or root in out.parents:
        parser.error("Output must be outside the selected checkout")
    out.mkdir(parents=True, exist_ok=False)
    git = lambda *command: subprocess.check_output(["git", *command], cwd=root).decode().strip()
    sources = snapshot(root)
    status = git("status", "--porcelain=v1", "--untracked-files=all")
    manifest = {
        "git_head": git("rev-parse", "HEAD"), "git_status": status,
        "dirty": bool(status), "source_kind": "working-tree snapshot (not commit-only)",
        "source_sha256": sources,
        "source_snapshot_sha256": hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
        "package_manager": json.loads((root / "package.json").read_text())["packageManager"],
        "node_image": args.node_image, "commands": [],
    }
    provenance = out / "provenance.json"

    def save():
        provenance.write_text(json.dumps(manifest, indent=2) + "\n")

    def run(command, name):
        with (out / f"{name}.log").open("w") as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        manifest["commands"].append({"command": command, "exit": result.returncode})
        save()
        result.check_returncode()

    save()
    stage = out / "build-context" / "source"
    for name, digest in sources.items():
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, target)
        if sha(target) != digest:
            raise RuntimeError(f"Source changed during staging: {name}")
    binding = stage / "compliance/node/v2"
    shutil.copy2(binding / "Dockerfile.build", out / "build-context/Dockerfile")
    run([
        "docker", "build", "--no-cache", "--build-arg", f"NODE_IMAGE={args.node_image}",
        "--target", "distribution", "--output", f"type=local,dest={out / 'packages'}",
        str(out / "build-context"),
    ], "build")
    manifest["tarball_sha256"] = {
        p.name: sha(p) for p in sorted((out / "packages/tarballs").glob("*.tgz"))
    }
    manifest["consumer"] = json.loads((out / "packages/installed.json").read_text())
    manifest["checkout_unchanged"] = sources == snapshot(root) and status == git("status", "--porcelain=v1", "--untracked-files=all")
    if not manifest["checkout_unchanged"]:
        save()
        raise RuntimeError("Selected checkout changed during build")
    if args.adapter_image:
        context = out / "adapter-context"
        shutil.copytree(out / "packages/consumer", context / "consumer")
        shutil.copytree(binding, context / "adapter")
        shutil.copy2(binding / "Dockerfile.adapter", context / "Dockerfile")
        run([
            "docker", "build", "--build-arg", f"NODE_IMAGE={args.node_image}",
            "--build-arg", f"RUNNER_IMAGE={args.runner_image}",
            "--tag", args.adapter_image, str(context),
        ], "adapter-build")
        manifest["adapter_image_id"] = subprocess.check_output([
            "docker", "image", "inspect", "--format", "{{.Id}}", args.adapter_image
        ]).decode().strip()
    save()
    print(provenance)


if __name__ == "__main__":
    main()
