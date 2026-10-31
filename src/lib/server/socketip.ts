import http from 'node:http';
import https from 'node:https';

/** Private header carrying the address of the connection a request arrived on, for clientip.ts. */
export const SOCKET_HEADER = 'x-folio-socket-ip';

/**
 * Next.js gives pages and routes no way to read the connection's address, and its own x-forwarded-for keeps whatever
 * the client sent. So, once at start-up, every incoming request is stamped with its real socket address in a private
 * header, after removing any copy a client sent itself.
 */
export function installSocketStamp() {
  const g = globalThis as unknown as { folioSocketStamp?: boolean };
  if (g.folioSocketStamp) return;
  g.folioSocketStamp = true;
  for (const proto of [http.Server.prototype, https.Server.prototype] as { emit: (event: string, ...args: unknown[]) => boolean }[]) {
    const emit = proto.emit;
    proto.emit = function (this: unknown, event: string, ...args: unknown[]) {
      if (event === 'request') {
        const req = args[0] as http.IncomingMessage;
        delete req.headers[SOCKET_HEADER];
        const a = req.socket && req.socket.remoteAddress;
        if (a) req.headers[SOCKET_HEADER] = a;
      }
      return emit.call(this, event, ...args);
    };
  }
}
