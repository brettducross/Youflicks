import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { assertAppRelativeStreamPath, assertOpaqueStorageKey } from "@/server/playback/opaque-key";
import {
  PLAYBACK_SESSION_TTL_MS,
  type PlaybackSession,
  type PlaybackStatus,
  type PlaybackTransport,
} from "@/server/playback/schema";

export type PlaybackSessionRecord = {
  sessionId: string;
  viewerId: string;
  projectId: string;
  renderJobId: string;
  outputKey: string;
  mimeType: string;
  durationMs: number;
  startMs: number;
  transport: PlaybackTransport;
  streamPath?: string;
  expiresAt: number;
  closedAt?: number;
};

type TokenPayload = {
  v: 1;
  sid: string;
  uid: string;
  pid: string;
  rid: string;
  key: string;
  mime: string;
  dur: number;
  start: number;
  tr: PlaybackTransport;
  exp: number;
};

function appStreamPath(projectId: string, sessionId: string) {
  return `/api/projects/${projectId}/playback/sessions/${encodeURIComponent(sessionId)}/stream`;
}

/**
 * Short-lived signed playback sessions. Runtime only — not a FinishedMovie.
 * Close is recorded in-process; expiry is enforced from the signed token.
 */
export class PlaybackSessionStore {
  private readonly revoked = new Map<string, number>();

  constructor(
    private readonly secret: string,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs: number = PLAYBACK_SESSION_TTL_MS,
  ) {}

  issue(input: {
    viewerId: string;
    projectId: string;
    renderJobId: string;
    outputKey: string;
    mimeType: string;
    durationMs: number;
    startMs?: number;
    transport: PlaybackTransport;
  }): PlaybackSessionRecord {
    const outputKey = assertOpaqueStorageKey(input.outputKey);
    const nonce = randomBytes(16).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    const sessionId = this.sign({
      v: 1,
      sid: nonce,
      uid: input.viewerId,
      pid: input.projectId,
      rid: input.renderJobId,
      key: outputKey,
      mime: input.mimeType,
      dur: input.durationMs,
      start: input.startMs ?? 0,
      tr: input.transport,
      exp: expiresAt,
    });
    const streamPath = input.transport === "APP_STREAM" ? appStreamPath(input.projectId, sessionId) : undefined;
    assertAppRelativeStreamPath(streamPath);
    return {
      sessionId,
      viewerId: input.viewerId,
      projectId: input.projectId,
      renderJobId: input.renderJobId,
      outputKey,
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      startMs: input.startMs ?? 0,
      transport: input.transport,
      streamPath,
      expiresAt,
    };
  }

  read(sessionId: string): PlaybackSessionRecord {
    const record = this.decode(sessionId);
    if (record.closedAt) {
      throw AppError.playbackSessionInvalid("That watch session is closed.");
    }
    if (record.expiresAt <= this.now()) {
      throw AppError.playbackSessionInvalid("That watch session has expired.");
    }
    return record;
  }

  status(sessionId: string): PlaybackStatus {
    try {
      const record = this.decode(sessionId);
      const state = record.closedAt
        ? "CLOSED"
        : record.expiresAt <= this.now()
          ? "EXPIRED"
          : "OPEN";
      return { sessionId, renderJobId: record.renderJobId, state };
    } catch (error) {
      if (error instanceof AppError && error.code === "PLAYBACK_SESSION_INVALID") {
        return { sessionId, renderJobId: "", state: "EXPIRED" };
      }
      throw error;
    }
  }

  close(sessionId: string): void {
    const record = this.decode(sessionId);
    this.revoked.set(record.sessionId, this.now());
  }

  toPublic(record: PlaybackSessionRecord): PlaybackSession {
    return {
      sessionId: record.sessionId,
      renderJobId: record.renderJobId,
      durationMs: record.durationMs,
      mimeType: record.mimeType,
      transport: record.transport,
      streamPath: record.streamPath,
    };
  }

  private decode(sessionId: string): PlaybackSessionRecord {
    const parts = sessionId.split(".");
    if (parts.length !== 2) {
      throw AppError.playbackSessionInvalid("That watch session is not valid.");
    }
    const [body, sig] = parts;
    const expected = this.hmac(body);
    const actual = Buffer.from(sig, "base64url");
    const wanted = Buffer.from(expected, "base64url");
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      throw AppError.playbackSessionInvalid("That watch session is not valid.");
    }
    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    } catch {
      throw AppError.playbackSessionInvalid("That watch session is not valid.");
    }
    if (payload.v !== 1 || !payload.sid || !payload.uid || !payload.pid || !payload.rid || !payload.key) {
      throw AppError.playbackSessionInvalid("That watch session is not valid.");
    }
    assertOpaqueStorageKey(payload.key);
    const reconstructedId = `${body}.${sig}`;
    const streamPath = payload.tr === "APP_STREAM" ? appStreamPath(payload.pid, reconstructedId) : undefined;
    assertAppRelativeStreamPath(streamPath);
    return {
      sessionId: reconstructedId,
      viewerId: payload.uid,
      projectId: payload.pid,
      renderJobId: payload.rid,
      outputKey: payload.key,
      mimeType: payload.mime,
      durationMs: payload.dur,
      startMs: payload.start,
      transport: payload.tr,
      streamPath,
      expiresAt: payload.exp,
      closedAt: this.revoked.get(reconstructedId),
    };
  }

  private sign(payload: TokenPayload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${body}.${this.hmac(body)}`;
  }

  private hmac(body: string) {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }
}
