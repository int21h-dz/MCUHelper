import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OptimisticDiagnosticStore, type LineChange } from "./optimisticDiagnostics";
import {
  largeDocumentEditPlan,
  shouldDiscardStaleSidebarApply,
  shouldScheduleTreePrime,
  shouldApplyOptimisticOverlay,
  paintDiagnosticsFromOverlay,
  shouldPaintCachedSidebarIndex,
  shouldSupersedeSidebarRefresh,
  sidebarPanelModeOnEditorSwitch,
  LARGE_DOC_LINE_THRESHOLD,
} from "./sidebarFreshness";

type FakeDiag = {
  message: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
};

const URI = "file:///load/3l070626.mcu";
const SMALL = "file:///load/958.mcu";

function diag(line: number, message = `L${line}`): FakeDiag {
  return {
    message,
    range: { start: { line, character: 0 }, end: { line, character: 8 } },
  };
}

function editLine(line: number): LineChange {
  return {
    range: { start: { line, character: 2 }, end: { line, character: 3 } },
    text: "x",
  };
}

describe("load: sidebar diagnostics overlay (15s host lag)", () => {
  it("SLA: two warning edits update overlay in <20ms without waiting for LSP", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    const host = [diag(10), diag(40)];
    const t0 = performance.now();
    store.applyEdit(URI, [editLine(10)], host);
    const shown = store.applyEdit(URI, [editLine(40)], host);
    const ms = performance.now() - t0;
    assert.equal(shown.length, 0);
    assert.ok(ms < 100, `overlay two-patch took ${ms.toFixed(2)}ms`);
  });

  it("stale vscode.languages.getDiagnostics must not bring warnings back", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    store.applyEdit(URI, [editLine(10)], [diag(10), diag(40)]);
    store.applyEdit(URI, [editLine(40)]);
    const shown = store.mergeHost(URI, [diag(10), diag(40)]);
    assert.equal(shown.length, 0);
  });

  it("empty host flicker must not wipe a non-empty overlay", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    store.applyEdit(URI, [editLine(10)], [diag(10), diag(40)]);
    const shown = store.mergeHost(URI, []);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].range.start.line, 40);
  });

  it("does not seed overlay from empty host before first LSP publish", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    const shown = store.applyEdit(URI, [editLine(10)], []);
    assert.equal(shown.length, 0);
    assert.equal(store.getPublished(URI), undefined);
  });

  it("stale LSP flood must not restore suppressed warnings in overlay", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    store.applyEdit(URI, [editLine(10)], [diag(10), diag(40)]);
    store.applyEdit(URI, [editLine(40)]);
    const flood = [diag(10), diag(40), diag(100, "aw")];
    const shown = store.mergeHost(URI, flood);
    assert.equal(shown.some((d) => d.range.start.line === 10 || d.range.start.line === 40), false);
    assert.ok(shown.some((d) => d.message === "aw"));
  });

  it("fresh validate commit shows a NEW warning on an edited line", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    store.applyEdit(URI, [editLine(10)], [diag(10, "old"), diag(40)]);
    const stale = store.mergeHost(URI, [diag(10, "old"), diag(40)]);
    assert.equal(stale.length, 1);
    const committed = store.commitFromLsp(URI, [diag(10, "new"), diag(40)]);
    assert.ok(committed.some((d) => d.message === "new"));
    assert.equal(committed.length, 2);
  });

  it("REGRESSION: second warning squiggle follows overlay, not lagged LSP collection", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    store.applyEdit(URI, [editLine(10)], [diag(10), diag(40)]);
    const overlay = store.applyEdit(URI, [editLine(40)]);
    const lspCollectionLag = [diag(40)];
    const squiggles = paintDiagnosticsFromOverlay(overlay);
    assert.equal(overlay.length, 0, "tree");
    assert.equal(squiggles.length, 0, "squiggle must match tree");
    assert.equal(lspCollectionLag.length, 1, "LSP host still has warning #2 — must not paint");
  });

  it("online conc warning survives stale LSP merge and is not duplicated", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    store.applyEdit(URI, [editLine(10)], [diag(10), diag(40)]);
    const added = store.replaceLineDiags(URI, 99, [diag(99, "2e-2*FOO")]);
    assert.ok(added.some((d) => d.message === "2e-2*FOO"));
    const merged = store.mergeHost(URI, [diag(10), diag(40)]);
    assert.ok(merged.some((d) => d.message === "2e-2*FOO"), "stale host must keep overlay-only conc warning");
    assert.equal(merged.filter((d) => d.range.start.line === 10).length, 0);
    const again = store.replaceLineDiags(URI, 99, [diag(99, "2e-2*FOO")]);
    assert.equal(again.filter((d) => d.message === "2e-2*FOO").length, 1);
  });

  it("overlay patch never invents a new warning; only fresh validate commit does", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    store.applyEdit(URI, [editLine(10)], [diag(10)]);
    const afterOtherLine = store.applyEdit(URI, [editLine(99)]);
    assert.equal(
      afterOtherLine.some((d) => d.range.start.line === 99),
      false
    );
    const committed = store.commitFromLsp(URI, [diag(99, "new lexer")]);
    assert.ok(committed.some((d) => d.message === "new lexer"));
  });

  it("SLA: overlay 2 of 8000 sidebar rows in <50ms", () => {
    const store = new OptimisticDiagnosticStore<FakeDiag>();
    const host = Array.from({ length: 8000 }, (_, i) => diag(i));
    const t0 = performance.now();
    store.applyEdit(URI, [editLine(10)], host);
    store.applyEdit(URI, [editLine(7999)]);
    const ms = performance.now() - t0;
    assert.equal(store.getPublished(URI)?.length, 7998);
    assert.ok(ms < 500, `8000-row overlay took ${ms.toFixed(2)}ms`);
  });
});

describe("load: editor switch freshness", () => {
  it("discards getIndex of previous file after generation bump", () => {
    assert.equal(
      shouldDiscardStaleSidebarApply({
        requestGen: 0,
        liveGen: 1,
        requestUri: URI,
        liveUri: SMALL,
      }),
      true
    );
    assert.equal(
      shouldDiscardStaleSidebarApply({
        requestGen: 1,
        liveGen: 1,
        requestUri: SMALL,
        liveUri: SMALL,
      }),
      false
    );
  });

  it("large-file edit always refreshes diagnostics now (not only via onDidChangeDiagnostics)", () => {
    const large = largeDocumentEditPlan(LARGE_DOC_LINE_THRESHOLD + 1);
    assert.equal(large.abortTreeRefresh, true);
    assert.equal(large.refreshDiagnosticsNow, true);
    assert.equal(large.skipFullIndexRefresh, true);

    const small = largeDocumentEditPlan(100);
    assert.equal(small.abortTreeRefresh, false);
    assert.equal(small.refreshDiagnosticsNow, false);
    assert.equal(small.skipFullIndexRefresh, false);
    assert.equal(small.retryTreePrimeAfterIdle, false);
  });

  it("retries tree prime until getIndex actually applied (abort must not stick empty materials)", () => {
    assert.equal(shouldScheduleTreePrime(undefined, URI, LARGE_DOC_LINE_THRESHOLD + 1), true);
    assert.equal(shouldScheduleTreePrime(URI, URI, LARGE_DOC_LINE_THRESHOLD + 1), false);
    assert.equal(shouldScheduleTreePrime(undefined, SMALL, 100), false);
    assert.equal(shouldApplyOptimisticOverlay(0, 0), false);
    assert.equal(shouldApplyOptimisticOverlay(2, 0), true);
    assert.equal(shouldApplyOptimisticOverlay(0, 1), true);
  });

  it("paints cached getIndex when a sidebar webview becomes ready later", () => {
    assert.equal(shouldPaintCachedSidebarIndex(URI, URI), true);
    assert.equal(shouldPaintCachedSidebarIndex(undefined, URI), false);
    assert.equal(shouldPaintCachedSidebarIndex(URI, SMALL), false);
  });

  it("supersedes in-flight getIndex when switching files", () => {
    assert.equal(shouldSupersedeSidebarRefresh(1, 2), true);
    assert.equal(shouldSupersedeSidebarRefresh(2, 2), false);
  });

  it("keeps diagnostics tree on switch instead of the loading placeholder", () => {
    assert.equal(sidebarPanelModeOnEditorSwitch("mcuhelper.lexerErrors"), "keep-diagnostics");
    assert.equal(sidebarPanelModeOnEditorSwitch("mcuhelper.materials"), "loading");
    assert.equal(sidebarPanelModeOnEditorSwitch("mcuhelper.constants"), "loading");
  });
});
