import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from chat_hermes import load_env_file, run_prompt


DEFAULT_OPENWA_BASE_URL = "http://10.60.10.59:2785"
DEFAULT_HERMES_MODE = "sync"
STATE_FILE_NAME = ".openwa_hermes_state.json"


def get_config() -> dict[str, str]:
    env_path = Path(__file__).with_name(".env")
    env_values = load_env_file(env_path)

    config = {
        "openwa_base_url": os.getenv("OPENWA_BASE_URL") or env_values.get("OPENWA_BASE_URL", DEFAULT_OPENWA_BASE_URL),
        "openwa_session_id": os.getenv("OPENWA_SESSION_ID") or env_values.get("OPENWA_SESSION_ID", ""),
        "openwa_api_key": os.getenv("OPENWA_API_KEY") or env_values.get("OPENWA_API_KEY", ""),
        "hermes_base_url": os.getenv("HERMES_BASE_URL") or env_values.get("HERMES_BASE_URL", ""),
        "hermes_api_key": os.getenv("API_SERVER_KEY") or env_values.get("API_SERVER_KEY", ""),
        "hermes_mode": (os.getenv("HERMES_MODE") or env_values.get("HERMES_MODE", DEFAULT_HERMES_MODE)).strip().lower(),
    }

    missing = [
        key
        for key in ("openwa_session_id", "openwa_api_key", "hermes_base_url", "hermes_api_key")
        if not config[key]
    ]
    if missing:
        raise RuntimeError(f"Konfigurasi wajib belum ada: {', '.join(missing)}")

    if config["hermes_mode"] not in {"sync", "async"}:
        config["hermes_mode"] = DEFAULT_HERMES_MODE

    config["openwa_base_url"] = config["openwa_base_url"].rstrip("/")
    config["hermes_base_url"] = config["hermes_base_url"].rstrip("/")
    return config


def openwa_request_json(
    base_url: str,
    api_key: str,
    path: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: int = 60,
) -> Any:
    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }
    req = Request(
        url=f"{base_url}{path}",
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers=headers,
        method=method,
    )
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def get_state_path() -> Path:
    return Path(__file__).with_name(STATE_FILE_NAME)


def load_state() -> dict[str, dict[str, str]]:
    state_path = get_state_path()
    if not state_path.exists():
        return {}
    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(data: dict[str, dict[str, str]]) -> None:
    get_state_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_chat_state(chat_id: str) -> dict[str, str]:
    return load_state().get(chat_id, {"session_id": "", "session_key": build_session_key(chat_id)})


def set_chat_state(chat_id: str, session_id: str) -> None:
    state = load_state()
    state[chat_id] = {
        "session_id": session_id,
        "session_key": build_session_key(chat_id),
    }
    save_state(state)


def clear_chat_state(chat_id: str) -> None:
    state = load_state()
    if chat_id in state:
        del state[chat_id]
        save_state(state)


def build_session_key(chat_id: str) -> str:
    if chat_id.endswith("@c.us"):
        return f"wa:private:{chat_id}"
    return f"wa:chat:{chat_id}"


def is_private_chat(chat_id: str) -> bool:
    return chat_id.endswith("@c.us")


def truncate_text(text: str, limit: int = 90) -> str:
    compact = " ".join((text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def fetch_recent_messages(config: dict[str, str], limit: int) -> list[dict[str, Any]]:
    query = urlencode({"limit": limit})
    response = openwa_request_json(
        base_url=config["openwa_base_url"],
        api_key=config["openwa_api_key"],
        path=f"/api/sessions/{config['openwa_session_id']}/messages?{query}",
        timeout=60,
    )
    return list(response.get("messages", []))


def print_recent_messages(messages: list[dict[str, Any]], incoming_only: bool, private_only: bool) -> None:
    filtered = []
    for message in messages:
        chat_id = str(message.get("chatId", ""))
        direction = str(message.get("direction", ""))
        if incoming_only and direction != "incoming":
            continue
        if private_only and not is_private_chat(chat_id):
            continue
        filtered.append(message)

    if not filtered:
        print("Tidak ada message yang cocok.")
        return

    for index, message in enumerate(filtered, start=1):
        print(f"[{index}] {message.get('direction', '?')} | {message.get('chatId', '-')}")
        print(f"     from={message.get('from', '-')} | type={message.get('type', '-')}")
        print(f"     body={truncate_text(str(message.get('body', '')))}")


def find_latest_incoming_private(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for message in messages:
        chat_id = str(message.get("chatId", ""))
        if message.get("direction") == "incoming" and is_private_chat(chat_id):
            return message
    return None


def build_helpdesk_prompt(chat_id: str, incoming_text: str) -> str:
    return "\n".join(
        [
            "WhatsApp helpdesk context:",
            f"- chat_id: {chat_id}",
            "- channel: WhatsApp",
            "- mode: manual relay test",
            "",
            "User message:",
            incoming_text.strip(),
            "",
            "Reply as MTI ICT Helpdesk in concise Indonesian.",
        ]
    )


def send_text_message(config: dict[str, str], chat_id: str, text: str) -> dict[str, Any]:
    if not is_private_chat(chat_id):
        raise RuntimeError("Pengiriman dibatasi ke private chat dulu.")
    payload = {
        "chatId": chat_id,
        "text": text,
    }
    return openwa_request_json(
        base_url=config["openwa_base_url"],
        api_key=config["openwa_api_key"],
        path=f"/api/sessions/{config['openwa_session_id']}/messages/send-text",
        method="POST",
        payload=payload,
        timeout=60,
    )


def relay_message(
    config: dict[str, str],
    chat_id: str,
    incoming_text: str,
    start_new: bool,
    mode: str,
    should_send: bool,
) -> str:
    if not is_private_chat(chat_id):
        raise RuntimeError("Bridge test ini dibatasi ke private chat.")

    if start_new:
        clear_chat_state(chat_id)

    state = get_chat_state(chat_id)
    session_id = state.get("session_id", "")
    session_key = state.get("session_key", build_session_key(chat_id))
    prompt = build_helpdesk_prompt(chat_id, incoming_text)

    answer, returned_session_id = run_prompt(
        base_url=config["hermes_base_url"],
        api_key=config["hermes_api_key"],
        prompt=prompt,
        session_key=session_key,
        session_id=session_id,
        mode=mode,
        status_callback=print if mode == "async" else None,
    )
    set_chat_state(chat_id, returned_session_id)

    if should_send:
        send_text_message(config, chat_id, answer)

    return answer


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Minimal OpenWA -> Hermes helpdesk test harness.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    recent_parser = subparsers.add_parser("recent", help="Lihat message terakhir dari OpenWA.")
    recent_parser.add_argument("--limit", type=int, default=10)
    recent_parser.add_argument("--incoming-only", action="store_true")
    recent_parser.add_argument("--private-only", action="store_true")

    relay_parser = subparsers.add_parser("relay", help="Kirim message uji ke Hermes untuk chat tertentu.")
    relay_parser.add_argument("--chat-id", required=True)
    relay_parser.add_argument("--message", required=True)
    relay_parser.add_argument("--new", action="store_true")
    relay_parser.add_argument("--send", action="store_true")
    relay_parser.add_argument("--sync", action="store_true")
    relay_parser.add_argument("--async", dest="force_async", action="store_true")

    latest_parser = subparsers.add_parser("relay-latest", help="Ambil incoming private message terbaru lalu relay ke Hermes.")
    latest_parser.add_argument("--limit", type=int, default=20)
    latest_parser.add_argument("--new", action="store_true")
    latest_parser.add_argument("--send", action="store_true")
    latest_parser.add_argument("--sync", action="store_true")
    latest_parser.add_argument("--async", dest="force_async", action="store_true")

    session_parser = subparsers.add_parser("session", help="Lihat atau reset state session Hermes per chat.")
    session_parser.add_argument("--chat-id", required=True)
    session_parser.add_argument("--clear", action="store_true")

    return parser


def resolve_mode(args: argparse.Namespace, default_mode: str) -> str:
    if getattr(args, "sync", False):
        return "sync"
    if getattr(args, "force_async", False):
        return "async"
    return default_mode


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        config = get_config()
    except RuntimeError as exc:
        print(f"Error: {exc}")
        return 1

    try:
        if args.command == "recent":
            messages = fetch_recent_messages(config, limit=args.limit)
            print_recent_messages(messages, incoming_only=args.incoming_only, private_only=args.private_only)
            return 0

        if args.command == "session":
            if args.clear:
                clear_chat_state(args.chat_id)
                print(f"State session untuk {args.chat_id} dihapus.")
                return 0
            print(json.dumps(get_chat_state(args.chat_id), indent=2))
            return 0

        mode = resolve_mode(args, config["hermes_mode"])

        if args.command == "relay":
            answer = relay_message(
                config=config,
                chat_id=args.chat_id,
                incoming_text=args.message,
                start_new=args.new,
                mode=mode,
                should_send=args.send,
            )
            print(answer)
            return 0

        if args.command == "relay-latest":
            messages = fetch_recent_messages(config, limit=args.limit)
            latest = find_latest_incoming_private(messages)
            if not latest:
                print("Tidak ada incoming private message yang ditemukan pada window ini.")
                return 1
            chat_id = str(latest.get("chatId", ""))
            incoming_text = str(latest.get("body", "")).strip()
            print(f"Chat terpilih: {chat_id}")
            print(f"Pesan masuk: {truncate_text(incoming_text, limit=200)}")
            answer = relay_message(
                config=config,
                chat_id=chat_id,
                incoming_text=incoming_text,
                start_new=args.new,
                mode=mode,
                should_send=args.send,
            )
            print(answer)
            return 0

        print("Command tidak dikenali.")
        return 1
    except HTTPError as exc:
        print(f"HTTP error {exc.code}: {exc.read().decode('utf-8', errors='ignore')}")
        return 1
    except RuntimeError as exc:
        print(f"Run error: {exc}")
        return 1
    except URLError as exc:
        print(f"Connection error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
