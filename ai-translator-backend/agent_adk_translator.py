"""RU↔EN realtime speech translation on LiveKit with Google ADK + Local Security (PII/Prompt Injection) + HITL.

This module implements a stateful real-time translation agent.
Features:
- LiveKit room subscriptions and audio flow
- Deepgram Nova-3 Speech-to-Text (STT)
- SecurityFilterNode for local PII and Prompt Injection detection
- HITL (Human-in-the-Loop) moderation queue
- Gemini 2.5 Flash translation
- Google Cloud TTS / ElevenLabs hybrid Speech Synthesis
"""

from __future__ import annotations

import asyncio
import logging
import os
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

from security import screen_capture_content

load_dotenv()

# LiveKit Google plugin expects GOOGLE_API_KEY; allow GEMINI_API_KEY alias
if not os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

logger = logging.getLogger("adk-translator")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DEEPGRAM_MODEL = os.getenv("DEEPGRAM_MODEL", "nova-3")
ELEVENLABS_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")


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


class TranslationNode:
    """Translation state node: Processes clean text through Gemini 2.5 Flash."""

    def __init__(self, target_language: Language):
        self._target_language = target_language
        self._llm = google.LLM(model=GEMINI_MODEL)

    async def translate(self, text: str) -> str:
        context = llm.ChatContext()
        context.add_message(
            role="system",
            content=(
                f"{INTERPRETER_SYSTEM} "
                f"For this turn, the output language must be {self._target_language.name} ({self._target_language.code}) only."
            ),
        )
        context.add_message(role="user", content=text)

        response = ""
        try:
            llm_stream = self._llm.chat(chat_ctx=context)
            async for chunk in llm_stream:
                if chunk.delta and chunk.delta.content:
                    response += chunk.delta.content
            await llm_stream.aclose()
        except Exception as e:
            logger.error("Error translating text: %s", e)
            response = ""

        return response.strip()


class SpeechSynthesisNode:
    """TTS state node: Synthesizes text with a hybrid/fallback mechanism.
    Primary: Google Cloud Text-to-Speech (Journey/Neural2) stream or ElevenLabs Flash.
    Secondary / Fallback: Google Cloud Text-to-Speech / ElevenLabs Flash.
    """

    def __init__(self, target_language: Language):
        self._target_language = target_language
        self._elevenlabs_tts = elevenlabs.TTS(model=ELEVENLABS_MODEL)
        self._elevenlabs_resampler = rtc.AudioResampler(22050, 48000)
        self._google_resampler = rtc.AudioResampler(24000, 48000)

        # Lazy init Google TTS client
        self._google_client = None

    def _get_google_client(self):
        if self._google_client is None:
            try:
                from google.cloud import texttospeech
                # This will automatically pick up credentials from env (Application Default Credentials)
                # or we can handle fallback gracefully.
                self._google_client = texttospeech.TextToSpeechAsyncClient()
                logger.info("Initialized Google Cloud Text-to-Speech Async Client.")
            except Exception as e:
                logger.error("Failed to initialize Google Cloud TTS client: %s", e)
                self._google_client = False
        return self._google_client

    def _get_preferred_tts_engine(self) -> str:
        try:
            import psycopg2
            pg_host = os.getenv("BOOKMARKS_PGHOST", "localhost")
            pg_port = int(os.getenv("BOOKMARKS_PGPORT", "5432"))
            pg_db = os.getenv("BOOKMARKS_PGDATABASE", "postgres")
            pg_user = os.getenv("BOOKMARKS_PGUSER", "postgres")
            pg_password = os.getenv("BOOKMARKS_PGPASSWORD", "supabase_password_e97577f974376e8d")
            
            conn = psycopg2.connect(
                host=pg_host,
                port=pg_port,
                dbname=pg_db,
                user=pg_user,
                password=pg_password
            )
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "select column_name from information_schema.columns where table_name='service_settings' and column_name='adk_translator_tts_engine'"
                    )
                    if cur.fetchone():
                        cur.execute("select adk_translator_tts_engine from public.service_settings where id = 1 limit 1")
                        row = cur.fetchone()
                        if row:
                            return row[0].strip().lower()
            except Exception as e:
                logger.debug("Failed to query adk_translator_tts_engine from DB: %s", e)
            finally:
                conn.close()
        except Exception as e:
            logger.debug("Failed to connect to DB to get tts_engine: %s", e)
        return "google"

    async def synthesize(self, text: str) -> list[rtc.AudioFrame]:
        frames_out = []
        preferred_engine = self._get_preferred_tts_engine()
        logger.info("Preferred TTS Engine resolved from DB: %s", preferred_engine)

        async def synthesize_google() -> bool:
            client = self._get_google_client()
            if not client:
                return False
            try:
                from google.cloud import texttospeech
                # Determine voice name and language code
                if self._target_language.code == "ru":
                    voice_name = "ru-RU-Journey-F"  # SOTA Journey voice
                    lang_code = "ru-RU"
                else:
                    voice_name = "en-US-Journey-F"  # English Journey voice
                    lang_code = "en-US"

                input_text = texttospeech.SynthesisInput(text=text)
                voice_config = texttospeech.VoiceSelectionParams(
                    language_code=lang_code,
                    name=voice_name,
                )
                # We request LINEAR16 PCM at 24000Hz (highly standard and fast)
                audio_config = texttospeech.AudioConfig(
                    audio_encoding=texttospeech.AudioEncoding.LINEAR16,
                    sample_rate_hertz=24000,
                )

                logger.info("Attempting Google Cloud TTS (Journey) synthesis for: %s", text)
                response = await client.synthesize_speech(
                    request={"input": input_text, "voice": voice_config, "audio_config": audio_config}
                )

                # Convert raw bytes (linear16 PCM) into LiveKit AudioFrames
                # Each 16-bit sample is 2 bytes, so num_samples = len / 2
                raw_data = response.audio_content
                frame = rtc.AudioFrame(
                    data=raw_data,
                    sample_rate=24000,
                    num_channels=1,
                    samples_per_channel=len(raw_data) // 2,
                )
                frames_out.extend(self._google_resampler.push(frame))
                logger.info("Google Cloud TTS (Journey) synthesis successful.")
                return True
            except Exception as e:
                logger.warning("Google Cloud TTS synthesis failed: %s", e)
                return False

        async def synthesize_elevenlabs() -> bool:
            try:
                logger.info("Attempting ElevenLabs synthesis for: %s", text)
                stream = self._elevenlabs_tts.synthesize(text)
                async for frame in stream:
                    frames = self._elevenlabs_resampler.push(frame.frame)
                    frames_out.extend(frames)
                await stream.aclose()
                logger.info("ElevenLabs synthesis successful.")
                return True
            except Exception as e:
                logger.error("ElevenLabs synthesis failed: %s", e)
                return False

        if preferred_engine == "elevenlabs":
            success = await synthesize_elevenlabs()
            if not success:
                logger.info("ElevenLabs failed, falling back to Google Cloud TTS...")
                await synthesize_google()
        else:
            success = await synthesize_google()
            if not success:
                logger.info("Google Cloud TTS failed, falling back to ElevenLabs...")
                await synthesize_elevenlabs()

        return frames_out


class ADKTranslator:
    """Stateful ADK-inspired Translation Agent representing transition graph."""

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
        self._input_queue = asyncio.Queue[str]()
        self._playout_queue = asyncio.Queue[tuple[str, list[rtc.AudioFrame]]]()

        # Nodes
        self._translation_node = TranslationNode(target_language)
        self._tts_node = SpeechSynthesisNode(target_language)

        self._closed = False

    def start(self):
        self._tasks.append(asyncio.create_task(self._process_pipeline()))
        self._tasks.append(asyncio.create_task(self._publish_and_playout()))

    async def aclose(self):
        self._closed = True
        await utils.aio.cancel_and_wait(*self._tasks)
        self._tasks.clear()

    def push_sentence(self, sentence: str):
        if not self._closed:
            self._input_queue.put_nowait(sentence)

    @utils.log_exceptions(logger=logger)
    async def _process_pipeline(self):
        while not self._closed:
            sentence = await self._input_queue.get()
            if not sentence:
                self._input_queue.task_done()
                continue

            logger.info("Processing sentence through ADK pipeline: %s", sentence)

            # State 1: Security Screening Node
            security_res = screen_capture_content(sentence)
            if security_res.route == "human_review":
                # Trigger HITL Node / queue
                alert_type = "PII" if security_res.redacted_categories else "Prompt Injection"
                logger.warning(
                    "Security node triggered human_review for [%s]: %s (categories: %s)",
                    alert_type,
                    security_res.text,
                    security_res.redacted_categories,
                )
                
                # Write to public.capture_moderation_queue for HITL dashboard
                moderation_id = None
                try:
                    import psycopg2
                    from psycopg2.extras import Json
                    
                    # Connection variables matching .env context or defaults
                    pg_host = os.getenv("BOOKMARKS_PGHOST", "localhost")
                    pg_port = int(os.getenv("BOOKMARKS_PGPORT", "5432"))
                    pg_db = os.getenv("BOOKMARKS_PGDATABASE", "postgres")
                    pg_user = os.getenv("BOOKMARKS_PGUSER", "postgres")
                    pg_password = os.getenv("BOOKMARKS_PGPASSWORD", "supabase_password_e97577f974376e8d")
                    
                    conn = psycopg2.connect(
                        host=pg_host,
                        port=pg_port,
                        dbname=pg_db,
                        user=pg_user,
                        password=pg_password
                    )
                    try:
                        with conn.cursor() as cur:
                            cur.execute(
                                """
                                insert into public.capture_moderation_queue (
                                  workspace_id, source, url, original_title,
                                  raw_text, redacted_text, redacted_categories, prompt_injection, status
                                ) values (1, 'call_interpreter', %s, %s, %s, %s, %s, %s, 'pending_approval')
                                returning id
                                """,
                                (
                                    f"livekit://{self._room.name}",
                                    f"Call with {self._participant_identity}",
                                    sentence,
                                    security_res.text,
                                    Json(security_res.redacted_categories),
                                    security_res.prompt_injection,
                                )
                            )
                            row = cur.fetchone()
                            moderation_id = row[0] if row else None
                            conn.commit()
                            logger.info("Successfully recorded HITL item into database (non-blocking): moderationId=%s", moderation_id)
                    except Exception as e_db:
                        conn.rollback()
                        logger.error("Failed to insert into capture_moderation_queue: %s", e_db)
                    finally:
                        conn.close()
                except Exception as e_conn:
                    logger.error("Could not connect to database for HITL queueing: %s", e_conn)
                
                # Real-time non-blocking flow: Translate the redacted/safe text immediately to avoid blocking the voice stream!
                logger.info("Non-blocking mode: translating redacted/safe text immediately to ensure ultra fast streaming translation.")
                clean_sentence = security_res.text
            else:
                clean_sentence = security_res.text

            # State 2: Translation Node
            translated_text = await self._translation_node.translate(clean_sentence)
            if not translated_text:
                self._input_queue.task_done()
                continue

            logger.info("Translated text ready: %s -> %s", clean_sentence, translated_text)

            # State 3: Speech Synthesis Node (TTS)
            audio_frames = await self._tts_node.synthesize(translated_text)

            # State 4: Playout queue
            await self._playout_queue.put((translated_text, audio_frames))
            self._input_queue.task_done()

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

        try:
            while not self._closed:
                text, frames = await self._playout_queue.get()
                logger.info("Playout translated audio & text: %s", text)

                await synchronizer.text_output.capture_text(text)
                synchronizer.text_output.flush()

                for frame in frames:
                    await synchronizer.audio_output.capture_frame(frame)
                synchronizer.audio_output.flush()

                self._playout_queue.task_done()
        finally:
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

        self._translators: dict[str, ADKTranslator] = {}
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
        logger.info("starting ADK translator for %s - %s", self.track.sid, lang.name)
        translator = ADKTranslator(
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
            logger.info("forwarding to ADK translators: %s", ev.token)
            for translator in self._translators.values():
                translator.push_sentence(ev.token)

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
        frame_count = 0
        async for ev in stream:
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
        name="agent-adk",
        identity="agent-adk",
    )


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
    logger.info("ADK Real-Time Translation Agent active and listening.")

    room_translator = RoomTranslator(ctx.room)
    room_translator.start()


if __name__ == "__main__":
    cli.run_app(server)
