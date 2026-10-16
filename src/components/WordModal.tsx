import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { lookupKbbi, type KbbiEntry } from '../lib/kbbi';
import { getGoogleTtsApiKey, playIndonesianSpeech, stopSpeech, type TtsSource } from '../lib/tts';
import { IconClose, IconVolume } from './Icons';
import './WordModal.css';

export interface WordModalProps {
  word: string | null;
  open: boolean;
  onClose: () => void;
}

export function WordModal({ word, open, onClose }: WordModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [usedSource, setUsedSource] = useState<TtsSource | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const titleId = useId();

  const entry: KbbiEntry | null = word ? lookupKbbi(word) : null;
  const hasApiKey = Boolean(getGoogleTtsApiKey());

  // Handle open/close with native <dialog>
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setErrorMsg(null);
      setUsedSource(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      stopSpeech();
      setPlaying(false);
      setLoading(false);
      dialog.close();
    }
  }, [open]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  const handlePlayAudio = useCallback(async () => {
    if (!word || loading) return;
    setErrorMsg(null);
    setLoading(true);

    try {
      const result = await playIndonesianSpeech(word, () => {
        setPlaying(false);
      });
      setUsedSource(result.source);
      setPlaying(true);
    } catch (err) {
      setPlaying(false);
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memutar audio');
    } finally {
      setLoading(false);
    }
  }, [word, loading]);

  if (!entry) return null;

  return (
    <dialog
      ref={dialogRef}
      className="word-modal"
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby={titleId}
    >
      <header className="word-modal__head">
        <div className="word-modal__badge-group">
          <span className="word-modal__tag">KBBI</span>
          <span className="word-modal__class" title={entry.wordClass}>
            {entry.classAbbr ? `[${entry.classAbbr}] ${entry.wordClass}` : entry.wordClass}
          </span>
        </div>
        <button
          type="button"
          className="word-modal__close-btn"
          onClick={onClose}
          aria-label="Tutup jendela pop-up"
        >
          <IconClose size={20} />
        </button>
      </header>

      <section className="word-modal__body">
        {/* Clickable word button for speech pronunciation */}
        <button
          id={titleId}
          type="button"
          className={`word-modal__word-btn${playing ? ' word-modal__word-btn--playing' : ''}${loading ? ' word-modal__word-btn--loading' : ''}`}
          onClick={handlePlayAudio}
          title="Klik untuk mendengarkan pelafalan baku"
        >
          <span className="word-modal__word-text">{entry.word}</span>
          <span className="word-modal__speaker-chip" aria-hidden="true">
            <IconVolume size={18} />
            <span className="word-modal__speaker-label">
              {loading ? 'Memuat...' : playing ? 'Memutar...' : 'Lafalkan'}
            </span>
          </span>
        </button>

        {/* Syllable and spelling */}
        <div className="word-modal__spelling-row">
          <span className="word-modal__spelling-label">Ejaan baku:</span>
          <span className="word-modal__spelling-dots">{entry.spelling}</span>
          {entry.lemma !== entry.word && (
            <span className="word-modal__lemma-hint">(bentuk dasar: {entry.lemma})</span>
          )}
        </div>

        {/* Definition */}
        <div className="word-modal__definition-card">
          <h4 className="word-modal__def-title">Arti kata (KBBI)</h4>
          <p className="word-modal__meaning">{entry.meaning}</p>
          {entry.example && (
            <p className="word-modal__example">
              <span className="word-modal__example-lead">Contoh: </span>
              <em>{entry.example}</em>
            </p>
          )}
        </div>

        {/* Audio engine indicator */}
        <div className="word-modal__engine-info">
          <div className="word-modal__engine-meta">
            <span className="word-modal__dot-online" aria-hidden="true" />
            <span className="word-modal__engine-text">
              {usedSource === 'google' || hasApiKey
                ? 'Google Cloud TTS (id-ID-Neural2-A)'
                : 'Web Speech Synthesis (id-ID)'}
            </span>
          </div>
          {errorMsg && <p className="word-modal__error-msg">{errorMsg}</p>}
        </div>
      </section>

      <footer className="word-modal__foot">
        <span className="word-modal__tip">Ketuk kata untuk mendengarkan suara pelafalan</span>
        <button type="button" className="btn btn--action" onClick={onClose}>
          Selesai
        </button>
      </footer>
    </dialog>
  );
}
