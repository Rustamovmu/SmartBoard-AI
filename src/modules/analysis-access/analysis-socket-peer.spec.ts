import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { AnalysisSocketPeer } from './analysis-socket-peer';
import type {
  AnalysisRegistryService,
  AnalysisStream,
} from './analysis-registry.service';

describe('analysis peer bounds', () => {
  let socket: EventEmitter & {
    readyState: number;
    bufferedAmount: number;
    send: jest.Mock;
    close: jest.Mock;
    terminate: jest.Mock;
  };
  let peer: AnalysisSocketPeer;
  const command = (type: string) =>
    Buffer.from(
      JSON.stringify({
        protocolVersion: 1,
        streamId: 'synthetic-stream',
        type,
      }),
    );
  beforeEach(() => {
    jest.useFakeTimers();
    socket = Object.assign(new EventEmitter(), {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
    });
    peer = new AnalysisSocketPeer(
      socket as unknown as WebSocket,
      {
        id: 'synthetic-stream',
        binding: { expiresAt: Date.now() + 900_000 },
      } as AnalysisStream,
      'analyze',
      {
        isCurrent: () => true,
        detach: jest.fn(),
      } as unknown as AnalysisRegistryService,
      jest.fn(),
    );
  });
  afterEach(() => {
    socket.emit('close');
    jest.useRealTimers();
  });

  it('closes slow consumers without adding queued application bytes', () => {
    socket.bufferedAmount = 16_384;
    peer.ready();
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1013, 'Connection closed.');
    jest.advanceTimersByTime(1_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('transport pongs do not extend inactivity; valid commands do', () => {
    jest.advanceTimersByTime(20_000);
    socket.emit('message', command('heartbeat'), false);
    jest.advanceTimersByTime(20_000);
    socket.emit('pong', Buffer.alloc(0));
    peer.checkIdle();
    expect(socket.close).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10_000);
    peer.checkIdle();
    expect(socket.close).toHaveBeenCalledWith(1000, 'Connection closed.');
  });

  it('rejects reentrant commands instead of retaining a command backlog', () => {
    socket.send.mockImplementationOnce(() =>
      socket.emit('message', command('status'), false),
    );
    socket.emit('message', command('heartbeat'), false);
    expect(socket.close).toHaveBeenCalledWith(1013, 'ANALYSIS_BUSY');
  });
});
