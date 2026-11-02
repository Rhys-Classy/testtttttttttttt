import type { LibraryDrag } from './actions';

export type { LibraryDrag };

/** Set by the library while one of its cards is being dragged. */
export const libraryDrag: { current: LibraryDrag | null } = { current: null };

/** iPad build: tapping a library card arms it for placement by a tap on the plan. */
export const libraryConfig = { tapToArm: false };
