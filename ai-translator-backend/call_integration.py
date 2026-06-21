#!/usr/bin/env python3
"""LiveKit Call & Popular Application Integration Gateway.

Supports:
1. LiveKit Ingress (RTMP/WHIP/SRT) creation to ingest Zoom/Teams/Skype stream outputs.
2. LiveKit SIP Trunk & Inbound Route setup for direct phone call translation.
3. Local Virtual Cable (VB-Audio / BlackHole) loopback routing helper.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("call_integration")

try:
    from livekit import api  # type: ignore
except ImportError:
    logger.error("LiveKit server SDK not found. Install with: pip install livekit-api")
    sys.exit(1)


def _load_env_cfg() -> tuple[str, str, str]:
    """Load LiveKit URL, API Key, and Secret from environment."""
    # Attempt to load from parent or adjacent .env
    for p in [Path(".env"), Path("../.env"), Path("../website/.env")]:
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))

    url = os.getenv("LIVEKIT_URL") or os.getenv("NEXT_PUBLIC_LIVEKIT_URL", "")
    key = os.getenv("LIVEKIT_API_KEY") or os.getenv("NEXT_PUBLIC_LIVEKIT_API_KEY", "")
    secret = os.getenv("LIVEKIT_API_SECRET") or os.getenv("LIVEKIT_API_SECRET", "")

    if not (url and key and secret):
        logger.error("LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be configured in environment or .env file.")
        sys.exit(1)

    return url, key, secret


async def setup_ingress(room_name: str, name: str) -> None:
    """Create a LiveKit Ingress (RTMP) to connect local apps or OBS."""
    url, key, secret = _load_env_cfg()
    logger.info("Connecting to LiveKit server to establish RTMP Ingress gateway...")
    
    async with api.LiveKitAPI(url, key, secret) as lk:
        try:
            # Check if Ingress API is available in this LiveKit Server SDK version
            if not hasattr(lk, "ingress"):
                logger.error("The installed LiveKit SDK version does not support Ingress API directly or Ingress is disabled.")
                return

            req = api.CreateIngressRequest(
                input_type=api.IngressInput.RTMP_INPUT,
                name=name,
                room_name=room_name,
                participant_identity=f"ingress-{name}",
                participant_name=f"Ingress Stream ({name})",
            )
            res = await lk.ingress.create_ingress(req)
            
            logger.info("=== Ingress Gateway Created Successfully ===")
            logger.info("Ingress ID: %s", res.ingress_id)
            logger.info("Stream URL: %s", res.stream_url)
            logger.info("Stream Key: %s", res.stream_key)
            logger.info("===========================================")
            logger.info("You can now route Zoom, MS Teams, Skype, or OBS to this Ingress using the Stream URL and Stream Key above.")
        except Exception as e:
            logger.error("Failed to create Ingress Gateway: %s", e)


async def setup_sip_trunk(number: str, sip_carrier: str) -> None:
    """Create a LiveKit SIP Trunk for inbound telephonic translation."""
    url, key, secret = _load_env_cfg()
    logger.info("Establishing connection to configure SIP trunk with carrier: %s", sip_carrier)

    async with api.LiveKitAPI(url, key, secret) as lk:
        try:
            if not hasattr(lk, "sip"):
                logger.error("The installed LiveKit SDK version does not support SIP API directly.")
                return

            # Register SIP Trunk configuration
            trunk_req = api.CreateSIPTrunkRequest(
                inbound_addresses=[f"sip.{sip_carrier}.com"],
                inbound_numbers=[number],
                name=f"trunk-{number}",
            )
            trunk_res = await lk.sip.create_sip_trunk(trunk_req)
            logger.info("=== SIP Trunk Configured ===")
            logger.info("Trunk ID: %s", trunk_res.sip_trunk_id)
            logger.info("Inbound Numbers: %s", trunk_res.inbound_numbers)
            logger.info("============================")
        except Exception as e:
            logger.error("Failed to register SIP Trunk: %s", e)


async def setup_sip_route(room_name: str, number: str) -> None:
    """Create an Inbound SIP Route to dispatch incoming calls to a Room."""
    url, key, secret = _load_env_cfg()
    logger.info("Setting up inbound routing for number %s to LiveKit Room: %s", number, room_name)

    async with api.LiveKitAPI(url, key, secret) as lk:
        try:
            if not hasattr(lk, "sip"):
                logger.error("The installed LiveKit SDK version does not support SIP API directly.")
                return

            # Register Inbound Route mapping specific numbers to a room
            route_req = api.CreateSIPInboundRouteRequest(
                name=f"route-{room_name}",
                source_rules=[api.SIPSourceRule(inbound_numbers=[number])],
                room_name=room_name,
                participant_identity=f"phone-{number}",
                participant_name="Caller (Phone)",
            )
            route_res = await lk.sip.create_sip_inbound_route(route_req)
            logger.info("=== Inbound SIP Route Created ===")
            logger.info("Route ID: %s", route_res.sip_inbound_route_id)
            logger.info("Forwarding %s to room: %s", number, room_name)
            logger.info("=================================")
        except Exception as e:
            logger.error("Failed to register Inbound SIP Route: %s", e)


def print_virtual_cable_guide() -> None:
    """Print step-by-step instructions for popular app integration using Virtual Audio Cable (VB-Cable / BlackHole)."""
    print("\n" + "=" * 80)
    print("      Popular Messenger & Call Apps Integration Guide (Virtual Cable)")
    print("=" * 80)
    print("For apps like Zoom, Teams, Skype, WhatsApp, and Telegram where direct LiveKit")
    print("API integration is restricted, route local audio using Virtual Audio Cables:")
    print("\n1. Prerequisites:")
    print("   - macOS: Install BlackHole 2ch (brew install blackhole-2ch)")
    print("   - Windows/Linux: Install VB-Audio Virtual Cable (vb-audio.com)")
    print("\n2. Output Routing (App to Translation Agent):")
    print("   - In your app (e.g. Zoom or Telegram Settings -> Audio):")
    print("     Change 'Speaker Output' -> Choose 'Virtual Cable' (e.g. VB-Cable or BlackHole).")
    print("   - This routes the incoming caller's voice directly to the virtual line.")
    print("\n3. Input Routing (Agent Translated Speech to App):")
    print("   - In your app (e.g. Zoom/Telegram Settings -> Audio):")
    print("     Change 'Microphone Input' -> Choose 'Virtual Cable' (e.g. VB-Cable / BlackHole).")
    print("   - The translation agent will speak back through the virtual mic directly.")
    print("\n4. Running Local Loopback Bridge:")
    print("   - Use ffmpeg or PyAudio to capture VB-Cable / BlackHole stream and publish")
    print("     directly into LiveKit room:")
    print("     $ ffmpeg -f avfoundation -i ':\"BlackHole 2ch\"' -f flv rtmp://live.autoro.tech/ingress/YOUR_KEY")
    print("=" * 80 + "\n")


def main() -> None:
    p = argparse.ArgumentParser(description="LiveKit Call and Popular App Integration Utility")
    subparsers = p.add_subparsers(dest="command", help="Integration Command")

    # Ingress creation
    ingress_p = subparsers.add_parser("ingress", help="Create RTMP Ingress point for Zoom/Teams stream outputs")
    ingress_p.add_argument("--room", required=True, help="LiveKit room name")
    ingress_p.add_argument("--name", default="stream-ingress", help="Ingress name identifier")

    # SIP setup
    sip_p = subparsers.add_parser("sip", help="Register SIP Trunk and Route phone call into room")
    sip_p.add_argument("--room", required=True, help="LiveKit room name")
    sip_p.add_argument("--number", required=True, help="Telephone number to listen or route")
    sip_p.add_argument("--carrier", default="telnyx", help="SIP trunk provider (e.g. telnyx, twilio)")

    # Virtual cable guide
    subparsers.add_parser("guide", help="Show step-by-step instructions for Virtual Audio Cable app integration")

    args = p.parse_args()

    if args.command == "ingress":
        asyncio.run(setup_ingress(args.room, args.name))
    elif args.command == "sip":
        asyncio.run(setup_sip_trunk(args.number, args.carrier))
        asyncio.run(setup_sip_route(args.room, args.number))
    elif args.command == "guide" or not args.command:
        print_virtual_cable_guide()


if __name__ == "__main__":
    main()
