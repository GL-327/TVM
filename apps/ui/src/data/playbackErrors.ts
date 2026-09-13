const MESSAGES: Readonly<Record<string, string>> = {
  'not-in-library': 'No playable stream was found. It may not be cached on Real-Debrid yet.',
  empty: 'Torrentio returned no streams for this title. Try another episode, or retry later.',
  unsupported: 'This link could not be opened by Real-Debrid.',
  'needs-auth': 'Real-Debrid rejected the saved token. Reconnect Real-Debrid and paste a new one.',
  'not-configured': 'Real-Debrid is not connected. Open the connection settings and paste a token.',
  'hours-cap': 'This week’s Free watch hours are used. Ads do not count. Upgrade in Settings, or wait for Monday.',
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
