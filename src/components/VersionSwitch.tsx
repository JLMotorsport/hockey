import { setUiVersion, useUiVersion, type UiVersion } from '@/lib/uiVersion';

/** V1 / V2 for testing the redesign side by side. */
export function VersionSwitch({ tone = 'light' }: { tone?: 'light' | 'page' }) {
  const version = useUiVersion();
  return (
    <div
      role="group"
      aria-label="Design version (testing)"
      className={`flex h-8 shrink-0 rounded-full p-0.5 text-[0.7rem] font-extrabold ${tone === 'light' ? 'bg-black/20 text-white' : 'bg-black/[0.06] text-ink-soft dark:bg-[#1f232c]'}`}
    >
      {(['v1', 'v2'] as UiVersion[]).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={version === v}
          onClick={() => setUiVersion(v)}
          // The pill is small; the tap area reaches 44px.
          className={`relative min-w-[2.1rem] rounded-full px-2 uppercase before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] ${
            version === v
              ? tone === 'light'
                ? 'bg-white text-brand'
                : 'bg-[#14181f] text-white dark:bg-[#eceff4] dark:text-[#0e1014]'
              : ''
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
