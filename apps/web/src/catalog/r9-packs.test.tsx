// R9 pack pages: the latest mix plays next to its song, hours against a target, the next exams and
// what expires soon, in light and dark · Opus 5.5. The data is the made-up pack cases.
import {
  COMPANY_PACK,
  CaseFile,
  MUSIC_PACK,
  STUDY_PACK,
  packDataset,
  type Entity,
  type Pack,
  type ViewSpec,
} from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import companyCases from '../../../../packages/schema/src/packs/cases/company.json';
import musicCases from '../../../../packages/schema/src/packs/cases/music.json';
import studyCases from '../../../../packages/schema/src/packs/cases/study.json';
import { FilePreview } from '../files/FilePreview';
import { contrastIssues } from '../test/contrast';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const TODAY = '2026-10-13';

function renderCase(pack: Pack, json: unknown, fixture: string) {
  // The pages read "today" from the clock: pin it to the cases' day.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  const file = CaseFile.parse(json);
  const data = packDataset(pack, file.fixtures![fixture]!, TODAY, file.files?.[fixture]);
  const spec: ViewSpec = { component: 'Board', widgets: pack.views[0]!.widgets };
  const result = render(
    <ViewDataProvider
      data={data}
      version={1}
      actions={{ apply: async () => ({ ok: false }), open: vi.fn() }}
    >
      <ViewRenderer spec={spec} />
    </ViewDataProvider>,
  );
  return { ...result, data, text: () => result.container.textContent ?? '' };
}

describe('music page', () => {
  it('lists the latest mix of each song next to its stage, with a play button', () => {
    const { text } = renderCase(MUSIC_PACK, musicCases, 'studio');
    expect(text()).not.toMatch(/failed to render|Unknown component/);
    expect(text()).toMatch(/Night Bus.*Mixing.*Night Bus mix 3.*v3/);
    expect(text()).not.toContain('Night Bus mix 2v2');
    // One play button per latest mix, plus one per audio file in the list of every mix.
    expect(screen.getAllByRole('button', { name: /^Play “Night Bus mix 3”/ })).toHaveLength(2);
    expect(screen.queryAllByRole('button', { name: /^Play “Night Bus mix 1”/ })).toHaveLength(1);
    expect(text()).toMatch(/Total.*12\.5 h/);
    // Songs by stage reads the stage labels, in the stages' own order.
    expect(text()).toMatch(/Songs by stageIdea1Demo1Recording1Mixing1/);
  });

  it('plays a mix in place and stops the one before', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event('pause'));
    });
    const { data } = renderCase(MUSIC_PACK, musicCases, 'studio');
    const night = data.files.find((f) => f.data.title === 'Night Bus mix 3')!;
    const [first] = screen.getAllByRole('button', { name: /^Play “Night Bus mix 3”/ });
    await act(async () => fireEvent.click(first!));
    expect(play).toHaveBeenCalledTimes(1);
    // Every button for that file now says Pause; the src is the file route, by id only.
    expect(screen.getAllByRole('button', { name: /^Pause “Night Bus mix 3”/ })).toHaveLength(2);
    expect((play.mock.contexts[0] as HTMLAudioElement).src).toContain(
      `/api/files/${night.id}/content`,
    );
    await act(async () =>
      fireEvent.click(screen.getAllByRole('button', { name: /^Play “Low Tide demo”/ })[0]!),
    );
    expect(pause).toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { name: /^Pause “Night Bus mix 3”/ })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Pause “Low Tide demo”/ }).length).toBe(2);
    await act(async () =>
      fireEvent.click(screen.getAllByRole('button', { name: /^Pause “Low Tide demo”/ })[0]!),
    );
    expect(screen.queryAllByRole('button', { name: /^Pause/ })).toHaveLength(0);
  });
});

describe('study page', () => {
  it('shows hours against target, a reached target as good news, and the next exams', () => {
    const { text, container } = renderCase(STUDY_PACK, studyCases, 'term');
    expect(text()).not.toMatch(/failed to render|Unknown component/);
    expect(text()).toContain('7.5 h of 40 h');
    expect(text()).toContain('32.5 h to go');
    expect(text()).toContain('Target reached');
    expect(text()).not.toMatch(/ over/);
    expect(text()).toMatch(/Statistics midterm.*in 9 days/);
    expect(text()).not.toContain('Statistics quiz');
    expect(container.querySelector('.bg-chart-bad')).toBeNull();
    expect(container.querySelector('.bg-chart-ok')).not.toBeNull();
  });
});

describe('company documents page', () => {
  it('shows what expires soon and the renewals due', () => {
    const { text } = renderCase(COMPANY_PACK, companyCases, 'papers');
    expect(text()).not.toMatch(/failed to render|Unknown component/);
    expect(text()).toMatch(/Liability policy.*Expired/);
    expect(text()).toMatch(/Office lease.*Expires/);
    expect(text()).toMatch(/Quarterly VAT filing.*3 days late/);
    expect(text()).toContain('City business office');
  });
});

describe('R9 pack pages in dark mode', () => {
  it('have readable text (WCAG AA)', () => {
    for (const [pack, json, fixture] of [
      [MUSIC_PACK, musicCases, 'studio'],
      [STUDY_PACK, studyCases, 'term'],
      [COMPANY_PACK, companyCases, 'papers'],
    ] as const) {
      const { container, unmount } = renderCase(pack, json, fixture);
      expect(contrastIssues(container, 'dark'), pack.name).toEqual([]);
      unmount();
    }
  });
});

describe('audio preview', () => {
  it('plays an audio file in the drawer with the browser controls', () => {
    const file = {
      id: 'file_mix',
      type: 'file',
      data: { title: 'Night Bus mix 3', path: 'music/night.wav' },
    } as Entity<'file'>;
    const { container } = render(<FilePreview file={file} available />);
    const audio = container.querySelector('audio')!;
    expect(audio.getAttribute('src')).toBe('/api/files/file_mix/content');
    expect(audio.hasAttribute('controls')).toBe(true);
    expect(container.textContent).not.toContain('No preview');
  });
});
