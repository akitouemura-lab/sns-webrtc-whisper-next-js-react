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
  | "sending"
  | "recording"
  | "transcribing"
  | "translating"
  | "saved"
  | "stopping"
  | "error";

type NoticeTone = "info" | "success" | "warning" | "error";

type UserNotice = {
  tone: NoticeTone;
  title: string;
  cause: string;
  action: string;
};

type StatusInfo = {
  tone: NoticeTone;
  label: string;
  description: string;
  action: string;
};

type DiagnosticReport = DiagnosticResponse & {
  deviceLabel: string;
  averageLevel: number;
  peakLevel: number;
};

type CaptionDraft = {
  transcript: string;
  translation: string;
};

const QUEUE_WARNING_THRESHOLD = 3;

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

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getErrorNotice(message: string): UserNotice | null {
  if (!message) {
    return null;
  }

  const lower = message.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("request failed: 0")
  ) {
    return {
      tone: "error",
      title: "Backendに接続できません",
      cause: "FastAPIサーバーが起動していない、またはAPIのURLが違う可能性があります。",
      action: "backendを起動し、http://localhost:8000/api/health が開けるか確認してください。"
    };
  }

  if (
    message.includes("Argos") ||
    message.includes("Translation is not ready") ||
    message.includes("default_dependencies")
  ) {
    return {
      tone: "warning",
      title: "翻訳モデルが使えません",
      cause: "Argos Translateの翻訳モデルが未設定、または読み込みに失敗しています。",
      action: "英語から日本語なら en -> ja モデルを入れるか、いったんTranslateをOFFにしてください。"
    };
  }

  if (
    message.includes("Audio level is too low") ||
    message.includes("マイク入力が小さい") ||
    lower.includes("too low")
  ) {
    return {
      tone: "warning",
      title: "マイク入力が小さいです",
      cause: "音量が小さく、Whisperが音声として認識できない可能性があります。",
      action: "Gainを上げる、マイクを近づける、入力デバイスが正しいか確認してください。"
    };
  }

  if (
    message.includes("20MB") ||
    message.includes("too large") ||
    message.includes("413")
  ) {
    return {
      tone: "error",
      title: "音声ファイルが大きすぎます",
      cause: "アップロードできる音声チャンクの上限を超えています。",
      action: "20MB以下になるようにChunk秒数を短くするか、録音し直してください。"
    };
  }

  if (
    lower.includes("decode") ||
    message.includes("Invalid data found") ||
    message.includes("音声処理")
  ) {
    return {
      tone: "error",
      title: "音声処理に失敗しました",
      cause: "ブラウザが作った音声形式をバックエンド側で読み取れなかった可能性があります。",
      action: "ChromeまたはEdgeで再試行し、録音し直してください。"
    };
  }

  if (
    lower.includes("notallowederror") ||
    lower.includes("permission") ||
    message.includes("許可")
  ) {
    return {
      tone: "error",
      title: "マイクの許可が必要です",
      cause: "ブラウザがマイクまたは画面音声へのアクセスを許可していません。",
      action: "アドレスバーの権限設定からマイクを許可し、もう一度録音を開始してください。"
    };
  }

  if (
    message.includes("音声トラックがありません") ||
    lower.includes("device") ||
    message.includes("入力デバイス")
  ) {
    return {
      tone: "warning",
      title: "入力デバイスを確認してください",
      cause: "選択したマイク、または共有した画面・タブに音声が含まれていない可能性があります。",
      action: "Micの選択、画面共有時の音声共有チェック、Discordなど他アプリの入力先を確認してください。"
    };
  }

  if (message.includes("Transcript is required")) {
    return {
      tone: "warning",
      title: "字幕本文が空です",
      cause: "保存するにはtranscriptが必要です。",
      action: "文字起こし欄に1文字以上入力してから保存してください。"
    };
  }

  if (message.includes("マイク入力を解放")) {
    return {
      tone: "info",
      title: "マイク入力を解放しました",
      cause: "このアプリが保持していたマイク入力を停止しました。",
      action: "Discordなど別アプリ側の入力音量も確認してください。"
    };
  }

  return {
    tone: "error",
    title: "処理に失敗しました",
    cause: message,
    action: "設定を確認して再試行してください。うまくいかない場合は録音し直してください。"
  };
}

function getLevelAssessment(averageLevel: number, peakLevel: number): StatusInfo {
  if (peakLevel < 0.08 || averageLevel < 0.015) {
    return {
      tone: "warning",
      label: "小さい",
      description: "入力レベルが低く、音声として認識されにくい状態です。",
      action: "Gainを上げるか、マイクを近づけてください。"
    };
  }

  if (peakLevel > 0.92) {
    return {
      tone: "warning",
      label: "大きすぎる",
      description: "ピークが高く、音割れや誤認識が起きる可能性があります。",
      action: "Gainを少し下げるか、マイクから少し離れてください。"
    };
  }

  return {
    tone: "success",
    label: "良好",
    description: "字幕化しやすい入力レベルです。",
    action: "このまま録音を開始できます。"
  };
}

function getPipelineInfo(
  status: PipelineStatus,
  pendingUploads: number,
  translateEnabled: boolean
): StatusInfo {
  if (pendingUploads >= QUEUE_WARNING_THRESHOLD) {
    return {
      tone: "warning",
      label: "処理待ちあり",
      description: `${pendingUploads}件の音声チャンクが処理待ちです。録音速度に処理が追いついていません。`,
      action: "Chunk秒数を長くする、TranslateをOFFにする、Whisperモデルを小さくする設定を検討してください。"
    };
  }

  if (pendingUploads > 0) {
    return {
      tone: "info",
      label: "処理中",
      description: `${pendingUploads}件の音声チャンクをバックエンドで処理しています。`,
      action: "字幕が反映されるまで少し待ってください。"
    };
  }

  const labels: Record<PipelineStatus, StatusInfo> = {
    idle: {
      tone: "info",
      label: "待機中",
      description: "録音開始を待っています。",
      action: "入力を選び、必要ならマイク診断を実行してください。"
    },
    diagnosing: {
      tone: "info",
      label: "入力デバイス確認中",
      description: "5秒間の診断音声を録音して、入力レベルと認識結果を確認しています。",
      action: "普通の声量で話して、診断が終わるまで待ってください。"
    },
    requesting: {
      tone: "info",
      label: "入力デバイス確認中",
      description: "ブラウザにマイクまたは画面音声の利用許可を確認しています。",
      action: "ブラウザの許可ダイアログが出たら許可してください。"
    },
    sending: {
      tone: "info",
      label: "音声送信中",
      description: "録音した音声チャンクをFastAPIへ送信しています。",
      action: "送信が終わると文字起こしに進みます。"
    },
    recording: {
      tone: "success",
      label: "録音中",
      description: "音声を録音し、数秒ごとに字幕化しています。",
      action: "字幕が出ない場合はマイクレベルと選択デバイスを確認してください。"
    },
    transcribing: {
      tone: "info",
      label: "文字起こし中",
      description: "Whisperで音声をテキスト化しています。",
      action: "処理中はそのまま待ってください。"
    },
    translating: {
      tone: translateEnabled ? "info" : "success",
      label: translateEnabled ? "翻訳中" : "文字起こし保存中",
      description: translateEnabled
        ? "Argos Translateで日本語字幕へ変換しています。"
        : "翻訳はOFFのため、原文字幕を保存しています。",
      action: translateEnabled
        ? "翻訳が遅い場合はTranslateをOFFにできます。"
        : "必要になったらTranslateをONにしてください。"
    },
    saved: {
      tone: "success",
      label: "保存完了",
      description: "字幕をSQLiteへ保存しました。",
      action: "履歴、要約、エクスポートから後で確認できます。"
    },
    stopping: {
      tone: "info",
      label: "停止処理中",
      description: "最後の音声チャンクを閉じて保存しています。",
      action: "数秒待ってから履歴を確認してください。"
    },
    error: {
      tone: "error",
      label: "エラー",
      description: "処理中に問題が発生しました。",
      action: "下のエラー詳細を確認して、対処してから再試行してください。"
    }
  };

  return labels[status];
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
  const [feedback, setFeedback] = useState("");

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
  const hasCaptions = captions.length > 0;
  const primarySubtitle =
    currentCaption?.translation ||
    currentCaption?.transcript ||
    (isRecording ? "音声を待っています" : "まだ字幕はありません");
  const subtitleGuide = currentCaption
    ? currentCaption.translation
      ? currentCaption.transcript
      : "翻訳OFFまたは翻訳待ちのため、原文字幕を表示しています。"
    : "マイクまたは画面音声を選択して録音を開始してください。不安な場合は先にマイク診断を実行できます。";

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

  const showFeedback = useCallback((message: string) => {
    setFeedback(message);
    window.setTimeout(() => {
      setFeedback((current) => (current === message ? "" : current));
    }, 2800);
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

  const pipelineInfo = useMemo(
    () => getPipelineInfo(pipelineStatus, pendingUploads, translateEnabled),
    [pendingUploads, pipelineStatus, translateEnabled]
  );
  const errorNotice = useMemo(() => getErrorNotice(error), [error]);
  const diagnosticAssessment = useMemo(
    () =>
      diagnostic
        ? getLevelAssessment(diagnostic.averageLevel, diagnostic.peakLevel)
        : null,
    [diagnostic]
  );
  const isProcessing =
    pendingUploads > 0 ||
    pipelineStatus === "sending" ||
    pipelineStatus === "transcribing" ||
    pipelineStatus === "translating";
  const activePipelineStep =
    pendingUploads >= QUEUE_WARNING_THRESHOLD ? "queue" : pipelineStatus;
  const pipelineSteps = [
    { key: "idle", label: "待機" },
    { key: "requesting", label: "入力確認" },
    { key: "recording", label: "録音" },
    { key: "sending", label: "送信" },
    { key: "transcribing", label: "文字起こし" },
    { key: "translating", label: "翻訳" },
    { key: "saved", label: "保存" },
    { key: "queue", label: "待ちあり" },
    { key: "error", label: "エラー" }
  ];

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
      setPipelineStatus("sending");
      const transcriptionTimer = window.setTimeout(() => {
        setPipelineStatus("transcribing");
      }, 250);
      const translationTimer = translateEnabled
        ? window.setTimeout(() => {
            setPipelineStatus("translating");
          }, 1200)
        : null;
      return uploadAudioChunk(formData)
        .then((result) => {
          window.clearTimeout(transcriptionTimer);
          if (translationTimer !== null) {
            window.clearTimeout(translationTimer);
          }
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
          setPipelineStatus("saved");
          showFeedback("字幕を保存しました");
          window.setTimeout(() => {
            setPipelineStatus((status) =>
              status === "saved" ? (shouldRecordRef.current ? "recording" : "idle") : status
            );
          }, 900);
        })
        .catch((err: Error) => {
          window.clearTimeout(transcriptionTimer);
          if (translationTimer !== null) {
            window.clearTimeout(translationTimer);
          }
          setPipelineStatus("error");
          setError(err.message);
        })
        .finally(() => {
          setPendingUploads((value) => Math.max(0, value - 1));
        });
    },
    [appendCaption, showFeedback, sourceLanguage, targetLanguage, translateEnabled]
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
    setFeedback("");
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
      showFeedback("録音を開始しました");
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
    } else {
      showFeedback("録音を停止しました");
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
      showFeedback("マイク診断が完了しました");
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
    showFeedback("要約を作成しました");
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
    showFeedback("セッション名を保存しました");
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
      showFeedback("字幕を更新しました");
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
      showFeedback("セッションを削除しました");
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
    showFeedback("単語候補を抽出しました");
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
    showFeedback(`${format.toUpperCase()}を書き出しました`);
  };

  return (
    <main className={`app-shell ${isRecording ? "is-recording" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div>
            <h1>Voice Caption</h1>
            <span>Realtime speech captions</span>
          </div>
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
              <div className="empty-state compact">
                <strong>履歴はまだありません</strong>
                <p>
                  録音を開始すると、字幕と翻訳がセッションとして保存されます。
                </p>
              </div>
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
              <button className="primary record-button" onClick={startRecording}>
                録音開始
              </button>
            ) : (
              <button className="danger record-button" onClick={stopRecording}>
                停止
              </button>
            )}
            <button
              className="secondary"
              onClick={runMicDiagnostic}
              disabled={isRecording || isDiagnosing}
            >
              {isDiagnosing ? "診断中" : "マイク診断"}
            </button>
            <button className="ghost" onClick={releaseMicrophone}>
              マイク解放
            </button>
          </div>
          <div className="mic-meter" aria-label="microphone input level">
            <span style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
        </div>

        <section
          className={`subtitle-stage ${isRecording ? "recording" : ""} ${
            isProcessing ? "processing" : ""
          }`}
        >
          <div className="meta">
            <span>{serviceLine}</span>
            <span className={`status-pill ${pipelineInfo.tone}`}>
              {pipelineInfo.label}
            </span>
            <span>
              mic {formatPercent(micLevel)} / peak {formatPercent(peakMicLevel)}
            </span>
            <span>{captions.length} chunks</span>
          </div>
          <p className="subtitle-text">{primarySubtitle}</p>
          <p className={currentCaption ? "transcript-text" : "subtitle-guide"}>
            {subtitleGuide}
          </p>
          {isProcessing ? <div className="stage-loader" /> : null}
        </section>

        {feedback ? (
          <section className="notice-card success">
            <strong>完了</strong>
            <p>{feedback}</p>
          </section>
        ) : null}

        {errorNotice ? (
          <section className={`notice-card ${errorNotice.tone}`}>
            <strong>{errorNotice.title}</strong>
            <div>
              <span>原因</span>
              <p>{errorNotice.cause}</p>
            </div>
            <div>
              <span>対処</span>
              <p>{errorNotice.action}</p>
            </div>
          </section>
        ) : null}

        <div className="status-grid">
          <section className={`panel status-card ${pipelineInfo.tone}`}>
            <div className="card-heading">
              <span>処理状態</span>
              <strong>{pipelineInfo.label}</strong>
            </div>
            <p>{pipelineInfo.description}</p>
            <p className="advice">{pipelineInfo.action}</p>
            <div className="step-strip" aria-label="pipeline steps">
              {pipelineSteps.map((step) => (
                <span
                  className={step.key === activePipelineStep ? "active" : ""}
                  key={step.key}
                >
                  {step.label}
                </span>
              ))}
            </div>
          </section>

          <section className="panel status-card">
            <div className="card-heading">
              <span>マイク初期診断</span>
              <strong>{diagnosticAssessment?.label ?? "未実行"}</strong>
            </div>
            {diagnostic && diagnosticAssessment ? (
              <div className="diagnostic-result">
                <div className={`level-badge ${diagnosticAssessment.tone}`}>
                  入力レベル: {diagnosticAssessment.label}
                </div>
                <div className="metric-grid">
                  <span>
                    平均レベル
                    <strong>{formatPercent(diagnostic.averageLevel)}</strong>
                  </span>
                  <span>
                    ピークレベル
                    <strong>{formatPercent(diagnostic.peakLevel)}</strong>
                  </span>
                </div>
                <p>{diagnosticAssessment.description}</p>
                <p className="advice">対処: {diagnosticAssessment.action}</p>
                <div className="diagnostic-detail">
                  <span>認識結果: {diagnostic.text || "音声を検出できませんでした"}</span>
                  <span>provider: {diagnostic.provider}</span>
                  <span>device: {diagnostic.deviceLabel}</span>
                  {diagnostic.warning ? (
                    <span>warning: {diagnostic.warning}</span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty-state compact">
                <strong>録音前に確認できます</strong>
                <p>
                  5秒だけ話して、入力レベルとWhisperの認識結果を確認できます。
                </p>
              </div>
            )}
          </section>

          <section
            className={`panel status-card ${
              pendingUploads >= QUEUE_WARNING_THRESHOLD ? "warning" : "info"
            }`}
          >
            <div className="card-heading">
              <span>処理待ちキュー</span>
              <strong>{pendingUploads}件</strong>
            </div>
            <p>
              {pendingUploads
                ? "送信済みの音声チャンクをバックエンドで処理しています。"
                : "処理待ちはありません。"}
            </p>
            {pendingUploads >= QUEUE_WARNING_THRESHOLD ? (
              <ul className="hint-list">
                <li>Chunk秒数を長くする</li>
                <li>TranslateをOFFにする</li>
                <li>Whisperモデルを小さくする</li>
              </ul>
            ) : (
              <p className="advice">録音中に増えすぎる場合は設定を軽くしてください。</p>
            )}
          </section>
        </div>

        <div className="workspace-grid">
          <section className="section">
            <div className="section-header">
              <h2>字幕</h2>
              <div className="button-row compact">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    className="export-button"
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
              <button
                className="secondary"
                onClick={saveSessionTitle}
                disabled={!activeSession}
              >
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
                <div className="empty-state">
                  <strong>まだ字幕はありません</strong>
                  <p>
                    マイクまたは画面音声を選択して、録音を開始してください。
                    英語音声を日本語字幕として保存できます。
                  </p>
                  <p>
                    不安な場合は、先にマイク診断を実行して入力レベルを確認してください。
                  </p>
                </div>
              ) : (
                captions.map((caption) => (
                  <article
                    className={`caption-row ${
                      editingCaptionId === caption.id ? "editing" : ""
                    }`}
                    key={caption.id}
                  >
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
                          <button className="secondary" onClick={cancelCaptionEdit}>
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <strong>{caption.translation || caption.transcript}</strong>
                        {caption.translation ? <p>{caption.transcript}</p> : null}
                        {caption.warning ? <p className="warning">{caption.warning}</p> : null}
                        <div className="button-row compact">
                          <button
                            className="ghost"
                            onClick={() => startCaptionEdit(caption)}
                          >
                            編集
                          </button>
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
              <button className="secondary" onClick={buildSummary} disabled={!captions.length}>
                要約
              </button>
            </div>
            {summary ? (
              <div className="summary-box">{summary}</div>
            ) : (
              <div className="empty-state">
                <strong>要約はまだありません</strong>
                <p>
                  字幕が保存されたあと、通常要約・箇条書き・重要単語・TODOから形式を選んで作成できます。
                </p>
              </div>
            )}

            <div className="section-header">
              <h2>単語帳</h2>
              <button
                className="secondary"
                onClick={loadVocabulary}
                disabled={!captions.length}
              >
                単語抽出
              </button>
            </div>
            <div className="vocabulary-list">
              {vocabulary.length === 0 ? (
                <div className="empty-state">
                  <strong>単語帳はまだありません</strong>
                  <p>
                    英語字幕があるセッションで単語抽出を押すと、頻出語と例文を確認できます。
                  </p>
                </div>
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
              <span>Status: {pipelineInfo.label}</span>
              <span>Session: {sessionId.slice(0, 8)}</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
