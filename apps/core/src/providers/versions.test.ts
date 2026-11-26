import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../prefs.ts';
import { parseTorrentioRelease } from './torrentio.ts';
import { describeVersion, rankVersions } from './versions.ts';

const s = (title: string, cached = true) => ({ url: `https://x/${title}`, title, quality: 0, cached });

describe('rankVersions', () => {
  const streams = [s('Film 2160p UpScaled WEB-DL'), s('Film 1080p BluRay x264'), s('Film 2160p REMUX HEVC'), s('Film 2160p CAM')];
  it('drops cams and upscales and puts the best native version first', () => {
    const out = rankVersions(streams, { prefs: { ...DEFAULT_PREFS, quality: 'original' }, originalLanguage: null, runtime: null, maxHeight: 2160 });
    expect(out.map(r => r.stream.title)).toEqual(['Film 2160p REMUX HEVC', 'Film 1080p BluRay x264']);
    expect(out[0]!.version.recommended).toBe(true);
  });
  it('respects the height cap', () => {
    const out = rankVersions(streams, { prefs: { ...DEFAULT_PREFS, quality: 'original' }, originalLanguage: null, runtime: null, maxHeight: 1080 });
    expect(out.map(r => r.stream.title)).toEqual(['Film 1080p BluRay x264']);
  });
  it('prefers the original language when asked', () => {
    const out = rankVersions([s('Film 1080p ENGLISH'), s('Film 2160p FRENCH')],
      { prefs: { ...DEFAULT_PREFS, quality: 'original', audioLanguage: 'original' }, originalLanguage: 'fra', runtime: null, maxHeight: 2160 });
    expect(out.map(r => r.stream.title)).toEqual(['Film 2160p FRENCH', 'Film 1080p ENGLISH']);
  });
});

const release = (title: string, name = 'Torrentio\n4k', tags = '') => parseTorrentioRelease({
  name, title: tags ? `${title}\n${tags}` : title,
});
const options = { prefs: DEFAULT_PREFS, originalLanguage: 'eng', runtime: 7200, maxHeight: 2160 };

describe('Torrentio catalogue releases', () => {
  it('puts the high-bitrate Interstellar REMUX ahead of smaller English encodes and foreign dubs', () => {
    const remux = release('Interstellar 2014 2160p PROPER IMAX REMUX DV HDR10+ TrueHD 7.1 Atmos-jennaortegaUHD',
      'Torrentio\n4k DV | HDR10+', '💾 95.63 GB');
    const encode = release('Interstellar 2014 2160p AV1 HDR10 EN/ITA/FR/ES OPUS 5.1-UH [UserHEVC]',
      'Torrentio\n4k HDR', '💾 16.87 GB\n🇬🇧 / 🇮🇹 / 🇪🇸 / 🇫🇷');
    const dub = release('Interstellar 2014 2160p FRENCH', 'Torrentio\n4k', '🇫🇷');
    const list = [dub, encode, remux];
    expect(rankVersions(list, { ...options, originalLanguage: null }).map(row => row.stream)).toEqual([remux, encode, dub]);
    expect(rankVersions(list, { ...options, client: { player: 'mpv' } })[0]?.version)
      .toMatchObject({ height: 2160, source: 'remux', hdr: 'dv', audio: { atmos: true } });
  });

  it('recognizes Dune: Part Two BDRemux and keeps its multilingual audio in browser rankings', () => {
    const original = release('Дюна: Часть вторая / Dune: Part Two [2024 UHD BDRemux 2160p HDR10 Dolby Vision] 4x Dub (Bravo Records Georgia RHS Jaskier HDrezka) + 3x MVO + AVO (Юрий Сербин) + VO + Dub Ukr + Sub Rus Ukr Eng Multi 4 + Original Eng',
      'Torrentio\n4k DV | HDR', '💾 69.35 GB\nMulti Audio / 🇬🇧 / 🇷🇺 / 🇺🇦');
    const web = release('Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX[TGx]');
    const client = { player: 'html5' as const, hdr: false, hevc: false, mkv: false };
    expect(rankVersions([web, original], { ...options, client, canConvert: true })[0]?.version)
      .toMatchObject({ height: 2160, source: 'remux', languages: expect.arrayContaining(['eng', 'rus', 'ukr']) });
    expect(rankVersions([web, original], { ...options, client })).toEqual([]);
  });

  it('distinguishes The Hunger Games English audio, Multi Subs, and unspecified MULTI audio', () => {
    const original = release('Hunger Games - (2012 2160p x265 10bit HDR Ita Eng DTS-HD MultiSub BDrip) [Accid].mkv',
      'Torrentio\n4k HDR', 'Multi Subs / 🇬🇧 / 🇮🇹');
    const multi = release('The.Hunger.Games.2012.Multi.2160p.UHD.BluRay.x265.HDR.Atmos.7.1.', 'Torrentio\n4k HDR', 'Multi Audio');
    const dub = release('The.Hunger.Games.2012.2160p.iTA.LATINO.HEVC.Subs.ENG', 'Torrentio\n4k', '🇮🇹 / 🇲🇽');
    expect(describeVersion(dub, null).languages).toEqual(['ita', 'spa']);
    expect(rankVersions([multi, dub, original], options).map(row => row.stream)).toEqual([original, multi, dub]);
  });

  it('removes a Breaking Bad upscale even when the episode filename hides the upscale tag', () => {
    const upscale = release('Breaking Bad. S01. 2008 2160P.Ai Upscaled.BluRay.60FPS.H265.SDR.AC3.5.1_Marjenbo',
      'Torrentio\n4k', 'Breaking Bad  S01E01  Pilot.mkv\n💾 9.53 GB');
    const original = release('Breaking Bad (2008) S01 (2160p AMZN WEB-DL H265 SDR DDP 5.1 English - HONE)',
      'Torrentio\n4k', 'Breaking Bad (2008) S01E01 (2160p AMZN WEB-DL H265 SDR DDP 5.1 English - HONE).mkv\n💾 6.27 GB');
    const episode = release('Breaking Bad S01E01 Pilot 2160p NF WEB-DL DDP5 1 H 265-XEBEC',
      'Torrentio\n4k', '💾 6.82 GB');
    expect(rankVersions([upscale, original, episode], { ...options, runtime: 58 * 60 }).map(row => row.version))
      .toEqual([
        expect.objectContaining({ height: 2160, source: 'web-dl', bitrateMbps: 16.8 }),
        expect.objectContaining({ height: 2160, source: 'web-dl', languages: ['eng'], bitrateMbps: null }),
      ]);
  });

  it('offers Sunrise on the Reaping cinema recordings only when the feed has no retail release', () => {
    const cam = release('The.Hunger.Games.Sunrise.on.the.Reaping.2026.CAM.1080p.FR.EN-CinemaCity',
      'Torrentio\nCAM', '💾 4.59 GB\n🇬🇧 / 🇫🇷');
    const ts = release('The.Hunger.Games.Sunrise.on.the.Reaping.2026.TS.1080p.MULTi',
      'Torrentio\nTeleSync', 'Multi Audio / 🇷🇺 / 🇺🇦');
    const tc = release('The.Hunger.Games.Sunrise.on.the.Reaping.2026.D.TELECINE.1080p', 'Torrentio\nTeleCine');
    expect(rankVersions([ts, tc, cam], options).map(row => row.version.label)).toEqual(Array(3).fill('Cinema recording, low quality'));
    expect(rankVersions([ts, tc, cam], options)[0]?.stream).toBe(cam);
    const retail = release('Sunrise.on.the.Reaping.2026.2160p.BluRay.FRENCH.ts');
    expect(rankVersions([cam, retail], options).map(row => row.stream)).toEqual([retail]);
    expect(rankVersions([cam, retail], { ...options, maxHeight: 1080 })).toEqual([]);
  });

  it('uses the selected episode filename instead of pack format and never treats the film Cam as a recording', () => {
    const pack = release('Breaking Bad COMPLETE S01-S05 2160p WEB-DL Rus Ukr Eng DTS-HD MA5.1 x264-TrollUHD [RiCK]',
      'Torrentio\n4k', 'Breaking.Bad.S01E01.2160p.WEBRip.DTS-HD.MA5.1.x264-TrollUHD.mkv\n💾 50.81 GB');
    expect(describeVersion(pack, 3480)).toMatchObject({ source: 'webrip', sizeBytes: null, bitrateMbps: null });
    expect(describeVersion(release('Cam.2018.1080p.WEB-DL.H264'), null).label).toBe('1080p · WEB-DL');
  });
});
