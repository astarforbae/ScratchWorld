<h1 align="center">ScratchWorld</h1>

<p align="center">
  <strong>See, Plan, Snap: Evaluating Multimodal GUI Agents in Scratch.</strong>
</p>

**ScratchWorld** is a comprehensive benchmark for evaluating **GUI agents** in [Scratch](https://scratch.mit.edu/), with a focus on precise screen-grounded interaction (especially accurate drag-and-drop) rather than text-only code generation.

### 🎮 Interaction Modes
- **Primitive Mode:** Agents use low-level GUI actions (click, drag-and-drop, type, key operations) for fine-grained control.
- **Composite Mode:** Agents use higher-level semantic APIs that package multiple UI actions into block-editing operations.

### 🧩 Task Categories
The benchmark evaluates performance across four distinct software engineering capabilities:
- **🎨 Create:** Synthesizing functional projects from scratch based on natural language descriptions.
- **🐛 Debug:** Diagnosing and repairing logical errors in broken scripts to restore expected behavior.
- **🚀 Extend:** Implementing new feature modules into existing codebases without disrupting original logic.
- **🧮 Compute:** Utilizing Scratch blocks to solve abstract algorithmic problems and mathematical reasoning tasks.

## 📢 Update

- 2026-02-12: We release our [paper](https://example.com/arxiv), [leaderboard](https://huggingface.co/spaces/astarforbae/ScratchWorld-Leaderboard), and [code](https://github.com/astarforbae/ScratchWorld):

## 📚 Table of Contents

- [📢 Update](#-update)
- [📚 Table of Contents](#-table-of-contents)
- [🗺️ Overview](#️-overview)
- [🛠️ Installation](#️-installation)
  - [🟢 Node.js](#-nodejs)
  - [🐍 Python](#-python)
- [⚡ Quick Start](#-quick-start)
- [🧪 Experiments](#-experiments)

## 🗺️ Overview

Project structure:

```
scratch-bench/
├── Agent-S/                # Agent-S code and dependencies
├── ocr_server/             # OCR service for primitive mode 
├── scratch-gui/            # Scratch 3.0 frontend interface
├── scratch-bench-api/      # Backend API server
├── scratchbench/           # Core evaluation framework
├── tasks/                  # Task definitions
│   ├── build/              # Build tasks
│   ├── fix/                # Fix tasks
│   ├── mbpp/               # Algorithm tasks
│   └── modify/             # Modification tasks
├── single_step_drag_benchmark/     # Single-step drag benchmark scripts and assets
├── visual_perception_benchmark/    # Visual perception benchmark scripts and assets
├── task_runner.py          # Main entry point for running tasks
├── run_single_step_drag_benchmark.py      # Run single-step drag benchmark
├── run_visual_perception_benchmark.py     # Run visual perception benchmark
├── results.py              # Analyze main benchmark results
├── results_visual_perception_benchmark.py # Analyze visual perception benchmark results
├── results_single_step_drag_benchmark.py  # Analyze single-step drag benchmark results
├── curate_submit.py        # Curate the JSONL for leaderboard submission
└── agent-config.json.example       # configuration needed for each Agent
```

## 🛠️ Installation

Environment setup has two parts: Node.js is for `scratch-gui`, and Python is for `scratch-bench-api`, benchmark runners, and optional OCR/Agent integrations.

### 🟢 Node.js
Required (for reproducibility): **Node.js v25.5.0**

Option A (recommended): install via **nvm**
```bash
# install nvm first (see https://github.com/nvm-sh/nvm)
nvm install 25.5.0
nvm use 25.5.0
node -v  # should print v25.5.0
```

Option B (no nvm): install Node.js **v25.5.0** directly
```bash
# download the v25.5.0 installer from https://nodejs.org/ and install
node -v  # should print v25.5.0
```

Install and run scratch-gui:
```bash
cd scratch-gui
npm install
npm start
```

### 🐍 Python

Recommended: create a **conda** env with **Python 3.10**
```bash
conda create -n scratch-bench python=3.10
conda activate scratch-bench
```

Install base Python dependencies:
```bash
python -m pip install -r requirements.txt
```

Install scratch-bench-api (editable for local development):
```bash
python -m pip install -e scratch-bench-api
```

Install Playwright browser (required by the API):
```bash
python -m playwright install chromium
```

Install dependencies needed for Agent-S:
```bash
cd Agent-S
python -m pip install -e .
```

Install PaddleOCR for running `primitive mode` (OCR server).
Follow PaddleOCR install docs: https://www.paddleocr.ai/main/version3.x/installation.html to install `paddlepaddle` and `paddleocr`.
```bash
# example (GPU build, with cu126)
python -m pip install paddlepaddle-gpu==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
python -m pip install paddleocr==3.3.0
```

## ⚡ Quick Start

Start `scratch-gui` (terminal 1)
```bash
cd scratch-gui
npm start # on port 8601 by default 
```

Start `scratch-bench-api` (terminal 2)
```bash
python -m api.main # on port 8081 by default
```

Start `ocr-server` (optional; terminal 3)
```bash
cd ocr_server
python main.py --gpu # on port 9090 by default; omit --gpu for CPU
```

Setup `.env`
```txt
OPENAI_API_KEY="your-api-key-here"
LLM_BASE_URL="your-base-url-here"

# Optional: Scratch GUI URL for the API to connect to (defaults to http://localhost:8601?locale=en)
SCRATCH_GUI_URL="http://localhost:8601?locale=en"

# Optional: cap for concurrent sessions (and task_runner parallelism cap). Do not set --parallel above this.
MAX_SESSIONS=100
```

Run a single task in `primitive mode`
```bash
python task_runner.py --model gpt-5 --mode primitive --task_list 1_task.json --max_steps 50 --parallel 1 --use_last_screenshot --agent scratch-agent --env-file .env
```

## 🧪 Experiments

Preparation:
- Create the env file referenced by the command you choose (e.g., `.env.dp`, `.env.gemini`). At minimum set `OPENAI_API_KEY` and `LLM_BASE_URL`.
- If you run Agent-S2 or AWM, copy `agent-config.json.example` to `agent-config.json` and fill the `<YOUR_*_API_KEY>` fields.

Main benchmark (all tasks):
```bash
# scratch-agent (composite)
python task_runner.py --model gpt-5 --mode composite --task_list all_tasks.json --max_steps 50 --parallel 1 --no_recording --agent scratch-agent --env-file .env

# scratch-agent (primitive)
python task_runner.py --model gpt-5 --mode primitive --task_list all_tasks.json --max_steps 50 --parallel 1 --use_last_screenshot --agent scratch-agent --env-file .env
```

Agent-S2 (primitive):
```bash
python task_runner.py --model gemini-2.5-pro --mode primitive --task_list all_tasks.json --max_steps 50 --parallel 1 --use_last_screenshot --agent agent-s2 --tasks_dir tasks --env-file .env
```

AWM:
```bash
# composite
python task_runner.py --model gemini-2.5-pro --mode composite --task_list all_tasks.json --max_steps 50 --parallel 1 --no_recording --agent awm --tasks_dir tasks --env-file .env

# primitive
python task_runner.py --model gemini-2.5-pro --mode primitive --task_list all_tasks.json --max_steps 50 --parallel 1 --use_last_screenshot --agent awm --tasks_dir tasks --env-file .env
```

Single-step drag benchmark (single_step_drag_benchmark):
```bash
# baseline
python run_single_step_drag_benchmark.py --model gpt-5 --times 3

# knowledge
python run_single_step_drag_benchmark.py --model gpt-5 --knowledge --times 3

# GT-start
python run_single_step_drag_benchmark.py --model gpt-5 --ground-truth-start --times 3
```

Visual perception benchmark (visual_perception_benchmark):
```bash
# full run
python run_visual_perception_benchmark.py --model gpt-5

# small smoke test (one task per tag)
python run_visual_perception_benchmark.py --model gpt-5 --small
```
