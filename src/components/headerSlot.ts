import { createContext, useContext } from 'react';

/**
 * Pick team and Transfers put their own title bar into the app's red header
 * (via a portal into this slot, see Layout), so the header itself never
 * leaves the screen. iPhone colours the status bar from it, so it stays red.
 */
export const HeaderSlot = createContext<HTMLElement | null>(null);
export const useHeaderSlot = () => useContext(HeaderSlot);
