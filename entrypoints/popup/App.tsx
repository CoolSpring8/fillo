import { useEffect, useState } from 'react';
import { deleteProfile, listProfiles } from '../../shared/storage/profiles';
import type { ProfileRecord } from '../../shared/types';

interface ViewState {
  loading: boolean;
  error?: string;
}

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ loading: true });

  const refresh = async () => {
    setViewState({ loading: true });
    try {
      const result = await listProfiles();
      setProfiles(result);
      setViewState({ loading: false });
      if (result.length === 0) {
        setExpandedId(null);
      } else if (expandedId && !result.some((profile) => profile.id === expandedId)) {
        setExpandedId(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setViewState({ loading: false, error: message });
    }
  };

  useEffect(() => {
    void refresh();
    const listener = () => {
      void refresh();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async (id: string) => {
    await deleteProfile(id);
    await refresh();
  };

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const renderProfile = (profile: ProfileRecord) => {
    const isExpanded = expandedId === profile.id;
    const createdAt = new Date(profile.createdAt);
    const basics = (profile.resume as Record<string, any> | undefined)?.basics ?? {};
    const displayName = typeof basics.name === 'string' && basics.name.trim().length > 0 ? basics.name : 'Unnamed profile';
    const providerLabel =
      profile.provider.kind === 'openai'
        ? `OpenAI (${profile.provider.model})`
        : 'Chrome on-device';

    return (
      <article key={profile.id} className="profile-card">
        <div className="profile-header">
          <div className="profile-summary">
            <strong>{displayName}</strong>
            <span className="profile-subline">
              {providerLabel} · Imported {createdAt.toLocaleString()}
            </span>
            <span className="profile-subline">
              PDF: {profile.sourceFile.name} ({profile.sourceFile.size.toLocaleString()} bytes) · Raw text: {profile.rawText.length.toLocaleString()} chars
            </span>
            {profile.validation && !profile.validation.valid && (
              <span className="profile-warning">Validation warnings available</span>
            )}
          </div>
          <div className="profile-actions">
            <button type="button" onClick={() => toggleExpanded(profile.id)}>
              {isExpanded ? 'Hide details' : 'View details'}
            </button>
            <button type="button" className="danger" onClick={() => handleDelete(profile.id)}>
              Delete
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="profile-details">
            <div>
              <h3>JSON Resume</h3>
              <pre>{JSON.stringify(profile.resume, null, 2)}</pre>
            </div>
            <div>
              <h3>Custom fields</h3>
              <pre>{JSON.stringify(profile.custom, null, 2)}</pre>
            </div>
            <div>
              <h3>Raw text</h3>
              <pre className="raw-text">{profile.rawText}</pre>
            </div>
            {profile.validation && profile.validation.errors && profile.validation.errors.length > 0 && (
              <div>
                <h3>Validation warnings</h3>
                <ul>
                  {profile.validation.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="popup">
      <header>
        <h1>Imported Profiles</h1>
        <p>Use onboarding to add resumes. Delete entries you no longer need.</p>
      </header>
      {viewState.loading && <p className="info">Loading profiles…</p>}
      {viewState.error && <p className="error">{viewState.error}</p>}
      {!viewState.loading && profiles.length === 0 && (
        <p className="info">
          No profiles stored yet. Import a PDF via the onboarding page to get started.
        </p>
      )}
      <div className="profiles">{profiles.map((profile) => renderProfile(profile))}</div>
      <footer>
        <button
          type="button"
          onClick={() =>
            browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') })
          }
        >
          Open onboarding
        </button>
        <button
          type="button"
          onClick={() =>
            browser.tabs.create({ url: browser.runtime.getURL('/options.html') })
          }
        >
          Settings
        </button>
      </footer>
    </div>
  );
}
