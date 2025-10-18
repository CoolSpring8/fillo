import { useEffect, useState } from 'react';
import { deleteProfile, listProfiles } from '../../shared/storage/profiles';
import { OPENAI_DEFAULT_BASE_URL } from '../../shared/storage/settings';
import type { ProfileRecord } from '../../shared/types';

interface ViewState {
  loading: boolean;
  error?: string;
}

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ loading: true });
  const { t } = i18n;

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

  const openSidePanel = async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        return;
      }
      await browser.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
      await browser.sidePanel.open({ tabId: tab.id });
    } catch (error) {
      console.error('Unable to open side panel', error);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const renderProfile = (profile: ProfileRecord) => {
    const isExpanded = expandedId === profile.id;
    const createdAt = new Date(profile.createdAt);
    const basics = (profile.resume as Record<string, any> | undefined)?.basics ?? {};
    const displayName =
      typeof basics.name === 'string' && basics.name.trim().length > 0
        ? basics.name
        : t('popup.profile.unnamed');
    const parsedAt = profile.parsedAt ? new Date(profile.parsedAt) : null;
    const providerLabel = profile.provider
      ? profile.provider.kind === 'openai'
        ? profile.provider.apiBaseUrl &&
          profile.provider.apiBaseUrl !== OPENAI_DEFAULT_BASE_URL
          ? t('popup.provider.openaiModelWithBase', [
              profile.provider.model,
              profile.provider.apiBaseUrl,
            ])
          : t('popup.provider.openaiModel', [profile.provider.model])
        : t('popup.provider.onDevice')
      : null;
    const parsedLabel = parsedAt ? t('popup.provider.parsed', [parsedAt.toLocaleString()]) : null;
    const parsingSummary = providerLabel
      ? parsedLabel
        ? `${providerLabel} · ${parsedLabel}`
        : providerLabel
      : t('popup.provider.notParsed');
    const fileSummary = profile.sourceFile
      ? t('popup.profile.fileInfo', [
          profile.sourceFile.name,
          profile.sourceFile.size.toLocaleString(),
          profile.rawText.length.toLocaleString(),
        ])
      : t('popup.profile.manualInfo', [profile.rawText.length.toLocaleString()]);

    return (
      <article key={profile.id} className="profile-card">
        <div className="profile-header">
          <div className="profile-summary">
            <strong>{displayName}</strong>
            <span className="profile-subline">
              {t('popup.profile.importedAt', [createdAt.toLocaleString()])}
            </span>
            <span className="profile-subline">
              {parsingSummary}
            </span>
            <span className="profile-subline">
              {fileSummary}
            </span>
            {profile.validation && !profile.validation.valid && (
              <span className="profile-warning">{t('popup.profile.validationWarning')}</span>
            )}
          </div>
          <div className="profile-actions">
            <button type="button" onClick={() => toggleExpanded(profile.id)}>
              {isExpanded ? t('popup.buttons.hideDetails') : t('popup.buttons.viewDetails')}
            </button>
            <button type="button" className="danger" onClick={() => handleDelete(profile.id)}>
              {t('popup.buttons.delete')}
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="profile-details">
            <div>
              <h3>{t('popup.sections.jsonResume')}</h3>
              {profile.provider ? (
                <pre>{JSON.stringify(profile.resume ?? {}, null, 2)}</pre>
              ) : (
                <p className="info">{t('popup.info.noStructured')}</p>
              )}
            </div>
            <div>
              <h3>{t('popup.sections.customFields')}</h3>
              {profile.provider ? (
                <pre>{JSON.stringify(profile.custom ?? {}, null, 2)}</pre>
              ) : (
                <p className="info">{t('popup.info.noCustom')}</p>
              )}
            </div>
            <div>
              <h3>{t('popup.sections.rawText')}</h3>
              <pre className="raw-text">{profile.rawText}</pre>
            </div>
            {profile.validation && profile.validation.errors && profile.validation.errors.length > 0 && (
              <div>
                <h3>{t('popup.sections.validationWarnings')}</h3>
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
        <h1>{t('popup.title')}</h1>
        <p>{t('popup.description')}</p>
      </header>
      {viewState.loading && <p className="info">{t('popup.loading')}</p>}
      {viewState.error && <p className="error">{t('popup.error', [viewState.error])}</p>}
      {!viewState.loading && profiles.length === 0 && (
        <p className="info">{t('popup.empty')}</p>
      )}
      <div className="profiles">{profiles.map((profile) => renderProfile(profile))}</div>
      <footer>
        <button
          type="button"
          onClick={() =>
            browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') })
          }
        >
          {t('popup.buttons.openOnboarding')}
        </button>
        <button
          type="button"
          onClick={() =>
            browser.tabs.create({ url: browser.runtime.getURL('/options.html') })
          }
        >
          {t('popup.buttons.settings')}
        </button>
        <button type="button" onClick={() => openSidePanel()}>
          {t('popup.buttons.openSidePanel')}
        </button>
      </footer>
    </div>
  );
}
