Yes: Follow the root README for official setup steps (Python version, virtualenv, and dependencies).
Yes: Python 3.10+ is required; use a venv and activate it before install.
Yes: Install dependencies with `pip install -r requirements.txt`.
Yes: Models are downloaded at runtime into `./models`; no pre-download required.
Yes: Windows users should install Microsoft C++ Build Tools before pip installing.
Yes: If using GPU, install a PyTorch version compatible with your CUDA toolkit.
Yes: The Docker image is `zyddnys/manga-image-translator:main` and is large (~15GB); GPU support may require extra setup.
Yes: Web UI runs by default on port 8000; API mode on port 8001; Local batch mode uses `python -m manga_translator local -v -i <path>`.
Yes: The old UI is served from `server/main.py`; the new UI is described under `front/README.md`.
Yes: Build steps: `make build-image` to build the Docker image; `make run-web-server` to run the web server.
Yes: Config/help is accessible via `python -m manga_translator config-help`; see `example/config-example.json` for a sample.
Yes: Environment variables for API keys live in a `.env` file; include keys like `OPENAI_API_KEY`, `DEEPL_AUTH_KEY`, etc.
Yes: Protect keys; the `.env` file is sensitive and should not be leaked.
Yes: Use the repo’s examples to configure translators and detectors (e.g., `example/config-example.json`).
Yes: When searching the codebase in sessions, prefer Glob (rg) and Grep for high-signal findings.
