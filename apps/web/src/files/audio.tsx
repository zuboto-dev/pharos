import { fileTypeOf, fileUrl } from '@pharos/schema';
import clsx from 'clsx';
import { Pause, Play } from 'lucide-react';
import { useSyncExternalStore } from 'react';

// Audio plays in place (R9): a mix next to its song, a row in a FileList, the file drawer and a
// FileView. One player for the whole page, so starting a mix stops the one before. The audio
// comes from the same file route as every preview (ids only, a mime type from FILE_TYPES).

/** Whether a project file plays in place (wav, mp3, m4a, ogg, flac). */
export function isAudio(path: string): boolean {
  return fileTypeOf(path).preview === 'audio';
}

type State = { fileId: string | null; playing: boolean };

let audio: HTMLAudioElement | null = null;
let state: State = { fileId: null, playing: false };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function player(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('play', () => set({ ...state, playing: true }));
  audio.addEventListener('pause', () => set({ ...state, playing: false }));
  audio.addEventListener('ended', () => set({ ...state, playing: false }));
  audio.addEventListener('error', () => set({ ...state, playing: false }));
  return audio;
}

/** Plays a file, or pauses it when it is the one playing. */
export function toggle(fileId: string) {
  const a = player();
  if (state.fileId === fileId) {
    if (!state.playing) void a.play().catch(() => set({ ...state, playing: false }));
    else a.pause();
    return;
  }
  a.pause();
  a.src = fileUrl('content', fileId);
  set({ fileId, playing: false });
  void a.play().catch(() => set({ ...state, playing: false }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether this file is the one playing now. */
export function usePlaying(fileId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.fileId === fileId && state.playing,
    () => false,
  );
}

/** A round play/pause button for one audio file. */
export function PlayButton({
  fileId,
  title,
  className,
}: {
  fileId: string;
  title: string;
  className?: string;
}) {
  const playing = usePlaying(fileId);
  const Icon = playing ? Pause : Play;
  return (
    <button
      type="button"
      aria-pressed={playing}
      aria-label={`${playing ? 'Pause' : 'Play'} “${title}”`}
      title={`${playing ? 'Pause' : 'Play'} “${title}”`}
      onClick={(e) => {
        e.stopPropagation();
        toggle(fileId);
      }}
      className={clsx(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        playing
          ? 'border-accent bg-accent text-on-inverse'
          : 'border-line-strong bg-surface text-accent-strong hover:border-accent',
        className,
      )}
    >
      <Icon className={clsx('size-3.5', !playing && 'translate-x-px')} aria-hidden />
    </button>
  );
}

/** The file drawer's and a FileView's preview of an audio file: the browser's own controls. */
export function AudioPreview({ fileId, title }: { fileId: string; title: string }) {
  return (
    <div className="rounded-lg border border-line bg-sunken p-3">
      <audio
        controls
        preload="metadata"
        src={fileUrl('content', fileId)}
        aria-label={`Play “${title}”`}
        className="w-full"
      >
        This browser can’t play this audio file; download it to listen.
      </audio>
    </div>
  );
}
