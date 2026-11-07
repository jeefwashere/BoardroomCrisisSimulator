# GPU access: Velocity cluster (University of Waterloo)

Assigned job for this project: 20031 (verify live status before use)

The existing Boardroom service is assigned job 20031. Use only this allocation
while it is running. Replace <JOB> with 20031 in the examples below. This dated
assignment does not authorize a new allocation or continued GPU work after expiry.

## Available GPUs

All listed GPUs are on max-compute-11, NVIDIA L40S 46 GB. They were idle at
17:56 UTC on 2026-11-07. This is a historical snapshot, not live availability.

| Job | GPU UUID prefix | CPUs | RAM limit | Ends (UTC) | Ends (Toronto) | Time left at check |
| --- | --- | --- | --- | --- | --- | --- |
| 19709 | d018f014 | 4 | 32 GiB | 2026-11-08 02:38:31 | Nov 7, 9:38 PM | 8h 42m |
| 19792 | 391b15c8 | 4 | 32 GiB | 2026-11-08 02:38:31 | Nov 7, 9:38 PM | 8h 42m |
| 20031 | 778d17bf | 16 | 200000 MiB | 2026-11-08 15:46:25 | Nov 8, 10:46 AM | 21h 50m |

Work still running at the end time is killed. Check the time left first and keep
results on disk:

```sh
ssh abehl@max-velocity.uwaterloo.ca "squeue -u abehl -o '%i %T %L %e'"
```

## Connect

Use the SSH setup already on this machine. Never ask for, copy, or print SSH keys.

```sh
ssh abehl@max-velocity.uwaterloo.ca 'srun --jobid=<JOB> --overlap bash -c "source ~/worldmodel/env.sh; python -c \"import torch; print(torch.cuda.get_device_name(0), torch.cuda.get_device_properties(0).uuid)\""'
```

Check that the UUID printed matches your job's GPU UUID prefix in the table.

## Long work (more than about 2 minutes)

Run it detached so it survives a dropped connection:

```sh
W=/home/abehl/worldmodel/runs/workflow-comparison-2026-11-07
ssh abehl@max-velocity.uwaterloo.ca "bash $W/shared/run_step.sh <JOB> <unique-step-name> <your-folder> '<command>'"
```

- Log: <your-folder>/logs/<step>.log
- Exit code: <your-folder>/logs/<step>.exit
- This script checks the GPU, sets up the environment, and starts in <your-folder>.
- Step names cannot be reused.
- To set PYTHONPATH, add to it (PYTHONPATH=...:$PYTHONPATH). Replacing it breaks imports.
- Allow 10–20 seconds after copying a file before a step reads it, because the node lags.

## Shared resources

These are shared by all jobs. Do not copy or move them:

- Environment: source ~/worldmodel/env.sh
- Model weights: ~/worldmodel/huggingface/hub (TRELLIS.2, SAM 2.1, DINOv3)
- TRELLIS code: ~/worldmodel/TRELLIS.2
- Pipeline code: /home/abehl/worldmodel/runs/workflow-comparison-2026-11-07/project
- Room models: ~/worldmodel/runs/vertex-objects-2026-11-07/guest-bedroom/objects/models/finished

Put your work in a new folder: ~/worldmodel/runs/<task-name>-<date>

## Rules

- Do not create new Slurm jobs. Use only the job assigned to you, and only while it is running.
- Never run scancel. Never kill the original srun processes or the "velocity" tmux session.
- Never use GPU 39c6c4f9. It shows up in nvidia-smi and Vulkan but is not ours, and other processes are on it. Do not override CUDA_VISIBLE_DEVICES.
- Vulkan tools ignore CUDA_VISIBLE_DEVICES, so pin them with --device "uuid:$WF_GPU_UUID_HEX" (set inside run_step.sh steps).
- Keep to one large model per GPU, and coordinate with any agent sharing your job. TRELLIS.2 peaks at about 28 GB of GPU memory and 17 GiB of RAM.
- Run no GPU work on the login node.
- Do not change drivers, system Python, or global packages. Ask before installing software, downloading large models, or starting expensive GPU runs.
- Servers bind to localhost and need a password or token, because other users share this node. Use SSH port forwarding, and never expose a service publicly.
- Never open or print key files in ~/.config/worldmodel, or put keys in commands, URLs, or logs.
- Paid calls: Vertex has a US$200 total limit. Atlas has a US$5 limit, and any new atlasGenerate job needs the user's explicit approval. Stop if a call's price is unknown.
- Report when you finish so the GPU can be reassigned. Do not release a job yourself.
