import config from 'config';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Socket, Server } from 'socket.io';
import * as mediasoup from 'mediasoup';
import { WorkerSettings, Worker } from 'mediasoup/lib/types'
import { types as mediasoupTypes } from "mediasoup";

import { IPeerConnection } from './wss.interfaces';
import { WssRoom } from './wss.room';

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
        worker: worker as Worker,
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
  

  private async loadRoom(peerConnection: IPeerConnection): Promise<mediasoupTypes.RtpCapabilities> {
    try {
      const { peerId } = peerConnection;
      let room = this.rooms.get(peerId);

      if (!room) {
        // this.updateWorkerStats();

        const index = this.getOptimalWorkerIndex();

        room = new WssRoom(this.workers[index].worker, index, peerId, this.server);

        await room.load();

        this.rooms.set(peerId, room);

        this.logger.log(`room ${peerId} created`);
      }

      // await room.addClient(query, client);
      const rtpCapabilities = room.getRouterRtpCapabilities() as mediasoupTypes.RtpCapabilities
      
      this.logger.log(`rtpCapabilities ${rtpCapabilities}`);

      return {
        rtpCapabilities
      }
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - handleConnection');
    }
  }

  @SubscribeMessage('publishRoom')
  async publishRoom(@MessageBody() data: IPeerConnection): Promise<mediasoupTypes.RtpCapabilities> {
    this.logger.log('publishRoom', data);

    return this.loadRoom(data)
    // return true
  }

  @SubscribeMessage('unpublishRoom')
  unpublishRoom(@MessageBody() data: any): Boolean {
    this.logger.log('unpublishRoom', data);
    return true
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
  
  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }
}