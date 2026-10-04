import type { Sponsor } from '@/lib/sponsors';

/**
 * A row of pitch-side advertising boards. Scrolls slowly like stadium boards;
 * stays still for people who prefer reduced motion, and when `still` is set
 * (e.g. for an exported image).
 */
export function SponsorBoards({
  sponsors,
  still = false,
  reverse = false,
}: {
  sponsors: Sponsor[];
  still?: boolean;
  reverse?: boolean;
}) {
  const boards = (key: string) =>
    sponsors.map((s) => (
      <span
        key={`${key}-${s.slug}`}
        className="flex h-7 w-[5.5rem] shrink-0 items-center justify-center bg-white px-1 sm:h-8 sm:w-28"
      >
        <img
          src={`/sponsors/${s.slug}.jpg`}
          alt={key === 'a' ? s.name : ''}
          className="max-h-full max-w-full object-contain"
          loading="lazy"
        />
      </span>
    ));
  return (
    <div
      className="overflow-hidden border-y-2 border-[#0f3d24] bg-[#0f3d24]"
      aria-label="Club sponsors"
    >
      <div
        className={`flex w-max gap-[2px] ${still ? '' : 'motion-safe:animate-[boards_40s_linear_infinite]'}`}
        style={reverse ? { animationDirection: 'reverse' } : undefined}
      >
        {boards('a')}
        {/* Second copy so the loop is seamless; hidden from screen readers. */}
        <span className="contents" aria-hidden="true">
          {boards('b')}
        </span>
      </div>
    </div>
  );
}
