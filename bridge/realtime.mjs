import { createHash } from "node:crypto";

const transcriptSnapshotLimit = 16;
const transcriptSnapshotTtlMs = 15 * 60 * 1000;

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("base64url")
    .slice(0, 20);
}

function summarizeSession(session) {
  return {
    sessionId: session.sessionId,
    sessionType: session.sessionType ?? null,
    title: session.title ?? null,
    initialMessage: session.initialMessage ?? null,
    model: session.model ?? null,
    isRunning: Boolean(session.isRunning),
    isArchived: Boolean(session.isArchived),
    createdAt: session.createdAt ?? null,
    lastActivityAt: session.lastActivityAt ?? null,
  };
}

export function createRealtimeController({ desktop, isChatSession, ApiError }) {
  const clients = new Map();
  const transcripts = new Map();
  let latestSessions = null;
  let latestSessionsDigest = "";
  let revision = 0;
  let statePollInFlight = false;
  let eventPollInFlight = false;

  function send(response, event, data) {
    if (response.destroyed || response.writableEnded) return false;
    try {
      revision += 1;
      response.write(`id: ${revision}\n`);
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      clients.delete(response);
      return false;
    }
  }

  function broadcast(event, data, predicate = () => true) {
    for (const [response, subscription] of clients) {
      if (predicate(subscription)) send(response, event, data);
    }
  }

  async function pollState() {
    if (!clients.size || statePollInFlight) return;
    statePollInFlight = true;
    try {
      const sessions = await desktop.invoke("LocalAgentModeSessions", "getAll", []);
      const summaries = sessions.map(summarizeSession);
      const snapshot = {
        chat: summaries.filter(isChatSession),
        cowork: summaries.filter((session) => !isChatSession(session)),
        observedAt: new Date().toISOString(),
      };
      const sessionsDigest = digest({ chat: snapshot.chat, cowork: snapshot.cowork });
      if (sessionsDigest !== latestSessionsDigest) {
        latestSessions = snapshot;
        latestSessionsDigest = sessionsDigest;
        broadcast("sessions", snapshot);
      }

      const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
      const selectedIds = new Set(
        [...clients.values()].map((item) => item.sessionId).filter(Boolean),
      );
      const now = Date.now();
      for (const [sessionId, snapshotValue] of transcripts) {
        if (
          !selectedIds.has(sessionId)
          || now - (snapshotValue.lastAccessedAt ?? snapshotValue.polledAt)
            > transcriptSnapshotTtlMs
        ) transcripts.delete(sessionId);
      }
      for (const sessionId of selectedIds) {
        const session = sessionsById.get(sessionId);
        if (!session) continue;
        const previous = transcripts.get(sessionId);
        const activityKey = `${session.lastActivityAt ?? ""}:${Boolean(session.isRunning)}`;
        const shouldPoll = !previous
          || session.isRunning
          || previous.activityKey !== activityKey
          || now - previous.polledAt >= 10000;
        if (!shouldPoll) continue;

        try {
          const transcript = await desktop.invoke(
            "LocalAgentModeSessions",
            "getTranscript",
            [sessionId],
          );
          const transcriptDigest = digest(transcript);
          transcripts.set(sessionId, {
            activityKey,
            digest: transcriptDigest,
            isRunning: Boolean(session.isRunning),
            lastAccessedAt: now,
            polledAt: now,
            value: transcript,
          });
          while (transcripts.size > transcriptSnapshotLimit) {
            transcripts.delete(transcripts.keys().next().value);
          }
          if (transcriptDigest !== previous?.digest || activityKey !== previous?.activityKey) {
            broadcast(
              "transcript",
              {
                sessionId,
                value: transcript,
                isRunning: Boolean(session.isRunning),
                observedAt: new Date().toISOString(),
              },
              (subscription) => subscription.sessionId === sessionId,
            );
          }
        } catch (error) {
          broadcast(
            "sync-error",
            { sessionId, error: error.message },
            (subscription) => subscription.sessionId === sessionId,
          );
        }
      }
    } catch (error) {
      broadcast("sync-error", { error: error.message });
    } finally {
      statePollInFlight = false;
    }
  }

  async function pollDesktopEvents() {
    if (!clients.size || eventPollInFlight) return;
    eventPollInFlight = true;
    try {
      const events = await desktop.pollEvents();
      for (const event of events) broadcast("desktop-ipc", event);
    } catch (error) {
      broadcast("sync-error", { error: error.message });
    } finally {
      eventPollInFlight = false;
    }
  }

  function open(request, response, url) {
    const mode = url.searchParams.get("mode") || "chat";
    const sessionId = url.searchParams.get("sessionId") || null;
    if (!new Set(["chat", "cowork", "code"]).has(mode)) {
      throw new ApiError(400, "invalid realtime mode");
    }
    if (sessionId && (sessionId.length > 200 || !/^[A-Za-z0-9_-]+$/.test(sessionId))) {
      throw new ApiError(400, "invalid realtime sessionId");
    }

    response.writeHead(200, {
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    response.write(": connected\n\n");
    clients.set(response, { mode, sessionId });
    send(response, "hello", {
      ok: true,
      transport: "server-sent-events",
      mode,
      sessionId,
    });
    if (latestSessions) send(response, "sessions", latestSessions);
    const transcript = sessionId ? transcripts.get(sessionId) : null;
    if (transcript) {
      send(response, "transcript", {
        sessionId,
        value: transcript.value,
        isRunning: transcript.isRunning,
        observedAt: new Date().toISOString(),
      });
    }
    void pollState();

    const close = () => {
      clients.delete(response);
      if (
        sessionId
        && ![...clients.values()].some((subscription) => subscription.sessionId === sessionId)
      ) transcripts.delete(sessionId);
    };
    request.on("close", close);
    response.on("close", close);
  }

  function pruneClosedClients() {
    for (const response of clients.keys()) {
      if (response.destroyed || response.writableEnded) clients.delete(response);
    }
  }

  function heartbeat() {
    pruneClosedClients();
    for (const response of clients.keys()) response.write(`: heartbeat ${Date.now()}\n\n`);
  }

  return { heartbeat, open, pollDesktopEvents, pollState };
}
