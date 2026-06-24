"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Caption,
  DiagnosticResponse,
  ServiceStatus,
  Session,
  VocabularyItem,
  diagnoseAudioChunk,
  deleteSession,
  exportSession,
  getCaptions,
  getHealth,
  getSessions,
  getVocabulary,
  summarizeSession,
  updateCaption,
  updateSessionTitle,
  uploadAudioChunk
} from "@/lib/api";

const LANGUAGES = [
  { code: "auto", label: "Auto" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
  { code: "es", label: "Español" }
];

const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/wav"
];

const SUMMARY_STYLES = [
  { value: "brief", label: "通常要約" },
  { value: "bullets", label: "箇条書き" },
  { value: "keywords", label: "重要単語" },
  { value: "todos", label: "TODO" }
];

const EXPORT_FORMATS = ["txt", "md", "srt", "vtt"];

type CaptureMode = "microphone" | "screen";
type PipelineStatus =
  | "idle"
  | "diagnosing"
  | "requesting"
  | "recording"
  | "transcribing"
  | "stopping"
  | "error";

type DiagnosticReport = DiagnosticResponse & {
  deviceLabel: string;
  averageLevel: number;
  peakLevel: number;
};

type CaptionDraft = {
  transcript: string;
  translation: string;
};

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "voice-caption";
}

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [targetLanguage, setTargetLanguage] = useState("ja");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("microphone");
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [chunkSeconds, setChunkSeconds] = useState(6);
  const [inputGain, setInputGain] = useState(4);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [peakMicLevel, setPeakMicLevel] = useState(0);
  const [summary, setSummary] = useState("");
  const [summaryStyle, setSummaryStyle] = useState("brief");
  const [sessionSearch, setSessionSearch] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [editingCaptionId, setEditingCaptionId] = useState<number | null>(null);
  const [captionDraft, setCaptionDraft] = useState<CaptionDraft>({
    transcript: "",
    translation: ""
  });
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterAnimationRef = useRef<number | null>(null);
  const shouldRecordRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);
  const chunkIndexRef = useRef(0);
  const uploadQueueRef = useRef(Promise.resolve());
  const activeSessionRef = useRef("");

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === sessionId) ?? null,
    [sessionId, sessions]
  );
  const currentCaption = captions.at(-1);
  const primarySubtitle =
    currentCaption?.translation ||
    currentCaption?.transcript ||
    (isRecording ? "音声を待っています" : "録音を開始してください");

  const refreshSessions = useCallback(
    async (query = sessionSearch) => {
      const data = await getSessions(query);
      setSessions(data);
    },
    [sessionSearch]
  );

  const refreshAudioInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioInputDevices(devices.filter((device) => device.kind === "audioinput"));
  }, []);

  useEffect(() => {
    const id = crypto.randomUUID();
    setSessionId(id);
    activeSessionRef.current = id;

    getHealth()
      .then(setServiceStatus)
      .catch((err: Error) => setError(err.message));
    getSessions().then(setSessions).catch((err: Error) => setError(err.message));
    refreshAudioInputDevices().catch(() => undefined);
  }, [refreshAudioInputDevices]);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }
    navigator.mediaDevices.addEventListener("devicechange", refreshAudioInputDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshAudioInputDevices);
    };
  }, [refreshAudioInputDevices]);

  useEffect(() => {
    activeSessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshSessions().catch((err: Error) => setError(err.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [refreshSessions]);

  useEffect(() => {
    if (activeSession) {
      setEditingTitle(activeSession.title);
    }
  }, [activeSession]);

  const serviceLine = useMemo(() => {
    if (!serviceStatus) {
      return "サービス確認中";
    }
    const whisper = serviceStatus.whisper.available ? "Whisper ready" : "Whisper mock";
    const translation = translateEnabled
      ? serviceStatus.translation.available
        ? "Argos ready"
        : "翻訳未設定"
      : "翻訳OFF";
    return `${whisper} / ${translation}`;
  }, [serviceStatus, translateEnabled]);

  const pipelineLabel = useMemo(() => {
    const labels: Record<PipelineStatus, string> = {
      idle: "待機中",
      diagnosing: "マイク診断中",
      requesting: "入力デバイス確認中",
      recording: "録音中",
      transcribing: "文字起こし中",
      stopping: "停止処理中",
      error: "エラー"
    };
    if (pendingUploads >= 3) {
      return "処理待ちが増えています";
    }
    if (pendingUploads > 0) {
      return `文字起こし中 (${pendingUploads}件)`;
    }
    return labels[pipelineStatus];
  }, [pendingUploads, pipelineStatus]);

  const appendCaption = useCallback((caption: Caption) => {
    setCaptions((items) => {
      const next = [...items, caption];
      next.sort((a, b) => a.chunk_index - b.chunk_index || a.id - b.id);
      return next;
    });
  }, []);

  const uploadChunk = useCallback(
    (blob: Blob, index: number) => {
      const formData = new FormData();
      const extension = blob.type.includes("mp4") ? "mp4" : "webm";
      formData.append("file", blob, `chunk-${index}.${extension}`);
      formData.append("session_id", activeSessionRef.current);
      formData.append("chunk_index", String(index));
      formData.append("source_language", sourceLanguage);
      formData.append("target_language", targetLanguage);
      formData.append("translate", String(translateEnabled));

      setPendingUploads((value) => value + 1);
      setPipelineStatus("transcribing");
      return uploadAudioChunk(formData)
        .then((result) => {
          appendCaption(result.caption);
          setSessions((items) => {
            const rest = items.filter((item) => item.id !== result.session.id);
            return [result.session, ...rest];
          });
          if (result.caption.warning) {
            setError(result.caption.warning);
            if (
              result.caption.warning.includes("Argos Translate failed") ||
              result.caption.warning.includes("Translation is not ready")
            ) {
              setTranslateEnabled(false);
            }
          }
        })
        .catch((err: Error) => {
          setPipelineStatus("error");
          setError(err.message);
        })
        .finally(() => {
          setPendingUploads((value) => Math.max(0, value - 1));
          if (shouldRecordRef.current) {
            setPipelineStatus("recording");
          } else {
            setPipelineStatus("idle");
          }
        });
    },
    [appendCaption, sourceLanguage, targetLanguage, translateEnabled]
  );

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const stopMicMeter = () => {
    if (meterAnimationRef.current !== null) {
      window.cancelAnimationFrame(meterAnimationRef.current);
      meterAnimationRef.current = null;
    }
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setMicLevel(0);
  };

  const stopMediaTracks = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    streamRef.current = null;
  };

  const releaseMicrophone = () => {
    shouldRecordRef.current = false;
    clearRecordingTimer();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.requestData();
      recorder.stop();
    } else {
      stopMediaTracks();
      stopMicMeter();
    }
    recorderRef.current = null;
    setIsRecording(false);
    setPipelineStatus("idle");
    setError("マイク入力を解放しました。Discord側の入力音量も確認してください。");
  };

  const startAudioPipeline = (stream: MediaStream) => {
    stopMicMeter();
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      return stream;
    }

    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(stream);
    const gain = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    const destination = audioContext.createMediaStreamDestination();

    gain.gain.value = inputGain;
    analyser.fftSize = 1024;
    source.connect(gain);
    gain.connect(destination);
    gain.connect(analyser);
    audioContextRef.current = audioContext;

    const data = new Uint8Array(analyser.fftSize);
    const updateLevel = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = value - 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length) / 128;
      const nextLevel = Math.min(1, rms * 5);
      setMicLevel(nextLevel);
      setPeakMicLevel((currentPeak) => Math.max(currentPeak, nextLevel));
      meterAnimationRef.current = window.requestAnimationFrame(updateLevel);
    };
    updateLevel();
    return destination.stream;
  };

  const startSegment = useCallback(
    (stream: MediaStream, mimeType: string | undefined) => {
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearRecordingTimer();
        if (chunks.length) {
          const index = chunkIndexRef.current;
          chunkIndexRef.current += 1;
          const blob = new Blob(chunks, {
            type: recorder.mimeType || mimeType || "audio/webm"
          });
          uploadQueueRef.current = uploadQueueRef.current.then(() =>
            uploadChunk(blob, index)
          );
        }

        if (shouldRecordRef.current && stream.active) {
          window.setTimeout(() => startSegment(stream, mimeType), 0);
          return;
        }

        stopMediaTracks();
        stopMicMeter();
      };

      recorderRef.current = recorder;
      recorder.start();
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.requestData();
          recorder.stop();
        }
      }, chunkSeconds * 1000);
    },
    [chunkSeconds, uploadChunk]
  );

  const getMicrophoneConstraints = (): MediaTrackConstraints => {
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };
    if (selectedDeviceId) {
      audioConstraints.deviceId = { exact: selectedDeviceId };
    }
    return audioConstraints;
  };

  const startRecording = async () => {
    setError("");
    setSummary("");
    setVocabulary([]);
    setDiagnostic(null);
    setEditingCaptionId(null);
    setCaptionDraft({ transcript: "", translation: "" });
    setCaptions([]);
    setPeakMicLevel(0);
    setPipelineStatus("requesting");
    const nextSessionId = crypto.randomUUID();
    setSessionId(nextSessionId);
    activeSessionRef.current = nextSessionId;
    chunkIndexRef.current = 0;
    uploadQueueRef.current = Promise.resolve();

    if (!navigator.mediaDevices?.getUserMedia) {
      setPipelineStatus("error");
      setError("このブラウザではマイク録音を利用できません。");
      return;
    }

    try {
      let stream: MediaStream;
      if (captureMode === "screen") {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        displayStream.getVideoTracks().forEach((track) => track.stop());
        const audioTracks = displayStream.getAudioTracks();
        if (!audioTracks.length) {
          throw new Error("共有された画面またはタブに音声トラックがありません。");
        }
        stream = new MediaStream(audioTracks);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: getMicrophoneConstraints()
        });
      }
      const mimeType = pickMimeType();
      const recordingStream = startAudioPipeline(stream);
      shouldRecordRef.current = true;
      streamRef.current = stream;
      recordingStreamRef.current = recordingStream;
      await refreshAudioInputDevices();
      startSegment(recordingStream, mimeType);
      setIsRecording(true);
      setPipelineStatus("recording");
    } catch (err) {
      setPipelineStatus("error");
      setError(err instanceof Error ? err.message : "録音を開始できませんでした。");
    }
  };

  const stopRecording = () => {
    shouldRecordRef.current = false;
    clearRecordingTimer();
    setPipelineStatus("stopping");
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.requestData();
      recorder.stop();
    } else {
      stopMediaTracks();
      stopMicMeter();
    }
    recorderRef.current = null;
    setIsRecording(false);
    if (peakMicLevel < 0.08) {
      setError("マイク入力が小さいため認識できない可能性があります。入力デバイスとGainを確認してください。");
    }
    refreshSessions().catch((err: Error) => setError(err.message));
  };

  const runMicDiagnostic = async () => {
    if (isRecording || isDiagnosing) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("このブラウザではマイク診断を利用できません。");
      return;
    }

    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let levelTimer: number | null = null;
    let peakLevel = 0;
    let levelTotal = 0;
    let levelSamples = 0;

    try {
      setError("");
      setDiagnostic(null);
      setIsDiagnosing(true);
      setPipelineStatus("diagnosing");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: getMicrophoneConstraints()
      });
      await refreshAudioInputDevices();

      const AudioContextConstructor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioContextConstructor) {
        audioContext = new AudioContextConstructor();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        levelTimer = window.setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const value of data) {
            const centered = value - 128;
            sum += centered * centered;
          }
          const level = Math.min(1, Math.sqrt(sum / data.length) / 128 * 5);
          peakLevel = Math.max(peakLevel, level);
          levelTotal += level;
          levelSamples += 1;
        }, 80);
      }

      const mimeType = pickMimeType();
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size) {
            chunks.push(event.data);
          }
        };
        recorder.onerror = () => reject(new Error("診断用の録音に失敗しました。"));
        recorder.onstop = () => {
          resolve(
            new Blob(chunks, {
              type: recorder.mimeType || mimeType || "audio/webm"
            })
          );
        };
      });
      recorder.start();
      await wait(5000);
      if (recorder.state === "recording") {
        recorder.requestData();
        recorder.stop();
      }
      const blob = await stopped;
      const formData = new FormData();
      const extension = blob.type.includes("mp4") ? "mp4" : "webm";
      formData.append("file", blob, `diagnostic.${extension}`);
      formData.append("source_language", sourceLanguage);
      const result = await diagnoseAudioChunk(formData);
      const selectedDevice = audioInputDevices.find(
        (device) => device.deviceId === selectedDeviceId
      );
      setDiagnostic({
        ...result,
        deviceLabel: selectedDevice?.label || "Default microphone",
        averageLevel: levelSamples ? levelTotal / levelSamples : 0,
        peakLevel
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "マイク診断に失敗しました。");
      setPipelineStatus("error");
    } finally {
      if (levelTimer !== null) {
        window.clearInterval(levelTimer);
      }
      stream?.getTracks().forEach((track) => track.stop());
      audioContext?.close().catch(() => undefined);
      setIsDiagnosing(false);
      if (!shouldRecordRef.current) {
        setPipelineStatus("idle");
      }
    }
  };

  const loadSession = async (id: string) => {
    setError("");
    setSummary("");
    setVocabulary([]);
    setDiagnostic(null);
    setEditingCaptionId(null);
    setCaptionDraft({ transcript: "", translation: "" });
    setSessionId(id);
    activeSessionRef.current = id;
    const data = await getCaptions(id);
    setCaptions(data);
    const selected = sessions.find((item) => item.id === id);
    setSummary(selected?.summary ?? "");
    setEditingTitle(selected?.title ?? "");
  };

  const buildSummary = async () => {
    setError("");
    const result = await summarizeSession(sessionId, summaryStyle);
    setSummary(result.summary);
    await refreshSessions();
  };

  const saveSessionTitle = async () => {
    if (!activeSession || !editingTitle.trim()) {
      return;
    }
    const updated = await updateSessionTitle(activeSession.id, editingTitle.trim());
    setSessions((items) =>
      items.map((item) => (item.id === updated.id ? updated : item))
    );
  };

  const startCaptionEdit = (caption: Caption) => {
    setEditingCaptionId(caption.id);
    setCaptionDraft({
      transcript: caption.transcript,
      translation: caption.translation ?? ""
    });
  };

  const cancelCaptionEdit = () => {
    setEditingCaptionId(null);
    setCaptionDraft({ transcript: "", translation: "" });
  };

  const saveCaptionEdit = async (captionId: number) => {
    const transcript = captionDraft.transcript.trim();
    if (!transcript) {
      setError("Transcript is required.");
      return;
    }
    setError("");
    try {
      const updated = await updateCaption(captionId, {
        transcript,
        translation: captionDraft.translation.trim() || null
      });
      setCaptions((items) =>
        items.map((item) => (item.id === updated.id ? updated : item))
      );
      cancelCaptionEdit();
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caption could not be saved.");
    }
  };

  const removeActiveSession = async () => {
    if (!activeSession || isRecording || isDeletingSession) {
      return;
    }
    const confirmed = window.confirm(
      `Delete "${activeSession.title}" and its captions?`
    );
    if (!confirmed) {
      return;
    }
    setError("");
    setIsDeletingSession(true);
    try {
      await deleteSession(activeSession.id);
      const nextSessionId = crypto.randomUUID();
      setSessionId(nextSessionId);
      activeSessionRef.current = nextSessionId;
      setCaptions([]);
      setSummary("");
      setVocabulary([]);
      setDiagnostic(null);
      setEditingTitle("");
      cancelCaptionEdit();
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session could not be deleted.");
    } finally {
      setIsDeletingSession(false);
    }
  };

  const loadVocabulary = async () => {
    setError("");
    const items = await getVocabulary(sessionId);
    setVocabulary(items);
  };

  const downloadExport = async (format: string) => {
    if (!activeSession) {
      return;
    }
    setError("");
    const blob = await exportSession(activeSession.id, format);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(activeSession.title)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const errorClassName =
    error.includes("mock") ||
    error.includes("skipped") ||
    error.includes("could not decode") ||
    error.includes("Argos") ||
    error.includes("Translation is not ready") ||
    error.includes("Audio level is too low") ||
    error.includes("マイク入力を解放")
      ? "warning"
      : "error";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Voice Caption</h1>
          <span className={`status-dot ${isRecording ? "recording" : ""}`} />
        </div>

        <div className="section">
          <div className="section-header">
            <h2>履歴</h2>
            <button onClick={() => refreshSessions()}>更新</button>
          </div>
          <label className="field">
            <span>検索</span>
            <input
              type="search"
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
              placeholder="タイトル・字幕を検索"
            />
          </label>
          <div className="session-list">
            {sessions.length === 0 ? (
              <div className="empty">履歴はまだありません</div>
            ) : (
              sessions.map((session) => (
                <button
                  className={`session-row ${session.id === sessionId ? "active" : ""}`}
                  key={session.id}
                  onClick={() => loadSession(session.id)}
                >
                  <strong>{session.title}</strong>
                  <span>
                    {formatTime(session.updated_at)} / {session.caption_count} chunks
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <section className="main">
        <div className="controls panel">
          <div className="field-grid">
            <label className="field">
              <span>Source</span>
              <select
                value={sourceLanguage}
                onChange={(event) => setSourceLanguage(event.target.value)}
                disabled={isRecording}
              >
                {LANGUAGES.map((language) => (
                  <option value={language.code} key={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Input</span>
              <select
                value={captureMode}
                onChange={(event) =>
                  setCaptureMode(event.target.value as CaptureMode)
                }
                disabled={isRecording}
              >
                <option value="microphone">Microphone</option>
                <option value="screen">Screen / tab audio</option>
              </select>
            </label>
            <label className="field">
              <span>Mic</span>
              <select
                value={selectedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
                disabled={isRecording || captureMode === "screen"}
              >
                <option value="">Default</option>
                {audioInputDevices.map((device, index) => (
                  <option value={device.deviceId} key={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Target</span>
              <select
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
                disabled={isRecording}
              >
                {LANGUAGES.filter((language) => language.code !== "auto").map(
                  (language) => (
                    <option value={language.code} key={language.code}>
                      {language.label}
                    </option>
                  )
                )}
              </select>
            </label>
            <label className="field">
              <span>Chunk</span>
              <input
                type="number"
                min={3}
                max={8}
                value={chunkSeconds}
                onChange={(event) => setChunkSeconds(Number(event.target.value))}
                disabled={isRecording}
              />
            </label>
            <label className="field">
              <span>Gain {inputGain.toFixed(1)}x</span>
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={inputGain}
                onChange={(event) => setInputGain(Number(event.target.value))}
                disabled={isRecording}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={translateEnabled}
                onChange={(event) => setTranslateEnabled(event.target.checked)}
                disabled={isRecording}
              />
              <span>Translate</span>
            </label>
          </div>

          <div className="button-row">
            {!isRecording ? (
              <button className="primary" onClick={startRecording}>
                録音開始
              </button>
            ) : (
              <button className="danger" onClick={stopRecording}>
                停止
              </button>
            )}
            <button onClick={runMicDiagnostic} disabled={isRecording || isDiagnosing}>
              {isDiagnosing ? "診断中" : "マイク診断"}
            </button>
            <button onClick={releaseMicrophone}>マイク解放</button>
          </div>
          <div className="mic-meter" aria-label="microphone input level">
            <span style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
        </div>

        <section className="subtitle-stage">
          <div className="meta">
            <span>{serviceLine}</span>
            <span>{pipelineLabel}</span>
            <span>
              mic {Math.round(micLevel * 100)}% / peak {Math.round(peakMicLevel * 100)}%
            </span>
            <span>{captions.length} chunks</span>
          </div>
          <p className="subtitle-text">{primarySubtitle}</p>
          {currentCaption?.translation ? (
            <p className="transcript-text">{currentCaption.transcript}</p>
          ) : null}
        </section>

        {error ? <p className={errorClassName}>{error}</p> : null}
        {pendingUploads >= 3 ? (
          <p className="warning">
            Whisper処理が録音に追いついていません。Chunkを長くするか、翻訳をOFFにしてください。
          </p>
        ) : null}

        <div className="status-grid">
          <section className="panel status-panel">
            <strong>マイク初期診断</strong>
            <span>録音前に5秒だけテストして、選択中のマイクと認識結果を確認できます。</span>
            {diagnostic ? (
              <div className="diagnostic-result">
                <span>Device: {diagnostic.deviceLabel}</span>
                <span>
                  level avg {Math.round(diagnostic.averageLevel * 100)}% / peak{" "}
                  {Math.round(diagnostic.peakLevel * 100)}%
                </span>
                <span>
                  Result: {diagnostic.text} ({diagnostic.language}, {diagnostic.provider})
                </span>
                {diagnostic.warning ? (
                  <span className="warning">{diagnostic.warning}</span>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="panel status-panel">
            <strong>処理待ちキュー</strong>
            <span>送信・文字起こし中: {pendingUploads} 件</span>
            <span>{pendingUploads ? "バックエンド処理中です" : "処理待ちはありません"}</span>
          </section>
        </div>

        <div className="workspace-grid">
          <section className="section">
            <div className="section-header">
              <h2>字幕</h2>
              <div className="button-row compact">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    key={format}
                    onClick={() => downloadExport(format)}
                    disabled={!activeSession || !captions.length}
                  >
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="session-tools panel">
              <label className="field title-field">
                <span>セッション名</span>
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  placeholder="例: 英語面接練習"
                  disabled={!activeSession}
                />
              </label>
              <button onClick={saveSessionTitle} disabled={!activeSession}>
                名前を保存
              </button>
              <button
                className="danger"
                onClick={removeActiveSession}
                disabled={!activeSession || isRecording || isDeletingSession}
              >
                {isDeletingSession ? "削除中" : "削除"}
              </button>
            </div>

            <div className="caption-list">
              {captions.length === 0 ? (
                <div className="empty">録音を開始してください</div>
              ) : (
                captions.map((caption) => (
                  <article className="caption-row" key={caption.id}>
                    <div className="row-meta">
                      <span>#{caption.chunk_index + 1}</span>
                      <span>{caption.provider}</span>
                      <span>{caption.source_language}</span>
                    </div>
                    {editingCaptionId === caption.id ? (
                      <div className="caption-editor">
                        <label className="field">
                          <span>Transcript</span>
                          <textarea
                            value={captionDraft.transcript}
                            onChange={(event) =>
                              setCaptionDraft((draft) => ({
                                ...draft,
                                transcript: event.target.value
                              }))
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Translation</span>
                          <textarea
                            value={captionDraft.translation}
                            onChange={(event) =>
                              setCaptionDraft((draft) => ({
                                ...draft,
                                translation: event.target.value
                              }))
                            }
                          />
                        </label>
                        <div className="button-row compact">
                          <button
                            className="primary"
                            onClick={() => saveCaptionEdit(caption.id)}
                          >
                            保存
                          </button>
                          <button onClick={cancelCaptionEdit}>キャンセル</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <strong>{caption.translation || caption.transcript}</strong>
                        {caption.translation ? <p>{caption.transcript}</p> : null}
                        {caption.warning ? <p className="warning">{caption.warning}</p> : null}
                        <div className="button-row compact">
                          <button onClick={() => startCaptionEdit(caption)}>編集</button>
                        </div>
                      </>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <h2>要約</h2>
            </div>
            <div className="summary-controls panel">
              <label className="field">
                <span>種類</span>
                <select
                  value={summaryStyle}
                  onChange={(event) => setSummaryStyle(event.target.value)}
                >
                  {SUMMARY_STYLES.map((style) => (
                    <option value={style.value} key={style.value}>
                      {style.label}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={buildSummary} disabled={!captions.length}>
                要約
              </button>
            </div>
            <div className="summary-box">
              {summary || "要約はまだありません。"}
            </div>

            <div className="section-header">
              <h2>単語帳</h2>
              <button onClick={loadVocabulary} disabled={!captions.length}>
                単語抽出
              </button>
            </div>
            <div className="vocabulary-list">
              {vocabulary.length === 0 ? (
                <div className="empty">英語字幕から単語候補を抽出できます</div>
              ) : (
                vocabulary.map((item) => (
                  <article className="vocabulary-row" key={item.term}>
                    <strong>{item.term}</strong>
                    <span>{item.count}回</span>
                    <p>{item.example}</p>
                  </article>
                ))
              )}
            </div>

            <div className="service-box">
              <strong>Service</strong>
              <span>{serviceLine}</span>
              <span>Status: {pipelineLabel}</span>
              <span>Session: {sessionId.slice(0, 8)}</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
