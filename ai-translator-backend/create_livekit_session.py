from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from pathlib import Path

try:
    from livekit import api  # type: ignore
except Exception as e:  # noqa: BLE001
    raise SystemExit(
        "Не найден LiveKit server SDK. Установите в текущее окружение: "
        "python3 -m pip install livekit-api"
    ) from e


def _parse_env_file(env_path: str) -> dict[str, str]:
    data: dict[str, str] = {}
    p = Path(env_path)
    if not p.exists():
        return data
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip().strip("'\"")
    return data


def _cfg(env_path: str) -> tuple[str, str, str]:
    cfg = _parse_env_file(env_path)
    merged = {
        "LIVEKIT_URL": os.getenv("LIVEKIT_URL", cfg.get("LIVEKIT_URL", "")),
        "LIVEKIT_API_KEY": os.getenv("LIVEKIT_API_KEY", cfg.get("LIVEKIT_API_KEY", "")),
        "LIVEKIT_API_SECRET": os.getenv(
            "LIVEKIT_API_SECRET", cfg.get("LIVEKIT_API_SECRET", "")
        ),
    }
    url = merged.get("LIVEKIT_URL", "")
    key = merged.get("LIVEKIT_API_KEY", "")
    secret = merged.get("LIVEKIT_API_SECRET", "")
    if not (url and key and secret):
        raise SystemExit("Missing LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET in .env")
    return url, key, secret


async def _create(env_path: str, room: str, agent_name: str, out_file: str) -> None:
    url, key, secret = _cfg(env_path)

    async with api.LiveKitAPI(url, key, secret) as lk:
        await lk.room.create_room(api.CreateRoomRequest(name=room))
        dispatch = await lk.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(room=room, agent_name=agent_name)
        )

    run_suffix = str(int(time.time()))
    caller_ru_identity = f"caller-ru-{run_suffix}"
    caller_en_identity = f"caller-en-{run_suffix}"

    def tok(identity: str, language: str) -> str:
        return (
            api.AccessToken(key, secret)
            .with_identity(identity)
            .with_name(identity)
            .with_grants(
                api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True)
            )
            .with_attributes({"language": language})
            .to_jwt()
        )

    data = {
        "livekit_url": url,
        "room": room,
        "agent_name": agent_name,
        "dispatch_id": getattr(dispatch, "id", None),
        "caller_ru": {"identity": caller_ru_identity, "token": tok(caller_ru_identity, "ru")},
        "caller_en": {"identity": caller_en_identity, "token": tok(caller_en_identity, "en")},
    }
    Path(out_file).write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"ROOM={room}")
    print(f"DISPATCH_ID={data['dispatch_id']}")
    print(f"FILE={out_file}")


def main() -> None:
    p = argparse.ArgumentParser(description="Create LiveKit room + dispatch + 2 test tokens")
    p.add_argument("--env", default=".env")
    p.add_argument("--agent-name", default="translator")
    p.add_argument("--room", default=f"ru-en-test-{int(time.time())}")
    p.add_argument("--out", default="livekit_test_session.json")
    args = p.parse_args()
    asyncio.run(_create(args.env, args.room, args.agent_name, args.out))


if __name__ == "__main__":
    main()
