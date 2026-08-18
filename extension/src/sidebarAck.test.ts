import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIDEBAR_ACK_TIMEOUT_MS,
  shouldAcceptActiveDocumentAck,
  shouldFallbackRefreshAfterAckTimeout,
  shouldHandshakeBeforeSidebarRefresh,
  shouldNotifyActiveDocument,
} from "./sidebarAck";

const LARGE = "file:///load/3l070626.mcu";
const SMALL = "file:///load/958.mcu";

describe("sidebar activeDocument handshake", () => {
  it("waits for ack only on editor switch, not on scheduleRefresh", () => {
    assert.equal(shouldHandshakeBeforeSidebarRefresh("editor-switch"), true);
    assert.equal(shouldHandshakeBeforeSidebarRefresh("schedule-refresh"), false);
    assert.equal(shouldHandshakeBeforeSidebarRefresh("lsp-ready"), false);
  });

  it("notifies the server on switch and LSP ready, not on ordinary refresh", () => {
    assert.equal(shouldNotifyActiveDocument("editor-switch"), true);
    assert.equal(shouldNotifyActiveDocument("lsp-ready"), true);
    assert.equal(shouldNotifyActiveDocument("schedule-refresh"), false);
  });

  it("accepts ack only when it matches both live and pending URI", () => {
    assert.equal(
      shouldAcceptActiveDocumentAck({ ackUri: SMALL, liveUri: SMALL, pendingUri: SMALL }),
      true
    );
    assert.equal(
      shouldAcceptActiveDocumentAck({ ackUri: SMALL, liveUri: LARGE, pendingUri: SMALL }),
      false
    );
    assert.equal(
      shouldAcceptActiveDocumentAck({ ackUri: SMALL, liveUri: SMALL, pendingUri: LARGE }),
      false
    );
    assert.equal(
      shouldAcceptActiveDocumentAck({ ackUri: SMALL, liveUri: SMALL, pendingUri: undefined }),
      false
    );
    assert.equal(
      shouldAcceptActiveDocumentAck({ ackUri: undefined, liveUri: SMALL, pendingUri: SMALL }),
      false
    );
  });

  it("falls back to refresh on timeout only while still waiting for the live file", () => {
    assert.equal(
      shouldFallbackRefreshAfterAckTimeout({ pendingUri: SMALL, liveUri: SMALL }),
      true
    );
    assert.equal(
      shouldFallbackRefreshAfterAckTimeout({ pendingUri: SMALL, liveUri: LARGE }),
      false
    );
    assert.equal(
      shouldFallbackRefreshAfterAckTimeout({ pendingUri: undefined, liveUri: SMALL }),
      false
    );
    assert.ok(SIDEBAR_ACK_TIMEOUT_MS >= 1000);
    assert.ok(SIDEBAR_ACK_TIMEOUT_MS <= 5000);
  });
});
