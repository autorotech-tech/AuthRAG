from __future__ import annotations

import logging
import os
import statistics

from dotenv import load_dotenv
from google.genai import types

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobRequest,
    MetricsCollectedEvent,
    cli,
    metrics,
    room_io,
)
from livekit.agents.metrics import RealtimeModelMetrics
from livekit.plugins import google

load_dotenv()

if not os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

logger = logging.getLogger("translator-live")

INTERPRETER_SYSTEM = """You are a real-time simultaneous interpreter in a voice call. Listen to the user's speech and respond ONLY with the translation: Russian to English or English to Russian. No filler, no explanations. Match the speaker's tone. Output speech suitable for immediate playback."""


class LatencyStats:
    def __init__(self, label: str, log_every: int = 5) -> None:
        self.label = label
        self._samples: list[float] = []
        self._log_every = log_every

    def record(self, ms: float) -> None:
        self._samples.append(ms)
        if len(self._samples) % self._log_every == 0:
            self.log_summary()

    def log_summary(self) -> None:
        if len(self._samples) < 1:
            return
        s = sorted(self._samples)
        n = len(s)
        p50 = s[n // 2]
        p95 = s[int((n - 1) * 0.95)]
        logger.info("[%s] n=%d p50=%.0fms p95=%.0fms (mean=%.0fms)", self.label, n, p50, p95, statistics.mean(s))


gemini_live_ttft = LatencyStats("A-gemini-live_ttft_ms")


def build_realtime_llm() -> google.realtime.RealtimeModel:
    silence_ms = int(os.getenv("GEMINI_SILENCE_MS", "350"))
    prefix_ms = int(os.getenv("GEMINI_PREFIX_MS", "120"))
    kwargs: dict = {
        "instructions": INTERPRETER_SYSTEM,
        "voice": os.getenv("GEMINI_LIVE_VOICE", "Puck"),
        # Lower end-of-speech threshold to reduce user-perceived latency.
        "realtime_input_config": types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                disabled=False,
                silence_duration_ms=silence_ms,
                prefix_padding_ms=prefix_ms,
            )
        ),
    }
    if os.getenv("GEMINI_LIVE_MODEL"):
        kwargs["model"] = os.environ["GEMINI_LIVE_MODEL"]
    return google.realtime.RealtimeModel(**kwargs)


class InterpreterLive(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=INTERPRETER_SYSTEM)


server = AgentServer()


async def request_fnc_live(req: JobRequest) -> None:
    await req.accept(name="agent-live", identity="agent-live")


@server.rtc_session(agent_name="translator-live", on_request=request_fnc_live)
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Gemini Live agent listening; GEMINI_LIVE_MODEL=%s VERTEX=%s", os.getenv("GEMINI_LIVE_MODEL", "(default from plugin)"), os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "0"))

    session = AgentSession(llm=build_realtime_llm())

    @session.on("metrics_collected")
    def _on_metrics_collected(ev: MetricsCollectedEvent) -> None:
        m = ev.metrics
        if isinstance(m, RealtimeModelMetrics) and m.ttft >= 0:
            gemini_live_ttft.record(m.ttft * 1000.0)
        metrics.log_metrics(m)

    async def _flush_latency() -> None:
        gemini_live_ttft.log_summary()

    ctx.add_shutdown_callback(_flush_latency)

    await session.start(
        agent=InterpreterLive(),
        room=ctx.room,
        room_options=room_io.RoomOptions(audio_input=room_io.AudioInputOptions()),
    )


if __name__ == "__main__":
    cli.run_app(server)
