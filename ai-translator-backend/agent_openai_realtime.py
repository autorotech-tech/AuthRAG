"""RU↔EN realtime speech-to-speech translation using OpenAI's gpt-realtime-translate.

End-to-end translation: accepts audio streams from LiveKit, translates with OpenAI,
and publishes translated audio/text tracks directly back to the room.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args: object, **kwargs: object) -> bool:
        return False

import aiohttp
from livekit import rtc
from livekit.agents import (
    AgentServer,
    AutoSubscribe,
    JobExecutorType,
    JobContext,
    JobRequest,
    cli,
    utils,
    voice,
)

load_dotenv()

logger = logging.getLogger("openai-translator")


class OpenAITranslator:
    """End-to-end real-time translation using OpenAI's gpt-realtime-translate model."""

    def __init__(
        self,
        *,
        room: rtc.Room,
        track_id: str,
        target_language: str,  # e.g., "en" or "ru"
        participant_identity: str,
        openai_api_key: str,
    ):
        self._room = room
        self._track_id = track_id
        self._target_language = target_language
        self._participant_identity = participant_identity
        self._openai_api_key = openai_api_key

        self._tasks: list[asyncio.Task] = []
        self._audio_queue = asyncio.Queue[rtc.AudioFrame]()

        self._input_resampler: rtc.AudioResampler | None = None
        self._output_resampler = rtc.AudioResampler(24000, 48000, 1)
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._closed = False

    def start(self):
        self._tasks.append(asyncio.create_task(self._run_loop()))

    async def aclose(self):
        self._closed = True
        if self._ws:
            await self._ws.close()
        await utils.aio.cancel_and_wait(*self._tasks)
        self._tasks.clear()

    def push_frame(self, frame: rtc.AudioFrame):
        if not self._closed:
            self._audio_queue.put_nowait(frame)

    @utils.log_exceptions(logger=logger)
    async def _run_loop(self):
        url = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"
        headers = {
            "Authorization": f"Bearer {self._openai_api_key}",
            "User-Agent": "LiveKit Agents",
        }

        logger.info(
            "Connecting to OpenAI Realtime Translation: track=%s target=%s",
            self._track_id,
            self._target_language,
        )

        async with aiohttp.ClientSession() as session:
            try:
                async with session.ws_connect(url, headers=headers) as ws:
                    self._ws = ws

                    # Send session.update to configure target language
                    session_update = {
                        "type": "session.update",
                        "session": {
                            "audio": {
                                "input": {
                                    "transcription": {"model": "gpt-realtime-whisper"},
                                    "noise_reduction": {"type": "near_field"},
                                },
                                "output": {
                                    "language": self._target_language,
                                },
                            }
                        }
                    }
                    await ws.send_str(json.dumps(session_update))
                    logger.info("OpenAI Realtime session configured for target_language=%s", self._target_language)

                    # Start parallel send and receive tasks
                    send_task = asyncio.create_task(self._send_audio_task())
                    recv_task = asyncio.create_task(self._recv_audio_task())

                    await asyncio.gather(send_task, recv_task)
            except Exception as e:
                logger.error("Error in OpenAI Realtime connection: %s", e, exc_info=True)

    @utils.log_exceptions(logger=logger)
    async def _send_audio_task(self):
        try:
            while not self._closed:
                frame = await self._audio_queue.get()

                # Dynamic resampler initialization
                if (
                    self._input_resampler is None
                    or self._input_resampler._input_rate != frame.sample_rate
                    or self._input_resampler._num_channels != frame.num_channels
                ):
                    self._input_resampler = rtc.AudioResampler(
                        input_rate=frame.sample_rate,
                        output_rate=24000,
                        num_channels=1,
                    )

                resampled_frames = self._input_resampler.push(frame)
                for f in resampled_frames:
                    data_bytes = f.data.tobytes()
                    b64_data = base64.b64encode(data_bytes).decode("utf-8")

                    append_event = {
                        "type": "session.input_audio_buffer.append",
                        "audio": b64_data,
                    }
                    if self._ws and not self._ws.closed:
                        await self._ws.send_str(json.dumps(append_event))

                self._audio_queue.task_done()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Error sending audio to OpenAI: %s", e, exc_info=True)

    @utils.log_exceptions(logger=logger)
    async def _recv_audio_task(self):
        audio_output = voice._ParticipantAudioOutput(
            self._room,
            sample_rate=48000,
            num_channels=1,
            track_publish_options=rtc.TrackPublishOptions(),
            track_name=f"{self._track_id}-{self._target_language}",
        )
        await audio_output.start()

        text_output = voice._ParticipantStreamTranscriptionOutput(
            self._room,
            participant=self._participant_identity,
            is_delta_stream=True,
            attributes={
                "language": self._target_language,
                "translated": "true",
            },
        )

        logger.info("Audio & Text output tracks active for %s-%s", self._track_id, self._target_language)

        try:
            async for msg in self._ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    event = json.loads(msg.data)
                    event_type = event.get("type")

                    if event_type == "session.output_audio.delta":
                        audio_b64 = event.get("delta")
                        if audio_b64:
                            audio_bytes = base64.b64decode(audio_b64)
                            frame = rtc.AudioFrame(
                                data=audio_bytes,
                                sample_rate=24000,
                                num_channels=1,
                                samples_per_channel=len(audio_bytes) // 2,
                            )
                            for f in self._output_resampler.push(frame):
                                await audio_output.capture_frame(f)

                    elif event_type == "session.output_transcript.delta":
                        text_delta = event.get("delta")
                        if text_delta:
                            await text_output.capture_text(text_delta)
                            text_output.flush()

                    elif event_type == "error":
                        logger.error("OpenAI real-time translation error: %s", event.get("error"))

                elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED):
                    break
        finally:
            await audio_output.aclose()
            await text_output.aclose()
            logger.info("Outputs closed for track=%s-%s", self._track_id, self._target_language)


class InputTrack:
    def __init__(
        self,
        *,
        language: str,
        track: rtc.RemoteAudioTrack,
        participant_identity: str,
        room: rtc.Room,
        openai_api_key: str,
    ):
        self.language = language
        self.track = track
        self.participant_identity = participant_identity
        self.room = room
        self.openai_api_key = openai_api_key

        self._translators: dict[str, OpenAITranslator] = {}
        self._tasks: list[asyncio.Task] = []

    def start(self):
        self._tasks.append(asyncio.create_task(self._consume_input()))

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
        if target_language in self._translators:
            return
        logger.info("starting OpenAI translator for %s - %s", self.track.sid, target_language)
        translator = OpenAITranslator(
            room=room,
            track_id=self.track.sid,
            target_language=target_language,
            participant_identity=self.participant_identity,
            openai_api_key=self.openai_api_key,
        )
        translator.start()
        self._translators[target_language] = translator

    def _remove_translator(self, target_language: str):
        translator = self._translators.pop(target_language, None)
        if translator:
            asyncio.create_task(translator.aclose())

    @utils.log_exceptions(logger=logger)
    async def _consume_input(self):
        stream = rtc.AudioStream.from_track(track=self.track)
        frame_count = 0
        async for ev in stream:
            frame_count += 1
            if frame_count % 200 == 0:
                logger.info(
                    "audio frames flowing to OpenAI Translator: track=%s frames=%d participant=%s",
                    self.track.sid,
                    frame_count,
                    self.participant_identity,
                )
            for translator in self._translators.values():
                translator.push_frame(ev.frame)
        await stream.aclose()


class RoomTranslator:
    def __init__(self, room: rtc.Room, *, openai_api_key: str, additional_languages: list[str] | None = None):
        self.room = room
        self.openai_api_key = openai_api_key
        self.additional_languages = list(additional_languages) if additional_languages else []
        self.desired_languages = list(self.additional_languages)
        self.input_tracks: list[InputTrack] = []

    def start(self):
        @self.room.on("participant_connected")
        def on_participant_joined(participant: rtc.RemoteParticipant):
            logger.info(
                "participant_connected: identity=%s attrs=%s",
                participant.identity,
                dict(participant.attributes),
            )
            self._update_languages()

        @self.room.on("participant_disconnected")
        def on_participant_left(participant: rtc.RemoteParticipant):
            logger.info("participant_disconnected: identity=%s", participant.identity)
            self._update_languages()

        @self.room.on("track_subscribed")
        def on_track_subscribed(
            track: rtc.Track,
            publication: rtc.TrackPublication,
            participant: rtc.RemoteParticipant,
        ):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                logger.info(
                    "track_subscribed: track=%s participant=%s muted=%s",
                    publication.sid,
                    participant.identity,
                    publication.muted,
                )
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
            openai_api_key=self.openai_api_key,
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
        name="agent-openai",
        identity="agent-openai",
    )


server = AgentServer(
    job_executor_type=JobExecutorType.THREAD,
    multiprocessing_context="spawn",
    num_idle_processes=0,
)


@server.rtc_session(agent_name="translator", on_request=request_fnc)
async def entrypoint(ctx: JobContext):
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        logger.error("OPENAI_API_KEY environment variable is missing!")
        ctx.shutdown()
        return

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    await ctx.room.local_participant.set_attributes(
        {
            "lk.agent.state": "listening",
        }
    )
    logger.info("OpenAI Real-Time Translation Agent active and listening.")

    room_translator = RoomTranslator(ctx.room, openai_api_key=openai_api_key)
    room_translator.start()


if __name__ == "__main__":
    cli.run_app(server)
