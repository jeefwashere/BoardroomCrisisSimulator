"""Download pinned model snapshots; verify file sizes and available LFS SHA-256s.

Run inside the assigned Slurm allocation via shared/run_step.sh. Does not load
models, execute downloaded repository code, install packages, or use API keys.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time

os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "120")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from huggingface_hub import HfApi, snapshot_download

MODELS = [
    ("LiquidAI/LFM3-1.7B", "0dc4268b561499c648c7ba7c9466bf3d8d01517a"),
    ("openbmb/MiniCPM5-2B", "f97400052a43d642bbc6e9975e2397e3ae6a6b52"),
    ("nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16", "49843eed8db1f1c616c47af75cfd36e07aec0667"),
    ("ibm-granite/granite-4.2-3b", "4e9c275e232f10211ec88644d106a1f6a1b60e06"),
    ("fastino/gliner2.5-small-v1", "b5d42bf7dc7d01c40304ae4ed43c2f13c325a75b"),
    ("fastino/gliner2.5-base-v1", "07d99c0ba5d15cb3b24e0a236fa99bdd4ef87a5c"),
    ("fastino/GLiNER2.5-Decide", "9d1bfb848cd16d93ee56ccbc59cd92bf0f284d90"),
    ("LiquidAI/d1-2B", "652f920e544ea37f81e4b0ce89b81d4ed0da90b1"),
    ("numind/NuExtract3", "c99dc8f5641b866aa0192b6ea78f84bf9f3535f1"),
]
ROOT = Path(__file__).resolve().parent
STATUS = ROOT / "download-status.json"


def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def save(status):
    status["updated_at"] = stamp()
    tmp = STATUS.with_suffix(".tmp")
    tmp.write_text(json.dumps(status, indent=2) + "\n")
    tmp.replace(STATUS)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if os.environ.get("SLURM_JOB_ID") != "20031":
        raise SystemExit("Run this task only in assigned job 20031.")
    if os.environ.get("WF_GPU_UUID_HEX") != "778d17bf71bd2cb751f6d39f0ca2fee5":
        raise SystemExit("Unexpected GPU binding; use the shared run_step.sh.")
    api = HfApi(token=False)
    status = {"started_at": stamp(), "job_id": "20031", "models": [], "complete": False}
    # Check every snapshot before starting a large transfer.
    for repo, revision in MODELS:
        info = api.model_info(repo, revision=revision, files_metadata=True)
        record = {"repo_id": repo, "revision": revision,
                  "path": str(ROOT / "models" / repo), "status": "pending", "files": []}
        for f in info.siblings:
            record["files"].append({"name": f.rfilename, "size": f.size,
                                    "sha256": f.lfs.sha256 if f.lfs else None})
        record["expected_bytes"] = sum(f["size"] or 0 for f in record["files"])
        status["models"].append(record)
    status["expected_bytes"] = sum(m["expected_bytes"] for m in status["models"])
    save(status)
    if shutil.disk_usage(ROOT).free < status["expected_bytes"] * 1.2:
        raise SystemExit("Insufficient free disk space for snapshots plus margin.")
    print(f"START {stamp()} repositories={len(MODELS)} bytes={status['expected_bytes']}", flush=True)
    for record in status["models"]:
        repo, revision = record["repo_id"], record["revision"]
        for attempt in range(1, 4):
            try:
                record.update(status="downloading", attempt=attempt)
                save(status)
                print(f"DOWNLOAD {stamp()} {repo} attempt={attempt}", flush=True)
                snapshot_download(repo, revision=revision, local_dir=record["path"],
                                  token=False, max_workers=4)
                record["status"] = "verifying"
                save(status)
                for f in record["files"]:
                    p = Path(record["path"]) / f["name"]
                    if not p.is_file() or (f["size"] is not None and p.stat().st_size != f["size"]):
                        raise RuntimeError(f"File missing or wrong size: {f['name']}")
                    if f["sha256"] and digest(p) != f["sha256"]:
                        raise RuntimeError(f"SHA-256 mismatch: {f['name']}")
                record.update(status="verified", completed_at=stamp())
                record.pop("error", None)
                save(status)
                print(f"VERIFIED {stamp()} {repo} bytes={record['expected_bytes']}", flush=True)
                break
            except Exception as exc:
                # Avoid signed URLs or credentials in exception logs.
                message = re.sub(r"https?://\S+", "[URL omitted]", str(exc))
                message = re.sub(r"\b(?:hf_|sk_)[A-Za-z0-9_-]+", "[REDACTED]", message)
                record.update(status="failed", error=f"{type(exc).__name__}: {message[:600]}")
                save(status)
                print(f"FAILED {stamp()} {repo} attempt={attempt} {record['error']}", flush=True)
                if attempt < 3:
                    time.sleep(10)
    status["complete"] = all(m["status"] == "verified" for m in status["models"])
    save(status)
    print(f"FINISHED {stamp()} complete={status['complete']}", flush=True)
    return 0 if status["complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
