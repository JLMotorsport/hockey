import { setUiVersion, UI_VERSIONS, useCanSwitchVersion, useUiVersion } from '@/lib/uiVersion';

/** V1 / V2 / V3 side by side: the super user only (everyone else has V2). */
export function VersionSwitch({ tone = 'light' }: { tone?: 'light' | 'page' | 'v3' }) {
  const version = useUiVersion();
  const allowed = useCanSwitchVersion();
  if (!allowed) return null;
  return (
    <div
      role="group"
      aria-label="Design version (testing)"
      className={`flex h-8 shrink-0 rounded-full p-0.5 text-[0.7rem] font-extrabold ${tone === 'light' ? 'bg-black/20 text-white' : tone === 'v3' ? 'border border-white/10 bg-white/[0.06] text-[#8b94a7]' : 'bg-black/[0.06] text-ink-soft dark:bg-[#1f232c]'}`}
    >
      {UI_VERSIONS.map((v) => (
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
                : tone === 'v3'
                  ? 'bg-white text-[#05070c]'
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
