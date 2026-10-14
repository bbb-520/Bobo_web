import { useEffect, useRef, useState } from 'react';
import type { PromptEntry } from '../lib/promptLibrary';
interface Selected { entry: PromptEntry; owner: string; revision: number; manual?: boolean; }

/** Keep public details separate from account-bound private selection. */
export function usePromptSelection(owner: string) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const identity = useRef(owner), revision = useRef(0);
  if (identity.current !== owner) { identity.current = owner; revision.current++; }
  // Fence synchronously, then discard the retained private object. Returning to
  // the same account is a new revision and must never resurrect an old detail.
  useEffect(() => { setSelected(current => current?.entry.source === 'visual-memory' ? null : current); }, [owner]);
  const detail = selected && (selected.entry.source === 'gallery' || (selected.owner === owner && selected.revision === revision.current)) ? selected : null;
  return {
    detail,
    revision: revision.current,
    open: (entry: PromptEntry, manual = false) => setSelected({ entry, owner: identity.current, revision: revision.current, manual }),
    close: () => setSelected(null),
  };
}
