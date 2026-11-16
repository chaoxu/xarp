import { createTravels } from "travels";
import { create, type Draft, type Immutable } from "mutative";

export type Snapshot = null | boolean | number | string | Snapshot[] | { [key: string]: Snapshot };

export function createHistory<T extends Snapshot>(initial: T, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("History limit must be an integer from 1 to 100");
  const ownedInitial = structuredClone(initial);
  // Travels freezes updates and replayed states, but adopts its initial state.
  create(ownedInitial, () => {}, { enableAutoFreeze: true });
  const history = createTravels(ownedInitial, { maxHistory: limit, enableAutoFreeze: true });
  // This wrapper only admits synchronous JSON snapshots and recipes. Express that
  // boundary directly rather than expanding Travels' conditional updater type.
  const writer = history as unknown as { setState(value: T | ((draft: Draft<T>) => void), metadata?: { references: string[] }): void };
  const getState = () => history.getState() as Immutable<T>;
  return {
    getState,
    setState(snapshot: T, references?: readonly string[]) {
      if (references !== undefined && (!Array.isArray(references) || references.some(reference => typeof reference !== "string")))
        throw new Error("History references must be an array of strings");
      // Fresh DOM snapshots may have new object identities without a change.
      if (JSON.stringify(snapshot) !== JSON.stringify(history.getState()))
        writer.setState(structuredClone(snapshot), references === undefined ? undefined : { references: [...new Set(references)] });
      return getState();
    },
    getRetainedReferences() {
      // Travels trims and branches this metadata with its retained transitions.
      return [...new Set(history.getMetadata().flatMap(metadata => metadata?.references as string[] | undefined ?? []))];
    },
    update(recipe: (draft: Draft<T>) => void) {
      // The recipe owns inserted values. Clone caller-owned data before insertion.
      writer.setState(recipe);
      return getState();
    },
    undo() { if (history.canBack()) history.back(); return getState(); },
    redo() { if (history.canForward()) history.forward(); return getState(); },
    canUndo: () => history.canBack(),
    canRedo: () => history.canForward(),
    clear() { history.rebase(); return getState(); },
  };
}
