import { test, expect } from "vitest";
import { createHistory } from "../lib/editor/history.js";
import { applyVisualEdits, type SlideTextEdit } from "../lib/editor/slide-edits.js";
import { parseSource as parseLibrary, updateSlideInSource } from "../lib/source.js";

test("history owns input snapshots and exposes deeply frozen states across undo and redo", () => {
  const initial = { text: "Before", box: { x: 0 } };
  const history = createHistory(initial);
  initial.text = "Unrecorded caller mutation";
  expect(history.getState().text).toBe("Before");
  const before = history.getState();
  expect(history.getState()).toBe(before);
  expect(Object.isFrozen(before)).toBe(true);
  expect(Object.isFrozen(before.box)).toBe(true);
  expect(() => { (before as typeof initial).box.x = 42; }).toThrow(TypeError);
  const next = { text: "After", box: { x: 20 } };
  history.setState(next);
  next.box.x = 999;
  const exposed = history.getState();
  expect(() => { (exposed as typeof next).text = "Unrecorded output mutation"; }).toThrow(TypeError);
  expect(() => { (exposed as typeof next).box.x = 1000; }).toThrow(TypeError);
  expect(history.getState()).toEqual({ text: "After", box: { x: 20 } });
  const undone = history.undo();
  expect(undone).toEqual({ text: "Before", box: { x: 0 } });
  expect(Object.isFrozen(undone.box)).toBe(true);
  const redone = history.redo();
  expect(redone).toEqual({ text: "After", box: { x: 20 } });
  expect(Object.isFrozen(redone.box)).toBe(true);
  expect(() => { (redone as typeof next).box.x = 1000; }).toThrow(TypeError);
});

test("incremental updates retain unchanged strokes and own cloned new strokes", () => {
  const history = createHistory([] as { color: string; points: { x: number; y: number }[] }[]);
  const original = { color: "red", points: [{ x: 1, y: 2 }] };
  history.update(strokes => { strokes.push(structuredClone(original)); });
  original.points[0]!.x = 999;
  const first = history.getState()[0]!;
  expect(first.points[0]!.x).toBe(1);
  expect(Object.isFrozen(first.points[0])).toBe(true);
  history.update(strokes => { strokes.push({ color: "blue", points: [{ x: 3, y: 4 }] }); });
  expect(history.getState()[0]).toBe(first);
  expect(history.undo()).toEqual([first]);
  history.update(() => {});
  expect(history.canRedo()).toBe(true);
  expect(history.redo()[1]!.color).toBe("blue");
  expect(Object.isFrozen(history.getState()[1]!.points[0])).toBe(true);
  const committed = history.getState();
  expect(() => history.update(strokes => { strokes.length = 0; throw new Error("cancelled"); })).toThrow("cancelled");
  expect(history.getState()).toBe(committed);
});

test("history groups each committed gesture and preserves redo through no-op snapshots", () => {
  const history = createHistory({ strokes: [] as number[][] });
  const points = Array.from({ length: 20 }, (_, index) => index);
  history.setState({ strokes: [points] });
  expect(history.undo()).toEqual({ strokes: [] });
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(true);
  history.setState({ strokes: [] });
  expect(history.canRedo()).toBe(true);
  history.redo();
  history.undo();
  history.setState({ strokes: [[100, 101]] });
  expect(history.canRedo()).toBe(false);
  expect(history.undo()).toEqual({ strokes: [] });
});

test("history retains only the requested bounded window and clear keeps the present state", () => {
  const history = createHistory({ value: 0 }, 3);
  for (let value = 1; value <= 5; value++) history.setState({ value });
  expect(history.undo()).toEqual({ value: 4 });
  expect(history.undo()).toEqual({ value: 3 });
  expect(history.undo()).toEqual({ value: 2 });
  expect(history.canUndo()).toBe(false);
  expect(history.undo()).toEqual({ value: 2 });
  history.redo();
  expect(history.clear()).toEqual({ value: 3 });
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(false);
  expect(() => createHistory({}, 101)).toThrow("from 1 to 100");
});

test("retained references cover both endpoints of the bounded undo and redo window", () => {
  const history = createHistory({ baselineId: "b0" }, 3);
  for (let step = 1; step <= 5; step++) {
    const baselineId = `b${step}`;
    history.setState({ baselineId }, [history.getState().baselineId, baselineId]);
  }
  expect(history.getRetainedReferences()).toEqual(["b2", "b3", "b4", "b5"]);
  history.undo();
  history.undo();
  expect(history.getState().baselineId).toBe("b3");
  expect(history.getRetainedReferences()).toEqual(["b2", "b3", "b4", "b5"]);
  history.setState({ baselineId: "branch" }, [history.getState().baselineId, "branch"]);
  expect(history.getRetainedReferences()).toEqual(["b2", "b3", "branch"]);
  expect(history.canRedo()).toBe(false);
  expect(history.undo().baselineId).toBe("b3");
  expect(history.redo().baselineId).toBe("branch");
  history.clear();
  expect(history.getState().baselineId).toBe("branch");
  expect(history.getRetainedReferences()).toEqual([]);
});

test("retained reference arrays are detached and no-op updates preserve redo metadata", () => {
  const history = createHistory({ baselineId: "initial" });
  const references = ["initial", "saved", "initial"];
  history.setState({ baselineId: "saved" }, references);
  references.splice(0, references.length, "caller-mutation");
  const exposed = history.getRetainedReferences();
  exposed.splice(0, exposed.length, "output-mutation");
  expect(history.getRetainedReferences()).toEqual(["initial", "saved"]);
  history.undo();
  history.setState({ baselineId: "initial" }, ["unused"]);
  expect(history.getRetainedReferences()).toEqual(["initial", "saved"]);
  expect(history.canRedo()).toBe(true);
  expect(history.redo().baselineId).toBe("saved");
  expect(() => history.setState({ baselineId: "invalid" }, [42] as unknown as string[])).toThrow("array of strings");
  expect(history.getState().baselineId).toBe("saved");
  expect(history.getRetainedReferences()).toEqual(["initial", "saved"]);
});

test("default reference retention follows all 100 retained transitions", () => {
  const history = createHistory({ baselineId: "b0" });
  for (let step = 1; step <= 110; step++) {
    const baselineId = `b${step}`;
    history.setState({ baselineId }, [history.getState().baselineId, baselineId]);
  }
  expect(history.getRetainedReferences()).toEqual(Array.from({ length: 101 }, (_, index) => `b${index + 10}`));
  for (let step = 0; step < 100; step++) history.undo();
  expect(history.canUndo()).toBe(false);
  expect(history.getState().baselineId).toBe("b10");
  expect(history.getRetainedReferences()).toHaveLength(101);
  for (let step = 0; step < 100; step++) history.redo();
  expect(history.getState().baselineId).toBe("b110");
  expect(history.getRetainedReferences()).toHaveLength(101);
});

test("shared visual mapping matches backend source updates and can restore a pre-save snapshot", () => {
  const markdown = '<!-- _class: pf-slide -->\n\n<p title="Target">Target</p>\n\n<svg><rect x="10" y="20" width="30" height="40"/></svg>\n\n<!-- Speaker note: Target stays here. -->';
  const edits: SlideTextEdit[] = [
    { tag: "p", beforeText: "Target", beforeHtml: "Target", afterText: "Changed <literally>", afterHtml: "Changed &lt;literally&gt;" },
    { tag: "rect", afterText: "", svgAttrs: { x: "50", y: "60" } },
  ];
  const source = `---\nmarp: true\n---\n\n<!-- slide: example -->\n\n${markdown}\n`;
  const mapped = applyVisualEdits(markdown, edits, "example");
  expect(mapped).toBe(updateSlideInSource(source, "example", { edits }).slideBody);
  expect(mapped).toContain('<p title="Target">Changed &lt;literally&gt;</p>');
  expect(mapped).toContain("Speaker note: Target stays here.");
  const history = createHistory({ markdown });
  history.setState({ markdown: mapped });
  const saved = updateSlideInSource(source, "example", { markdown: history.getState().markdown }).updatedSource;
  const restored = updateSlideInSource(saved, "example", { markdown: history.undo().markdown }).updatedSource;
  expect(parseLibrary(restored).slides[0]!.body).toBe(markdown);
  expect(applyVisualEdits(markdown, [], "example")).toBe(markdown);
  expect(() => applyVisualEdits(markdown, [{ tag: "p", beforeText: "Missing", afterText: "Wrong" }], "example")).toThrow("Could not identify");
});
