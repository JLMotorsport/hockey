// Club cards saved as images for socials (Team of the Week, Manager of the Month).
import { toPng } from 'html-to-image';

/** Facebook's best portrait size: 1080 x 1350 (4:5), drawn at 540 x 675 and doubled. */
export const SOCIAL = { width: 540, height: 675 };

/** The social card as a PNG. */
export async function renderCard(node: HTMLElement): Promise<Blob> {
  const url = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    width: SOCIAL.width,
    height: SOCIAL.height,
  });
  return (await fetch(url)).blob();
}

/** Can this browser hand an image file to the phone's share sheet? */
export function canShareFiles(): boolean {
  try {
    return Boolean(
      navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }),
    );
  } catch {
    return false;
  }
}
