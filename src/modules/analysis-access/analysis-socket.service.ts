import {
  HttpException,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import {
  ANALYSIS_TRANSPORT,
  type AnalysisEndpoint,
} from '../../contracts/analysis-transport-v1';
import { ANALYSIS_ERRORS, type AnalysisErrorCode } from './analysis.errors';
import { AnalysisConfig } from './analysis.config';
import { AnalysisRegistryService } from './analysis-registry.service';
import { AnalysisSocketPeer } from './analysis-socket-peer';

@Injectable()
export class AnalysisSocketService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: ANALYSIS_TRANSPORT.maxMessageBytes,
    perMessageDeflate: false,
  });
  private readonly peers = new Set<AnalysisSocketPeer>();
  private readonly upgrading = new Set<Duplex>();
  private http?: Server;
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private readonly upgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    void this.accept(req, socket, head);
  };

  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly config: AnalysisConfig,
    private readonly registry: AnalysisRegistryService,
  ) {
    this.server.on('error', () => undefined);
  }

  onApplicationBootstrap() {
    // Operator commands use AppModule in a non-HTTP application context.
    const httpAdapter = this.adapter.httpAdapter;
    if (!httpAdapter) return;
    this.http = httpAdapter.getHttpServer() as Server;
    this.http.on('upgrade', this.upgrade);
    if (this.config.enabled)
      this.timer = setInterval(() => {
        for (const peer of this.peers) peer.checkIdle();
      }, 100);
  }

  private async accept(req: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => undefined);
    const endpoint: AnalysisEndpoint | undefined =
      req.url === '/ws/analyze'
        ? 'analyze'
        : req.url === '/ws/control'
          ? 'control'
          : undefined;
    if (!endpoint) {
      this.reject(socket, 404, 'VALIDATION_ERROR');
      return;
    }
    let stream:
      Awaited<ReturnType<AnalysisRegistryService['redeem']>> | undefined;
    try {
      if (
        this.stopping ||
        !this.config.enabled ||
        this.upgrading.size + this.peers.size >=
          ANALYSIS_TRANSPORT.maxStreams * 2
      )
        throw new ServiceUnavailableException();
      if (
        req.headers.origin !== undefined ||
        req.headers.cookie !== undefined ||
        req.headers['x-smartbord-client'] !== 'native'
      )
        throw new ForbiddenException();
      // Node joins/discards some repeated headers: inspect the original names too.
      const names = req.rawHeaders
        .filter((_, i) => i % 2 === 0)
        .map((name) => name.toLowerCase());
      if (
        [
          'authorization',
          'x-smartbord-client',
          'sec-websocket-key',
          'sec-websocket-version',
        ].some((name) => names.filter((n) => n === name).length !== 1)
      )
        throw new BadRequestException();
      if (
        req.method !== 'GET' ||
        req.headers.upgrade?.toLowerCase() !== 'websocket' ||
        req.headers['sec-websocket-version'] !== '13' ||
        typeof req.headers['sec-websocket-key'] !== 'string' ||
        !/^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key']) ||
        req.headers['sec-websocket-protocol'] !== undefined
      )
        throw new BadRequestException();
      const authorization = req.headers.authorization;
      delete req.headers.authorization;
      req.rawHeaders = [];
      if (
        typeof authorization !== 'string' ||
        !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)
      )
        throw new UnauthorizedException();
      this.upgrading.add(socket);
      stream = await this.registry.redeem(authorization.slice(7), endpoint);
      if (this.stopping || socket.destroyed || !this.registry.isCurrent(stream))
        throw new UnauthorizedException();
      const current = stream;
      let attached = false;
      this.server.handleUpgrade(req, socket, head, (ws) => {
        const peer = new AnalysisSocketPeer(
          ws,
          current,
          endpoint,
          this.registry,
          () => this.peers.delete(peer),
        );
        attached = this.registry.attach(current, endpoint, peer);
        if (!attached) {
          ws.terminate();
          return;
        }
        this.peers.add(peer);
        peer.ready();
      });
      if (!attached) this.registry.detach(current, endpoint);
    } catch (error) {
      if (stream) this.registry.detach(stream, endpoint);
      const status = error instanceof HttpException ? error.getStatus() : 503;
      const code: AnalysisErrorCode =
        status === 401
          ? 'UNAUTHENTICATED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 400
              ? 'VALIDATION_ERROR'
              : 'SERVICE_UNAVAILABLE';
      this.reject(socket, status, code);
    } finally {
      this.upgrading.delete(socket);
    }
  }

  private reject(socket: Duplex, status: number, code: AnalysisErrorCode) {
    if (socket.destroyed) return;
    const body = JSON.stringify({
      statusCode: status,
      code,
      message: ANALYSIS_ERRORS[code],
    });
    socket.end(
      `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      () => socket.destroy(),
    );
    // Do not leave an unauthenticated half-open TCP socket after the response.
  }

  async onModuleDestroy() {
    this.stopping = true;
    this.http?.off('upgrade', this.upgrade);
    if (this.timer) clearInterval(this.timer);
    for (const socket of this.upgrading) socket.destroy();
    this.upgrading.clear();
    for (const peer of this.peers) peer.close('shutdown');
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
