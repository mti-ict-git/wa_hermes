import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "http://10.60.10.59:8642"
DEFAULT_MODEL = "marisa"
DEFAULT_SESSION_KEY = "wa:test:simple-chat"
DEFAULT_MODE = "async"
DEFAULT_POLL_INTERVAL_SECONDS = 2.0
STATE_FILE_NAME = ".chat_hermes_state.json"


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_path.exists():
        return values

    for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def get_config() -> tuple[str, str, str, str, str]:
    env_path = Path(__file__).with_name(".env")
    env_values = load_env_file(env_path)

    api_key = os.getenv("API_SERVER_KEY") or env_values.get("API_SERVER_KEY", "")
    base_url = os.getenv("HERMES_BASE_URL") or env_values.get("HERMES_BASE_URL", DEFAULT_BASE_URL)
    model = os.getenv("HERMES_MODEL") or env_values.get("HERMES_MODEL", DEFAULT_MODEL)
    session_key = os.getenv("HERMES_SESSION_KEY") or env_values.get("HERMES_SESSION_KEY", DEFAULT_SESSION_KEY)
    mode = os.getenv("HERMES_MODE") or env_values.get("HERMES_MODE", DEFAULT_MODE)

    if not api_key:
        raise RuntimeError(
            "API_SERVER_KEY tidak ditemukan. Simpan di environment atau file .env."
        )

    mode = mode.strip().lower() or DEFAULT_MODE
    if mode not in {"sync", "async"}:
        mode = DEFAULT_MODE

    return base_url.rstrip("/"), api_key, model.strip() or DEFAULT_MODEL, session_key, mode


def get_state_path() -> Path:
    return Path(__file__).with_name(STATE_FILE_NAME)


def load_state(session_key: str) -> dict[str, str]:
    state_path = get_state_path()
    if not state_path.exists():
        return {"session_key": session_key, "session_id": ""}

    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"session_key": session_key, "session_id": ""}

    saved_session_key = str(data.get("session_key", session_key))
    saved_session_id = str(data.get("session_id", ""))
    if saved_session_key != session_key:
        return {"session_key": session_key, "session_id": ""}

    return {"session_key": session_key, "session_id": saved_session_id}


def save_state(session_key: str, session_id: str) -> None:
    state_path = get_state_path()
    payload = {
        "session_key": session_key,
        "session_id": session_id,
    }
    state_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def reset_state(session_key: str) -> None:
    save_state(session_key, "")


def request_json(
    base_url: str,
    api_key: str,
    path: str,
    method: str = "GET",
    payload: dict | None = None,
    session_key: str = "",
    session_id: str = "",
    timeout: int = 180,
) -> tuple[dict, object]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if session_key:
        headers["X-Hermes-Session-Key"] = session_key
    if session_id:
        headers["X-Hermes-Session-Id"] = session_id

    req = Request(
        url=f"{base_url}{path}",
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers=headers,
        method=method,
    )

    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        body = json.loads(raw) if raw else {}
        return body, resp.headers


def chat_once_sync(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    session_key: str,
    session_id: str = "",
) -> tuple[str, str]:
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
        "stream": False,
    }

    body, headers = request_json(
        base_url=base_url,
        api_key=api_key,
        path="/v1/chat/completions",
        method="POST",
        payload=payload,
        session_key=session_key,
        session_id=session_id,
        timeout=180,
    )
    returned_session_id = headers.get("X-Hermes-Session-Id", session_id)
    return body["choices"][0]["message"]["content"], returned_session_id


def chat_once_async(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    session_key: str,
    session_id: str = "",
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    status_callback=None,
) -> tuple[str, str]:
    payload = {
        "model": model,
        "input": prompt,
    }
    if session_id:
        payload["session_id"] = session_id

    start_body, _ = request_json(
        base_url=base_url,
        api_key=api_key,
        path="/v1/runs",
        method="POST",
        payload=payload,
        session_key=session_key,
        timeout=60,
    )
    run_id = str(start_body["run_id"])
    if status_callback:
        status_callback(f"Run started: {run_id}")

    last_status = ""
    while True:
        time.sleep(poll_interval_seconds)
        run_body, _ = request_json(
            base_url=base_url,
            api_key=api_key,
            path=f"/v1/runs/{run_id}",
            method="GET",
            timeout=60,
        )
        status = str(run_body.get("status", "unknown"))
        returned_session_id = str(run_body.get("session_id", session_id))

        if status != last_status and status_callback:
            status_callback(f"Run status: {status}")
            last_status = status

        if status == "completed":
            return str(run_body.get("output", "")), returned_session_id
        if status == "failed":
            raise RuntimeError(str(run_body.get("error", "Hermes run gagal.")))
        if status == "cancelled":
            raise RuntimeError("Hermes run dibatalkan.")


def run_prompt(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    session_key: str,
    session_id: str,
    mode: str,
    status_callback=None,
) -> tuple[str, str]:
    if mode == "async":
        return chat_once_async(
            base_url=base_url,
            api_key=api_key,
            model=model,
            prompt=prompt,
            session_key=session_key,
            session_id=session_id,
            status_callback=status_callback,
        )
    return chat_once_sync(
        base_url=base_url,
        api_key=api_key,
        model=model,
        prompt=prompt,
        session_key=session_key,
        session_id=session_id,
    )


def parse_args(argv: list[str]) -> tuple[bool, str, str]:
    start_new = False
    mode = ""
    prompts: list[str] = []
    for arg in argv:
        if arg == "--new":
            start_new = True
        elif arg == "--async":
            mode = "async"
        elif arg == "--sync":
            mode = "sync"
        else:
            prompts.append(arg)
    return start_new, mode, " ".join(prompts).strip()


def main() -> int:
    try:
        base_url, api_key, model, session_key, default_mode = get_config()
    except RuntimeError as exc:
        print(f"Error: {exc}")
        return 1

    state = load_state(session_key)
    session_id = state.get("session_id", "")
    start_new, requested_mode, prompt = parse_args(sys.argv[1:])
    mode = requested_mode or default_mode

    if start_new:
        reset_state(session_key)
        session_id = ""

    if prompt:
        if not prompt:
            print("Error: prompt kosong.")
            return 1
        try:
            answer, returned_session_id = run_prompt(
                base_url=base_url,
                api_key=api_key,
                model=model,
                prompt=prompt,
                session_key=session_key,
                session_id=session_id,
                mode=mode,
                status_callback=print if mode == "async" else None,
            )
            save_state(session_key, returned_session_id)
            print(answer)
            return 0
        except HTTPError as exc:
            print(f"HTTP error {exc.code}: {exc.read().decode('utf-8', errors='ignore')}")
            return 1
        except RuntimeError as exc:
            print(f"Run error: {exc}")
            return 1
        except URLError as exc:
            print(f"Connection error: {exc}")
            return 1

    print(f"Connected to Hermes at {base_url}")
    print(f"Model aktif: {model}")
    print(f"Session key: {session_key}")
    print(f"Session id aktif: {session_id or '(belum ada)'}")
    print(f"Mode aktif: {mode}")
    print("Ketik pesan lalu Enter. Gunakan /new untuk sesi baru, /session untuk lihat state, /sync atau /async untuk ganti mode, /exit untuk keluar.")

    while True:
        try:
            prompt = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not prompt:
            continue
        if prompt.lower() in {"/exit", "exit", "quit"}:
            break
        if prompt.lower() == "/new":
            reset_state(session_key)
            session_id = ""
            print("Session lokal di-reset. Request berikutnya akan membuat sesi Hermes baru.")
            continue
        if prompt.lower() == "/session":
            print(f"Session key: {session_key}")
            print(f"Session id aktif: {session_id or '(belum ada)'}")
            print(f"Model aktif: {model}")
            print(f"Mode aktif: {mode}")
            continue
        if prompt.lower() == "/sync":
            mode = "sync"
            print("Mode diubah ke sync.")
            continue
        if prompt.lower() == "/async":
            mode = "async"
            print("Mode diubah ke async.")
            continue

        try:
            answer, returned_session_id = run_prompt(
                base_url=base_url,
                api_key=api_key,
                model=model,
                prompt=prompt,
                session_key=session_key,
                session_id=session_id,
                mode=mode,
                status_callback=print if mode == "async" else None,
            )
            session_id = returned_session_id
            save_state(session_key, session_id)
            print(answer)
        except HTTPError as exc:
            print(f"HTTP error {exc.code}: {exc.read().decode('utf-8', errors='ignore')}")
        except RuntimeError as exc:
            print(f"Run error: {exc}")
        except URLError as exc:
            print(f"Connection error: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
