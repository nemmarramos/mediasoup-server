import config from 'config';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import {
  IProducerConnectorTransport,
  IPeerTransport,
  IProduceTrack,
} from './wss.interfaces';
import { BaseGateway } from '@nramos/nest-mediasoup-base'

import { throwRoomNotFound } from '../common/errors';

const mediasoupSettings = config.get<IMediasoupSettings>('MEDIASOUP_SETTINGS');

@WebSocketGateway()
export class WssGateway extends BaseGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private logger: Logger = new Logger('WssGateway');

  // private getClientQuery(client: io.Socket): IClientQuery {
  //   return client.handshake.query as unknown as IClientQuery;
  // }

  constructor() {
    super(mediasoupSettings)
  }

  @SubscribeMessage('createWebRTCTransport')
  async createWebRTCTransport(
    @MessageBody() data: IPeerTransport,
  ): Promise<any> {
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null);
    return room.createWebRtcTransport({ type: data.type }, data.peerId);
  }

//   @SubscribeMessage('sendMessage')
//   async onNewMessage(@MessageBody() data: IRoomMessageWrapper): Promise<any> {
//     const room = this.rooms.get(data.room);
//     if (!room) return throwRoomNotFound(null);
//     return room.broadcastAll('newMessage', {
//       ...data.message,
//       room: data.room,
//     });
//   }

//   @SubscribeMessage('consume')
//   async consume(@MessageBody() data: IPeerTransport): Promise<any> {
//     const room = this.rooms.get(data.room);
//     if (!room) return throwRoomNotFound(null);
//     return room.consume(data);
//   }

  @SubscribeMessage('connectWebRTCTransport')
  async connectWebRTCTransport(
    @MessageBody() data: IProducerConnectorTransport,
  ): Promise<any> {
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null);
    return room.connectWebRTCTransport(data);
  }

  @SubscribeMessage('produce')
  produce(@MessageBody() data: IProduceTrack): Promise<string> {
    const room = this.rooms.get(data.room);
    if (room) return room.produce(data as IProduceTrack);
    return Promise.resolve(null);
  }

  @SubscribeMessage('unpublishRoom')
  unpublishRoom(@MessageBody() data: any): Promise<void> {
    this.logger.log('unpublishRoom', data);
    const room = this.rooms.get(data.room);
    if (room) return room.close();
    return Promise.resolve();
  }

  @SubscribeMessage('sendGift')
  async sendGift(@MessageBody() data: any): Promise<void> {
    this.logger.log('sendGift', data);
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null);

    // await room.sendGift(data.gift, data.peerId);
    return Promise.resolve();
  }

  @SubscribeMessage('requestVideoChat')
  requestVideoChat(@MessageBody() data: any): Promise<any> {
    this.logger.log('requestVideoChat', data);
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null);
    // return room.requestVideoChat(data.peerId);
  }

  @SubscribeMessage('acceptVideoChatRequest')
  acceptVideoChatRequest(@MessageBody() data: any): Promise<any> {
    this.logger.log('acceptVideoChatRequest', data);
    const room = this.rooms.get(data.room);
    if (!room) return throwRoomNotFound(null);
    // return room.acceptVideoChatRequest(data.peerId);
  }

  afterInit() {
    this.logger.log('Init');
  }

  @SubscribeMessage('identity')
  async identity(@MessageBody() data: number): Promise<number> {
    return data;
  }
}
