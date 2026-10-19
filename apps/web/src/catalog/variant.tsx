import { createContext, useContext, type ReactNode } from 'react';

/**
 * How catalog components are drawn. `board` (the default) is a working page: widgets in cards
 * with title bars on a grid. `document` is a report document (R14): the same components drawn
 * plain inside the flow of an article, with no cards, borders, title bars or grid, so the page
 * reads top to bottom (docs/reframe/r14-report-documents.md, "Looks like a report, not a board").
 */
export type RenderVariant = 'board' | 'document';

const VariantContext = createContext<RenderVariant>('board');

export function VariantProvider({
  variant,
  children,
}: {
  variant: RenderVariant;
  children: ReactNode;
}) {
  return <VariantContext.Provider value={variant}>{children}</VariantContext.Provider>;
}

export const useVariant = (): RenderVariant => useContext(VariantContext);

/** Whether components are drawn inside a report document (plain, no board chrome). */
export const useInDocument = (): boolean => useContext(VariantContext) === 'document';
