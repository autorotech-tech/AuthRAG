"""RU↔EN realtime speech translation (multi-participant).

Adapted from LiveKit: examples/other/translation/multi-user-translator.py
https://github.com/livekit/agents/blob/main/examples/other/translation/multi-user-translator.py

Each participant sets attribute `language` to `ru` or `en` (via access token).
The agent transcribes each mic with Deepgram, translates with Gemini, TTS via ElevenLabs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import statistics
import time
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args: object, **kwargs: object) -> bool:
        return False

from livekit import rtc
from livekit.agents import (
    AgentServer,
    AutoSubscribe,
    JobExecutorType,
    JobContext,
    JobRequest,
    cli,
    llm,
    stt,
    tokenize,
    utils,
    voice,
)
from livekit.agents.types import (
    ATTRIBUTE_TRANSCRIPTION_FINAL,
    ATTRIBUTE_TRANSCRIPTION_SEGMENT_ID,
    ATTRIBUTE_TRANSCRIPTION_TRACK_ID,
    TOPIC_TRANSCRIPTION,
)
from livekit.plugins import deepgram, elevenlabs, google

load_dotenv()

# LiveKit Google plugin expects GOOGLE_API_KEY for Gemini Developer API; allow GEMINI_API_KEY alias.
if not os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

logger = logging.getLogger("transcriber")

# Variant B (low-latency pipeline): Flash LLM + Nova-3 STT + ElevenLabs Flash TTS
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DEEPGRAM_MODEL = os.getenv("DEEPGRAM_MODEL", "nova-3")
ELEVENLABS_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")


class LatencyStats:
    """Сбор задержек для сравнения p50/p95 (логируется каждые N сэмплов)."""

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
        p95 = s[int(max(0, (n - 1) * 0.95))]
        logger.info(
            "[%s] n=%d p50=%.0fms p95=%.0fms (mean=%.0fms)",
            self.label,
            n,
            p50,
            p95,
            statistics.mean(s),
        )


# От момента «фраза собрана после STT/токенайзера» до первого аудиокадра на выходе (LLM+TTS+публикация).
pipeline_latency = LatencyStats("B-pipeline_stt_ready_to_first_audio_ms")


@dataclass
class STTText:
    text: str
    t_after_stt: float


@dataclass
class TranslatedText:
    text: str
    t_after_stt: float


@dataclass
class Language:
    code: str
    name: str


_languages = [
    Language(code="en", name="English"),
    Language(code="ru", name="Russian"),
]

language_map: dict[str, Language] = {lang.code: lang for lang in _languages}

INTERPRETER_SYSTEM = """You are a real-time simultaneous interpreter. You will receive fragmented speech input. \
Translate Russian to English and English to Russian immediately. Do not add conversational filler. \
Maintain the tone of the speaker. Output ONLY the translated text, optimized for immediate TTS playback."""


@dataclass
class PlayoutData:
    audio_ch: utils.aio.Chan[rtc.AudioFrame]
    transcript: str
    t_after_stt: float

    def __init__(self, transcript: str, t_after_stt: float) -> None:
        self.audio_ch = utils.aio.Chan[rtc.AudioFrame]()
        self.transcript = transcript
        self.t_after_stt = t_after_stt


class Translator:
    """Handles real-time translation of transcribed text to target languages."""

    def __init__(
        self,
        *,
        room: rtc.Room,
        track_id: str,
        target_language: Language,
        participant_identity: str,
    ):
        self._room = room
        self._target_language = target_language
        self._track_id = track_id
        self._participant_identity = participant_identity
        self._tasks: list[asyncio.Task] = []
        self._input_ch = utils.aio.Chan[STTText]()
        self._playout_ch = utils.aio.Chan[PlayoutData]()
        self._llm_stream = utils.aio.Chan[TranslatedText]()

        self._llm = google.LLM(model=GEMINI_MODEL)
        self._tts = elevenlabs.TTS(model=ELEVENLABS_MODEL)
        self._resampler = rtc.AudioResampler(22050, 48000)

    def start(self):
        self._tasks.append(asyncio.create_task(self._run()))
        self._tasks.append(asyncio.create_task(self._synthesize_tts()))
        self._tasks.append(asyncio.create_task(self._publish_and_playout()))

    async def aclose(self):
        self.end_input()
        await asyncio.gather(*self._tasks)
        self._tasks.clear()

    def push_sentence(self, sentence: str):
        self._input_ch.send_nowait(STTText(sentence, time.perf_counter()))

    def end_input(self):
        if not self._input_ch.closed:
            self._input_ch.close()

    @utils.log_exceptions(logger=logger)
    async def _run(self):
        async for job in self._input_ch:
            if not job or not job.text:
                continue

            context = llm.ChatContext()
            context.add_message(
                role="system",
                content=(
                    f"{INTERPRETER_SYSTEM} "
                    f"For this turn, the output language must be {self._target_language.name} ({self._target_language.code}) only."
                ),
            )
            context.add_message(role="user", content=job.text)

            try:
                llm_stream = self._llm.chat(chat_ctx=context)
                response = ""
                async for chunk in llm_stream:
                    if not chunk.delta or not chunk.delta.content:
                        continue
                    response += chunk.delta.content
                await llm_stream.aclose()

                logger.info("translated to %s: %s", self._target_language.name, response)
                self._llm_stream.send_nowait(TranslatedText(response, job.t_after_stt))
            except Exception:
                logger.exception("Error translating sentence")

        self._llm_stream.close()

    @utils.log_exceptions(logger=logger)
    async def _synthesize_tts(self):
        async for job in self._llm_stream:
            stream = self._tts.synthesize(job.text)
            playout_data = PlayoutData(job.text, job.t_after_stt)
            self._playout_ch.send_nowait(playout_data)
            async for frame in stream:
                frames = self._resampler.push(frame.frame)
                for f in frames:
                    playout_data.audio_ch.send_nowait(f)
            playout_data.audio_ch.close()
            await stream.aclose()

        logger.info("ending tts input")
        self._playout_ch.close()

    @utils.log_exceptions(logger=logger)
    async def _publish_and_playout(self):
        audio_output = voice._ParticipantAudioOutput(
            self._room,
            sample_rate=48000,
            num_channels=1,
            track_publish_options=rtc.TrackPublishOptions(),
            track_name=f"{self._track_id}-{self._target_language.code}",
        )
        await audio_output.start()
        text_output = voice._ParticipantStreamTranscriptionOutput(
            self._room,
            participant=self._participant_identity,
            is_delta_stream=True,
            attributes={
                "language": self._target_language.code,
                "translated": "true",
            },
        )
        synchronizer = voice.TranscriptSynchronizer(
            next_in_chain_audio=audio_output,
            next_in_chain_text=text_output,
        )

        async for playout_data in self._playout_ch:
            logger.info("translated playing out: %s", playout_data.transcript)
            await synchronizer.text_output.capture_text(playout_data.transcript)
            synchronizer.text_output.flush()
            first_frame = True
            async for frame in playout_data.audio_ch:
                if first_frame:
                    ms = (time.perf_counter() - playout_data.t_after_stt) * 1000
                    pipeline_latency.record(ms)
                    first_frame = False
                await synchronizer.audio_output.capture_frame(frame)
            synchronizer.audio_output.flush()

        await synchronizer.aclose()
        await audio_output.aclose()


class InputTrack:
    def __init__(
        self,
        *,
        language: str,
        track: rtc.RemoteAudioTrack,
        participant_identity: str,
        room: rtc.Room,
    ):
        self.language = language
        self.track = track
        self.participant_identity = participant_identity
        self.room = room

        self._translators: dict[str, Translator] = {}
        self._tasks: list[asyncio.Task] = []
        self._stt = deepgram.STT(language=language, model=DEEPGRAM_MODEL)
        tokenizer = tokenize.blingfire.SentenceTokenizer()
        self._sentence_stream: tokenize.SentenceStream = tokenizer.stream()
        self._stt_stream = self._stt.stream(language=language)

    def start(self):
        self._tasks.append(asyncio.create_task(self._consume_input()))
        self._tasks.append(asyncio.create_task(self._tokenize_to_sentences()))
        self._tasks.append(asyncio.create_task(self._forward_to_translators()))

    async def aclose(self):
        await utils.aio.cancel_and_wait(*self._tasks)
        self._tasks.clear()
        for translator in self._translators.values():
            await translator.aclose()

    def set_languages(self, target_languages: list[str], *, room: rtc.Room):
        for lang in target_languages:
            if lang != self.language:
                self._add_translator(lang, room)
        for lang in list(self._translators.keys()):
            if lang != self.language and lang not in target_languages:
                self._remove_translator(lang)

    def _add_translator(self, target_language: str, room: rtc.Room):
        lang = language_map.get(target_language)
        if not lang:
            return
        if lang.code in self._translators:
            return
        logger.info("starting translator for %s - %s", self.track.sid, lang.name)
        translator = Translator(
            room=room,
            target_language=lang,
            track_id=self.track.sid,
            participant_identity=self.participant_identity,
        )
        translator.start()
        self._translators[lang.code] = translator

    def _remove_translator(self, target_language: str):
        translator = self._translators.pop(target_language, None)
        if translator:
            asyncio.create_task(translator.aclose())

    async def _forward_to_translators(self):
        async for ev in self._sentence_stream:
            logger.info("forwarding to translators: %s", ev.token)
            for translator in self._translators.values():
                translator.push_sentence(ev.token)

        logger.info("ending translator input")
        for translator in self._translators.values():
            translator.end_input()

    @utils.log_exceptions(logger=logger)
    async def _tokenize_to_sentences(self):
        async def _create_text_writer(*, segment_id: str) -> rtc.TextStreamWriter:
            attributes = {
                ATTRIBUTE_TRANSCRIPTION_FINAL: "false",
                ATTRIBUTE_TRANSCRIPTION_TRACK_ID: self.track.sid,
                ATTRIBUTE_TRANSCRIPTION_SEGMENT_ID: segment_id,
                "language": self.language,
            }
            return await self.room.local_participant.stream_text(
                topic=TOPIC_TRANSCRIPTION,
                sender_identity=self.participant_identity,
                attributes=attributes,
            )

        segment_id = utils.shortuuid("SG_")
        writer: rtc.TextStreamWriter | None = None
        async for ev in self._stt_stream:
            if ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                logger.info("STT: %s", ev.alternatives[0].text)
                self._sentence_stream.push_text(ev.alternatives[0].text)
                if writer is None:
                    writer = await _create_text_writer(segment_id=segment_id)
                await writer.write(ev.alternatives[0].text)
            elif ev.type == stt.SpeechEventType.END_OF_SPEECH:
                self._sentence_stream.flush()
                if writer:
                    attributes = {
                        ATTRIBUTE_TRANSCRIPTION_FINAL: "true",
                        ATTRIBUTE_TRANSCRIPTION_TRACK_ID: self.track.sid,
                    }
                    await writer.aclose(attributes=attributes)
                    writer = None
                    segment_id = utils.shortuuid("SG_")
        self._sentence_stream.end_input()

    async def _consume_input(self):
        stream = rtc.AudioStream.from_track(track=self.track)
        # region agent log
        frame_count = 0
        # endregion
        async for ev in stream:
            # region agent log
            frame_count += 1
            if frame_count == 1:
                logger.info(
                    "audio stream started: track=%s participant=%s language=%s",
                    self.track.sid,
                    self.participant_identity,
                    self.language,
                )
            elif frame_count % 200 == 0:
                logger.info(
                    "audio frames flowing: track=%s frames=%d participant=%s",
                    self.track.sid,
                    frame_count,
                    self.participant_identity,
                )
            # endregion
            self._stt_stream.push_frame(ev.frame)
        await stream.aclose()


class RoomTranslator:
    def __init__(self, room: rtc.Room, *, additional_languages: list[str] | None = None):
        self.room = room
        self.additional_languages = list(additional_languages) if additional_languages else []
        self.desired_languages = list(self.additional_languages)
        self.input_tracks: list[InputTrack] = []

    def start(self):
        @self.room.on("participant_connected")
        def on_participant_joined(participant: rtc.RemoteParticipant):
            # region agent log
            logger.info(
                "participant_connected: identity=%s attrs=%s",
                participant.identity,
                dict(participant.attributes),
            )
            # endregion
            self._update_languages()

        @self.room.on("participant_disconnected")
        def on_participant_left(participant: rtc.RemoteParticipant):
            # region agent log
            logger.info("participant_disconnected: identity=%s", participant.identity)
            # endregion
            self._update_languages()

        @self.room.on("track_subscribed")
        def on_track_subscribed(
            track: rtc.Track,
            publication: rtc.TrackPublication,
            participant: rtc.RemoteParticipant,
        ):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                # region agent log
                logger.info(
                    "track_subscribed: track=%s participant=%s muted=%s",
                    publication.sid,
                    participant.identity,
                    publication.muted,
                )
                # endregion
                audio_language = participant.attributes.get("language")
                if audio_language is None:
                    audio_language = "en"
                self._add_track(
                    track, language=audio_language, participant_identity=participant.identity
                )

        @self.room.on("track_unsubscribed")
        def on_track_unsubscribed(
            track: rtc.Track,
            publication: rtc.TrackPublication,
            participant: rtc.RemoteParticipant,
        ):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                self._remove_track(track)

        self._update_languages()

        existing_track_ids = [input_track.track.sid for input_track in self.input_tracks]
        for participant in self.room.remote_participants.values():
            for pub in participant.track_publications.values():
                if (
                    pub.track
                    and pub.kind == rtc.TrackKind.KIND_AUDIO
                    and pub.sid not in existing_track_ids
                ):
                    on_track_subscribed(pub.track, pub, participant)

    def _update_languages(self):
        languages = set(self.additional_languages)
        for participant in self.room.remote_participants.values():
            language = participant.attributes.get("language")
            if language:
                languages.add(language)
        self.desired_languages = list(languages)
        self._reconcile_translators()

    def _add_track(self, track: rtc.RemoteAudioTrack, *, language: str, participant_identity: str):
        input_track = InputTrack(
            language=language,
            track=track,
            participant_identity=participant_identity,
            room=self.room,
        )
        input_track.start()
        self.input_tracks.append(input_track)
        self._reconcile_translators()

    def _remove_track(self, track: rtc.RemoteAudioTrack):
        input_track = next((t for t in self.input_tracks if t.track.sid == track.sid), None)
        if input_track:
            asyncio.create_task(input_track.aclose())
            self.input_tracks.remove(input_track)

    def _reconcile_translators(self):
        for track in self.input_tracks:
            track.set_languages(self.desired_languages, room=self.room)


async def request_fnc(req: JobRequest):
    await req.accept(
        name="agent",
        identity="agent",
    )


# Work around Linux forkserver instability on this host:
# run jobs in threads (no child process pool), keep spawn settings explicit.
server = AgentServer(
    job_executor_type=JobExecutorType.THREAD,
    multiprocessing_context="spawn",
    num_idle_processes=0,
)


@server.rtc_session(agent_name="translator", on_request=request_fnc)
async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    await ctx.room.local_participant.set_attributes(
        {
            "lk.agent.state": "listening",
        }
    )
    logger.info(
        "agent state set to listening, models: gemini=%s deepgram=%s elevenlabs=%s",
        GEMINI_MODEL,
        DEEPGRAM_MODEL,
        ELEVENLABS_MODEL,
    )

    room_translator = RoomTranslator(ctx.room)
    room_translator.start()

    @ctx.room.on("disconnected")
    def _on_room_disconnected(*args: object) -> None:
        pipeline_latency.log_summary()


if __name__ == "__main__":
    cli.run_app(server)
