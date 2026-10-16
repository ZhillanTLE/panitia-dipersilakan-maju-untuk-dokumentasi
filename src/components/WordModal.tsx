import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { lookupKbbi, type KbbiEntry } from '../lib/kbbi';
import { getGoogleTtsApiKey, playIndonesianSpeech, stopSpeech, type TtsSource } from '../lib/tts';
import { IconClose, IconVolume } from './Icons';
import './WordModal.css';

export interface WordModalProps {
  word: string | null;
  anchor?: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function WordModal({ word, anchor, open, onClose, onMouseEnter, onMouseLeave }: WordModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [usedSource, setUsedSource] = useState<TtsSource | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const titleId = useId();

  const entry: KbbiEntry | null = word ? lookupKbbi(word) : null;
  const hasApiKey = Boolean(getGoogleTtsApiKey());

  // Reset states when word changes or modal closes
  useEffect(() => {
    if (!open) {
      stopSpeech();
      setPlaying(false);
      setLoading(false);
      setErrorMsg(null);
      setUsedSource(null);
    }
  }, [open, word]);

  // Position the modal directly above the anchor word ("di atas katanya")
  useLayoutEffect(() => {
    if (!open || !anchor || !modalRef.current) return;
    const modal = modalRef.current;

    const place = () => {
      const a = anchor.getBoundingClientRect();
      const width = modal.offsetWidth;
      const height = modal.offsetHeight;

      // Center horizontally on anchor word, clamp inside viewport margins
      let left = a.left + a.width / 2 - width / 2;
      left = Math.min(Math.max(left, 16), window.innerWidth - width - 16);

      // Arrow position relative to modal left edge
      const arrowX = Math.min(Math.max(a.left + a.width / 2 - left, 16), width - 16);

      // Default: placement ABOVE the word
      let top = a.top - height - 12;
      let placement: 'top' | 'bottom' = 'top';

      // If not enough room above, flip below the word
      if (top < 12) {
        top = a.bottom + 12;
        placement = 'bottom';
      }

      modal.style.left = `${left}px`;
      modal.style.top = `${top}px`;
      modal.style.setProperty('--arrow', `${arrowX}px`);
      modal.dataset.placement = placement;
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, word]);

  // Handle escape key and pointerdown outside
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (
        modalRef.current &&
        !modalRef.current.contains(target) &&
        (!anchor || !anchor.contains(target))
      ) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, anchor, onClose]);

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

  if (!open || !entry) return null;

  return (
    <div
      ref={modalRef}
      className="word-modal"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ '--arrow': '50%' } as CSSProperties}
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
          <IconClose size={18} />
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
        <span className="word-modal__tip">Ketuk tombol untuk mendengarkan lafal</span>
        <button type="button" className="word-modal__done-btn" onClick={onClose}>
          Tutup
        </button>
      </footer>
    </div>
  );
}
