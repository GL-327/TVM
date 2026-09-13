import { useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './billing.css';

export function Legal(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const exportData = async (): Promise<void> => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/privacy/export', { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Export could not be created. Try again.');
      const data: unknown = await response.json();
      const preferences: Record<string, string | null> = {};
      for (const key of Object.keys(localStorage)) if (/^tvm[.:_-]/i.test(key)) preferences[key] = localStorage.getItem(key);
      const url = URL.createObjectURL(new Blob([JSON.stringify({ device: data, browserPreferences: preferences }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'tvm-personal-data.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setMessage('Your data export is ready in downloads. It contains personal viewing history; keep it private.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed.'); }
    finally { setBusy(false); }
  };
  const erase = async (): Promise<void> => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/privacy/erase', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'ERASE_LOCAL_DATA' }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('Data could not be deleted. Try again.');
      for (const store of [localStorage, sessionStorage]) for (const key of Object.keys(store)) if (/^tvm[.:_-]/i.test(key)) store.removeItem(key);
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Deletion failed.'); setBusy(false); }
  };
  return <main className="page page--settings billing-page">
    <TopBar title="Privacy & terms" />
    <h1 className="page__heading">Your data. Your sources.</h1>
    <p className="billing-badge">Private test build · notice version 12 September 2026</p>
    <div className="hero__actions">
      <FocusButton id="legal-back" onSelect={() => navigate.pop()}>Back</FocusButton>
      <FocusButton id="privacy-export" disabled={busy} onSelect={() => void exportData()}>Export my data</FocusButton>
      <FocusButton id="privacy-erase" disabled={busy} onSelect={() => confirmErase ? void erase() : setConfirmErase(true)}>{confirmErase ? 'Confirm — delete all TVM data' : 'Delete local TVM data'}</FocusButton>
      {confirmErase && <FocusButton id="privacy-keep" disabled={busy} onSelect={() => setConfirmErase(false)}>Keep my data</FocusButton>}
    </div>
    {confirmErase && <p role="alert">This removes all TVM profiles, viewing history, lists, provider credentials, test plans and receipts on this device, and locks DEV mode. Other providers’ accounts and browser sessions are separate. This cannot be undone.</p>}
    {message && <p role="status">{message}</p>}
    <article className="legal-copy">
      <h2>Private testing terms</h2>
      <p>TVM is a media interface for your own files and sources you are authorised to use. A TVM plan does not supply rights to films, channels or third-party services. Do not use it to infringe copyright, share provider credentials contrary to their terms, or bypass access restrictions. Availability and supported formats depend on your provider, connection and device. Service names identify independent providers; they do not imply endorsement or partnership.</p>
      <p>Checkout is a simulation. No card, payment mandate, charge, renewal or paid contract is created. Test plans can be cancelled from Plans. Colourcast remains unlocked after cancellation. Production pricing, tax, refund and cancellation terms must be supplied before any real sale. Nothing in these test terms excludes statutory rights.</p>
      <h2>What is stored and why</h2>
      <p>TVM stores profile names, watch progress, watchlists and preferences to provide personal playback and recommendations. Test receipts record plan choices, consent version and time. Provider credentials are stored to connect the services you choose. Credentials, profiles, viewing history, playlists and billing records are encrypted on disk. On Windows, the encryption key is protected by your Windows account. Running software under that account can still access data.</p>
      <p>Data stays until you remove it or reset TVM; the billing history keeps the latest 100 test events. Artwork and catalogue caches can be cleared in Settings. Theme, motion and search history are local browser preferences; search history is not encrypted. Use device encryption and a private account on shared machines. TVM does not run an analytics tracker in this build.</p>
      <h2>Connections to other services</h2>
      <p>Metadata and images are requested from catalogue and artwork services, including Cinemeta and configured TMDB services. They and media hosts receive network information such as your IP address. Real-Debrid receives your token and requested links. The existing Torrentio resolver also receives the Real-Debrid token in its request URL when resolving catalogue playback. Connect only if you accept those providers’ terms and credential handling. IPTV servers receive your provider login or playlist URL. HTTP-only sources are not encrypted in transit; use HTTPS where your provider supports it.</p>
      <p>Third-party websites use their own accounts, cookies, privacy policies and retention rules. Removing TVM data does not delete data held by those services. Disconnect or revoke tokens with the provider as needed. This build does not request advertising-network prerolls.</p>
      <h2>Your choices and contact</h2>
      <p>You can rename profiles, remove saved titles, disconnect services, export your TVM data, or erase it using the controls above. Exports exclude credentials. Contact the person who supplied this private test build for access, correction, objections, restrictions or complaints about test data. UK users can also complain to the Information Commissioner’s Office at ico.org.uk.</p>
      <p>The business operator’s legal name, postal address, support/privacy contact, lawful bases, applicable territories and any transfer safeguards are still awaiting owner confirmation. This is a private-test notice, not a completed public privacy policy or legal certification.</p>
    </article>
  </main>;
}
