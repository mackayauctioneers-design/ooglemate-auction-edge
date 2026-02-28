import { createContext, useContext } from 'react';

/**
 * Context to detect if a component is already inside a layout (sidebar + main).
 * When pages are embedded inside tabbed consolidation pages, their own
 * OperatorLayout/AppLayout wrappers should skip rendering the sidebar.
 */
const LayoutNestingContext = createContext(false);

export const useIsNestedLayout = () => useContext(LayoutNestingContext);
export const LayoutNestingProvider = LayoutNestingContext.Provider;
