const SAMPLE_VAST =
  'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples&sz=640x480&cust_params=sample_ct%3Dlinear&ciu_szs=300x250%2C728x90&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&impl=s&correlator=';

const FALLBACK_AD = 'https://storage.googleapis.com/gvabox/media/samples/stock.mp4';

export interface VastPreroll {
  url: string;
  mimeType: string;
  duration: number | null;
}

function mediaFromVast(xml: string): VastPreroll | null {
  const files = [...xml.matchAll(/<MediaFile\b([^>]*)>([\s\S]*?)<\/MediaFile>/gi)];
  for (const match of files) {
    const attrs = match[1] ?? '';
    const body = (match[2] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (!/^https?:\/\//i.test(body)) continue;
    const type = /type="([^"]+)"/i.exec(attrs)?.[1] ?? '';
    if (type.includes('mp4') || type.includes('webm') || /\.(mp4|webm)(\?|$)/i.test(body)) {
      return { url: body, mimeType: type || 'video/mp4', duration: null };
    }
  }
  return null;
}

export async function fetchVastPreroll(fetchImpl: typeof fetch = fetch): Promise<VastPreroll> {
  try {
    const response = await fetchImpl(`${SAMPLE_VAST}${Date.now()}`, {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: 'application/xml,text/xml,*/*' },
    });
    if (response.ok) {
      const xml = await response.text();
      const parsed = mediaFromVast(xml);
      if (parsed !== null) return parsed;
    }
  } catch {
    // Fall through to the public sample file.
  }
  return { url: FALLBACK_AD, mimeType: 'video/mp4', duration: 10 };
}
