const MESSAGES: Readonly<Record<string, string>> = {
  'mobile-plan-required': 'Mobile viewing requires Basic, Premium, Ultra or MAX with at least 1080p. Open Settings → Plans to continue.',
  'live-hls-required': 'This channel supplies raw MPEG-TS. Use an HLS (.m3u8) playlist from your provider, or connect to a home Core with FFmpeg.',
  'not-in-library': 'No playable stream was found. It may not be cached on Real-Debrid yet.',
  empty: 'Torrentio returned no streams for this title. Try another episode, or retry later.',
  unsupported: 'This file could not be opened. Real-Debrid may have returned a broken link, or the format is not playable.',
  'needs-converter':
    'This file is not MP4, M4V, MOV or HLS, so this device cannot play it. Try another title, or watch on desktop where TVM can convert.',
  'needs-auth': 'Real-Debrid rejected the saved token. Reconnect Real-Debrid and paste a new one.',
  'not-configured': 'Real-Debrid is not connected. Open the connection settings and paste a token.',
  'hours-cap': 'This week’s Free watch hours are used. Ads do not count. Upgrade in Settings, or wait for Monday.',
  /*
   * Live TV upstream failures, named rather than collapsed. "Playback failed"
   * read identically whether the subscription was rejected, the channel path
   * was gone, or the provider was simply down — which made an IPTV problem
   * impossible to tell apart from a TVM one.
   */
  'upstream-401': 'Your IPTV provider rejected this subscription. Check the username, password or host in Live TV settings.',
  'upstream-403': 'Your IPTV provider refused this channel. The subscription may have expired, be in use on another device, or not include this channel.',
  'upstream-404': 'This channel is no longer on your provider. Refresh the playlist in Live TV settings.',
  'upstream-empty': 'Your IPTV provider accepted the connection but sent no video. Many subscriptions allow only one device at a time.',
  'upstream-timeout': 'Your IPTV provider did not respond in time. Check the connection and try again.',
  unreachable: 'TVM could not reach your IPTV provider. Check the host address and that this network is not blocking it.',
  network: 'TVM could not reach the local core. Check that the app is running, then retry.',
  timeout: 'Finding a playable stream took too long. Press Retry, or Back to choose another title.',
  internal: 'Playback failed inside TVM. Retry, or check that core is running.',
  internal_error: 'Playback failed inside TVM. Retry, or check that core is running.',
};

export function playbackErrorMessage(reason: string): string {
  const known = MESSAGES[reason];
  if (known !== undefined) return known;
  const trimmed = reason.trim();
  return trimmed === '' ? MESSAGES.internal ?? 'Playback failed inside TVM. Retry, or check that core is running.' : trimmed;
}
