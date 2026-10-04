import { useEffect, type ReactNode } from 'react';

/** Bottom sheet on phones, centred panel on larger screens. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[85vh] w-full flex-col rounded-t-3xl bg-surface shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="mb-0">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-tap min-w-tap text-2xl leading-none text-ink-soft"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
