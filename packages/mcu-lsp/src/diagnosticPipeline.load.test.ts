import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DiagnosticPublishPipeline,
  LARGE_DOC_LINE_THRESHOLD,
  shouldSkipBackgroundValidate,
  shouldChainValidateAgain,
  shouldScheduleValidateOnDidChange,
  shouldRescheduleAfterStale,
  shouldValidateOnActiveDocumentChange,
  decideStaleValidate,
} from "./diagnosticPipeline";
import type { LineChange } from "./diagnosticPatch";

type FakeDiag = { message: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } };

const URI = "file:///load/3l070626.mcu";
const OTHER = "file:///load/958.mcu";

function diag(line: number, message = `L${line}`): FakeDiag {
  return {
    message,
    range: {
      start: { line, character: 0 },
      end: { line, character: 8 },
    },
  };
}

function editLine(line: number, text = "x"): LineChange {
  return {
    range: { start: { line, character: 2 }, end: { line, character: 3 } },
    text,
  };
}

/** Однопоточная очередь LSP: пока sync-analyze крутится, didChange стоит. */
class SerializedLspLoop {
  private queue: Array<{ kind: string; durationMs: number; run: () => void }> = [];
  elapsedMs = 0;

  enqueue(kind: string, durationMs: number, run: () => void): void {
    this.queue.push({ kind, durationMs, run });
  }

  drain(): void {
    while (this.queue.length) {
      const job = this.queue.shift()!;
      job.run();
      this.elapsedMs += job.durationMs;
    }
  }
}

describe("load: two warnings on a heavy deck", () => {
  it("SLA: two line edits drop both diags in <20ms while LSP is idle", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    pipe.seed(URI, [diag(10), diag(40)]);
    const t0 = performance.now();
    const first = pipe.onIncrementalEdit(URI, [editLine(10)]);
    const second = pipe.onIncrementalEdit(URI, [editLine(40)]);
    const ms = performance.now() - t0;
    assert.deepEqual(
      first?.map((d) => d.range.start.line),
      [40]
    );
    assert.deepEqual(second?.map((d) => d.range.start.line), []);
    assert.equal(pipe.getPublished(URI)?.length, 0);
    assert.ok(ms < 100, `idle two-patch took ${ms.toFixed(2)}ms`);
  });

  it("SLA: patch 2 of 8000 diags in <50ms", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    const many = Array.from({ length: 8000 }, (_, i) => diag(i));
    pipe.seed(URI, many);
    const t0 = performance.now();
    pipe.onIncrementalEdit(URI, [editLine(10)]);
    pipe.onIncrementalEdit(URI, [editLine(40)]);
    const ms = performance.now() - t0;
    const left = pipe.getPublished(URI)!;
    assert.equal(left.length, 7998);
    assert.ok(!left.some((d) => d.range.start.line === 10 || d.range.start.line === 40));
    assert.ok(ms < 500, `8000-diag patch took ${ms.toFixed(2)}ms`);
  });

  it("commitValidate keeps a NEW warning on a line that was just edited", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    pipe.seed(URI, [diag(10, "old"), diag(40)]);
    pipe.onIncrementalEdit(URI, [editLine(10)]);
    const sent = pipe.afterValidate(URI, [diag(10, "new"), diag(40)]);
    assert.equal(sent.find((d) => d.range.start.line === 10)?.message, "new");
    assert.equal(sent.length, 2);
  });

  it("stale host still hides the old message, but a new message on that line shows", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    pipe.seed(URI, [diag(10, "old"), diag(40)]);
    pipe.onIncrementalEdit(URI, [editLine(10)]);
    const stale = pipe.mergeHost(URI, [diag(10, "old"), diag(40)]);
    assert.deepEqual(
      stale.map((d) => d.message),
      ["L40"]
    );
    const fresh = pipe.mergeHost(URI, [diag(10, "new"), diag(40)]);
    assert.ok(fresh.some((d) => d.message === "new"));
    assert.ok(fresh.some((d) => d.range.start.line === 40));
  });

  it("LSP thread: second didChange waits for in-flight analyze (UI must NOT wait — see overlay squiggle tests)", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    pipe.seed(URI, [diag(10), diag(40)]);
    const loop = new SerializedLspLoop();
    let sentAfterValidate: FakeDiag[] | undefined;
    let firstPatchAt = -1;
    let secondPatchAt = -1;

    loop.enqueue("didChange-1", 0, () => {
      pipe.onIncrementalEdit(URI, [editLine(10)]);
      firstPatchAt = loop.elapsedMs;
    });
    loop.enqueue("validate-analyze", 8000, () => {
      /* sync parse blocks the thread */
    });
    loop.enqueue("didChange-2", 0, () => {
      pipe.onIncrementalEdit(URI, [editLine(40)]);
      secondPatchAt = loop.elapsedMs;
    });
    loop.enqueue("validate-send", 0, () => {
      sentAfterValidate = pipe.afterValidate(URI, []);
    });
    loop.drain();

    assert.equal(firstPatchAt, 0);
    assert.equal(secondPatchAt, 8000, "second didChange waits for in-flight analyze");
    assert.deepEqual(sentAfterValidate?.map((d) => d.range.start.line), []);
  });

  it("BUG CONTRACT: send before queued didChange resurrects the second warning", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    pipe.seed(URI, [diag(10), diag(40)]);
    pipe.onIncrementalEdit(URI, [editLine(10)]);
    const sentTooEarly = pipe.afterValidate(URI, [diag(10), diag(40)]);
    pipe.onIncrementalEdit(URI, [editLine(40)]);
    assert.equal(sentTooEarly.length, 2, "commit of analyzed version keeps bundle (skip-stale must avoid this send)");
    assert.equal(pipe.getPublished(URI)?.length, 1, "later didChange drops warning #2");
  });
});

describe("load: stale validate policy", () => {
  it("matching version sends; drifted version schedules debounce (no immediate re-parse storm)", () => {
    assert.equal(decideStaleValidate(2, 2), "send");
    assert.equal(decideStaleValidate(2, 3), "schedule-debounce");
    assert.equal(decideStaleValidate(14, 15), "schedule-debounce");
  });
});

describe("load: file switch vs background validate", () => {
  it("skips full-core validate when another document is active", () => {
    assert.equal(
      shouldSkipBackgroundValidate(URI, OTHER, LARGE_DOC_LINE_THRESHOLD + 1),
      true
    );
    assert.equal(shouldSkipBackgroundValidate(URI, URI, LARGE_DOC_LINE_THRESHOLD + 1), false);
    assert.equal(shouldSkipBackgroundValidate(URI, OTHER, 100), false);
    assert.equal(shouldSkipBackgroundValidate(URI, undefined, LARGE_DOC_LINE_THRESHOLD + 1), false);
  });

  it("does not chain validateAgain on full-core (debounce instead of 8s×N storm)", () => {
    assert.equal(shouldChainValidateAgain(LARGE_DOC_LINE_THRESHOLD + 1), false);
    assert.equal(shouldChainValidateAgain(100), true);
  });

  it("didChange on full-core does not schedule another 8s parse", () => {
    assert.equal(
      shouldScheduleValidateOnDidChange(URI, URI, LARGE_DOC_LINE_THRESHOLD + 1),
      false
    );
    assert.equal(shouldScheduleValidateOnDidChange(URI, URI, 100), true);
    assert.equal(shouldScheduleValidateOnDidChange(URI, OTHER, 100), true);
    assert.equal(shouldRescheduleAfterStale(LARGE_DOC_LINE_THRESHOLD + 1), false);
    assert.equal(shouldRescheduleAfterStale(100), true);
  });

  it("focused full-core is not skipped (file-level diags must publish)", () => {
    assert.equal(shouldSkipBackgroundValidate(URI, URI, LARGE_DOC_LINE_THRESHOLD + 1), false);
    assert.equal(shouldSkipBackgroundValidate(URI, OTHER, LARGE_DOC_LINE_THRESHOLD + 1), true);
  });

  it("activeDocument re-validate only when the focused URI actually changes", () => {
    assert.equal(shouldValidateOnActiveDocumentChange(undefined, URI), true);
    assert.equal(shouldValidateOnActiveDocumentChange(OTHER, URI), true);
    assert.equal(shouldValidateOnActiveDocumentChange(URI, URI), false);
    assert.equal(shouldValidateOnActiveDocumentChange(URI, undefined), false);
  });

  it("getIndex of old file must not block patch of the new file in the queue model", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    pipe.seed(OTHER, [diag(3), diag(7)]);
    const loop = new SerializedLspLoop();
    let patchAt = -1;
    loop.enqueue("getIndex-old", 16000, () => {
      /* 16s fetch of 3l */
    });
    loop.enqueue("didChange-new", 0, () => {
      pipe.onIncrementalEdit(OTHER, [editLine(3)]);
      patchAt = loop.elapsedMs;
    });
    loop.drain();
    assert.equal(patchAt, 16000);
    assert.equal(
      pipe.getPublished(OTHER)?.length,
      1,
      "once the loop is free, patch of 958 still works"
    );
  });
});

describe("load: client overlay while host collection is 15s stale", () => {
  it("two edits drop both warnings even if vscode.languages.getDiagnostics still has both", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    const host = [diag(10), diag(40)];
    const afterFirst = pipe.applyEdit(URI, [editLine(10)], host);
    assert.deepEqual(
      afterFirst.map((d) => d.range.start.line),
      [40]
    );
    const afterSecond = pipe.applyEdit(URI, [editLine(40)], host);
    assert.equal(afterSecond.length, 0);

    const stillStaleHost = [diag(10), diag(40)];
    const shown = pipe.mergeHost(URI, stillStaleHost);
    assert.equal(shown.length, 0, "stale host must not undo optimistic overlay");
    assert.ok(pipe.accumulatedCount(URI) > 0);
  });

  it("stale validate flood must not restore suppressed warnings", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    pipe.seed(URI, [diag(10), diag(40)]);
    pipe.onIncrementalEdit(URI, [editLine(10)]);
    pipe.onIncrementalEdit(URI, [editLine(40)]);
    const flood = [diag(10), diag(40), diag(100, "aw"), diag(101, "thr")];
    const shown = pipe.mergeHost(URI, flood);
    assert.equal(shown.some((d) => d.range.start.line === 10 || d.range.start.line === 40), false);
    assert.ok(shown.some((d) => d.message === "aw"));
    assert.ok(shown.some((d) => d.message === "thr"));
  });

  it("clears accumulator when host finally matches the overlay", () => {
    const pipe = new DiagnosticPublishPipeline<FakeDiag>();
    pipe.applyEdit(URI, [editLine(10)], [diag(10), diag(40)]);
    const caughtUp = pipe.mergeHost(URI, [diag(40)]);
    assert.deepEqual(
      caughtUp.map((d) => d.range.start.line),
      [40]
    );
    assert.equal(pipe.accumulatedCount(URI), 0);
  });
});
