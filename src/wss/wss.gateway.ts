import config from 'config';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import io, { Socket, Server } from 'socket.io';
import * as mediasoup from 'mediasoup';
import { WorkerSettings } from 'mediasoup/lib/types'
import { types as mediasoupTypes } from "mediasoup";
import { Worker } from 'mediasoup/lib/types';

import { IPeerConnection, IProducerConnectorTransport, IPeerTransport, IProduceTrack, IRoomMessageWrapper } from './wss.interfaces';
import { WssRoom } from './wss.room';
import { throwRoomNotFound } from 'src/common/errors';

const mediasoupSettings = config.get<IMediasoupSettings>('MEDIASOUP_SETTINGS');

@WebSocketGateway()
export class WssGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect{
  @WebSocketServer()
  public server: Server;
  public rooms: Map<string, WssRoom> = new Map();

  private logger: Logger = new Logger('WssGateway');
  public workers: { [index: number]: { clientsCount: number; roomsCount: number; pid: number; worker: Worker } };

  constructor() {
    this.createWorkers();
  }

  private async createWorkers(): Promise<void> {
    const promises = [];
    for (let i = 0; i < mediasoupSettings.workerPool; i++) {
      promises.push(mediasoup.createWorker(mediasoupSettings.worker as WorkerSettings));
    }

    this.workers = (await Promise.all(promises)).reduce((acc, worker, index) => {
      acc[index] = {
        clientsCount: 0,
        roomsCount: 0,
        pid: worker.pid,
        worker: worker,
      };

      return acc;
    }, {});
  }

  // private getClientQuery(client: io.Socket): IClientQuery {
  //   return client.handshake.query as unknown as IClientQuery;
  // }

  private getOptimalWorkerIndex(): number {
    return parseInt(
      Object.entries(this.workers).reduce((prev, curr) => {
        if (prev[1].clientsCount < curr[1].clientsCount) {
          return prev;
        }
        return curr;
      })[0],
      10
    );
  }

  private async loadRoom(peerConnection: IPeerConnection, socket: io.Socket): Promise<mediasoupTypes.RtpCapabilities> {
    try {
      const { peerId, room: roomName, profile } = peerConnection;
      this.logger.debug('peerConnection', JSON.stringify(peerConnection))
      let room = this.rooms.get(roomName);
      this.logger.log('Checking room status')
      this.logger.log('isLoaded', Boolean(room))
      if (!room) {
        // this.updateWorkerStats();

        const index = this.getOptimalWorkerIndex();
        room = new WssRoom(this.workers[index].worker, index, roomName, this.server);

        await room.load();

        room.setHost({ io: socket, id: peerId, profile, media: {} })
        this.rooms.set(roomName, room);

        this.logger.log(`room ${roomName} created`);
      }

      socket.on('disconnect', u => {
        this.logger.log('user disconnected', u)
        room.onPeerSocketDisconnect(peerId, isHost => {
          if (isHost) {
            this.rooms.delete(roomName)
          }
        })
      })

      await room.addClient(peerId, socket, profile);
      const rtpCapabilities = room.getRouterRtpCapabilities() as mediasoupTypes.RtpCapabilities
      
      this.logger.log(`rtpCapabilities ${rtpCapabilities}`);

      return rtpCapabilities
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - handleConnection');
    }
  }

  @SubscribeMessage('joinRoom')
  async joinRoom(
    @MessageBody() data: IPeerConnection,
    @ConnectedSocket() socket: Socket,
  ): Promise<mediasoupTypes.RtpCapabilities> {
    return this.loadRoom(data, socket)
  }

  @SubscribeMessage('createWebRTCTransport')
  async createWebRTCTransport(@MessageBody() data: IPeerTransport): Promise<any> {
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null)
    return room.createWebRtcTransport({ type: data.type }, data.peerId)
  }

  @SubscribeMessage('sendMessage')
  async onNewMessage(@MessageBody() data: IRoomMessageWrapper): Promise<any> {
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null)
    return room.broadcastAll('newMessage', {
      ...data.message,
      room: data.room
    })
  }


  @SubscribeMessage('consume')
  async consume(@MessageBody() data: IPeerTransport): Promise<any> {
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null)
    return room.consume(data)
  }

  @SubscribeMessage('connectWebRTCTransport')
  async connectWebRTCTransport(@MessageBody() data: IProducerConnectorTransport): Promise<any> {
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null)
    return room.connectWebRTCTransport(data)
  }

  @SubscribeMessage('produce')
  produce(@MessageBody() data: IProduceTrack): Promise<string> {
    const room = this.rooms.get(data.room);
    if (room) return room.produce(data as IProduceTrack)
    return Promise.resolve(null)
  }

  @SubscribeMessage('unpublishRoom')
  unpublishRoom(@MessageBody() data: any): Promise<void> {
    this.logger.log('unpublishRoom', data);
    const room = this.rooms.get(data.room);
    if (room) return room.close()
    return Promise.resolve()
  }

  @SubscribeMessage('sendGift')
  async sendGift(@MessageBody() data: any): Promise<void> {
    this.logger.log('sendGift', data);
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null)

    await room.sendGift(data.gift, data.peerId)
    return Promise.resolve()
  }

  @SubscribeMessage('requestVideoChat')
  requestVideoChat(@MessageBody() data: any): Promise<any> {
    this.logger.log('requestVideoChat', data);
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null)
    return room.requestVideoChat(data.peerId)
  }
  
  afterInit() {
    this.logger.log('Init');
  }

  @SubscribeMessage('identity')
  async identity(@MessageBody() data: number): Promise<number> {
    return data;
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
  
  handleConnection(client: io.Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }
}